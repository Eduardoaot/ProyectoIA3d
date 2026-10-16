# Estado del frontend (Astra)

## 2026-10-16 · A6 · Funciones anunciadas por el backend

- Flujos `material`, `personas`, `vehiculos`, `carga`, colores/trazos distintos,
  retornos curvos y leyenda en editor y plano imprimible. Herramienta de banda
  por puntos y estaciones, `capacity_ppm`, `speed_mpm` y enlace `route.conveyor`.
- Pesos editables validados (suma 1); se envían fuera de `plant` en `/api/analyze`.
  Resultados muestran campos opcionales `main_metric`, `recommended_reason`,
  `recommended_tradeoffs`, `weights_used`, `method`, `kind`, `assumptions`,
  `scores`, `flows` y `sensitivity`; no se calculan métricas en el cliente.
- Asistente: valida y presenta operaciones aceptadas/rechazadas antes de aplicar
  un lote. Una edición invalida propuestas pendientes; no se admiten metadatos
  privados de deshacer ni modificación indirecta del bloqueo.
- Simulación explícita con semilla/réplicas, P10/mediana/P90 y «sin datos» para null.
  Los cambios invalidan sus resultados y requiere confirmar Contexto 2.
- Informe dual texto/JSON `{ text, validation }`, acuerdo explícito del usuario;
  se conserva streaming y se imprime `validation.discarded`. Ver nota a Claude.
- A5 publicada en `626a775` (66 pruebas). A6: 75 pruebas aprobadas, lint sin
  errores y build aprobado; se conservan advertencias anteriores de hooks/bundle.
- Prueba real en Chrome headless con API simulada v2/v3: selección por modificadores,
  copiar/pegar/deshacer, invalidación de Contexto 2 y asistente reversible aprobados,
  sin excepciones del navegador. Script reproducible sin dependencias adicionales.
- Se preservó el commit externo `282b6b6` que añadió plan/criterios mientras
  trabajábamos. Esos archivos no se modificaron en las entregas del frontend.

## 2026-10-16 · A5 · Contexto y confirmación

- Entradas inmutables con `segment`, `id`, `key`, `version`, `date`, `value`,
  `unit`, `source`, `confidence`, `owner` y `supersedes`. Historial visible;
  cambios de tiempo desde el inspector, incluido deshacer, agregan versiones.
- Contexto 2 determinista: cantidades, fijos, rutas por flujo, bandas y cambios
  desde el último análisis. Tanto análisis inicial como rediseño requieren
  confirmar el contenido exacto; editar contexto también invalida la confirmación.
- El cliente convierte contexto segmentado a texto para servidores sin
  `segmented_context` en análisis, rutas, evaluación e informe. Conserva el
  objeto y todo su historial cuando el servidor anuncia esa función.
- Datos de confianza baja marcados; rangos visibles, sin inventar intervalos
  para valores puntuales que no los tienen. La historia v2 se conserva.
- A4 publicada en `244b56f` (62 pruebas). A5: pruebas de historial inmutable,
  edición/deshacer de tiempos, bloqueo de llamadas sin confirmación y fallback
  v2 frente al envío segmentado v3; lint y build conservan avisos previos.

## 2026-10-16 · A4 · Edición por grupos

- Reanudación desde `f065794` en `feature/ParteB`; el usuario solicita completar
  A4–A7 con commit y push por fase. Se conserva la propiedad del frontend.
- Selección rectangular y Shift/Ctrl/Meta para sumar/quitar; mover el grupo
  conserva distancias relativas y genera un lote reversible de `move`.
- Copiar/cortar/pegar con ids nuevos, desplazamiento incremental, rutas y bandas
  internas remapeadas. Los bloqueados rechazan mover/cortar/borrar el grupo.
- Edición de `flow`/`frac` en varias rutas, validada y reversible en un paso.
- Se corrige el orden de eliminación de dependientes en `diffOps` para permitir
  borrar/restaurar estaciones conectadas a bandas sin referencias rotas.
- Pruebas de copia de tres estaciones, rutas internas, inversas exactas, corte,
  movimiento con límites, selección y edición de rutas; render v2/v3 conservado.
- Dependencias restauradas con `npm ci`, sin cambios al manifiesto ni al lock.


## A3 · Cantidades y plano legible

- Inspector: `count`, `unit_w`, `unit_d`, `arrangement`, `ops_per_unit`, rango
  `t_cycle_min`, `t_source` y `batch`. Los cambios de cantidad ajustan el tamaño
  del bloque en una operación explícita; nunca redistribuyen otras estaciones.
- Expandir/agrupar solo cambia la vista. Etiquetas adaptativas, título completo
  y leyenda numerada compartidos por editor y plano imprimible. Etiqueta ×N en 3D.
- Rueda para zoom; Alt/central para paneo; restablecer vista. Las rutas paralelas
  se separan visualmente sin cambiar las métricas recibidas del motor.
- Pruebas: cuadrículas fila/columna/bloque, caso ×10, etiquetas y rutas opuestas.

## A2 · Operaciones y almacenamiento v3

- `applyOps` es la vía de edición: operaciones atómicas con inversas, incluso
  arrastres completos y cambios de supuestos. Deshacer/rehacer usa lotes.
- Adaptador `diffOps` conserva `layout[id]`, paredes, zonas y portones actuales.
  Metadatos locales `_collection`, `_position`, `_index`, `_unset` preservan forma
  y orden en las inversas; `$plant` identifica propiedades de la bodega. No se
  envían al backend ni alteran el contrato de operaciones del asistente.
- Bloqueo y desbloqueo con motivo. Rechazo de mover, borrar o redimensionar fijos.
- Migración por copia a `cauce-proyecto-v3`; v2 nunca se escribe ni se elimina.
  El frontend conserva campos originales y envía plantas v3 completas.
- Pruebas: inversas de cada operación, lotes atómicos, fijos, adaptación y migración.
- Verificación A2: 55 pruebas aprobadas; lint sin errores y compilación correcta.

## A1 · Trabajo manual y propuestas

- A0 publicada en `ae47881`. Se continúa en `feature/ParteB` con un commit y push por fase.
- «Interpretar historia» obtiene el borrador; «Analizar» es la acción explícita de análisis.
- `plant_revision` aumenta con cambios del borrador/rediseño; `analysis_revision`
  conserva la revisión enviada, incluso si la respuesta llega después de una edición.
- Propuestas con «Ver» y «Aplicar», aplicación reversible y protección defensiva de
  posiciones `locked`. Se muestra el motivo y se invalidan métricas tras aplicar/editar.
- El rediseño se evalúa únicamente con «Analizar rediseño». Se conserva la consulta
  ligera de rutas del editor permitida por criterios §8; no redistribuye elementos.
- Pruebas: revisiones, respuestas tardías, fijos e inversa de posiciones; suite v2/v3.

## 2026-10-15 · Fase A0 completada

Rama de trabajo: `feature/ParteB`, por indicación del usuario; base de integración:
`develop`. El plan menciona `main` y `astra/editor`, pero no hay una referencia
local/remota a `main`. Se usa el backend integrado desde `upstream/develop`
(`1703596`), sin modificarlo. HEAD inicial: `0de0f8a`.

Se leyeron el plan y el contrato completos. Los criterios se encontraron en
`../CRITERIOS-IMPLEMENTACION-1.1.md` (fuera del repositorio), también leídos.

### Inventario

| Responsabilidad | Código actual |
| --- | --- |
| Persistencia | `frontend/src/project.js`: `useProject`, clave `cauce-proyecto-v2`, guardado con espera de 300 ms |
| Cliente HTTP | `frontend/src/api.js`: peticiones JSON y lectura de texto en streaming |
| Análisis | `frontend/src/App.jsx`: `save()` llama `api.analyze(draft)` al pulsar «Guardar y ver en 3D» |
| Informe | `frontend/src/components/useReport.js`: `stream('/api/report', ...)` |
| Plano editable | `frontend/src/editor/PlanEditor.jsx` e `Inspector.jsx`, SVG |
| Planos de resultados e impresión | `frontend/src/charts/FlowPlan.jsx` |
| Escena 3D | `frontend/src/three/PlantView.jsx` y `PlantScene.js` |
| PDF | `frontend/src/steps/Report.jsx`: `window.print()` sobre `report/ReportDoc.jsx` y estilos `@media print` |

### Ajustes al plan basados en el código

- Ya existe un cliente de API: se amplía ese archivo con `getCapabilities()`.
- `/api/report` responde `text/plain` en streaming, no JSON. La captura
  `report-v2.json` conservará estado, tipo de contenido y cuerpo textual reales.
  No se cambia el protocolo ni se inventa un campo de texto v3. La incorporación
  de `validation.discarded` requiere acordar su transporte con backend antes de A6.
- El PDF es responsabilidad del frontend; las etiquetas se atenderán en A3.
- Las posiciones actuales están en `plant.layout[id] = [x, z, rot]`; los
  obstáculos actuales son zonas `kind: "bloqueado"`. A2 debe conservar esas formas.
- El editor solicita `/api/routes` al editar, y el rediseño solicita
  `/api/evaluate`; ninguno llama automáticamente a `/api/analyze`. A1 debe
  proteger el análisis explícito y distinguir propuestas de cambios aplicados.
- El caso compartido tiene 11 estaciones y 13 rutas. Se conserva como fuente
  v2; las cantidades v3 serán datos simulados del frontend, no una nueva medición.

### Secuencia

A0 completada como cambio independiente. Las fases A1–A7 siguen pendientes.
La migración de almacenamiento corresponde a A2.

### Entregado

- Importación JSON en el paso 1, validación antes de sustituir el borrador,
  confirmación de sustitución y reinicio del historial al cambiar de proyecto.
  Se aceptan plantas completas y plantas dentro de `draft`/`plant`.
- Cliente `getCapabilities()` con caché compartida, límite de cinco segundos y
  fallback silencioso a `{ features: [] }`.
- Capturas HTTP reales `analyze-v2.json` y `report-v2.json`, caso de entrada y
  metadatos de procedencia. Informe capturado mediante el fallback del backend,
  con Ollama inaccesible; no es una respuesta generada por un modelo.
- Fixtures simulados `analyze-v3.json`, `transformadores-v3.json`,
  `capabilities-full.json` y `plan-ops.json`. Son pruebas de formato y renderizado,
  no resultados calculados para las cantidades v3.
- Guía de uso, pruebas y reproducción de capturas en `docs/editor.md`.

### Campos del contrato

- Se consultan `features` y `vision` de `/api/capabilities`; se conservan los
  campos desconocidos de una respuesta válida. A0 no añade herramientas v3.
- `/api/analyze` conserva la petición `{ plant }`. Al importar, se mantienen
  las posiciones y todos los campos adicionales de la planta.
- No cambia el formato del informe ni la persistencia v2 existente. Migración,
  operaciones, Contexto 2 y presentación de resultados v3 quedan para sus fases.

### Verificación

- `npm test`: 42 pruebas aprobadas (API, importación, fixtures y renderizado).
- `npm run lint`: sin errores; permanecen los avisos de hooks/refs existentes.
- `npm run build`: aprobado; permanece el aviso de tamaño del bundle.
- `git diff --check`: aprobado.
- Captura real: `/api/capabilities` → 404; el caso tiene 11 estaciones y 13 rutas.
  Recorrido actual: 163 m/pieza; recomendación `keep`: 141 m/pieza.
- El renderizado en Node usa los componentes reales de plano e informe y un
  sustituto del logotipo, que requiere geometría SVG del navegador. Queda
  pendiente la comprobación visual e interacción manual en navegador.
- No se cambiaron archivos del backend ni de `pruebas/**`. Cambios locales,
  sin commit, push ni PR. `PLAN-ASTRA.md` ya estaba sin seguimiento al comenzar.
