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


def test_retry_reuses_valid_agent_deliveries_without_reusing_changed_sources():
    cache, model = {}, Model()
    asyncio.run(organize(TEXT, model, cache=cache))
    count = len(model.calls)
    repeated = asyncio.run(organize(TEXT, model, cache=cache))
    assert len(model.calls) == count
    assert all(row["cache_hit"] for row in repeated["master"]["trace"])
    asyncio.run(organize(TEXT + " Otra observación.", model, cache=cache))
    assert len(model.calls) > count


def test_explanation_cannot_introduce_an_unsupported_number():
    with pytest.raises(ValueError, match="añade cifras"):
        clean_fact(fact(value="Hay 99 embobinadoras"), {"id": "relato", "text": TEXT})


def test_quantities_spelled_in_words_are_read_without_model_arithmetic():
    row = clean_fact(fact(number=3, value="Hay 3 embobinadoras", excerpt="Hay tres embobinadoras."), {"id": "case", "text": "Hay tres embobinadoras."})
    assert row["number"] == 3


def test_nullable_schema_preserves_unknown_values_and_rejects_wrong_types():
    from cauce.agents import check
    schema = {"type": ["number", "null"]}
    assert check(None, schema) == [] and check(12, schema) == []
    assert check("desconocido", schema) and check(True, schema)


def test_ollama_uses_the_context_window_it_advertises(monkeypatch):
    import httpx
    from cauce.providers.ollama import OllamaProvider
    monkeypatch.setenv("CAUCE_OLLAMA_CONTEXT", "12288")
    requests = []
    def handle(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"message": {"content": '{"ok":true}'}})
    client_type = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client_type(transport=httpx.MockTransport(handle), **kwargs))
    provider = OllamaProvider("modelo-local")
    assert asyncio.run(provider.json("Sistema", "Entrada")) == {"ok": True}
    assert requests[0]["options"]["num_ctx"] == provider.capabilities["max_context"] == 12288


def test_semantic_sources_cover_full_document_with_original_offsets():
    text = ("### Máquinas\n\nMáquinas a la izquierda.\n\n" * 700) + "Última afirmación."
    pieces = semantic_sources(text)
    assert "".join(p["text"] for p in pieces) == text
    assert all(text[p["offset"]:p["offset"] + len(p["text"])] == p["text"] for p in pieces)
    assert max(len(p["text"]) for p in pieces) <= 1000


def test_long_context_cycles_bound_every_agent_and_preserve_first_and_last_evidence():
    import re
    from cauce.agent_input import InputBudget

    text = "\n".join(f"Hay 1 equipo Máquina-{i:03d} al fondo a la derecha." for i in range(100))
    class Cycles:
        capabilities = {"max_context": 8192}
        max_output_tokens = 4096
        def __init__(self):
            self.calls = []
        async def json(self, system, prompt, schema):
            data = json.loads(prompt)
            self.calls.append((system, data, schema))
            fields = schema["properties"]
            if "assignments" in fields:
                names = re.findall(r"Máquina-\d+", data["source"]["text"])
                return {"entities": names, "assignments": [{"topic": "maquinas", "instructions": "Lee cantidades por equipo"}], "questions": [f"¿Está validada la ubicación de {name}?" for name in names[:2]]}
            if "facts" in fields:
                rows = []
                for match in re.finditer(r"Hay 1 equipo (Máquina-\d+) al fondo a la derecha\.", data["source"]["text"]):
                    rows.append(fact(entity=match[1], number=1, value="Hay 1 equipo", excerpt=match[0]))
                return {"facts": rows, "questions": []}
            if "answers" in fields:
                return {"answers": [{"id": q["id"], "answer": "La fuente dice al fondo a la derecha", "excerpt": data["source"]["text"].splitlines()[0]} for q in data["questions"]]}
            return {"decisions": [{"id": f["id"], "topic": f["topic"], "label": f["label"], "value": f["value"], "duplicate_of": ""} for f in data["facts"]], "summary": "Lectura conservada. " * 70, "questions": []}
    model = Cycles()
    result = asyncio.run(organize(text, model))
    assert len(result["proposals"]) == 100
    assert {f["entity"] for f in result["proposals"]} == {f"Máquina-{i:03d}" for i in range(100)}
    assert "".join(s["text"] for s in result["master"]["sources"]) == text
    assert result["master"]["processing"]["chunk_chars"] == 1000
    assert any(len(data["questions"]) < len(result["master"]["questions"]) for _, data, schema in model.calls if "answers" in schema["properties"])
    for system, data, schema in model.calls:
        assert InputBudget(model).fits(system, data, schema)
        if "source" in data:
            assert len(data["source"]["text"]) <= 1000
        if "decisions" in schema["properties"]:
            assert len(data["facts"]) <= 2
    assert any(row["input"].get("previous_sections_not_loaded", 0) > 0 for row in result["master"]["trace"])


def test_input_budget_counts_schema_and_reserves_output_without_cutting_atomic_rows():
    from cauce.agent_input import InputBudget, split_text
    class Provider:
        capabilities = {"max_context": 2048}
        max_output_tokens = 1024
    budget = InputBudget(Provider())
    rows = ["ñ" * 400 for _ in range(9)]
    payload = lambda batch: {"rows": batch}
    pages = list(budget.pages(rows, payload, "Instrucción", {"type": "object"}))
    assert [row for page in pages for row in page] == rows
    assert len(pages) > 1
    with pytest.raises(ValueError, match="indivisible"):
        list(budget.pages(["x" * 10000], payload, "Instrucción", {}))
    content = "á漢🙂" * 700
    parts = list(split_text(content, 1000))
    assert "".join(p["text"] for p in parts) == content


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


def test_identical_labels_on_different_entities_do_not_conflict_or_overwrite():
    source = {"id": "case", "text": "Hay 12 embobinadoras y 4 soldadoras."}
    rows = [clean_fact(fact(label="Cantidad", excerpt=source["text"]), source), clean_fact(fact(label="Cantidad", entity="Soldadoras", number=4, value="Hay 4 soldadoras", excerpt=source["text"]), source)]
    project = service.prepare({})
    service.merge_result(project, {"proposals": rows})
    assert all(p["status"] == "pending" for p in project["contextWorkspace"]["proposals"])
    result = service.confirm(project, [p["id"] for p in rows])
    assert len(result["accepted"]) == 2
    from cauce.context import current
    assert len(current(project["context"])) == 2


def test_discarding_conflicting_source_unblocks_remaining_candidate():
    p = service.prepare({"contextWorkspace": {"proposals": [{"id": "a", "topic": "maquinas", "label": "Cantidad", "value": "12", "status": "pending"}, {"id": "b", "topic": "maquinas", "label": "Cantidad", "value": "10", "status": "pending"}]}})
    p["contextWorkspace"]["proposals"][1]["status"] = "discarded"
    p = service.prepare(p)
    assert p["contextWorkspace"]["proposals"][0]["status"] == "pending"


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
