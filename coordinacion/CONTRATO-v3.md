# Contrato común v3: Cauce (Claude Code ↔ Astra)

Este archivo se sube a develop ANTES de que empiece cualquiera de los dos. Ruta en el repo: `coordinacion/CONTRATO-v3.md`. Ninguna de las dos IA lo edita. Si alguna necesita cambiarlo, se detiene y se lo pide al usuario.

Propósito: que el backend (Claude Code) y el frontend (Astra) avancen en paralelo, en PCs distintas, sin que ninguno necesite el código del otro para funcionar ni para pasar sus pruebas.

## 1. Regla de oro: todo cambio es aditivo y tolerante

- Nunca se renombra ni se elimina un campo, una ruta o un valor que exista hoy. Solo se agregan cosas.
- Todo campo nuevo es opcional. El que lo recibe usa el valor por defecto de este contrato cuando falta.
- El backend ignora los campos que no conoce y no falla con ellos. Si los modelos usan validación estricta (`extra="forbid"` o equivalente), se cambia a ignorar.
- El frontend ignora los campos de respuesta que no conoce y no falla cuando falta un campo nuevo.
- Las funciones nuevas del backend se detectan, no se suponen. El frontend consulta `GET /api/capabilities`. Si responde 404 o error, trata la lista de funciones como vacía y oculta lo que depende de ellas.
- Los nombres de los campos nuevos son exactamente los de este documento. Los campos existentes conservan su nombre actual.

Consecuencias:

- Frontend nuevo + backend viejo → funciona y oculta lo nuevo.
- Frontend viejo + backend nuevo → funciona con valores por defecto.
- Frontend nuevo + backend nuevo → todo activo.

## 2. Propiedad de archivos (nadie toca lo del otro)

| Dueño | Archivos |
|---|---|
| Claude Code | `backend/**`, `pruebas/**`, `requirements*.txt` / `pyproject.toml`, `README.md`, `coordinacion/estado-claude.md`, `coordinacion/de-claude-para-astra.md` |
| Astra | Carpeta del frontend (HTML/JS/CSS de la interfaz, sea `frontend/`, `static/`, `web/` o la que exista), `package.json` y su lock si existen, `docs/editor.md`, `coordinacion/estado-astra.md`, `coordinacion/de-astra-para-claude.md` |
| Nadie | `CRITERIOS-IMPLEMENTACION-*.md`, `ESTADO.md`, `contexto-proyecto.md`, `coordinacion/CONTRATO-v3.md` |

- Si el frontend se sirve desde dentro de `backend/` (por ejemplo `backend/cauce/static/`), esa subcarpeta es de Astra. Claude Code la excluye de su propiedad y lo anota en `estado-claude.md`.
- Si una IA necesita algo del otro lado, no lo hace: lo escribe en su archivo `de-X-para-Y.md` y sigue con lo que no depende de eso.
- `ESTADO.md` lo actualiza el usuario a partir de los dos archivos `estado-*.md`.

## 3. Ramas

- Claude Code trabaja en `cc/motor`. Astra trabaja en `astra/editor`.
- Cada una se fusiona a develop por su lado, en PRs pequeños, cuando sus pruebas pasan.
- Antes de cada push: `git diff --name-only develop...HEAD` debe contener solo archivos propios (sección 2). Si aparece uno ajeno, se revierte.
- Cada una puede traer develop a su rama cuando quiera. Como los archivos no se cruzan, no debería haber conflictos.

## 4. Formato de planta v3 (lo que viaja en las peticiones y se guarda)

### 4.1 Planta

| Campo nuevo | Tipo | Defecto | Significado |
|---|---|---|---|
| `schema_version` | int | 2 | 3 cuando lo escribe el frontend v3 |
| `conveyors` | lista | `[]` | Bandas (4.4) |

### 4.2 Estación (campos nuevos, todos opcionales)

| Campo | Tipo | Defecto | Significado |
|---|---|---|---|
| `count` | int ≥ 1 | 1 | Máquinas idénticas en paralelo |
| `unit_w` | número (m) | ancho actual | Ancho de cada unidad |
| `unit_d` | número (m) | fondo actual | Fondo de cada unidad |
| `arrangement` | `"fila"`, `"columna"`, `"bloque"` | `"fila"` | Cómo se acomodan las N unidades |
| `ops_per_unit` | int ≥ 0 | valor de ops / N | Operarios por unidad |
| `t_cycle_min` | [min, max] o número | sin dato | Tiempo de ciclo por pieza o lote (min) |
| `t_source` | `"medido"`, `"estimado"`, `"supuesto"`, `"usuario"` | `"supuesto"` | Procedencia del tiempo |
| `batch` | `{ "size": int, "t_min": número }` | sin dato | Proceso por lote (horno, secado) |
| `locked` | bool | false | Ninguna alternativa ni IA la mueve |
| `lock_reason` | texto | `""` | Por qué está fija |

Reglas:

- La posición y el tamaño existentes de la estación siguen siendo los del bloque completo (todas las unidades juntas). `unit_w`/`unit_d` son de cada unidad.
- Un obstáculo (columna, muro interior) es un elemento con `kind: "obstaculo"`, y además `locked: true` y `lock_reason`. Si hoy los obstáculos tienen otra forma, se conserva esa forma y solo se agregan `locked` y `lock_reason`.

### 4.3 Ruta o conexión (campos nuevos)

| Campo | Tipo | Defecto |
|---|---|---|
| `flow` | `"material"`, `"personas"`, `"vehiculos"`, `"carga"` | `"material"` |
| `is_return` | bool | false |
| `conveyor` | id de banda o null | null |

### 4.4 Banda (`conveyors[]`)

```json
{ "id": "banda-1", "from": "soldadura", "to": "config", "points": [[10,4],[18,4]],
  "capacity_ppm": 2, "speed_mpm": 6, "locked": false }
```

### 4.5 Contexto

`context` puede ser:

- texto (formato actual), o
- objeto segmentado:

```json
{ "segments": { "tiempos": [ { "id": "tiempos-0007", "segment": "tiempos", "version": 3,
  "date": "2026-10-14", "key": "pulido.t_ciclo", "value": [3.5, 4.5], "unit": "min/pieza",
  "source": "medido", "confidence": "alta", "owner": "supervisor", "supersedes": "tiempos-0004" } ] } }
```

Segmentos válidos: `negocio`, `operaciones`, `tiempos`, `maquinas`, `flujo`, `personal`, `calidad`, `restricciones`, `referencias`. Las entradas no se borran: una entrada nueva reemplaza a la anterior mediante `supersedes`. La entrada vigente de cada `key` es la que no fue reemplazada por ninguna otra.

### 4.6 Almacenamiento local

- La clave actual `cauce-proyecto-v2` no se modifica ni se borra.
- El frontend v3 guarda en `cauce-proyecto-v3`. Al arrancar sin v3, migra desde v2 (copia y agrega valores por defecto).

## 5. Operaciones sobre el plano (un solo formato para deshacer y para el asistente)

```json
{ "op": "add",      "element": { "...": "estación, obstáculo o banda completa con x,z" } }
{ "op": "delete",   "id": "pulido-2" }
{ "op": "move",     "id": "horno", "to": { "x": 28, "z": 4 } }
{ "op": "update",   "id": "embobinado", "set": { "count": 10 } }
{ "op": "connect",  "from": "horno", "to": "config", "frac": 1.0, "flow": "material" }
{ "op": "disconnect", "from": "horno", "to": "config", "flow": "material" }
{ "op": "lock",     "id": "columna-1", "reason": "Columna estructural" }
{ "op": "unlock",   "id": "columna-1" }
```

Toda operación puede llevar `"reason": "texto"`. Varias operaciones forman un lote y se deshacen juntas.

Reglas:

- `move`, `delete` y `update` (de posición o tamaño) sobre un elemento `locked` se rechazan.
- Las coordenadas de un `add` que genera el backend las calcula el motor, nunca el modelo de lenguaje.

## 6. API

### 6.1 `GET /api/capabilities` (nueva)

```json
{ "schema_version": 3,
  "features": ["count", "locked", "flows", "conveyors", "weights", "plan_ops",
               "report_validation", "simulate", "segmented_context"],
  "vision": false }
```

`features` lista solo lo que ya está implementado. El backend lo va completando fase por fase.

### 6.2 `POST /api/analyze` (existente; solo se agregan campos)

Petición, campos nuevos opcionales:

- `weights`: `{ "manejo": 0.25, "lead_time": 0.20, "capacidad": 0.15, "obra": 0.15, "seguridad": 0.15, "flexibilidad": 0.10 }`. Deben sumar 1. Si falta, se usan estos valores.

Respuesta, campos nuevos opcionales:

| Campo | Significado |
|---|---|
| `plant_version` | hash del plano usado (SHA-256 del JSON canónico, sin campos de vista) |
| `context_version` | hash o versión del contexto usado |
| `main_metric` | `{ "key": "manejo", "label": "Costo de manejo", "direction": "min" }` |
| `recommended_reason` | texto generado por el motor (no por IA) que explica la elección |
| `recommended_tradeoffs` | `[{ "metric": "manejo", "delta_pct": 12.5, "note": "..." }]` si empeora en algo |
| `weights_used` | pesos aplicados |
| `alternatives[].method` | `"craft"`, `"slp"`, `"corelap"`, `"aldep"`, `"linea"`, `"usuario"`, `"hoy"` |
| `alternatives[].assumptions` | lista de textos |
| `alternatives[].scores` | `{ "manejo": ..., "lead_time": ..., ... }` por criterio |
| `alternatives[].kind` | `"ideal"` o `"viable"` |
| `alternatives[].locked_respected` | bool |
| `alternatives[].flows` | métricas por flujo: `{ "material": {...}, "personas": {...} }` |
| `alternatives[].sensitivity` | `{ "manejo_x0.5": "misma", "manejo_x2": "cambia", ... }`: para cada criterio, si la recomendación es la `"misma"` o `"cambia"` al multiplicar su peso por 0.5 y por 2 |

El campo `recommended` existente conserva su significado.

### 6.3 `POST /api/report` (existente)

Respuesta, campo nuevo opcional: `validation: { "checked": 12, "discarded": [ { "text": "...", "reason": "cifra no está en facts()" } ] }`.

### 6.4 `POST /api/plan/ops` (nueva, función `plan_ops`)

- Petición: `{ "instruction": "agrega una pulidora junto a sandblasting y no muevas la columna", "plant": { ... } }`
- Respuesta: `{ "ops": [ ...sección 5... ], "rejected": [ { "op": {...}, "reason": "..." } ], "notes": "..." }`
- El backend nunca devuelve el plano completo.

### 6.5 `POST /api/simulate` (nueva, función `simulate`)

- Petición: `{ "plant": {...}, "alternative": "id", "replicas": 30, "seed": 42 }`
- Respuesta: `{ "seed": 42, "replicas": 30, "kpis": { "piezas_dia": { "p10": .., "p50": .., "p90": .. }, "lead_time_min": {...}, "utilizacion": { "<estación>": {...} }, "tiempo_muerto": { "falla": .., "material": .., "personal": .., "cambio": .., "lote": .. }, "oee": null } }`
- Un KPI sin datos se envía como null. El frontend muestra "sin datos".

## 7. Datos de prueba compartidos

- `pruebas/transformadores.json` es la fuente (formato v2). Es de Claude Code, y Astra solo la lee. Es un objeto `plant` completo, el mismo que recibe `POST /api/analyze` en `{ "plant": ... }`. `pruebas/probar_transformadores.py` lo valida contra el motor sin servidor.
- Astra guarda copias y respuestas simuladas en su propia carpeta de pruebas del frontend.
- Cuando Claude Code cree `pruebas/transformadores-v3.json`, lo avisa en `de-claude-para-astra.md`. Astra puede leerlo, pero no lo necesita para avanzar.
