"""Asistente del editor: de una instrucción en palabras a operaciones del contrato §5.

El agente editor propone en abstracto ("agrega una pulidora junto a pintura"). El motor
decide todo lo demás:
- dónde va cada cosa (el hueco factible más cercano a la estación de referencia);
- si la operación es válida (ids que existen, rutas que no se repiten);
- que nada toque lo fijo ni lo que la instrucción pidió no mover;
- que ninguna cifra venga del modelo: cantidades y porcentajes solo si el usuario los escribió.
Nunca devuelve el plano completo: solo `ops`, `rejected` y `notes`.
"""

from __future__ import annotations

import copy
import re

from . import units
from .agents.roles import EDITOR_SCHEMA, FLOWS, OPS, prompt
from .agents.schema import check
from .catalog import KIND
from .engine import station_map
from .layout import _rect, collisions, nearest_free
from .story import _kind_from_name, _match, normalize, words_to_digits

# Campos que el asistente puede cambiar con update.
UPDATABLE = {"name", "count", "t", "ops", "t_cycle_min", "t_source", "batch", "arrangement"}
GEOMETRY = {"count", "arrangement", "w", "d", "unit_w", "unit_d"}


class Reject(Exception):
    pass


def editor_facts(plant: dict) -> str:
    lines = [f"Bodega de {plant['size']['w']} x {plant['size']['d']} m.", "Estaciones (id: nombre, tipo):"]
    for s in plant["stations"]:
        extra = (f", x{units.count(s)}" if units.count(s) > 1 else "") + (", FIJA" if s.get("locked") else "")
        lines.append(f"- {s['id']}: {s['name']} ({s['kind']}{extra})")
    if plant.get("zones"):
        lines.append("Zonas (id: nombre): " + "; ".join(f"{z['id']}: {z['name']}" + (" (FIJA)" if z.get("locked") else "") for z in plant["zones"]))
    names = {s["id"]: s["name"] for s in plant["stations"]}
    if plant.get("routes"):
        lines.append("Rutas: " + "; ".join(f"{names.get(r['from'], r['from'])} -> {names.get(r['to'], r['to'])}" for r in plant["routes"]))
    lines.append("Tipos de estación: " + ", ".join(KIND))
    return "\n".join(lines)


def instruction_numbers(text: str) -> set[float]:
    t = words_to_digits(normalize(text))
    return {float(x.replace(",", ".")) for x in re.findall(r"\d+(?:[.,]\d+)?", t)}


def protected_refs(text: str) -> list[str]:
    """Lo que la instrucción pide no tocar: "no muevas la columna ni el horno"."""
    t = normalize(text)
    out = []
    for m in re.finditer(r"\bno (?:muevas|mueva|muevan|toques|toque|quites|borres|cambies)\s+(.+?)(?=[,.;]| y no |$)", t):
        for part in re.split(r"\s+(?:ni|y)\s+", m.group(1)):
            part = re.sub(r"^(?:la|el|los|las|a la|al)\s+", "", part.strip())
            if part:
                out.append(part)
    return out


STOP_LOCK = r"(?=[.;]| pero | y (?:reorganiz|reacomod|muev|cambi|optimiz|redistribu)|$)"
LOCK_PATTERNS = [
    r"\bmant[ei]n\w*\s+fij[oa]s?\s+(.+?)" + STOP_LOCK,
    r"(?<![a-z])fij[ae]s?\s+(?!a\b|en\b)(.+?)" + STOP_LOCK,
    r"\bconserv\w*\s+(?:la |las )?(?:posicion(?:es)?|lugar(?:es)?|ubicacion(?:es)?)\s+(?:actual(?:es)?\s+)?de\s+(.+?)" + STOP_LOCK,
    r"\bmant[ei]n\w*\s+(.+?)\s+en sus? (?:sitio|lugar|posicion)",
    r"\bdej[ae]\w*\s+(.+?)\s+(?:donde esta|en su (?:sitio|lugar))",
]
ATTRS = {"dimensiones", "medidas", "tamano", "tamanos", "conexiones", "rutas", "posiciones", "portones", "giro", "orientacion"}
ALL_MACHINES = re.compile(r"^(?:todas? )?(?:las |los )?(?:maquinas|estaciones|equipos)$")


def lock_requests(text: str) -> list[str]:
    """Lo que la instrucción pide dejar fijo: "mantén fija la M1", "conserva las posiciones de las máquinas 1, 3 y 5".
    Una descripción de lugar ("la sierra está al fondo") no fija nada: solo los verbos de conservar."""
    t = words_to_digits(normalize(text))
    refs = []
    for pat in LOCK_PATTERNS:
        for m in re.finditer(pat, t):
            noun = ""
            for part in re.split(r"\s*,\s*|\s+(?:y|e|ni)\s+", m.group(1).strip()):
                part = re.sub(r"^(?:(?:y|e|pero)\s+)?(?:fij[oa]s?\s+)?(?:a |al )?(?:la|el|los|las)\s+", "", part.strip())
                part = re.sub(r"^(?:y|e|pero)\s+", "", part)
                part = re.sub(r"\s+(?:en su (?:posicion|lugar|sitio)(?: actual)?|actual(?:es)?|donde esta)$", "", part)
                # Otra cláusula ("no cambies las medidas") o un atributo no son elementos de la planta.
                if not part or re.match(r"^(?:no|pero|reorganiz|reacomod|muev|cambi|optimiz)\w*\b", part) or part in ATTRS:
                    continue
                head = re.match(r"^([a-z]+?)s?\s+(\d+)$", part)
                if head:
                    noun = head.group(1)
                elif re.fullmatch(r"\d+", part) and noun:
                    # "las máquinas 1, 3 y 5": el número suelto hereda el sustantivo.
                    part = f"{noun} {part}"
                if part not in refs:
                    refs.append(part)
    return refs + [p for p in protected_refs(text) if p not in refs and p not in ATTRS]


class Planner:
    def __init__(self, plant: dict, instruction: str):
        self.work = copy.deepcopy(plant)
        self.work.setdefault("routes", [])
        self.work.setdefault("zones", [])
        self.layout = self.work.setdefault("layout", {})
        self.numbers = instruction_numbers(instruction)
        self.protected = protected_refs(instruction)

    # --- referencias ---
    def station(self, ref) -> dict | None:
        if not ref:
            return None
        st = station_map(self.work)
        if ref in st:
            return st[ref]
        sid = _match(str(ref), self.work["stations"])
        return st.get(sid)

    def zone(self, ref) -> dict | None:
        if not ref:
            return None
        n = normalize(str(ref))
        for z in self.work["zones"]:
            if z["id"] == ref or normalize(z["name"]) == n:
                return z
        for z in self.work["zones"]:
            m = normalize(z["name"])
            if n and (n in m or m in n):
                return z
        return None

    def element(self, ref):
        s = self.station(ref)
        if s:
            return "station", s
        z = self.zone(ref)
        return ("zone", z) if z else (None, None)

    def guard(self, item: dict, verb: str = "mover"):
        name = normalize(item.get("name", ""))
        for p in self.protected:
            if p in name or name in p or p == item["id"]:
                raise Reject(f"La instrucción pide no {verb} «{item['name']}»")
        if item.get("locked"):
            raise Reject(f"«{item['name']}» está fijo" + (f": {item['lock_reason']}" if item.get("lock_reason") else ""))

    def user_number(self, v, what: str):
        if v is None:
            return None
        if float(v) not in self.numbers:
            raise Reject(f"{what} {v} no está en la instrucción: el asistente no inventa cifras")
        return v

    # --- lugar ---
    def target(self, ref):
        kind, it = self.element(ref)
        if kind == "station" and it["id"] in self.layout:
            return tuple(self.layout[it["id"]][:2]), it
        if kind == "zone":
            return (it["x"], it["z"]), it
        W, D = self.work["size"]["w"], self.work["size"]["d"]
        return (W / 2, D / 2), None

    def place(self, s: dict, target, skip=None):
        st = station_map(self.work)
        placed = [_rect(st[k], *v) for k, v in self.layout.items() if k in st and k != skip]
        pos, _ = nearest_free(self.work, s, target, placed)
        trial = {**{k: v for k, v in self.layout.items() if k != skip}, s["id"]: pos}
        if s["id"] in collisions({**self.work, "stations": [x for x in self.work["stations"] if x["id"] != s["id"]] + [s]}, trial):
            raise Reject(f"No hay un lugar libre para «{s['name']}» sin encimarla")
        return pos

    # --- operaciones ---
    def add(self, raw):
        name = str(raw.get("name") or "").strip()
        kind = raw.get("kind") if raw.get("kind") in KIND else _kind_from_name(name)
        k = KIND[kind]
        name = name or k["name"]
        n = int(self.user_number(raw.get("count"), "La cantidad") or 1) if raw.get("count") not in (None, 1) else 1
        base = re.sub(r"[^a-z0-9]+", "-", normalize(name)).strip("-") or kind
        sid, i = base, 2
        while self.station(sid) and self.station(sid)["id"] == sid or self.zone(sid) and self.zone(sid)["id"] == sid:
            sid, i = f"{base}-{i}", i + 1
        s = {"id": sid, "name": name, "kind": kind, "w": k["w"], "d": k["d"], "t": k["t"], "ops": k["ops"]}
        if n > 1:
            w, d = units.block_size(n, k["w"], k["d"], "bloque" if n > 4 else "fila")
            s.update(count=n, unit_w=k["w"], unit_d=k["d"], arrangement="bloque" if n > 4 else "fila", w=w, d=d, ops=k["ops"] * n)
        target, ref = self.target(raw.get("near"))
        if raw.get("near") and not ref:
            raise Reject(f"No se encontró «{raw['near']}» para colocar «{name}» junto a ella")
        x, z, rot = self.place(s, target)
        self.work["stations"].append(s)
        self.layout[sid] = [x, z, rot]
        return {"op": "add", "element": {**s, "x": x, "z": z, "rot": rot}}

    def move(self, raw):
        kind, it = self.element(raw.get("id"))
        if not it:
            raise Reject(f"No existe «{raw.get('id')}»")
        self.guard(it)
        if kind == "zone":
            raise Reject(f"Las zonas se mueven a mano en el editor («{it['name']}»)")
        if not raw.get("near"):
            raise Reject(f"Falta junto a qué estación mover «{it['name']}»")
        target, ref = self.target(raw["near"])
        if not ref:
            raise Reject(f"No se encontró «{raw['near']}»")
        x, z, rot = self.place(it, target, skip=it["id"])
        self.layout[it["id"]] = [x, z, rot]
        return {"op": "move", "id": it["id"], "to": {"x": x, "z": z, "rot": rot}}

    def delete(self, raw):
        kind, it = self.element(raw.get("id"))
        if not it:
            raise Reject(f"No existe «{raw.get('id')}»")
        self.guard(it, "quitar")
        if kind == "station":
            self.work["stations"].remove(it)
            self.layout.pop(it["id"], None)
            self.work["routes"] = [r for r in self.work["routes"] if it["id"] not in (r["from"], r["to"])]
        else:
            self.work["zones"].remove(it)
        return {"op": "delete", "id": it["id"]}

    def update(self, raw):
        s = self.station(raw.get("id"))
        if not s:
            raise Reject(f"No existe la estación «{raw.get('id')}»")
        set_ = {k: v for k, v in (raw.get("set") or {}).items() if k in UPDATABLE}
        if not set_:
            raise Reject("No hay nada que se pueda cambiar en la operación")
        if GEOMETRY & set(set_):
            self.guard(s, "cambiar")
        for k, v in set_.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                self.user_number(v, "La cifra")
        if "count" in set_ or "arrangement" in set_:
            n = int(set_.get("count", units.count(s)))
            uw, ud = s.get("unit_w", s["w"]), s.get("unit_d", s["d"])
            w, d = units.block_size(n, uw, ud, set_.get("arrangement", s.get("arrangement", "fila")))
            set_.update(count=n, unit_w=uw, unit_d=ud, w=w, d=d)
        s.update(set_)
        return {"op": "update", "id": s["id"], "set": set_}

    def _route_ends(self, raw):
        a, b = self.station(raw.get("from")), self.station(raw.get("to"))
        if not a or not b:
            raise Reject(f"La ruta {raw.get('from')} → {raw.get('to')} une estaciones que no existen")
        if a["id"] == b["id"]:
            raise Reject("Una ruta no puede salir y llegar a la misma estación")
        flow = raw.get("flow") if raw.get("flow") in FLOWS else "material"
        return a, b, flow

    def connect(self, raw):
        a, b, flow = self._route_ends(raw)
        if any(r["from"] == a["id"] and r["to"] == b["id"] and r.get("flow", "material") == flow for r in self.work["routes"]):
            raise Reject(f"Ya existe la ruta «{a['name']}» → «{b['name']}»")
        frac = 1.0
        if raw.get("frac") not in (None, 1, 1.0):
            f = float(raw["frac"])
            pct = f * 100 if f <= 1 else f
            self.user_number(pct, "El porcentaje")
            frac = round(pct / 100, 4)
        self.work["routes"].append({"from": a["id"], "to": b["id"], "flow": flow})
        return {"op": "connect", "from": a["id"], "to": b["id"], "frac": frac, "flow": flow}

    def disconnect(self, raw):
        a, b, flow = self._route_ends(raw)
        r = next((r for r in self.work["routes"] if r["from"] == a["id"] and r["to"] == b["id"] and r.get("flow", "material") == flow), None)
        if not r:
            raise Reject(f"No existe la ruta «{a['name']}» → «{b['name']}»")
        self.work["routes"].remove(r)
        return {"op": "disconnect", "from": a["id"], "to": b["id"], "flow": flow}

    def lock(self, raw):
        _, it = self.element(raw.get("id"))
        if not it:
            raise Reject(f"No existe «{raw.get('id')}»")
        it["locked"] = True
        return {"op": "lock", "id": it["id"], "reason": str(raw.get("reason") or "")}

    def unlock(self, raw):
        _, it = self.element(raw.get("id"))
        if not it:
            raise Reject(f"No existe «{raw.get('id')}»")
        it["locked"] = False
        return {"op": "unlock", "id": it["id"]}

    def resolve(self, ref: str) -> tuple[list[str], str | None]:
        """Ids que nombra una referencia de la instrucción, o un aviso si no se encuentra o es ambigua."""
        if ALL_MACHINES.match(ref):
            return [s["id"] for s in self.work["stations"]], None
        num = re.match(r"^(?:[a-z]+\s+)?m?(\d+)$", ref)
        if num:
            n = num.group(1)
            code = [s["id"] for s in self.work["stations"] if re.search(rf"(?<![a-z0-9])m{n}(?![0-9])", normalize(s["name"])) or s["id"].lower() == f"m{n}"]
            hits = code or [s["id"] for s in self.work["stations"] if re.search(rf"(?<![a-z0-9.,]){n}(?![0-9])", normalize(s["name"]))]
            if len(hits) == 1:
                return hits, None
            return [], f"«{ref}»: " + ("ninguna estación lleva ese número" if not hits else "varias estaciones llevan ese número")
        _, it = self.element(ref)
        if it:
            return [it["id"]], None
        # "el almacén principal": por tipo; si hay varias, la principal es la más grande.
        base = re.sub(r"\s+(?:principal|grande|actual)$", "", ref)
        k = _kind_from_name(base)
        cands = [s for s in self.work["stations"] if k != "otro" and s["kind"] == k]
        if len(cands) > 1 and "principal" in ref:
            cands = [max(cands, key=lambda s: s["w"] * s["d"])]
        if len(cands) == 1:
            return [cands[0]["id"]], None
        return [], f"«{ref}»: " + ("no se encontró en la planta" if not cands else "es ambiguo, hay varias")

    def lock_ops(self, text: str) -> tuple[list, list]:
        """Operaciones lock que la instrucción pide con palabras, sin depender del modelo."""
        ops, missing, seen = [], [], set()
        for ref in lock_requests(text):
            ids, why = self.resolve(ref)
            if why:
                missing.append(why)
            for i in ids:
                if i not in seen and not self.element(i)[1].get("locked"):
                    seen.add(i)
                    ops.append({"op": "lock", "id": i, "reason": "La instrucción pide no moverlo"})
        return ops, missing

    def run(self, raw_ops: list) -> tuple[list, list]:
        ops, rejected = [], []
        for raw in raw_ops:
            if not isinstance(raw, dict) or raw.get("op") not in OPS:
                rejected.append({"op": raw, "reason": "Operación desconocida"})
                continue
            try:
                op = getattr(self, raw["op"])(raw)
            except Reject as e:
                rejected.append({"op": raw, "reason": str(e)})
                continue
            except (TypeError, ValueError, KeyError) as e:
                rejected.append({"op": raw, "reason": f"Operación incompleta: {e}"})
                continue
            if raw.get("reason"):
                op["reason"] = str(raw["reason"])
            ops.append(op)
        return ops, rejected


async def plan_ops(provider, plant: dict, instruction: str) -> dict:
    system = prompt("editor")
    text = editor_facts(plant) + "\n\nInstrucción del usuario: " + instruction
    # Lo que se pide fijar se fija antes que nada: así ninguna operación del modelo lo puede mover.
    planner = Planner(plant, instruction)
    locks, missing = planner.lock_ops(instruction)
    lock_note = ("No se pudo fijar: " + "; ".join(missing) + ".") if missing else ""

    def fallback(note):
        ops, rejected = Planner(plant, instruction).run(locks)
        return {"ops": ops, "rejected": rejected, "notes": " ".join(x for x in ("Se fijó lo que la instrucción pide conservar." if ops else note, lock_note) if x)}

    try:
        raw = await provider.json(system, text, EDITOR_SCHEMA)
        if not isinstance(raw, dict) or check(raw, {"type": "object", "required": ["ops"], "properties": {"ops": {"type": "array"}}}):
            # Un reintento con el error a la vista; si vuelve a fallar no se inventa nada.
            raw = await provider.json(system, text + "\n\nTu respuesta anterior no cumplía el esquema: debe ser un objeto con la lista 'ops'.", EDITOR_SCHEMA)
    except Exception as e:  # noqa: BLE001
        return fallback(f"El asistente no respondió: la IA (Ollama) no está encendida o no se alcanza ({e}). Revisa que Ollama esté corriendo y vuelve a intentar.")
    if not isinstance(raw, dict) or not isinstance(raw.get("ops"), list):
        return fallback("El asistente no devolvió operaciones válidas. No se propuso ningún cambio.")
    locked = {o["id"] for o in locks}

    def dup_lock(o):
        it = planner.element(o.get("id"))[1] if isinstance(o, dict) and o.get("op") == "lock" else None
        return bool(it) and it["id"] in locked

    ops, rejected = Planner(plant, instruction).run(locks + [o for o in raw["ops"] if not dup_lock(o)])
    return {"ops": ops, "rejected": rejected, "notes": " ".join(x for x in (str(raw.get("notes") or ""), lock_note) if x)}


__all__ = ["plan_ops", "Planner", "editor_facts", "protected_refs", "lock_requests"]
