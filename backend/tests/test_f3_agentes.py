"""F3: agentes separados, proveedores por rol y /api/plan/ops."""

import copy

from cauce.agents.roles import ROLES, prompt
from cauce.layout import collisions
from cauce.providers import caps, get_provider
from conftest import load


def ops_of(client, fake, plant, instruction, data):
    fake.data = data
    r = client.post("/api/plan/ops", json={"instruction": instruction, "plant": plant})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"ops", "rejected", "notes"}  # nunca el plano completo
    return body


def test_mover_la_columna_fija_se_rechaza_y_agregar_da_lugar_factible(client, fake):
    plant = load("transformadores-v3.json")
    body = ops_of(client, fake, plant, "agrega una pulidora junto a pintura y mueve la columna junto a corte", {
        "ops": [
            {"op": "add", "kind": "pulido", "name": "Pulidora", "near": "pintura", "reason": "Se agrega junto a pintura."},
            {"op": "move", "id": "columna-1", "near": "corte"},
            {"op": "connect", "from": "Pintura de gabinetes", "to": "Pulidora"},
        ],
        "notes": "Se agrega una pulidora.",
    })
    add = body["ops"][0]
    assert add["op"] == "add" and add["element"]["kind"] == "pulido"
    el = add["element"]
    assert isinstance(el["x"], (int, float)) and isinstance(el["z"], (int, float))
    # El lugar lo dio el motor y no se encima con nada.
    stations = plant["stations"] + [{k: v for k, v in el.items() if k not in ("x", "z", "rot")}]
    layout = {**plant["layout"], el["id"]: [el["x"], el["z"], el["rot"]]}
    assert el["id"] not in collisions({**plant, "stations": stations}, layout)
    assert body["ops"][1] == {"op": "connect", "from": "pintura", "to": el["id"], "frac": 1.0, "flow": "material"}
    assert body["rejected"][0]["op"]["id"] == "columna-1"
    assert "está fijo" in body["rejected"][0]["reason"]


def test_lo_que_la_instruccion_protege_no_se_toca(client, fake, plant):
    body = ops_of(client, fake, plant, "acerca la pintura a soldadura, pero no muevas el horno ni la oficina", {
        "ops": [{"op": "move", "id": "horno", "near": "despacho"}, {"op": "move", "id": "pintura", "near": "soldadura"}],
    })
    assert body["rejected"][0]["reason"] == "La instrucción pide no mover «Horno de secado»"
    assert body["ops"][0]["op"] == "move" and body["ops"][0]["id"] == "pintura"


def test_el_asistente_no_inventa_cifras(client, fake, plant):
    body = ops_of(client, fake, plant, "agrupa las embobinadoras", {"ops": [{"op": "update", "id": "embobinado", "set": {"count": 10}}]})
    assert body["ops"] == [] and "no inventa cifras" in body["rejected"][0]["reason"]
    body = ops_of(client, fake, plant, "son diez embobinadoras en bloque", {"ops": [{"op": "update", "id": "embobinado", "set": {"count": 10, "arrangement": "bloque"}}]})
    s = body["ops"][0]["set"]
    assert s["count"] == 10 and (s["w"], s["d"]) == (33.8, 13.2)


def test_operaciones_desconocidas_o_incompletas(client, fake, plant):
    body = ops_of(client, fake, plant, "haz algo", {"ops": [{"op": "volar"}, {"op": "move", "id": "corte"}, {"op": "delete", "id": "no-existe"}, {"op": "connect", "from": "corte", "to": "corte"}]})
    assert body["ops"] == [] and len(body["rejected"]) == 4


def test_si_el_modelo_falla_no_se_propone_nada(client, fake, plant):
    body = ops_of(client, fake, plant, "agrega algo", RuntimeError("sin conexión"))
    assert body["ops"] == [] and "no respondió" in body["notes"]


def test_respuesta_fuera_de_esquema_se_reintenta_una_vez(client, fake, plant):
    body = ops_of(client, fake, plant, "quita el despacho", [{"cambios": []}, {"ops": [{"op": "delete", "id": "despacho"}]}])
    assert body["ops"] == [{"op": "delete", "id": "despacho"}]
    assert len(fake.calls) == 2 and "no cumplía el esquema" in fake.calls[1]["prompt"]


def test_extractor_reintenta_y_no_inventa_estaciones_ni_cantidades(client, fake):
    text = "Tenemos 10 embobinadoras y una mesa de corte. Primero se corta y luego se embobina."
    good = {
        "negocio": "Transformadores",
        "estaciones": [
            {"nombre": "Corte", "tipo": "corte", "minutos_por_pieza": 5, "operarios": 1},
            {"nombre": "Embobinadoras", "tipo": "otro", "cantidad": 10, "minutos_por_pieza": 60, "operarios": 1},
            {"nombre": "Horno", "tipo": "horno", "cantidad": 3},
        ],
        "flujo": [{"de": "Corte", "a": "Embobinadoras", "porcentaje": 100}],
        "supuestos": [],
    }
    fake.data = [{"negocio": 3}, good]
    out = client.post("/api/story", json={"text": text}).json()
    assert len(fake.calls) >= 2 and "no cumplía el esquema" in fake.calls[1]["prompt"]
    names = [s["name"] for s in out["plant"]["stations"]]
    assert not any("Horno" in n for n in names)  # la historia no lo menciona
    # Las 10 embobinadoras son 10 ramas de una misma familia, cada una con su ruta desde Corte.
    emb = [s for s in out["plant"]["stations"] if "mbobin" in s["name"]]
    assert len(emb) == 10 and len({s["family"] for s in emb}) == 1 and [s["lane"] for s in emb] == list(range(1, 11))
    ids = {s["id"] for s in emb}
    assert sum(1 for r in out["plant"]["routes"] if r["to"] in ids) == 10


def test_misiones_con_cifras_inventadas_se_descartan(client, fake):
    from test_compat import fixture

    fake.data = {"misiones": [
        {"titulo": "A", "detalle": "Bajar a 777 m el recorrido.", "puntos": 80},
        {"titulo": "B", "detalle": "Pasillos despejados.", "puntos": 60},
        {"titulo": "C", "detalle": "Carro lleno.", "puntos": 90},
    ]}
    out = client.post("/api/missions", json=fixture("frontend-report-v2.json")).json()
    assert out["source"] == "reglas"  # quedaron 2 válidas: se usan las de respaldo


def test_un_prompt_por_rol():
    for role in ROLES:
        assert len(prompt(role)) > 40, role
    assert "No inventes estaciones" in prompt("extractor")
    assert "nunca escribes coordenadas" in prompt("editor")


def test_proveedor_y_modelo_por_rol(monkeypatch):
    for v in ("CAUCE_MODEL", "CAUCE_EXTRACT_MODEL", "CAUCE_EDITOR_MODEL", "CAUCE_CHAT_MODEL", "CAUCE_REPORT_MODEL"):
        monkeypatch.delenv(v, raising=False)
    assert get_provider("editor").model == "llama3.1:8b"
    monkeypatch.setenv("CAUCE_EXTRACT_MODEL", "qwen2.5:7b")
    assert get_provider("editor").model == "qwen2.5:7b"  # el editor hereda del extractor
    monkeypatch.setenv("CAUCE_EDITOR_MODEL", "llama3.1:70b")
    assert get_provider("editor").model == "llama3.1:70b"
    monkeypatch.setenv("CAUCE_CHAT_MODEL", "gemma2")
    assert get_provider("informe").model == "gemma2"  # el informe hereda del chat


def test_capacidades_del_proveedor():
    import os

    os.environ.pop("CAUCE_MODEL", None)
    c = caps(get_provider("chat"))
    assert c["json_schema"] and c["stream"] and c["vision"] is False  # llama3.1:8b no ve imágenes
    from cauce.providers.ollama import OllamaProvider

    assert OllamaProvider("llava:13b").capabilities["vision"] is True


def test_capabilities_anuncia_plan_ops(client):
    assert "plan_ops" in client.get("/api/capabilities").json()["features"]


def test_plano_sin_fijos_no_cambia(plant):
    from cauce.planops import Planner

    p = copy.deepcopy(plant)
    Planner(p, "x").run([{"op": "delete", "id": "corte"}])
    assert p == plant  # el planificador trabaja sobre una copia
