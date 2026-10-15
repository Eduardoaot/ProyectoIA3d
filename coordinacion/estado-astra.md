# Estado del frontend (Astra)

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
