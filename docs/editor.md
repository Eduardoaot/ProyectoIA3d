# Editor de Cauce · Fase A0

## A6: flujos, bandas, propuestas y resultados

Las herramientas nuevas aparecen cuando el servidor anuncia que las soporta.
«Ruta» permite elegir flujo y marcar retorno; su color/trazo y curva también
aparecen en el PDF. «Banda»: clic en una estación, puntos intermedios sobre el
fondo y otra estación para terminar. Revisa capacidad y velocidad en el inspector
(inicialmente 1 pieza/min y 6 m/min); Esc cancela. La ruta queda vinculada a la banda.

Los pesos deben sumar 1 antes de analizar. Los resultados muestran los criterios,
compromisos, tipo ideal/viable y sensibilidad cuando llegan del motor.
El asistente presenta operaciones y rechazos: «Aplicar operaciones» es reversible
en un solo paso. Si editas mientras prepara la propuesta, debes pedir otra.
«Simular alternativa» muestra semilla, réplicas y percentiles; no rellena datos
faltantes. Primero confirma Contexto 2. Una edición marca la simulación desactualizada.

El informe sigue aceptando texto y ahora también JSON `{ text, validation }`,
acordado con el usuario. «Afirmaciones descartadas» solo aparece si hay rechazos.

La prueba opcional `node tests/browser-smoke.mjs` usa Chrome headless instalado,
un perfil temporal y API simulada, sin dependencias nuevas. `CAUCE_BROWSER`
permite indicar otro Chromium. Cubre interacción v2/v3, copia/pegado/deshacer,
confirmación y aplicación reversible del asistente.

## A5: contexto con historial

«Contexto por segmentos e historial» permite registrar datos con fuente,
confianza, unidad y responsable. «Corregir» agrega una versión con la misma
clave, conservando la anterior. Los tiempos operativos se editan en el inspector
de la estación: sus cambios y deshacer quedan registrados automáticamente.
Los rangos se escriben como `[mínimo, máximo]`; no se inventan rangos faltantes.

Antes de «Analizar» o «Analizar rediseño», revisa y confirma el Contexto 2.
Editar el plano, los supuestos o el contexto exige confirmarlo otra vez.
El resumen solo cuenta y describe datos; las métricas siguen viniendo del motor.
Sin soporte de contexto segmentado, la API recibe texto con las entradas vigentes.

## A4: selección y portapapeles

Arrastra sobre el fondo para encerrar elementos completos. Shift/Ctrl (o Cmd)
+ clic suma o quita elementos. Arrastrar uno seleccionado mueve todo el grupo;
si contiene un fijo, se explica el bloqueo. El límite de la bodega conserva
las distancias relativas. Los portones mantienen el grupo sobre su muro.

Ctrl+C/Ctrl+X/Ctrl+V copia/corta/pega con desplazamiento incremental de 1 m.
También hay botones en la barra. El portapapeles es interno a ese editor;
las rutas y bandas entre estaciones copiadas se duplican con ids nuevos.
Deshacer elimina una pegada completa. Los atajos no interceptan los campos de texto.
Selecciona varias rutas con Shift/Ctrl para aplicarles flujo o porcentaje desde
el inspector. Cada aplicación es un paso de deshacer.

## A3: cantidades y navegación

Selecciona una estación para editar unidades, dimensiones por unidad, disposición,
operarios, rango de ciclo, fuente y lote. Cambiar cantidad/disposición ajusta solo
el bloque seleccionado; los fijos rechazan ese cambio. «Expandir unidades» muestra
sus divisiones sin modificar datos. Rueda para zoom, Alt + arrastrar o botón central
para paneo; «Ajustar vista» restaura el encuadre. Los nombres completos aparecen
en la leyenda del plano y del documento imprimible, aunque el bloque use un número.

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
