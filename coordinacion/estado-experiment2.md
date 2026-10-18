# Estado de feature/experiment2

Rama de trabajo del plan unificado (`coordinacion/PLAN-UNIFICADO.md`). Base: `feature/experiment` actualizada con `develop` (merge limpio; develop solo traía el contrato v3 y la planta de transformadores).

## Cómo correr las pruebas

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt
.venv/Scripts/python -m pytest            # backend, sin Ollama
cd ../frontend
npm ci
node --test tests/                        # módulos puros del frontend
npm run build && npm run lint
```

## F0. Base de pruebas y diagnóstico

### Inventario

| Qué | Dónde |
|---|---|
| Motor de rutas y métricas | `backend/cauce/engine.py` (`evaluate`, `rebalance_ops`, `relations`, `compare`) |
| Alternativas y factibilidad | `backend/cauce/layout.py` (`feasible`, `flow_order`, `alternatives`, `score`, `keep_swap`) |
| Alternativa compacta con IA | `backend/cauce/compact.py` |
| Rutas `/api/analyze`, `/api/report`, `/api/chat`, `facts()` | `backend/main.py` |
| Proveedores de IA | `backend/cauce/providers/` (`base.py`, `ollama.py`, fábrica en `__init__.py`) |
| Agentes espaciales (ya existían) | `backend/cauce/agents.py` |
| Modelos de la API | Pydantic en `main.py`; `plant` es `dict` y Pydantic ignora campos desconocidos por defecto: el backend ya era tolerante |
| Frontend | `frontend/` (React + Vite). No vive dentro de `backend/`. Proyecto guardado en `frontend/src/project.js` (`cauce-proyecto-v2`); llamadas a la API en `frontend/src/api.js`; plano en `frontend/src/editor/PlanEditor.jsx`; PDF en el navegador (`frontend/src/report/ReportDoc.jsx` + `window.print()`) |

### Diagnóstico H1

Con `pruebas/transformadores.json` el motor **no** recomienda la línea recta:

| | Recorrido por pieza | Puntaje (con supuestos) | Puntaje (sin supuestos) |
|---|---|---|---|
| Hoy | 163,0 m | | |
| Flujo en U | 199,5 m | 1,111 | 1,654 |
| Línea recta | 232,4 m | 1,089 | 1,656 |
| Reordenar en su lugar | 141,0 m | **0,732** | **0,865** |

`recommended = "keep"` en los dos casos. La frase "es más eficiente" no existe en el código: la escribe el modelo en `/api/report`. Causa: `facts()` no le dice al modelo cuál es la recomendada ni por qué, el usuario había elegido la línea recta y el modelo la elogió. Es un error de **texto que contradice los datos** (H1 + H10). El arreglo va en el informe (F1): `facts()` declara la recomendada con su razón y un validador descarta las oraciones que contradicen al motor o citan cifras sin respaldo.

### Pruebas

- `backend/tests/conftest.py`: planta de transformadores y `FakeProvider` (texto fijo que reproduce H1 y trae una cifra inventada).
- `pruebas/baseline-transformadores.json`: comportamiento antes de cambiar el motor (generado por `pruebas/generar_baseline.py`).
- `backend/tests/fixtures/frontend-*-v2.json`: las peticiones exactas del frontend actual (`analyze`, `report`, `chat`).
- `test_compat.py`: `test_frontend_actual_sigue_funcionando`, `test_payload_v3_no_rompe_backend`, `test_capabilities_coherente`.
- `test_regresion_5_4.py`: las 6 pruebas de criterios §5.4. La #3 ("Reordenar nunca peor que hoy") ya pasa en la base; las demás están en `xfail` estricto con la fase que las resuelve.

### API nueva

- `GET /api/capabilities` → `{ "schema_version": 3, "features": [], "vision": false }`.
