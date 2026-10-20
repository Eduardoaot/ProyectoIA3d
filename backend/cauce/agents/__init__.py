"""Agentes de IA de Cauce (criterios §7.1). El motor no es un agente.

Cada rol tiene su prompt en un archivo propio (`<rol>.md`) y su esquema de salida en
código (`roles.py`). Los agentes que leen el espacio de la historia viven en
`spatial.py` y se reexportan aquí para que `from cauce.agents import ...` siga igual.
"""

from .spatial import (  # noqa: F401
    AGENTS,
    MIN_CUES,
    apply_building,
    apply_walls,
    apply_zones,
    detail,
    fit_zones,
    place_with_targets,
    read_spatial,
    station_targets,
)
from .roles import ROLES, prompt  # noqa: F401
from .schema import check  # noqa: F401
