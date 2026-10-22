"""Expedientes locales: originales y revisiones atómicas, sin estado global de conexión."""
from __future__ import annotations

import copy
import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def now():
    return datetime.now(timezone.utc).isoformat()


class Conflict(ValueError):
    pass


def valid_id(value):
    if not re.fullmatch(r"[\w-]{1,100}", value, flags=re.ASCII):
        raise ValueError("Identificador inválido")
    return value


@contextmanager
def connection():
    directory = Path(os.environ.get("CAUCE_DATA_DIR", Path(__file__).resolve().parents[2] / ".cauce-data"))
    directory.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(directory / "workspaces.sqlite3", timeout=20) as db:
        db.row_factory = sqlite3.Row
        db.executescript("""
            CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, revision INTEGER, project TEXT, updated TEXT);
            CREATE TABLE IF NOT EXISTS revisions (workspace TEXT, revision INTEGER, project TEXT, date TEXT, PRIMARY KEY(workspace,revision));
            CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, workspace TEXT, metadata TEXT, content BLOB);
            CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, workspace TEXT, data TEXT);
        """)
        yield db


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def read(workspace_id, db=None):
    valid_id(workspace_id)
    if db is None:
        with connection() as conn:
            return read(workspace_id, conn)
    row = db.execute("SELECT * FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
    if not row:
        raise KeyError(workspace_id)
    return {"id": workspace_id, "revision": row["revision"], "project": json.loads(row["project"]), "updated": row["updated"], "context_schema_version": 1}


def write(workspace_id, project, expected_revision, db=None):
    valid_id(workspace_id)
    if db is None:
        with connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            return write(workspace_id, project, expected_revision, conn)
    row = db.execute("SELECT revision FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
    revision = row["revision"] if row else 0
    if revision != expected_revision:
        raise Conflict(f"La revisión cambió: esperada {expected_revision}, vigente {revision}. Recarga antes de aplicar cambios.")
    value, date = encode(project), now()
    # Guardar idéntico contenido es idempotente, sin producir revisiones vacías.
    if row and read(workspace_id, db)["project"] == project:
        return read(workspace_id, db)
    revision += 1
    db.execute("INSERT OR REPLACE INTO workspaces VALUES (?,?,?,?)", (workspace_id, revision, value, date))
    db.execute("INSERT INTO revisions VALUES (?,?,?,?)", (workspace_id, revision, value, date))
    return read(workspace_id, db)


def mutate(workspace_id, expected_revision, operation):
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        saved = read(workspace_id, db)
        if saved["revision"] != expected_revision:
            raise Conflict("El expediente cambió. Guarda o recarga antes de continuar.")
        project = copy.deepcopy(saved["project"])
        result = operation(project)
        return {**write(workspace_id, project, expected_revision, db), "result": result}


def put_document(workspace_id, metadata, content):
    with connection() as db:
        read(workspace_id, db)
        db.execute("INSERT INTO documents VALUES (?,?,?,?)", (metadata["id"], workspace_id, encode(metadata), content))
    return metadata


def document(workspace_id, document_id):
    with connection() as db:
        row = db.execute("SELECT metadata,content FROM documents WHERE id=? AND workspace=?", (document_id, workspace_id)).fetchone()
        if not row:
            raise KeyError(document_id)
        return json.loads(row["metadata"]), bytes(row["content"])


def documents(workspace_id):
    with connection() as db:
        return [json.loads(row[0]) for row in db.execute("SELECT metadata FROM documents WHERE workspace=?", (workspace_id,))]


def job(workspace_id, job_id):
    with connection() as db:
        row = db.execute("SELECT data FROM jobs WHERE id=? AND workspace=?", (job_id, workspace_id)).fetchone()
        if not row:
            raise KeyError(job_id)
        return json.loads(row[0])


def save_job(workspace_id, value):
    with connection() as db:
        db.execute("INSERT OR REPLACE INTO jobs VALUES (?,?,?)", (value["id"], workspace_id, encode(value)))
    return value


def interrupt_jobs():
    with connection() as db:
        for row in db.execute("SELECT workspace,data FROM jobs").fetchall():
            value = json.loads(row["data"])
            if value.get("status") in ("queued", "running"):
                value.update(status="interrupted", error="El servicio se reinició. Puedes reintentar; los bloques completos se conservan.")
                db.execute("UPDATE jobs SET data=? WHERE id=?", (encode(value), value["id"]))
