"""Carga mínima y deliberada de configuración local desde ``.env``.

Las variables ya presentes en el proceso tienen prioridad, para despliegues y
pruebas. El archivo vive en la raíz del repositorio y está excluido de Git.
"""

from __future__ import annotations

import os
from pathlib import Path


def load_project_env(path: Path | None = None) -> None:
    """Carga pares ``NOMBRE=valor`` sin sobrescribir el entorno existente."""
    env_file = path or Path(__file__).resolve().parents[2] / ".env"
    if not env_file.is_file():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        name, value = line.split("=", 1)
        name, value = name.strip(), value.strip()
        if not name or name in os.environ:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ[name] = value
