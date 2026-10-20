# Plan unificado: Cauce v3 (motor, API, agentes, editor y plano)

Une `PLAN-CLAUDE-CODE.md` (fases C0–C7, backend) y `PLAN-ASTRA.md` (fases A0–A7, frontend) en un solo plan ejecutado por una sola IA en la rama `feature/experiment2` (base: `feature/experiment` actualizada con `develop`).

Documentos que mandan, en este orden: `CRITERIOS-IMPLEMENTACION-1.1.md`, `coordinacion/CONTRATO-v3.md` y este plan. El contrato no se edita.

## Qué cambia al unir los dos planes

| Tema | Planes originales | Plan unificado |
|---|---|---|
| Ramas | `cc/motor` y `astra/editor` contra `main` | Una rama, `feature/experiment2`, contra `develop` (la rama base real del repo) |
| Propiedad de archivos | Backend para Claude, frontend para Astra | Una sola IA toca los dos lados, pero **cada commit es de un solo lado** (backend o frontend), así se puede separar después |
| Archivos de coordinación | `estado-claude.md`, `estado-astra.md`, `de-X-para-Y.md` | Un solo `coordinacion/estado-experiment2.md` |
| Compatibilidad | Cada lado prueba contra el otro "viejo" | Se mantiene: el frontend nuevo funciona si `/api/capabilities` da 404, y el frontend actual funciona con el backend nuevo (prueba `test_frontend_actual_sigue_funcionando`) |
| Orden | Dos listas en paralelo | Una lista por hallazgo (criterios §9): cada fase entrega su parte de motor y su parte de interfaz juntas |

## Ajustes al código real (regla 6 de ambos planes)

1. **`backend/cauce/agents.py` ya existe** (agentes que leen el espacio). El plan pide la carpeta `backend/cauce/agents/`. Se convierte en paquete: el código actual pasa a `agents/spatial.py` y `agents/__init__.py` reexporta lo mismo, así `from cauce.agents import ...` sigue funcionando.
2. **Obstáculos**: hoy una columna es una zona `kind: "bloqueado"`. Según el contrato §4.2 se conserva esa forma y solo se agregan `locked` y `lock_reason`.
3. **El editor ya tiene** deshacer y rehacer (por instantánea del plano), zoom con la rueda, paneo y copiar y pegar de un solo elemento. No se reescribe: se agrega `applyOps` como forma única de los cambios **automáticos** (aplicar alternativa, asistente, bloquear, cambios por grupo) y cada lote entra a la misma pila de deshacer como un paso. Las ediciones a mano siguen guardando una instantánea por gesto, que ya equivale a "un lote".
4. **H7 en el código real**: guardar el plano en el paso 1 vuelve a analizar y **borra el rediseño propio** (`redesign.custom = null`). Ese es el "me manda a mover plano". Se corrige ahí.
5. **Pruebas de frontend**: no hay sistema de pruebas. Se usa `node --test` (incluido en Node 24, sin dependencias) sobre módulos JS puros (`ops.js`, `migrate.js`, `context2.js`, `capabilities.js`).

## Fases

Cada fase: primero la prueba que falla, después el arreglo; commits pequeños; al final se anota en `estado-experiment2.md` qué se hizo, qué campos nuevos hay y qué pruebas lo cubren.

### F0. Base de pruebas y diagnóstico (C0 + A0)

Motor:
- `backend/requirements.txt` y `backend/requirements-dev.txt` (pytest).
- `backend/tests/conftest.py`: planta de transformadores y proveedor falso (sin Ollama).
- Línea base en `pruebas/baseline-transformadores.json` (alternativas, métricas, `recommended`, rutas, informe con proveedor falso).
- Diagnóstico H1 anotado.
- Las 6 pruebas de criterios §5.4 como `xfail` con motivo; cada fase quita las suyas.
- Modelos tolerantes a campos desconocidos y `test_payload_v3_no_rompe_backend`.
- `GET /api/capabilities` con `features: []` y `vision`.
- `test_frontend_actual_sigue_funcionando` con el payload real del frontend.

Interfaz:
- `api.getCapabilities()` en caché; `{ features: [] }` ante cualquier error.
- Respuestas simuladas en `frontend/tests/fixtures/` (v2 capturadas del motor, v3 escritas a mano según contrato §6).
- Botón "Importar proyecto (JSON)".

### F1. Consistencia y trazabilidad (C1 + A1 + A6.4/A6.5) — H1, H10, H7

Motor: `main_metric`, `recommended_reason` y `recommended_tradeoffs` generados por plantilla; validador del informe (`cauce/validate.py`) aplicado a informe y chat; `plant_version` y `context_version`; `context` como texto u objeto segmentado; `facts()` dice cuál es la recomendada y por qué.
Interfaz: guardar el plano ya no borra el rediseño propio; `plant_revision` local y aviso "Desactualizado"; alternativas con "Ver" y "Aplicar" (aplicar se deshace); panel con `main_metric`, razón y contrapartidas; "Afirmaciones descartadas" en el informe.
Features: `report_validation`, `segmented_context`.

### F2. Cantidades, fijos y operaciones (C2 + A2 + A3) — H2, H6, H9

Motor: lectura de `count`, `unit_w`, `unit_d`, `arrangement`, `ops_per_unit`, `t_cycle_min`, `t_source`, `batch`, `locked`, `lock_reason`; N servidores; centro del bloque; fijos como restricción en `feasible()` y en todas las alternativas, con el fijo que lo impide; `espera_lote` en el desglose; `alternatives[].locked_respected`; `pruebas/transformadores-v3.json`.
Interfaz: `ops.js` (`applyOps → { plant, inverse }`), migración `cauce-proyecto-v2 → v3` sin tocar v2; bloquear y desbloquear (candado, borde punteado, no se arrastra); al aplicar una alternativa los fijos conservan su lugar; inspector con cantidad, medidas por unidad, acomodo, tiempos y lote; plano con N unidades o bloque "×N"; etiquetas que no se cortan (número + leyenda).
Features: `count`, `locked`.

### F3. Agentes, proveedores y `/api/plan/ops` (C3 + A6.6)

Motor: `cauce/agents/` con un prompt `.md` por rol y su esquema; `capabilities` por proveedor; proveedor y modelo por rol; `POST /api/plan/ops` (la IA propone en abstracto, el motor resuelve coordenadas y rechaza lo que toca fijos); extractor que no inventa estaciones y reintenta una vez.
Interfaz: asistente del editor (visible solo con `plan_ops`) que muestra operaciones y rechazos antes de aplicarlos en un lote que se deshace.
Feature: `plan_ops`.

### F4. Alternativas y multicriterio (C4 + A6.3) — H4, H5

Motor: CRAFT (pares y tripletas) para "Reordenar", nunca peor que hoy; SLP por bloques; "Línea" solo con flujo lineal; pesos normalizados y validados; `scores`, `weights_used`, `kind`, `sensitivity`, `method`, `assumptions`; README y "Cómo se calculó".
Interfaz: editor de pesos (suman 1) y vista de puntajes, ideal o viable y sensibilidad.
Feature: `weights`.

### F5. Flujos, ciclos y bandas (C5 + A6.1 + A6.2 + A3.4) — H3

Motor: métricas por flujo (`alternatives[].flows`); `flow_order` con componentes fuertemente conexos y retornos (`is_return`); tramos en banda con su velocidad.
Interfaz: flujo por ruta con color y trazo; retornos como flecha curva; herramienta de banda; flechas paralelas separadas.
Features: `flows`, `conveyors`.

### F6. Contexto segmentado y Contexto 2 (A5)

Interfaz: segmentos con entradas inmutables y `supersedes`, historial visible; envía texto si el backend no anuncia `segmented_context`; Contexto 2 determinista que se confirma antes de analizar; datos de confianza baja como rango.

### F7. Selección múltiple, copiar y pegar en grupo (A4) — H8

Interfaz: rectángulo de selección, `Shift`/`Ctrl`; mover en grupo; `Ctrl+C`/`X`/`V` con rutas internas e ids nuevos; `flow` o `frac` a varias rutas a la vez.

### F8. Simulación (C6 + A6.7)

Motor: `POST /api/simulate` con SimPy; triangular con rango, determinista si es medido; colas, lotes y retornos; semilla y réplicas; KPIs `null` sin datos.
Interfaz: botón (solo con `simulate`) con P10, mediana y P90 y "sin datos".
Feature: `simulate`.

### F9. Visión (C7 + A7)

Motor: `vision` refleja al proveedor activo; una ruta con imágenes da un error claro sin visión.
Interfaz: segmento `referencias` con imagen y nota; sin visión dice "No interpretada: el proveedor actual no tiene visión".

## Pruebas transversales (en cada fase)

- `pytest` en `backend/tests` sin Ollama.
- `node --test frontend/tests` para los módulos puros.
- `npm run build` y `npm run lint` sin errores nuevos.
- `test_frontend_actual_sigue_funcionando`, `test_payload_v3_no_rompe_backend`, `test_capabilities_coherente`.
- `pruebas/probar_transformadores.py` sigue en OK.

## Lo que no se hace

- Ningún número sale de un modelo de lenguaje.
- No se renombra ni se quita ningún campo o ruta de la API.
- No se edita el contrato, los criterios ni `ESTADO.md`.
- No se borra ni modifica `cauce-proyecto-v2` en el navegador.
