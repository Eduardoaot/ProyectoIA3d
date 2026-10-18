"""Validador de lo que escribe la IA (H10, contrato §6.3).

Cada oración del texto generado se revisa antes de llegar al usuario:
- toda cifra (con o sin unidad, porcentajes, rangos) debe existir en los hechos del
  motor (facts()), con una tolerancia de redondeo;
- una oración que elogia una alternativa que el motor muestra peor que hoy (o que
  la llama "la mejor" sin ser la recomendada) contradice los datos.
La oración que falla se descarta y queda en `validation.discarded` con su motivo.

Funciona sobre un texto completo o sobre un flujo de trozos (el informe se sigue
mostrando a medida que llega, una oración a la vez).
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field

TRAILER = "\u001e"  # separa el texto del resumen de validación al final del flujo

_NUM = re.compile(r"(?<![\w])(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)")
_LIST_MARK = re.compile(r"^\s*(?:\d+[.)]|[-*•])\s+")
_NEGATION = re.compile(r"\bno\s+(?:es|son|resulta|conviene|reduce|ahorra|mejora|baja|disminuye)\b")
_POSITIVE = re.compile(r"m[aá]s eficiente|\bmejor\b|\bconviene\b|\brecomend|\bahorr|\breduc|\bdisminu|\bbaja\b|menos recorrido|m[aá]s cort|[oó]ptim|\bventaja")
_SUPERLATIVE = re.compile(r"m[aá]s eficiente|\bla mejor\b|\bel mejor\b|\brecomend|[oó]ptim")
SMALL_INTS = {0, 1, 2, 3}


def _fold(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def readings(token: str) -> list[float]:
    """Valores posibles de una cifra escrita a mano: "1.304" puede ser mil trescientos cuatro o 1,304."""
    out = []
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+(?:,\d+)?", token):
        out.append(float(token.replace(".", "").replace(",", ".")))
    try:
        out.append(float(token.replace(",", ".")) if token.count(".") + token.count(",") <= 1 else float(token.replace(",", "")))
    except ValueError:
        pass
    return out


def numbers(text: str) -> list[tuple[str, list[float]]]:
    text = _LIST_MARK.sub("", text)
    return [(m.group(1), readings(m.group(1))) for m in _NUM.finditer(text)]


def allowed_numbers(*texts: str) -> list[float]:
    vals = []
    for t in texts:
        for line in (t or "").splitlines():
            for _, rs in numbers(line):
                vals += rs
    return vals


def supported(rs: list[float], allowed: list[float]) -> bool:
    for r in rs:
        if r in SMALL_INTS:
            return True
        for a in allowed:
            if abs(r - a) <= max(0.51, abs(a) * 0.01):
                return True
    return False


@dataclass
class Claims:
    """Lo que el motor sabe de las alternativas, para detectar elogios que lo contradicen."""

    names: dict[str, str] = field(default_factory=dict)  # nombre (en minúsculas, sin tildes) -> id
    worse_than_today: set[str] = field(default_factory=set)
    recommended: str | None = None
    labels: dict[str, str] = field(default_factory=dict)


def claims_from(ctx: dict | None) -> Claims:
    c = Claims()
    if not ctx:
        return c
    a = ctx.get("analysis") or {}
    cur = a.get("current") or {}
    alts = list(a.get("alternatives") or [])
    rd = ctx.get("redesign")
    if rd and rd.get("metrics") and rd.get("name") and not any(x.get("name") == rd["name"] for x in alts):
        alts.append({"id": "propio", "name": rd["name"], "metrics": rd["metrics"]})
    key = "daily_m" if cur.get("daily_m") is not None and all((x.get("metrics") or {}).get("daily_m") is not None for x in alts) else "piece_m"
    base = cur.get(key)
    best = None
    for x in alts:
        v = (x.get("metrics") or {}).get(key)
        if not x.get("name") or v is None:
            continue
        c.names[_fold(x["name"])] = x["id"]
        c.labels[x["id"]] = x["name"]
        if base is not None and v > base * 1.005:
            c.worse_than_today.add(x["id"])
        if best is None or v < best[0]:
            best = (v, x["id"])
    c.recommended = a.get("recommended") or (best[1] if best else None)
    return c


def contradiction(sentence: str, claims: Claims) -> str | None:
    s = _fold(sentence)
    hits = sorted((s.find(n), aid) for n, aid in claims.names.items() if n and n in s)
    if not hits or _NEGATION.search(s) or not _POSITIVE.search(s):
        return None
    aid = hits[0][1]  # la que se nombra primero es de la que se habla
    name = claims.labels.get(aid, aid)
    if aid in claims.worse_than_today:
        return f"contradice al motor: «{name}» camina más que hoy"
    if _SUPERLATIVE.search(s) and claims.recommended and aid != claims.recommended:
        return f"contradice al motor: la recomendada es «{claims.labels.get(claims.recommended, claims.recommended)}», no «{name}»"
    return None


class Validator:
    def __init__(self, facts: str, claims: Claims | None = None, extra: list[str] | None = None):
        self.allowed = allowed_numbers(facts, *(extra or []))
        self.claims = claims or Claims()
        self.checked = 0
        self.discarded: list[dict] = []

    def check(self, sentence: str) -> str | None:
        """Motivo para descartar la oración, o None si se conserva."""
        if not sentence.strip():
            return None
        self.checked += 1
        for tok, rs in numbers(sentence):
            if rs and not supported(rs, self.allowed):
                return f"la cifra {tok} no está en los hechos del motor"
        return contradiction(sentence, self.claims)

    def keep(self, sentence: str) -> bool:
        why = self.check(sentence)
        if why:
            self.discarded.append({"text": sentence.strip(), "reason": why})
            return False
        return True

    def result(self) -> dict:
        return {"checked": self.checked, "discarded": self.discarded}

    def pass_through(self, sentence: str) -> str:
        """La oración si se conserva; si se descarta, solo sus saltos de línea (no se pegan los párrafos)."""
        if self.keep(sentence):
            return sentence
        return "\n" * sentence[len(sentence.rstrip()) :].count("\n")

    def filter_text(self, text: str) -> str:
        return "".join(self.pass_through(s) for s in split(text))

    async def filter_stream(self, tokens):
        buf = ""
        async for tok in tokens:
            buf += tok
            while True:
                cut = boundary(buf)
                if cut is None:
                    break
                sentence, buf = buf[:cut], buf[cut:]
                out = self.pass_through(sentence)
                if out:
                    yield out
        if buf:
            out = self.pass_through(buf)
            if out:
                yield out


def boundary(buf: str) -> int | None:
    """Fin de la primera oración completa (incluye el espacio o salto que la cierra)."""
    for m in re.finditer(r"\n|[.!?](?=\s)", buf):
        end = m.end()
        if m.group(0) != "\n":
            # "1. Marcar..." es un número de lista, no el fin de una oración.
            line = buf[: m.start()].rsplit("\n", 1)[-1]
            if re.fullmatch(r"\s*\d+", line):
                continue
            ws = re.match(r"[ \t]*\n?", buf[end:])
            if end + ws.end() >= len(buf):
                return None  # falta ver qué sigue
            end += ws.end()
        return end
    return None


def split(text: str) -> list[str]:
    out, buf = [], text
    while True:
        cut = boundary(buf)
        if cut is None:
            break
        out.append(buf[:cut])
        buf = buf[cut:]
    if buf:
        out.append(buf)
    return out


def trailer(validation: dict) -> str:
    return "\n" + TRAILER + json.dumps({"validation": validation}, ensure_ascii=False)
