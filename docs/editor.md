# Editor de Cauce · Fase A0

## A2: operaciones, fijos y guardado

El proyecto se guarda en `cauce-proyecto-v3`. La primera apertura copia los datos
de v2 sin escribir ni eliminar su clave. Los obstáculos existentes conservan su
forma de zona y se marcan fijos. Selecciona un elemento y pulsa «Bloquear» para
añadir un motivo; los fijos rechazan movimiento, borrado y cambio de dimensiones.
Deshacer (`Ctrl+Z`) y rehacer (`Ctrl+Y` / `Ctrl+Shift+Z`) funcionan por lotes de
operaciones; un arrastre o una propuesta aplicada es un solo paso. Los cambios
de supuestos también entran en ese historial.

## A1: analizar y aplicar propuestas

«Interpretar historia» genera un borrador. «Analizar» guarda la revisión enviada al
motor. Si editas después, aparece «Desactualizado: el plano cambió»; una respuesta
tardía no borra tus cambios. «Ver» una alternativa solo cambia la vista previa;
«Aplicar» la copia al rediseño respetando estaciones fijas. «Deshacer aplicación»
restaura el estado previo. Tras editar o aplicar, pulsa «Analizar rediseño» para
obtener métricas nuevas. El cálculo ligero de rutas no mueve estaciones.

## Importar una planta

En **Proceso y plano**, pulsa **Importar proyecto (JSON)** y selecciona
`pruebas/transformadores.json`. Se abre el borrador con las posiciones del archivo.
La importación no solicita un análisis. El editor conserva su consulta existente
de rutas; para analizar usa **Guardar y ver en 3D**.

También se acepta un proyecto guardado con `draft` o `plant`. Si hay un borrador
se importa ese, por ser el trabajo más reciente. Solo se importa la planta: no se
restauran análisis, reportes ni el progreso de otro proyecto. Al sustituir un
borrador se solicita confirmación y se reinicia el historial del editor.

Los errores de JSON, identificadores duplicados, posiciones ausentes, dimensiones
inválidas y referencias a estaciones o portones inexistentes se muestran antes de
cambiar el borrador. El máximo por archivo es 5 MB. Las posiciones no se generan
automáticamente y se conservan los campos adicionales de v3.

## Compatibilidad de API

`frontend/src/api.js` sigue siendo el único cliente HTTP. `getCapabilities()`
comparte una petición y guarda su resultado durante la sesión, también cuando
falla. Ante 404, otro error HTTP, fallo de red, JSON inválido o cinco segundos de
espera, devuelve `{ features: [] }`. `vision` solo se considera activa si llega
como `true`. La caché se renueva al recargar la página.

El informe v2 sigue siendo un stream de texto. Su fixture usa un contenedor de
prueba con `status`, `content_type` y `body`; ese contenedor **no** es un formato
nuevo de la API. La validación estructurada del informe de A6 requiere acordar
el transporte con backend (ver `coordinacion/de-astra-para-claude.md`).

## Pruebas

Desde `frontend/`:

```powershell
npm test
npm run lint
npm run build
```

Las pruebas usan `node:test` y `node:assert`, sin dependencias nuevas. Se requiere
una versión de Node compatible con el Vite instalado (se verificó con Node 24).
El renderizado usa Vite y React ya presentes en el proyecto. Solo se sustituye
el logotipo animado en esa prueba porque requiere geometría SVG del navegador;
se ejecutan los componentes reales del editor, plano e informe. No es una prueba
visual ni una prueba completa de interacción en navegador.

Las respuestas v2 son capturas HTTP del backend de referencia integrado desde
`upstream/develop` (`1703596`). Los metadatos están en
`frontend/tests/fixtures/capture-v2.meta.json`. Se usó el fallback real del informe
con Ollama inaccesible, para que las pruebas no dependan de un modelo local.

Para repetir la captura, inicia una instancia separada desde `backend/`:

```powershell
$env:OLLAMA_HOST = 'http://127.0.0.1:1'
./.venv/Scripts/python.exe -B -m uvicorn main:app --host 127.0.0.1 --port 8017
```

Y desde `frontend/`:

```powershell
node tests/capture-v2.mjs http://127.0.0.1:8017
```

El script imprime las respuestas y la procedencia en JSON sin sobrescribir
fixtures ni archivos del backend. Para una captura equivalente debe usarse el
commit de referencia y mantener el backend sin cambios locales.

`analyze-v3.json`, `transformadores-v3.json`, `capabilities-full.json` y
`plan-ops.json` son **simulados** para probar el contrato de forma independiente.
Las métricas de `analyze-v3.json` se heredaron de la captura v2: no representan
cálculos del motor para las cantidades v3. Los campos adicionales de puntaje y
sensibilidad son ejemplos de formato, no recomendaciones de ingeniería.

## Siguientes fases

A0 prepara la importación, el inventario y las pruebas. A1 protege el trabajo
manual, separa «Ver» de «Aplicar» y marca resultados desactualizados. A2 incorpora
operaciones, bloqueo y migración a `cauce-proyecto-v3`. La persistencia actual
continúa en v2 hasta esa migración.
