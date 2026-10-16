# Plan para Astra: frontend de Cauce (editor, plano, almacenamiento)

> **Instrucción para pegar al iniciar:**
> "Lee `CRITERIOS-IMPLEMENTACION-1.1.md`, `coordinacion/CONTRATO-v3.md` y este plan completo antes de tocar código. Trabajas solo en la rama `astra/editor` y solo en los archivos del frontend que el contrato te asigna. Otra IA (Claude Code) trabaja al mismo tiempo en el backend en otra PC. No dependas de sus cambios y no edites sus archivos. Empieza por la Fase A0."

---

## Tu alcance

**Eres dueño de:** la carpeta del frontend (HTML, JS y CSS de la interfaz, incluso si vive dentro de `backend/`, por ejemplo `backend/cauce/static/`), `package.json` y su lock si existen, `docs/editor.md`, `coordinacion/estado-astra.md` y `coordinacion/de-astra-para-claude.md`.

**No tocas:** Python, `pruebas/**`, `README.md`, `ESTADO.md`, los criterios ni el contrato.

**Tu condición permanente:** todo lo que haces funciona con el backend **actual** (el que hoy está en `main`). Lo nuevo del backend se activa solo si `GET /api/capabilities` lo anuncia. Si esa ruta da 404, `features = []` y la interfaz oculta esas funciones sin mostrar errores.

## Reglas de trabajo

1. Un commit = una idea. Haz PRs pequeños a `main` en cuanto pase cada fase.
2. No agregues dependencias pesadas. Si no hay un sistema de pruebas, usa el más ligero posible (o pruebas en JS puro ejecutables con Node) y justifícalo en el PR.
3. Antes de cada push, ejecuta `git diff --name-only main...HEAD`. Si aparece un archivo fuera de tu propiedad, quítalo.
4. Al terminar cada fase, anota en `coordinacion/estado-astra.md` qué hiciste, qué campos del contrato envías o lees y qué pruebas lo cubren.
5. Si el código real no coincide con lo que supone este plan, detente, anótalo y propón el ajuste antes de implementarlo.
6. Ninguna herramienta del editor recalcula el layout completo (criterios §8).

---

## Fase A0: inventario y base de pruebas (primero)

1. Ubica dónde se guarda el proyecto (`cauce-proyecto-v2`), dónde se llama a `/api/analyze` y `/api/report`, quién dibuja el plano y quién genera el PDF. Anótalo en `estado-astra.md`. Si el PDF se genera en el backend, el problema de etiquetas del PDF es de Claude Code: escríbelo en `de-astra-para-claude.md`.
2. Captura las respuestas **actuales** del backend con el caso `pruebas/transformadores.json` (corriendo el backend de `main` en local, solo para leer) y guárdalas como respuestas simuladas: `<frontend>/tests/fixtures/analyze-v2.json` y `report-v2.json`.
3. Crea a mano `analyze-v3.json`, `capabilities-full.json` y `plan-ops.json` siguiendo el contrato §6. Con eso pruebas lo nuevo sin esperar al backend.
4. Crea un cliente de API único (`api.js` o equivalente) con `getCapabilities()`, que guarda el resultado en caché y devuelve `{ features: [] }` si hay un error.
5. Agrega un botón "Importar proyecto (JSON)" para cargar `transformadores.json` en la interfaz.

**Salida:** la interfaz carga el caso de transformadores y existen pruebas con respuestas simuladas v2 y v3.

## Fase A1: no pisar el trabajo manual (H7)

1. Editar el plano **nunca** dispara un análisis ni reubica elementos. El análisis se lanza solo con el botón "Analizar".
2. Las alternativas se muestran como **propuestas**, con los botones "Ver" y "Aplicar". Aplicar es una sola acción que se puede deshacer.
3. Contador local `plant_revision` que sube con cada edición. Cada resultado guarda la revisión con la que se calculó; si no coincide, aparece el aviso "Desactualizado: el plano cambió". Esto no depende del backend; si la respuesta trae `plant_version`, se muestra también.
4. Protección defensiva: al aplicar una alternativa, los elementos `locked` conservan su posición aunque la respuesta los haya movido. Si la alternativa movía un fijo, se avisa. Funciona igual con el backend viejo.

**Pruebas:** editar no llama a la API; aplicar y deshacer devuelve el plano idéntico.

## Fase A2: operaciones, deshacer y migración v3

1. Implementa el formato de operaciones del contrato §5 como **única** forma de cambiar el plano: `applyOps(plant, ops) → { plant, inverse }`. Toda edición manual genera operaciones.
2. Pila de deshacer y rehacer por **lote** de operaciones (`Ctrl+Z`, `Ctrl+Y` o `Ctrl+Shift+Z`).
3. Bloquear y desbloquear (operaciones `lock` y `unlock`) con un estilo visual distinto (candado y borde punteado). Los elementos bloqueados no se arrastran; al intentarlo, se muestra el motivo.
4. Migración: al arrancar sin `cauce-proyecto-v3`, copia `v2`, agrega los valores por defecto del contrato y `schema_version: 3`. **No borres ni modifiques `v2`.**
5. Al llamar a `/api/analyze`, envía la planta v3 completa. El backend viejo ignora los campos nuevos.

**Pruebas:** `applyOps` seguido de su inversa devuelve el plano original; la migración de un proyecto v2 de ejemplo produce un v3 válido; un `move` sobre un elemento `locked` se rechaza.

## Fase A3: cantidades, agrupación, zoom y etiquetas (H2, H9)

1. En el panel de la estación, edita `count`, `unit_w`, `unit_d`, `arrangement`, `ops_per_unit`, `t_cycle_min` (rango), `t_source` y `batch`.
2. El plano dibuja las N unidades según `arrangement`, o un bloque colapsado con la etiqueta "×N". Las opciones agrupar y expandir solo cambian la vista, no los datos.
3. Zoom con la rueda del ratón y paneo. Etiquetas adaptativas: si no caben, se muestra el número o la abreviatura, y el nombre completo aparece al pasar el cursor y en una leyenda.
4. Las flechas se separan cuando se superponen (desplazamiento lateral para rutas paralelas).

**Pruebas:** el caso v3 (creado por ti a partir de transformadores con embobinado ×10, montaje ×4, etc.) se dibuja sin etiquetas cortadas a zoom normal.

## Fase A4: selección múltiple, copiar y pegar, rutas por grupo (H8)

1. Selección por rectángulo, y `Shift` o `Ctrl` para sumar o quitar elementos.
2. Mover en grupo genera un lote de `move`.
3. `Ctrl+C`, `Ctrl+X` y `Ctrl+V` con desplazamiento al pegar; las rutas **entre** elementos copiados se duplican con ids nuevos.
4. Edición de rutas por grupo: aplicar `flow` o `frac` a varias rutas seleccionadas.

**Pruebas:** copiar 3 estaciones conectadas y pegarlas produce 3 estaciones y sus rutas internas; deshacer las elimina en un solo paso.

## Fase A5: contexto segmentado y Contexto 2

1. Interfaz por segmentos (contrato §4.5) con entradas inmutables. Editar un dato crea una entrada nueva con `supersedes`, y el historial es visible.
2. Si el backend no anuncia `segmented_context`, envía el contexto como **texto** (concatenación legible de las entradas vigentes). Si lo anuncia, lo envía como objeto.
3. **Contexto 2 determinista** (sin IA): después de editar el plano, se muestra un resumen generado en el frontend (estaciones con su cantidad, fijos, rutas por flujo, bandas, cambios desde el último análisis). "Analizar" queda deshabilitado hasta que el usuario lo confirma.
4. La confianza se refleja en la vista: los datos de confianza baja se marcan y se muestran como rango.

**Pruebas:** editar un tiempo deja la entrada anterior en el historial; sin confirmar el Contexto 2, no se llama a la API.

## Fase A6: flujos, banda, pesos y asistente

1. Herramientas de dibujo para los flujos `material`, `personas`, `vehiculos` y `carga`, cada uno con su color y trazo, y marca de retorno (`is_return`) dibujada como flecha curva.
2. Herramienta de banda (`conveyors[]`) con puntos, capacidad y velocidad.
3. Editor de pesos (contrato §6.2) que valida que sumen 1; visible solo si `weights` está en `features`. Muestra `weights_used` si viene en la respuesta.
4. Panel de resultados: muestra `main_metric`, `recommended_reason`, `recommended_tradeoffs`, `scores`, `kind` (ideal o viable), `sensitivity` y métricas por flujo **solo si vienen**. Si no vienen, se mantiene la vista actual.
5. Informe: si llega `validation.discarded`, lo muestra en "Afirmaciones descartadas".
6. Asistente del editor: cuadro de texto visible solo si `plan_ops` está en `features`. Muestra la lista de operaciones y las rechazadas con su motivo **antes** de aplicarlas; "Aplicar" las ejecuta con `applyOps` como un solo lote que se puede deshacer.
7. Simulación: botón visible solo si `simulate` está en `features`. Muestra P10, mediana y P90, y "sin datos" para cada `null`.

**Pruebas (con respuestas simuladas):** con `capabilities` vacío no aparece ninguna función nueva; con `capabilities-full` y `plan-ops.json`, el asistente muestra y aplica las operaciones.

## Fase A7: referencias con imagen

- Segmento `referencias`: subir una imagen con notas. Si `vision` es `false` o no se conoce, se guarda como nota y la interfaz dice "No interpretada: el proveedor actual no tiene visión".

---

## Pruebas transversales (en cada fase)

- **Backend viejo:** con `analyze-v2.json` y `/api/capabilities` → 404, la app funciona completa sin errores en la consola.
- **Backend nuevo:** con `analyze-v3.json` y `capabilities-full.json`, todo lo nuevo se muestra.
- **Datos guardados:** un proyecto existente en `cauce-proyecto-v2` se abre sin pérdida.

## Lo que no haces

- No editas Python aunque veas un error ahí: lo anotas en `de-astra-para-claude.md`.
- No calculas distancias, capacidades ni tiempos en el frontend para mostrarlos como resultado (las métricas son del motor). Sí puedes sumar o contar para el resumen del Contexto 2.
- No cambias el contrato. Si algo no cabe, te detienes y se lo propones al usuario.
