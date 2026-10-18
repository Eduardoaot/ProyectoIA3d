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

## F1. Consistencia y trazabilidad (H1, H10, H7)

### Motor
- `cauce/decision.py`: `main_metric` (sin supuestos: costo de manejo en m por pieza; con supuestos: tiempo por pieza, con capacidad como segunda), `recommended_reason` y `recommended_tradeoffs` por plantilla. Si la recomendada empeora la métrica principal, la razón lo dice y nombra las alternativas mejores en esa métrica.
- `cauce/validate.py`: revisa cada oración del informe y del chat. Descarta las que traen una cifra que no está en `facts()` (tolerancia de redondeo de 0,5 o 1 %; entiende "1.304" como miles, porcentajes, rangos y números de lista) y las que elogian una alternativa que el motor muestra peor que hoy o llaman "la mejor" a otra que no es la recomendada. Trabaja sobre el flujo, oración por oración, así el informe sigue apareciendo mientras se escribe.
- `facts()` ahora dice cuál es la recomendada y por qué, qué alternativas hacen caminar más que hoy, el porcentaje frente a hoy de cada una, los elementos fijos y los datos vigentes del contexto. El prompt del informe pide no calcular porcentajes.
- `/api/analyze`: `plant_version`, `context_version`, `main_metric`, `recommended_reason`, `recommended_tradeoffs`. Acepta `context` (texto u objeto segmentado) y `weights` (se usan en F4).
- `/api/report` y `/api/chat`: validados siempre. Con `with_validation: true` el flujo termina con `\n\u001e{"validation": {...}}` (contrato §6.3); sin ese campo el texto es igual que antes (frontend actual). En el chat, las cifras que escribió el usuario también cuentan como respaldo.
- `features`: `report_validation`, `segmented_context`.
- Pruebas: `test_f1_trazabilidad.py`; §5.4 #6 y la contrapartida de #1 pasan.

### Interfaz
- Guardar el plano en el paso 1 ya no borra «Tu rediseño» (era el "me manda a mover plano"). Si se hizo sobre un plano anterior, se avisa.
- `draftRev` sube con cada edición del plano; el análisis guarda `analysisRev`. Si no coinciden: "Desactualizado: el plano cambió" (con `plant_version` si viene). No depende del backend.
- Alternativas con «Ver» y «Aplicar». Aplicar copia la propuesta a «Tu rediseño» en un paso y «Deshacer lo aplicado» lo revierte. Los fijos conservan su lugar aunque la respuesta los mueva (`proposals.protectLocked`).
- Panel «Por qué se recomienda» con `recommended_reason`, métrica principal y contrapartidas, solo si vienen.
- El informe pide `with_validation` solo si el backend anuncia `report_validation`; las frases descartadas se muestran en «Afirmaciones descartadas».
- `slim()` envía `recommended`, su razón y el texto de la historia como `context`.
- Pruebas: `frontend/tests/f1-propuestas.test.js`.

## F2. Cantidades, fijos y operaciones (H2, H6, H9)

### Motor
- `cauce/units.py`: `count`, `unit_w`/`unit_d`, `arrangement`, `ops_per_unit` (por defecto `ops / count`), `t_cycle_min` (rango → promedio), `t_source`, `batch`, `locked`, `lock_reason`, y `block_size()`.
- Servidores: cada operario es un servidor (igual que v2); sin operarios, cada máquina. `count: 1` da exactamente lo mismo que v2 (la prueba del payload v3 compara capacidad, tiempo y camiones). Las estaciones con varias máquinas no entran al reparto de operarios.
- Lote: `lead_parts.espera_lote` separado del tiempo de máquina; la pieza pasa el lote completo en el horno y la carga por pieza es `t_min / size`.
- Fijos: todas las alternativas, incluida la compacta, dejan las estaciones `locked` en su lugar. `alternatives[].locked_respected` y, si algo no cabe, `alternatives[].infeasible = { stations, blocked_by, text }` dice qué fijo lo impide (si cabe sin los fijos) o que no hay lugar.
- Zonas `kind: "obstaculo"` se tratan como bloqueadas en relaciones.
- `pruebas/transformadores-v3.json`: 14 estaciones, 36 máquinas (embobinado ×10, montaje ×4, soldadura ×3, configuración ×6, gabinete ×4), horno por lote y fijo, dos columnas fijas, retornos, flujos de personas, vehículos y carga, y una banda. `probar_transformadores.py transformadores-v3.json` da OK; el horno sale como cuello de botella por tiempo.
- `features`: `count`, `locked`. Pruebas: `test_f2_cantidades_fijos.py`; §5.4 #2 y #4 pasan.

### Interfaz
- `ops.js`: `applyOps(plant, ops) → { plant, inverse, applied, rejected }` con las 8 operaciones del contrato §5; rechaza mover, borrar o cambiar medidas de lo fijo con su motivo. La inversa deja el plano idéntico (campos extra `at` y `unset`).
- `migrate.js`: guarda en `cauce-proyecto-v3`; la primera vez copia y migra `cauce-proyecto-v2`, que no se toca.
- Editor: «Fijar en su lugar» con motivo y «Liberar» (por `applyOps`, un paso de deshacer); lo fijo se dibuja con borde punteado y candado y no se arrastra, gira, mueve con flechas ni borra (avisa el motivo). Las copias no heredan el fijo.
- Con `count` anunciado: cantidad, operarios por máquina, medidas por unidad, acomodo, ciclo mínimo y máximo, procedencia y lote. Cambiar cantidad, medidas o acomodo recalcula el bloque.
- El plano dibuja las N máquinas según el acomodo, o un bloque «×N» (más de 12 se agrupan por defecto; «Ver las N máquinas» / «Ver como un bloque» solo cambia la vista).
- Etiquetas: si el nombre no cabe se muestra el número y el nombre va en una leyenda debajo del plano y al pasar el cursor; igual en el plano del reporte (PDF).
- Pruebas: `f2-ops-migracion.test.js`, `f2-unidades.test.js`.
- Pendiente menor: la vista 3D dibuja el bloque de una estación con varias máquinas como una sola maqueta.

## F3. Agentes, proveedores y `/api/plan/ops`

### Motor
- `cauce/agents/` es un paquete: `spatial.py` (los agentes espaciales de antes, reexportados igual), un prompt por rol en `extractor.md`, `editor.md`, `contexto.md`, `analista.md`, `informe.md`, `misiones.md`, `chat.md`, y `roles.py` con los esquemas de salida. `schema.py` valida JSON sin dependencias.
- Proveedores: `capabilities = {json_schema, stream, vision, max_context}` en `base.py`; Ollama marca `vision` solo para modelos con visión (llava, *vision*, gemma3…). `get_provider(rol)` con `CAUCE_<ROL>_PROVIDER/MODEL` (editor y misiones heredan del extractor; informe, analista y contexto heredan del chat). `/api/health` agrega `roles`.
- `POST /api/plan/ops` (`cauce/planops.py`): el editor propone en abstracto (`near`, nunca coordenadas); el motor coloca en el hueco factible más cercano, rechaza lo fijo, lo que la instrucción protege ("no muevas X"), ids inexistentes, rutas repetidas y cifras que el usuario no escribió. Respuesta `{ ops, rejected, notes }`, nunca el plano. Si el modelo falla, `ops: []`.
- Extractor: valida contra el esquema y reintenta una vez; nuevo campo `cantidad` (solo se usa si la cifra aparece en la historia).
- Misiones: se descarta la que cita una cifra sin respaldo en `facts()`.
- Arreglo encontrado por las pruebas: las importaciones diferidas de `spatial.py` apuntaban al paquete viejo.
- `features`: `plan_ops`. Pruebas: `test_f3_agentes.py`.
- Sin ruta todavía: los agentes `contexto` y `analista` tienen prompt y proveedor, pero el Contexto 2 se arma en el frontend sin IA (F6) y el análisis lo redacta el informe.

### Interfaz
- Asistente del plano debajo del editor (solo con `plan_ops`): muestra las operaciones en palabras y lo rechazado con su motivo antes de aplicar; «Aplicar» usa `applyOps` en un lote = un paso de deshacer. Si `applyOps` rechaza algo (por ejemplo, algo fijado después), lo dice.
- Pruebas: `f3-asistente.test.js`.

## F4. Alternativas y multicriterio (H4, H5)

### Motor
- «Reordenar en su lugar» = CRAFT: intercambios por pares y, cuando ya no mejoran, rotaciones de tres estaciones entre sus lugares, hasta que el costo de manejo no baje. Si por las rutas reales caminara más que hoy, se queda como hoy (§5.4 #3 garantizado, no solo observado).
- Nueva alternativa `slp` «Por bloques (SLP)»: las áreas con relación A o E forman bloques que siguen el orden del flujo y se empacan desde la esquina de menor costo. En transformadores: 136,4 m frente a 163 m hoy; en la v3, 200,9 m frente a 244,4 m.
- En la v3, CRAFT no encuentra intercambios factibles (bloques de tamaños muy distintos): «Reordenar» queda igual que hoy y lo declara; no se finge una mejora.
- `criteria.py`: puntaje 0–1 por criterio (manejo, lead_time, capacidad, obra, seguridad, flexibilidad), pesos validados (422 si hay criterios desconocidos, negativos o todo en 0) y normalizados (`weights_note`). Recomendada = mayor total entre las viables (respetan fijos y caben); `ideal` = mejor sin contar obra ni fijos; `sensitivity` por criterio ×0,5 y ×2.
- `/api/analyze` agrega `alternatives[].method`, `assumptions`, `scores`, `score_total`, `kind`, `sensitivity`, y `weights_used`, `ideal`, `current_scores`. `score` (el de antes) se conserva por compatibilidad.
- README: tabla de alternativas y explicación del puntaje actualizadas.
- Rendimiento: `pack()` con caja envolvente incremental; SLP busca en malla de 1 m.
- `features`: `weights`. Pruebas: `test_f4_multicriterio.py`; §5.4 #1 pasa.

### Interfaz
- Tabla «Cómo se comparan»: puntaje por criterio de hoy y cada alternativa, total, ★ en la recomendada, etiqueta «ideal» y lectura de la sensibilidad. Solo si llegan `scores`.
- «Qué pesa más para ti» (solo con `weights`): seis pesos que deben sumar 1, «Ajustar para que sumen 1», «Pesos por defecto» y «Recalcular con estos pesos» (acción explícita; no toca «Tu rediseño»). Los pesos se guardan y se envían al guardar el plano.
- Tarjetas: «IDEAL» cuando la mejor técnica no es la recomendada; aviso si una alternativa no respeta lo fijo.
- «Cómo se calculó» explica la recomendación multicriterio.
- Pruebas: `f4-pesos.test.js`.

## F5. Flujos, ciclos y bandas (H3)

### Motor
- `cauce/flows.py`: flujo por ruta (`material`, `personas`, `vehiculos`, `carga`). Las métricas de siempre son solo del material; `current.flows` y `alternatives[].flows` traen metros por pieza y al día de cada flujo. En la búsqueda pesan material y carga 1, vehículos 0,5 y personas 0,3.
- Orden del proceso con componentes fuertemente conexas (Tarjan) sin los retornos: un ciclo ya no manda estaciones al final. Sin ciclos el orden es el mismo de antes. `current.cycles` lista los ciclos (con retornos). En la planta v2 había un ciclo sin marcar (pruebas → encubado, 5 %): ahora queda en su lugar del proceso; U, línea y reordenar dan lo mismo que antes y SLP cambia un poco (136,4 → 142,4 m).
- Bandas: una ruta con `conveyor` mide la banda más la carga y descarga; nadie camina el tramo en banda (no suma a `daily_m`), su traslado usa `speed_mpm` y `conveyor_load` compara piezas por minuto con `capacity_ppm`.
- Legs con `flow`, `is_return`, `conveyor` y `belt_m`. Otros flujos dan relación I. `facts()` nombra retornos, bandas y flujos de personas, vehículos y carga.
- `features`: `flows`, `conveyors`. Pruebas: `test_f5_flujos.py`; §5.4 #5 pasa. **Las 6 pruebas de §5.4 pasan; no queda ningún `xfail`.**

### Interfaz
- Rutas con color y trazo por flujo; los retornos se dibujan como flecha curva punteada; las rutas entre el mismo par de estaciones se separan a los lados (editor y plano del reporte). Leyenda de flujos bajo el plano.
- Herramienta «Ruta» con selector de flujo (con `flows`); en el inspector, «Qué se mueve», «Es un retorno» y «Va en banda» (con `conveyors`).
- Herramienta «Banda» (con `conveyors`): se dibuja arrastrando, sus extremos se unen a la máquina más cercana; inspector con capacidad, velocidad (valores iniciales marcados como supuestos), de dónde recibe y a quién entrega, fijar y quitar (las rutas que la usaban vuelven a ir a pie).
- Panel «Por flujo» en el rediseño con metros por flujo, ciclos y carga de cada banda, solo si vienen.
- Pruebas: `f5-flujos.test.js`.
