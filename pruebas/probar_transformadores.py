"""Valida pruebas/transformadores.json (planta en formato v2) contra el motor, sin servidor.
Revisa que las máquinas no se encimen ni se salgan de la bodega, que todas las rutas
encuentren paso y que el análisis completo (hoy y alternativas) corra.
Uso: backend/.venv/Scripts/python pruebas/probar_transformadores.py"""
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "backend"))

from cauce.catalog import KIND, ZONE  # noqa: E402
from cauce.engine import evaluate, rect_at, station_map, zone_rect  # noqa: E402
from cauce.layout import alternatives, score  # noqa: E402

plant = json.loads((ROOT / "transformadores.json").read_text(encoding="utf-8"))
W, D = plant["size"]["w"], plant["size"]["d"]
errores = []

st = station_map(plant)
ids = set(st)
for s in plant["stations"]:
    if s["kind"] not in KIND:
        errores.append(f"tipo desconocido: {s['id']} ({s['kind']})")
    if s["id"] not in plant["layout"]:
        errores.append(f"sin posición: {s['id']}")
for z in plant["zones"]:
    if z["kind"] not in ZONE:
        errores.append(f"zona de tipo desconocido: {z['id']} ({z['kind']})")
for r in plant["routes"]:
    if r["from"] not in ids or r["to"] not in ids:
        errores.append(f"ruta con estación inexistente: {r['id']}")
for g in (plant["receive_gate"], plant["dispatch_gate"]):
    if g not in {x["id"] for x in plant["gates"]}:
        errores.append(f"portón inexistente: {g}")

# Nada encimado y todo dentro de la bodega.
rects = [(sid, rect_at(st[sid], pos)) for sid, pos in plant["layout"].items()] + [(z["id"], zone_rect(z)) for z in plant["zones"]]
for name, (x0, z0, x1, z1) in rects:
    if x0 < 0 or z0 < 0 or x1 > W or z1 > D:
        errores.append(f"fuera de la bodega: {name}")
for i, (a, ra) in enumerate(rects):
    for b, rb in rects[i + 1 :]:
        if ra[0] < rb[2] and rb[0] < ra[2] and ra[1] < rb[3] and rb[1] < ra[3]:
            errores.append(f"encimados: {a} y {b}")

hoy = evaluate(plant, plant["layout"])
if hoy["blocked_legs"]:
    errores.append(f"{hoy['blocked_legs']} rutas sin paso libre")
alts = alternatives(plant)
for a in alts:
    a["score"] = score(hoy, a["metrics"], a["works_cost"], plant.get("use_assumptions"))
best = min(alts, key=lambda a: a["score"])

names = {s["id"]: s["name"] for s in plant["stations"]}
print(f"{plant['name']}: {len(plant['stations'])} estaciones, {len(plant['routes'])} rutas, {len(plant['zones'])} zonas, {len(plant['walls'])} paredes")
print(f"Hoy: {hoy['piece_m']} m por pieza; capacidad {hoy.get('capacity')} piezas/día; cuello de botella: {names.get(hoy.get('bottleneck'))}")
print("Alternativas: " + ", ".join(f"{a['name']} {a['metrics']['piece_m']} m" for a in alts) + f"; recomendada: {best['name']}")

if errores:
    print("\nERRORES:\n- " + "\n- ".join(errores))
    sys.exit(1)
print("OK")
