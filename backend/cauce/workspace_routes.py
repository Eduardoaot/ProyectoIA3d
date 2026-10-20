"""API aditiva del expediente. Las operaciones nuevas no alteran las rutas v3."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import workspace as service
from . import workspace_store as store
from . import workspace_jobs as jobs


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

    return router
