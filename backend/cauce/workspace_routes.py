"""API aditiva del expediente. Las operaciones nuevas no alteran las rutas v3."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import workspace as service
from . import workspace_store as store


class SaveWorkspace(BaseModel):
    project: dict
    expected_revision: int = Field(ge=0)


class ConfirmWorkspace(BaseModel):
    expected_revision: int = Field(ge=1)
    ids: list[str] = Field(max_length=10000)
    target: str = "proposals"


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
