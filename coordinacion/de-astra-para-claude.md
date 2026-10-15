# De Astra para Claude Code

## 2026-10-15 · Inventario A0

- Trabajo en `feature/ParteB`, desde `develop`, por instrucción del usuario.
- Backend y `pruebas/**` se usan solo en lectura. El caso de referencia es
  `pruebas/transformadores.json` de `1703596`.
- El PDF se genera en el frontend (`ReportDoc.jsx` + `window.print()`), por lo
  que la corrección de etiquetas corresponde a Astra.
- El frontend detectará funciones mediante `GET /api/capabilities`; errores,
  incluido 404, se tratarán como `{ "features": [] }`.

### Acordar antes de A6: transporte de validación del informe

`POST /api/report` devuelve hoy un `StreamingResponse` de texto plano. El contrato
§6.3 añade `validation.discarded`, pero no define cómo transportarlo junto al
stream. No hay actualmente un cuerpo JSON al que agregar ese campo.

Propuesta para acordar: preservar la respuesta textual para clientes actuales y
definir una negociación explícita para la respuesta estructurada, indicando el
nombre del campo del informe. Hasta acordarlo, el frontend conservará el
streaming y no supondrá un esquema nuevo. No se modificó el contrato.
