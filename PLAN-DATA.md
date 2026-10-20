# Plan de `feature/data`: contexto inicial y reporte de ingeniería

## Objetivo

Dar al usuario un solo lugar, al inicio del proyecto, para contar cómo funciona su planta, adjuntar evidencia y comprobar qué entendió el sistema antes de analizar. Reunir allí las opciones que hoy están dispersas entre «Datos de la planta», «Referencias con imagen» y «Qué pesa más para ti». Ampliar el reporte con entregables de estudio del trabajo, especialmente cuando el usuario no subió uno.

## Primera entrega: validar el frontend

Por indicación del usuario, primero se construye una interfaz navegable para revisar la experiencia. El contrato definitivo, la estructura del backend y los entregables del reporte se trabajarán después de esta revisión.

El prototipo reúne texto libre, diez temas, datos con historial, documentos, estudios manuales, imágenes, prioridades y confirmación del plano/contexto. El acceso está en la esquina superior derecha desde todos los pasos. Rediseño conserva el resumen de prioridades y enlaza a su edición en contexto.

Alcance y límites de esta entrega:

- «Organizar información» clasifica fragmentos por palabras clave en el navegador y lo indica en pantalla. No usa IA ni extrae cifras inferidas. Las propuestas requieren confirmación y conservan su fragmento original.
- Los datos confirmados usan los segmentos existentes. El borrador adicional se guarda en `project.contextWorkspace`, fuera del contrato de planta y de las peticiones a la API. Los proyectos anteriores siguen abriendo sin cambiar su formato.
- Los documentos originales se conservan en IndexedDB en este navegador, hasta 10 MB por archivo. TXT, MD y CSV permiten revisar hasta 100 000 caracteres de texto; los demás formatos quedan pendientes de lectura. La extracción local no verifica hechos. Los adjuntos no se sincronizan con un servidor ni viajan en la exportación actual del proyecto.
- Las imágenes conservan la función anterior y su límite de 1 MB. Solo se marcan interpretadas tras una respuesta del proveedor de visión existente.
- Estudios permite registrar actividades y vincularlas a estaciones/rutas. Tiempo y distancia desconocidos quedan vacíos. La visualización es un borrador del orden capturado; las ramas, uniones y cursogramas finales siguen pendientes.
- La confirmación contempla plano completo, texto, contexto, prioridades y borrador. Un cambio marca los resultados anteriores pendientes de actualizar. No se recalcula automáticamente.

Para revisar: `cd frontend`, `npm ci`, `npm run dev`; abrir el enlace local y entrar en **Ver contexto de la planta**. Se puede recorrer y capturar contexto sin servidor. La creación asistida de planos y el análisis conservan sus servicios actuales.

Verificación de esta entrega: 58 pruebas unitarias, compilación y prueba en Chrome con el caso de transformadores, API simulada y perfil aislado. Se comprobaron propuestas, historial, archivos TXT/PDF, estudios, prioridades, confirmación, persistencia tras recarga, foco de teclado y seis vistas a 390 px. La prueba de navegador se ejecuta con Vite activo mediante `node tests/context-workspace.browser.mjs`; `CAUCE_BROWSER` permite indicar otro Chromium. El lint conserva advertencias previas del proyecto.

## Experiencia propuesta

1. En la esquina superior derecha del paso inicial: botón **«Ver contexto de la planta»**, visible también en pasos posteriores para consultar o corregir. Abre una página o panel de ancho completo con navegación lateral, parecido en organización a `/docs` del backend. La interfaz debe mostrar ejemplos y lenguaje cotidiano, no exigir claves técnicas como `pulido.t_ciclo`.
2. Portada **«Cuéntanos sobre tu planta»**: cuadro de texto libre y botón **«Organizar información»**. La IA propone datos estructurados por tema. Cada propuesta enseña fragmento de origen, valor, unidad, confianza y estado; el usuario puede corregirla o confirmarla antes de incorporarla. El texto original se conserva. Si no hay IA disponible, siguen funcionando la captura manual y los archivos.
3. Temas: **Negocio**, **Operaciones**, **Tiempos**, **Máquinas y espacio**, **Flujo de materiales**, **Personal**, **Calidad**, **Restricciones**, **Estudios del trabajo** y **Imágenes y layouts**. Cada tema muestra un resumen legible, datos vigentes, archivos asociados y «Agregar / corregir». Mantener historial, fuente, fecha y nivel de confianza del contexto actual.
4. En cada tema: adjuntar documentos de contexto. Registrar nombre, tipo, fecha, origen y tema. Extraer texto solo de formatos realmente soportados; mostrar «adjunto, pendiente de lectura» para lo demás. Las imágenes y planos van en su tema, con nota del usuario; únicamente afirmar «interpretada» cuando un proveedor con visión la haya leído. Los archivos nunca deben confundirse con hechos verificados.
5. **Estudios del trabajo**: admitir cursogramas analíticos y sinópticos, diagramas de recorrido, hojas de tiempos, métodos y otros estudios. Poder marcar un documento como «estudio existente» y vincular sus operaciones a estaciones/rutas del plano. Si el sistema extrae actividades, presentarlas para revisión con tipo (operación, transporte, inspección, espera, almacenamiento), secuencia, tiempo, distancia y fuente. Dejar vacío lo desconocido.
6. **Prioridades de decisión**: mover «Qué pesa más para ti» a este lugar, con explicación breve y valores iniciales visibles. El usuario puede ajustarlas aquí o volver a ellas antes de recalcular una recomendación. La vista de rediseño muestra un resumen y enlace a estas prioridades.
7. **«Así entendimos tu planta»**: resumen por tema, datos faltantes, contradicciones y supuestos, con enlaces para corregir. Antes del análisis, confirmar una versión concreta del contexto y del plano. Si cualquiera cambia, avisar que el análisis/reporte anterior requiere actualización. Conservar la confirmación actual de `Context2` y ampliarla, no eliminar esa protección.

## Flujo y reporte

- El recorrido principal queda: **Proceso y plano → Planta 3D → Diagnóstico → Rediseño → Reporte → Resumen**. Contexto es una entrada transversal desde el primer paso; desaparecen las tarjetas separadas de datos e imágenes. El usuario puede regresar a contexto desde cualquier paso.
- El modelo de flujo debe admitir **una estación con varias salidas** y **varias entradas a una estación**, así como retornos. Cada arco lleva origen, destino, producto/material, frecuencia o cantidad, lote y, si se conoce, tiempo y distancia. No deducir una única secuencia lineal si el proceso converge o diverge.
- El reporte agrega **cursograma analítico actual** y, cuando hay rediseño sustentado, **cursograma propuesto**; **cursograma sinóptico o mapa de proceso** cuando los datos alcancen; tabla de tiempos y recorridos; supuestos, fuentes, datos faltantes y recomendaciones concretas. En flujos ramificados, mostrar ramas y uniones sin inventar orden total.
- Si el usuario subió un estudio, usarlo como fuente revisable y citarlo; si no, generar un **borrador derivado del plano y las rutas**. Cada renglón indica si procede de un documento, una medición, el modelo de planta o una inferencia. Tiempo/distancia desconocidos se muestran como «sin dato»; nunca como cero. El reporte no debe llamarlo estudio cronometrado si no hubo medición.

## Contrato y orden de implementación

1. **Modelo de datos y migración.** Extender el contexto segmentado existente con `estudios`, adjuntos/metadatos, propuestas pendientes, prioridades y vínculo a estaciones/rutas. Definir almacenamiento y límites antes de aceptar documentos grandes: hoy las imágenes se guardan en el navegador con límite de 1 MB. Importar proyectos anteriores sin perder entradas ni imágenes. Mantener compatibilidad de `contextPayload` y de las capacidades del backend.
2. **Interfaz inicial.** Construir navegación por temas, captura libre, edición manual, vista «Así entendimos» y acceso persistente. Reubicar las tres interfaces existentes sin cambiar aún la lógica de análisis. Confirmar con un caso real de `pruebas/transformadores.json`.
3. **Lectura asistida.** Añadir endpoints/capacidad para extraer propuestas del texto y de formatos de documento elegidos. Distinguir extracción, clasificación e inferencia. Nunca guardar automáticamente como hecho lo que proponga un agente; pedir revisión y registrar procedencia.
4. **Flujo ramificado.** Revisar esquema, editor, métricas y visualización para convergencias/divergencias y múltiples productos; conservar las rutas existentes. Comprobar distancias y frecuencias por arco antes de agregarlas.
5. **Entregables del ingeniero.** Generar las tablas y diagramas estructurados desde datos confirmados, y solo después pedir a la IA redacción explicativa. Validar cifras y referencias antes de imprimir/exportar. Comparar cursograma subido contra el generado cuando ambos existan.

## Criterios de aceptación

- Un usuario nuevo puede pegar una descripción de planta, revisar lo interpretado, corregir un dato y analizar sin escribir claves técnicas.
- Cada tema permite añadir y revisar su evidencia; se distingue claramente «archivo subido», «texto extraído», «imagen interpretada» y «dato confirmado».
- La estructura de contexto conserva historial y procedencia; un proyecto guardado antes de esta rama sigue abriendo.
- Un ejemplo con bifurcación y reunión de rutas aparece correctamente en editor, análisis y reporte.
- El reporte produce un cursograma analítico útil sin archivo previo y deja en blanco los tiempos no medidos. Si hay estudio previo, cita su fuente y señala discrepancias.
- Al cambiar contexto, prioridades o plano después de analizar, el usuario ve qué resultado debe recalcular.

## Prompt para retomar en casa

> Trabaja en la rama `feature/data` de ProyectoIA3d. Lee `PLAN-DATA.md`, `coordinacion/CONTRATO-v3.md`, `CRITERIOS-IMPLEMENTACION-1.1.md` y el código actual antes de editar. Implementa el plan por fases pequeñas, verificando frontend y backend en cada una. El objetivo es una entrada inicial única de contexto de planta, organizada por temas y con texto libre asistido por IA, documentos por tema, estudios del trabajo, imágenes/layouts y prioridades de decisión. El usuario debe poder ver y corregir qué entendió la IA antes de analizar. Retira las secciones separadas «Datos de la planta», «Referencias con imagen» y «Qué pesa más para ti» de sus pasos actuales, conservando sus datos y capacidades en la nueva interfaz. Admite rutas de proceso que convergen y divergen. Amplía el reporte con cursogramas y entregables de ingeniería respaldados por fuentes, sin inventar tiempos ni mediciones. Preserva proyectos existentes, el historial/procedencia y la validación del reporte. Primero propone el contrato de datos y la secuencia concreta de cambios; después implementa la primera fase.
