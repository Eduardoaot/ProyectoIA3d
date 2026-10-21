"""Contrato de coordinación; el proveedor simulado no evalúa calidad lingüística real."""
import asyncio
import copy
import json
from pathlib import Path

import pytest

from cauce.agents.context_pipeline import organize, semantic_sources
from cauce.context_master import accepted_master, assemble, clean_fact
from cauce import workspace as service, workspace_store as store, workspace_jobs as jobs


TEXT = "La bodega mide 32 x 16 m. Hay 12 embobinadoras a la izquierda. El horno está al fondo."


def fact(**changes):
    return {"topic": "operaciones", "label": "Cantidad de embobinadoras", "value": "Hay 12 embobinadoras", "excerpt": "Hay 12 embobinadoras a la izquierda.", "entity": "Embobinadoras", "entity_type": "station", "field": "count", "target": "", "number": 12, "unit": "", "scope": "current", **changes}


class Model:
    def __init__(self, questions=False, unavailable=False):
        self.calls, self.questions, self.unavailable = [], questions, unavailable

    async def json(self, system, prompt, schema):
        data = json.loads(prompt)
        self.calls.append((system, copy.deepcopy(data)))
        fields = schema["properties"]
        if self.unavailable:
            raise RuntimeError("Modelo no disponible")
        if "assignments" in fields:
            return {"entities": ["Embobinadoras", "Horno"], "assignments": [{"topic": "maquinas", "instructions": "Identifica las cantidades y ubicaciones escritas."}], "questions": []}
        if "facts" in fields:
            return {"facts": [fact()], "questions": ["¿Dónde está el horno?"] if self.questions and "clarifications" not in data else []}
        if "answers" in fields:
            return {"answers": [{"id": data["questions"][0]["id"], "answer": "Al fondo", "excerpt": "El horno está al fondo."}]}
        return {"decisions": [{"id": row["id"], "topic": "maquinas", "label": row["label"], "value": row["value"], "duplicate_of": ""} for row in data["facts"]], "summary": "Las embobinadoras están a la izquierda.", "questions": []}


def test_consolidator_reclassification_is_applied_and_master_keeps_every_handover():
    result = asyncio.run(organize(TEXT, Model()))
    assert result["proposals"][0]["topic"] == "maquinas"
    master = result["master"]
    assert master["sections"]["maquinas"] == [result["proposals"][0]["id"]]
    assert not master["sections"]["operaciones"]
    assert master["handovers"][0]["status"] == "consolidated"
    assert [row["agent"] for row in master["trace"]] == ["interprete", "especialista:maquinas", "consolidador:maquinas"]
    assert master["sources"][0]["text"] == TEXT


def test_specialist_receives_answer_from_general_interpreter_before_consolidation():
    model = Model(questions=True)
    result = asyncio.run(organize(TEXT, model))
    reviews = [data for _, data in model.calls if "previous_facts" in data]
    assert reviews and reviews[0]["clarifications"][0]["answer"] == "Al fondo"
    assert result["master"]["questions"][0]["status"] == "answered"


def test_unanswered_question_stays_uncertain():
    class Uncertain(Model):
        async def json(self, system, prompt, schema):
            if "answers" in schema["properties"]:
                return {"answers": []}
            return await super().json(system, prompt, schema)
    result = asyncio.run(organize(TEXT, Uncertain(questions=True)))
    assert result["master"]["questions"][0]["status"] == "unresolved"


def test_empty_or_failed_interpretation_never_returns_a_completed_master():
    with pytest.raises(RuntimeError, match="Modelo no disponible"):
        asyncio.run(organize(TEXT, Model(unavailable=True)))


def test_explanation_cannot_introduce_an_unsupported_number():
    with pytest.raises(ValueError, match="añade cifras"):
        clean_fact(fact(value="Hay 99 embobinadoras"), {"id": "relato", "text": TEXT})


def test_nullable_schema_preserves_unknown_values_and_rejects_wrong_types():
    from cauce.agents import check
    schema = {"type": ["number", "null"]}
    assert check(None, schema) == [] and check(12, schema) == []
    assert check("desconocido", schema) and check(True, schema)


def test_semantic_sources_cover_full_document_with_original_offsets():
    text = ("### Máquinas\n\nMáquinas a la izquierda.\n\n" * 700) + "Última afirmación."
    pieces = semantic_sources(text)
    assert "".join(p["text"] for p in pieces) == text
    assert all(text[p["offset"]:p["offset"] + len(p["text"])] == p["text"] for p in pieces)


def test_only_accepted_facts_feed_master_and_manual_edits_require_reinterpretation():
    result = asyncio.run(organize(TEXT, Model()))
    project = service.prepare({})
    service.merge_result(project, result)
    assert accepted_master(project)["status"] == "unaccepted"
    service.confirm(project, [result["proposals"][0]["id"]])
    assert accepted_master(project)["facts"][0]["number"] == 12
    project["context"]["segments"]["maquinas"][0]["value"] = "Hay 14 embobinadoras"
    changed = accepted_master(project)["facts"][0]
    assert changed["needs_reinterpretation"] and changed["scope"] == "uncertain"


def test_conflicting_counts_remain_blocked():
    text = TEXT + " Otra fuente dice 10 embobinadoras."
    a = clean_fact(fact(), {"id": "a", "text": text})
    b = clean_fact(fact(number=10, value="Hay 10 embobinadoras", excerpt="Otra fuente dice 10 embobinadoras."), {"id": "b", "text": text})
    master = assemble([a, b], [])
    assert all(f["status"] == "blocked" for f in master["facts"])
    assert master["questions"][0]["status"] == "unresolved"


def test_job_persists_master_stages_and_does_not_confirm_it(tmp_path, monkeypatch):
    monkeypatch.setenv("CAUCE_DATA_DIR", str(tmp_path))
    store.write("case", service.prepare({}), 0)
    value = {"id": "work", "kind": "context", "text": TEXT, "base_revision": 1, "status": "queued", "result": {}, "errors": []}
    store.save_job("case", value)
    asyncio.run(jobs.run("case", "work", Model()))
    result = store.job("case", "work")
    assert result["status"] == "done" and result["stage"] == "review"
    saved = store.read("case")["project"]
    assert saved["contextWorkspace"]["masterDraft"]["schema_version"] == 2
    assert accepted_master(saved)["status"] == "unaccepted"


def test_real_case_preserves_source_policy_and_image_annotation_is_not_model_output():
    root = Path(__file__).resolve().parents[2]
    expected = json.loads((root / "pruebas/contexto-transformadores.expected.json").read_text(encoding="utf-8"))
    assert expected["source_policy"]["default"] == "text"
    winding = next(r for r in expected["requirements"] if r["id"] == "winding")
    assert winding["expected"] == 12 and winding["conflicts_with_text"] == 10
    assert winding["source"] == "image_review"
