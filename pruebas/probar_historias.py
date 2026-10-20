"""Pasa las historias de pruebas/historias.json por /api/story (IA extractora + reglas)
y /api/analyze, y resume qué entendió Cauce.
Uso (con el backend corriendo): backend/.venv/Scripts/python pruebas/probar_historias.py"""
import json
import pathlib
import sys
import time

import httpx

sys.stdout.reconfigure(encoding="utf-8")
API = "http://localhost:8000/api"
casos = json.loads((pathlib.Path(__file__).parent / "historias.json").read_text(encoding="utf-8"))
for c in casos:
    t = time.time()
    r = httpx.post(f"{API}/story", json={"text": c["texto"]}, timeout=300).json()
    pl = r["plant"]
    p = pl["params"]
    names = {s["id"]: s["name"] for s in pl["stations"]}
    print(f"\n== {c['id']}: {c['nota']}  ({time.time() - t:.0f} s)")
    print(f"  lectura: {r['source']}" + (f"  error IA: {r['error'][:80]}" if r.get("error") else ""))
    print(f"  personas={sum(s['ops'] for s in pl['stations'])} producción/día={p['demand']} camiones={p['trucks']}")
    print("  estaciones: " + " | ".join(f"{s['name']} [{s['kind']}]" for s in pl["stations"]))
    print("  flujo: " + " ; ".join(f"{names[x['from']]} -> {names[x['to']]}" + (f" ({x['frac']:.0%})" if x["frac"] < 1 else "") for x in pl["routes"]))
    print("  zonas: " + (", ".join(z["name"] for z in pl["zones"]) or "ninguna"))
    if r.get("ai_assumptions"):
        print("  supuestos IA: " + "; ".join(r["ai_assumptions"][:3]))
    a = httpx.post(f"{API}/analyze", json={"plant": pl}, timeout=300).json()
    print(f"  recorrido hoy {a['current']['piece_m']} m/pieza; alternativas: " + ", ".join(f"{x['name']} {x['metrics']['piece_m']}" for x in a["alternatives"]) + f"; recomendada {a['recommended']}")