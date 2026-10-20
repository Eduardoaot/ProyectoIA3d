# Extensión DATA del contrato v3

Implementación autorizada el 20 de octubre de 2026. Complementa `CONTRATO-v3.md`, sin editarlo ni sustituir rutas anteriores. Planta sigue en v3; el expediente usa `context_schema_version: 1`.

## Decisiones para esta entrega

- SQLite local (`CAUCE_DATA_DIR`, por defecto `.cauce-data`) conserva expedientes, revisiones, documentos originales y trabajos. No requiere un servicio de base de datos adicional.
- Prioridades apagadas significa usar los pesos base actuales; no se elimina el criterio multicriterio. Las respuestas conservan `weights_used`.
- Preguntas de cobertura se muestran dentro de la revisión existente. No se añade una sección de navegación.
- Estudios iniciales: cursograma analítico, hoja de tiempos y relaciones de proceso/recorrido cuando hay datos. Identificación, interpretación por esquema y construcción determinista de entregables; otros tipos se indican como pendientes.
- CSV y XLSX para operadores; TXT, MD, CSV, XLSX y PDF con texto para documentos. Escaneados/imágenes conservan el estado pendiente salvo el flujo de visión existente.
- Eficiencia importada y valoración de ritmo son indicadores distintos. No se calcula desempeño individual sin observaciones y definición; no cambia el factor global del motor.

## Expediente y revisión

`GET/PUT /api/workspaces/{id}` recibe `{ project, expected_revision }` y devuelve `{ id, revision, project }`. Una revisión diferente produce 409. Crear usa revisión 0. `project` conserva los campos del frontend actual, incluido `contextWorkspace`; el servicio no convierte propuestas en hechos al guardar.

`contextWorkspace` añade `operators`, `questions`, `study_text` y `study_inventory` de forma opcional. Propuestas conservan id, tema, etiqueta, valor, unidad, fragmento original, estado y procedencia. Actividades conservan sus ids, referencias, valores desconocidos nulos/vacíos y estado de revisión. Entradas aceptadas mantienen `segments`, `supersedes` e historial.

`POST /api/workspaces/{id}/confirm` recibe `{ expected_revision, ids, target }`, con target `proposals` o `activities`. Solo acepta ids del lote explícito; bloqueados/contradictorios se devuelven por separado. Los reintentos sobre ids ya aceptados no duplican hechos. El texto original siempre permanece como evidencia, no como hecho numérico verificado.

## Trabajos de interpretación

`POST /api/workspaces/{id}/jobs` recibe `{ expected_revision, kind, text, topic?, source_id? }`, kind `context` o `studies`. Devuelve un trabajo consultable en `GET /api/workspaces/{id}/jobs/{job_id}` y cancelable en `POST .../cancel`. Trabajos largos conservan bloques procesados y errores; al reiniciar se marcan interrumpidos y pueden reintentarse. No aplican resultados sobre una revisión cambiada: conservan el resultado y exigen repetir/revisar. Nunca sobrescriben correcciones confirmadas.

La IA se accede por la interfaz existente de proveedores; fragmentos de evidencia se validan contra el original. Fallos parciales son visibles; sin IA la captura manual y documentos funcionan. No hay truncamiento silencioso.

## Archivos, operadores y entregables

- `POST /api/workspaces/{id}/documents?name=...&topic=...`: cuerpo binario, hasta 10 MB; metadatos y texto extraído con fuentes. `GET .../documents/{document_id}` descarga el original.
- `POST /api/workspaces/{id}/operators`: `{ expected_revision, source_id, mapping? }`; previsualiza filas y errores, devuelve datos para revisión, no modifica cálculos del motor.
- `GET /api/workspaces/{id}/coverage`: preguntas dirigidas y referencias faltantes.
- `GET /api/workspaces/{id}/deliverables`: tablas calculadas de actividades aceptadas, tiempos conocidos, referencias y disponibilidad de estudios.
- `GET /api/workspaces/{id}/export` / `POST /api/workspaces/import`: paquete ZIP de expediente y originales; rutas internas nunca se extraen al filesystem.

## Plano y compatibilidad

`POST /api/story` acepta opcionalmente `context` aceptado. Construye un borrador explícito, conserva cantidades/restricciones y no sustituye un plano del cliente. `contextPayload` incluye estudios/operadores aceptados solo cuando `context_workspace` se anuncia en capabilities. Los hechos y el reporte identifican las fuentes nuevas; tiempos desconocidos no se convierten en cero.

Capacidades se añaden a medida que exista cada ruta. Clientes anteriores siguen utilizando texto/contexto v3. Cada fase se verifica con proveedores falsos sin red; pruebas con un proveedor real se reportan por separado.
