"""Ensayo explícito con el proveedor real; nunca sustituye una ejecución por mocks."""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import time
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cauce.agents.context_pipeline import organize
from cauce.master_builder import meters
from cauce.providers import get_provider


def assess(master, expected):
    checks = []
    for requirement in expected.get("requirements", []):
        row = {"id": requirement["id"], "expected": requirement.get("expected"), "status": "needs_human_review"}
        if requirement.get("source") == "image_review":
            row["reason"] = "Esta referencia procede de anotación visual humana; el ensayo de texto no ejecuta visión."
        elif requirement.get("field") == "dimensions":
            rows = [f for f in master["facts"] if f["entity_type"] == "building"]
            w = next((meters(f) for f in rows if f["field"] == "width"), None)
            d = next((meters(f) for f in rows if f["field"] == "depth"), None)
            row.update(actual=[w, d], status="matched" if [w, d] == requirement["expected"] else "mismatch")
        elif requirement.get("field") == "count":
            found = [f["number"] for f in master["facts"] if f["field"] == "count" and requirement.get("entity", "").lower() in f["entity"].lower()]
            row.update(actual=found, status="matched" if requirement["expected"] in found else "mismatch")
        else:
            row["reason"] = "Revisar entidades, relaciones y evidencia en el maestro y sus trazas; no se puntúa con coincidencias superficiales."
        checks.append(row)
    return checks


async def main(args):
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    provider = get_provider("contexto")
    status = await provider.status()
    report = {"provider": provider.name, "model": provider.model, "provider_status": status, "source": str(args.source), "mock": False}
    if not status.get("ready"):
        report.update(status="not_run", reason="El proveedor real no está disponible. No hay evidencia de calidad del modelo.")
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Ensayo pendiente: configura {provider.model}. Registro: {output}")
        return 2
    provider.max_output_tokens = 4096
    started = time.monotonic()
    async def progress(stage, details):
        print(stage, details, flush=True)
    try:
        result = await asyncio.wait_for(organize(Path(args.source).read_text(encoding="utf-8"), provider, progress=progress), args.max_seconds)
        expected = json.loads(Path(args.expected).read_text(encoding="utf-8")) if args.expected else {}
        checks = assess(result["master"], expected)
        report.update(status="needs_review", elapsed_s=round(time.monotonic() - started, 2), checks=checks, result=result,
                      note="La ejecución no confirma datos ni escribe en un expediente de producción. El usuario debe revisar las discrepancias y la evidencia.")
    except Exception as exc:
        report.update(status="failed", elapsed_s=round(time.monotonic() - started, 2), error=str(exc))
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Estado: {report['status']}. Registro: {output}")
    return 1 if report["status"] == "failed" else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="pruebas/Contexto_transformadores.txt")
    parser.add_argument("--expected", default="pruebas/contexto-transformadores.expected.json")
    parser.add_argument("--output", default=".cauce-data/master-evaluation.json")
    parser.add_argument("--max-seconds", type=int, default=1200)
    raise SystemExit(asyncio.run(main(parser.parse_args())))
