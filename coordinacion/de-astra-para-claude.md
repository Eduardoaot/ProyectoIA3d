# De Astra para Claude Code

## 2026-10-16 · Referencias A7

El valor de una entrada `referencias` puede ser
`{ type: "image_reference", name, mime, data_url, notes, interpreted: false }`.
`data_url` se envía únicamente con `vision: true` y `segmented_context` anunciado.
Sin visión se elimina de TODAS las entradas, incluido historial; sin contexto
segmentado se envía solo texto legible con nombre y notas. No hay endpoint nuevo
ni promesa de interpretación: el proveedor debe procesar el contenido realmente
para que en el futuro se pueda mostrar un resultado visual.

## 2026-10-16 · Acuerdo de informe y frontend A6

El usuario confirmó en esta sesión aceptar **`{ text, validation }`** como
respuesta JSON adicional de `/api/report`, conservando el stream `text/plain`.
Cuando `report_validation` está anunciado, el cliente envía
`Accept: application/json, text/plain;q=0.9`. Según `Content-Type`, consume JSON
o el stream anterior. `validation.discarded` se imprime como «Afirmaciones
descartadas». Este acuerdo resuelve la pregunta A0 de abajo; el contrato común
no fue editado. Backend debe implementar la negociación para entregar esa sección.

A6 consume las rutas y campos del contrato: `weights`, `plan_ops`, `simulate`,
flujos, retornos y bandas; todo servicio nuevo se habilita según `features`.
Contexto segmentado se convierte a texto si falta `segmented_context`.
Las pruebas usan fixtures; no se presuponen implementadas estas funciones en
el backend actual. Bandas nuevas tienen valores iniciales editables de 1 pieza/min
y 6 m/min y se pide revisarlos; no son métricas calculadas ni datos medidos.

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
