"""API aditiva del expediente. Las operaciones nuevas no alteran las rutas v3."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import workspace as service
from . import workspace_store as store
from . import workspace_jobs as jobs
from . import workspace_documents as documents
from .workspace_deliverables import build as build_deliverables


class SaveWorkspace(BaseModel):
    project: dict
    expected_revision: int = Field(ge=0)


class ConfirmWorkspace(BaseModel):
    expected_revision: int = Field(ge=1)
    ids: list[str] = Field(max_length=10000)
    target: str = "proposals"


class JobInput(BaseModel):
    expected_revision: int = Field(ge=1)
    kind: str = "context"
    text: str = Field(default="", max_length=500000)
    topic: str | None = None
    source_id: str | None = None
    retry_job_id: str | None = None


class OperatorInput(BaseModel):
    expected_revision: int = Field(ge=1)
    source_id: str
    mapping: dict[str, str] | None = None


def translate(operation):
    try:
        return operation()
    except store.Conflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(404, "No existe el expediente o recurso solicitado") from exc
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc


def create_router(provider):
    router = APIRouter(prefix="/api/workspaces", tags=["Contexto y estudios"])

    async def read_limited(request, maximum):
        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > maximum:
                raise HTTPException(413, "El archivo supera el tamaño permitido")
        return bytes(content)

    @router.post("/import")
    async def import_workspace(request: Request):
        binary = await read_limited(request, 100 * 1024 * 1024)
        return translate(lambda: documents.import_bundle(binary))

    @router.get("/{workspace_id}/export")
    def export_workspace(workspace_id: str):
        binary = translate(lambda: documents.export_bundle(workspace_id))
        return Response(binary, media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="cauce-proyecto.zip"'})

    @router.post("/{workspace_id}/documents")
    async def upload_document(workspace_id: str, request: Request, name: str, topic: str):
        if topic not in service.TOPICS:
            raise HTTPException(422, "Tema no reconocido")
        content = await read_limited(request, documents.MAX_BYTES)
        return translate(lambda: documents.upload(workspace_id, name, topic, content, request.headers.get("content-type", "")))

    @router.get("/{workspace_id}/documents/{document_id}")
    def download_document(workspace_id: str, document_id: str):
        metadata, content = translate(lambda: store.document(workspace_id, document_id))
        from urllib.parse import quote
        return Response(content, media_type="application/octet-stream", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(metadata['name'])}"})

    @router.post("/{workspace_id}/operators")
    def operators(workspace_id: str, body: OperatorInput):
        def process(project):
            preview = documents.operator_preview(workspace_id, body.source_id, body.mapping)
            workspace = project.setdefault("contextWorkspace", {})
            rows = workspace.setdefault("operators", [])
            existing = {row["id"] for row in rows}
            rows.extend(row for row in preview["operators"] if row["id"] not in existing)
            workspace["operator_import"] = {k: v for k, v in preview.items() if k != "operators"}
            return preview
        return translate(lambda: store.mutate(workspace_id, body.expected_revision, process))

    @router.on_event("startup")
    async def recover_jobs():
        store.interrupt_jobs()

    @router.post("/{workspace_id}/jobs")
    async def start_job(workspace_id: str, body: JobInput):
        if body.kind not in ("context", "studies"):
            raise HTTPException(422, "Tipo de interpretación no reconocido")
        if not (await provider().status()).get("ready"):
            raise HTTPException(503, "El proveedor de contexto no está disponible. Puedes guardar datos manuales y volver a interpretar después.")
        return translate(lambda: jobs.launch(workspace_id, body, provider()))

    @router.get("/{workspace_id}/jobs/{job_id}")
    def read_job(workspace_id: str, job_id: str):
        return translate(lambda: store.job(workspace_id, job_id))

    @router.post("/{workspace_id}/jobs/{job_id}/cancel")
    def cancel_job(workspace_id: str, job_id: str):
        value = translate(lambda: store.job(workspace_id, job_id))
        if value["status"] in ("queued", "running"):
            value["status"] = "cancelled"
            store.save_job(workspace_id, value)
            if job_id in jobs.TASKS:
                jobs.TASKS[job_id].cancel()
        return value

    @router.get("/{workspace_id}")
    def read_workspace(workspace_id: str):
        return translate(lambda: store.read(workspace_id))

    @router.put("/{workspace_id}")
    def save_workspace(workspace_id: str, body: SaveWorkspace):
        return translate(lambda: store.write(workspace_id, service.prepare(body.project), body.expected_revision))

    @router.post("/{workspace_id}/confirm")
    def confirm(workspace_id: str, body: ConfirmWorkspace):
        if body.target not in ("proposals", "activities", "operators"):
            raise HTTPException(422, "Tipo de revisión no reconocido")
        return translate(lambda: store.mutate(workspace_id, body.expected_revision, lambda p: service.confirm(p, body.ids, body.target)))

    @router.get("/{workspace_id}/coverage")
    def coverage(workspace_id: str):
        return translate(lambda: service.coverage(store.read(workspace_id)["project"]))

    @router.get("/{workspace_id}/deliverables")
    def deliverables(workspace_id: str):
        def result():
            project = store.read(workspace_id)["project"]
            return build_deliverables(service.accepted_context(project), project.get("draft") or project.get("plant"), project.get("analysis"))
        return translate(result)

    return router
