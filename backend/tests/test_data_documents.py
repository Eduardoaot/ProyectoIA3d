import io
import json
import zipfile

import pytest

from cauce import workspace_documents as documents, workspace_store as store


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("CAUCE_DATA_DIR", str(tmp_path))
    store.write("demo", {"contextWorkspace": {"attachments": []}}, 0)


def test_original_read_and_pending_are_distinct(client):
    response = client.post("/api/workspaces/demo/documents?name=tiempos.txt&topic=tiempos", content="Corte: 12 minutos".encode())
    assert response.status_code == 200
    metadata = response.json()
    assert metadata["status"] == "text_extracted"
    assert client.get(f"/api/workspaces/demo/documents/{metadata['id']}").content == "Corte: 12 minutos".encode()
    other = documents.upload("demo", "plano.dwg", "referencias", b"unread binary")
    assert other["status"] == "pending" and not other.get("text")
    broken = documents.upload("demo", "broken.pdf", "estudios", b"not PDF")
    assert broken["status"] == "pending" and broken.get("error")


def test_real_pdf_text_and_empty_scan():
    from pypdf import PdfWriter
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    content = io.BytesIO()
    writer.write(content)
    assert documents.extract(content.getvalue(), "scan.pdf")["status"] == "pending"


def test_export_restore_keeps_evidence_without_overwriting_original(client):
    metadata = documents.upload("demo", "note.txt", "negocio", b"Original")
    saved = store.read("demo")
    project = saved["project"]
    project["contextWorkspace"]["attachments"] = [metadata]
    store.write("demo", project, saved["revision"])
    binary = client.get("/api/workspaces/demo/export").content
    restored = client.post("/api/workspaces/import", content=binary)
    assert restored.status_code == 200
    data = restored.json()
    document_id = data["project"]["contextWorkspace"]["attachments"][0]["id"]
    assert document_id != metadata["id"]
    assert store.document(data["id"], document_id)[1] == b"Original"
    assert store.document("demo", metadata["id"])[1] == b"Original"


def test_operator_import_preserves_scale_and_homonyms(client):
    metadata = documents.upload("demo", "personal.csv", "personal", "nombre;maquina;turno;eficiencia;valoración de ritmo\nAna;Corte;Mañana;85%;110\nAna;Horno;Noche;0.85;\n".encode())
    result = client.post("/api/workspaces/demo/operators", json={"expected_revision": 1, "source_id": metadata["id"]})
    assert result.status_code == 200
    rows = result.json()["result"]["operators"]
    assert len(rows) == 2 and rows[0]["id"] != rows[1]["id"]
    assert rows[0]["efficiency_reported"]["scale"] == "percent"
    assert rows[1]["efficiency_reported"]["scale"] == "unspecified"
    assert all(r["calculated_efficiency"] is None for r in rows)


def test_excel_import_and_limit():
    from openpyxl import Workbook
    workbook = Workbook()
    workbook.active.append(["nombre", "turno"])
    workbook.active.append(["Luis", "Noche"])
    stream = io.BytesIO()
    workbook.save(stream)
    assert documents.table(stream.getvalue(), "operators.xlsx")[1] == ["Luis", "Noche"]
    with pytest.raises(ValueError, match="10 MB"):
        documents.upload("demo", "huge.txt", "negocio", b"x" * (documents.MAX_BYTES + 1))


def test_clear_context_preserves_plan_other_projects_and_checks_revision(client):
    metadata = documents.upload("demo", "note.txt", "negocio", b"Original")
    project = store.read("demo")["project"]
    project.update(draft={"stations": [{"id": "keep"}]}, text="Delete this")
    store.write("demo", project, 1)
    store.write("other", {"text": "Other project"}, 0)
    assert client.post("/api/workspaces/demo/clear-context", json={"expected_revision": 1}).status_code == 409
    assert store.document("demo", metadata["id"])[1] == b"Original"
    saved = client.post("/api/workspaces/demo/clear-context", json={"expected_revision": 2}).json()
    assert saved["project"]["text"] == ""
    assert saved["project"]["draft"]["stations"][0]["id"] == "keep"
    assert store.read("other")["project"]["text"] == "Other project"
    with pytest.raises(KeyError):
        store.document("demo", metadata["id"])
