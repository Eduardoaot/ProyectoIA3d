# Orquestación del contexto maestro

Acuerdo del 21 de octubre de 2026. Extensión compatible de CONTRATO-DATA y planta v3. El usuario autorizó implementar el recorrido y publicar commits por fase.

1. El intérprete general comprende el encargo, identifica entidades y delega instrucciones concretas a especialistas. La selección es semántica; los diez temas siguen como navegación.
2. Cada especialista entrega afirmaciones con evidencia y dudas dirigidas al intérprete. Hay una ronda acotada de aclaraciones: solo se resuelven con fuentes existentes; el resto permanece incierto y se pregunta al usuario.
3. Un consolidador explícito recibe ordenadamente los entregables, aplica reclasificaciones y vincula entidades en una plantilla maestra versionada. Conserva datos actuales, objetivos, hipótesis y contradicciones por separado. Puede reformular explicaciones sin alterar magnitudes ni relaciones aportadas.
4. El usuario acepta la revisión de datos. El constructor consume las afirmaciones aceptadas y sus relaciones, sin volver a sustituirlas por una extracción independiente del relato. La geometría se calcula en código. Cada requisito queda cumplido, incumplido o sin datos para verificarlo.
5. El cliente revisa y confirma el plano antes del análisis. El analista/optimizador recibe maestro aceptado, plano realmente aprobado (incluidas correcciones manuales), prioridades y resultados del motor. El asistente de construcción aplica propuestas revisables sobre una copia; conserva fijos y no reemplaza silenciosamente el plano actual.
6. La calidad con un modelo real se evalúa aparte de las pruebas de integración. Se conservan trazas, errores y tiempos por agente; ninguna alternativa local se presenta como interpretación de IA.

## Recorrido implementado y responsabilidades

La interfaz conectada inicia trabajos `kind=context` mediante `/api/workspaces/{id}/jobs`. `workspace_jobs.run` reúne relato, documentos legibles y datos actuales, y llama a [context_pipeline.py](../backend/cauce/agents/context_pipeline.py). `/api/context/organize` conserva el organizador anterior por compatibilidad; no es la entrada del recorrido maestro.

| Paso | Comportamiento actual |
| --- | --- |
| Intérprete general | Recorre las fuentes por bloques, comparte nombres de entidades y encarga instrucciones a los temas pertinentes. No fuerza diez consultas por cada bloque. |
| Especialistas | Entregan afirmaciones estructuradas, fragmentos literales y dudas. La concurrencia predeterminada es 2, configurable entre 1 y 4. |
| Aclaraciones | El intérprete busca respaldo en las fuentes. Hay una ronda de revisión de los especialistas que recibieron respuesta; las dudas restantes permanecen inciertas. No hay conversación libre ni rondas ilimitadas. |
| Consolidador | Recibe cada entrega en orden, revisa clasificación y redacción, conserva evidencias y registra duplicados/dudas. No cambia entidades, magnitudes ni relaciones estructurales. El resultado queda como borrador persistente para revisión. |
| Constructor y verificador | [master_builder.py](../backend/cauce/master_builder.py) consume solo hechos actuales aceptados. La geometría y la comprobación se ejecutan en código; no hay otra extracción del relato por un modelo. |
| Análisis y optimización | `/api/analyze` calcula métricas y alternativas con el motor sobre el plano confirmado. La alternativa compacta opcional consulta al rol `analista` con maestro, objetivos y plano actual; su propuesta se calcula y revisa antes de aplicarse. |

Intérprete, especialistas y consolidador son roles lógicos con instrucciones y esquemas distintos; reciben la misma instancia del proveedor `contexto`. Por defecto utilizan el mismo modelo local, no diez modelos independientes. Los estudios del trabajo conservan su coordinación por tipos de estudio, separada de esta organización del contexto.

La lectura de contexto y estudios usa ciclos de hasta **1000 caracteres** por defecto (`CAUCE_AGENT_CHUNK_CHARS`, entre 256 y 4000). Prefiere saltos de línea y finales de frase, conserva todos los caracteres y sus offsets. Las dudas y los hechos de revisión/consolidación se paginan también; las entregas del consolidador contienen hasta dos afirmaciones por consulta. El índice completo de entidades, los resúmenes y las correcciones permanecen en el servidor/maestro: cada consulta recibe una selección auxiliar limitada y declara cuántos elementos no cargó.

Cada ciclo comprueba el tamaño de instrucciones, entrada y esquema JSON, con una reserva para la respuesta. El cálculo de tokens es una estimación (`bytes UTF-8 / 3 + 128`), no el tokenizador exacto del modelo; sus cifras y la reserva quedan en las trazas. Una fila indivisible que no cabe se rechaza explícitamente, no se trunca. Ollama limita la salida a la mitad de la ventana como máximo. Las entregas válidas siguen disponibles para reintentar; una revisión parcial no borra los hechos que no revisó.

La construcción usa trabajos `kind=construction` en la misma API del expediente y no necesita un proveedor de IA activo una vez aceptado el maestro. Avanza por recinto, áreas/equipos, recorridos y comprobación final; los lotes tienen cinco entidades/relaciones por defecto (`CAUCE_BUILD_BATCH_SIZE`, entre 1 y 20). Cada lote comprueba los requisitos aplicables y la geometría antes de guardar su punto de avance en SQLite. Un incumplimiento detiene el trabajo con `blocked` y conserva el último punto válido; las dimensiones o posiciones desconocidas permanecen como datos pendientes de revisión.

Al reintentar se recupera el punto anterior si coincide la huella del maestro. Si los hechos, objetivos, dudas o criterios de fuentes cambian, comienza una construcción nueva. El plano se aplica al expediente al terminar y solo si coincide su revisión; los resultados tardíos quedan en el trabajo con `conflict`. Los puntos de avance y las trazas se pueden consultar completos; `GET .../jobs/{id}?summary=true` permite consultar el progreso sin retransmitirlos. La interfaz usa esta consulta y conserva la confirmación del plano antes del análisis.

## Datos y revisión

El maestro vive en `contextWorkspace.masterDraft`: versión de esquema, revisión/huella, fuentes, entidades, afirmaciones con ids estables, relaciones, dudas, resumen, entregas y trazas. Sus afirmaciones se enlazan a las propuestas revisables existentes. Una afirmación pendiente no alimenta el constructor; las correcciones aceptadas prevalecen. El estado de aceptación se deriva de las propuestas/entradas vigentes, no de una firma vieja.

Las fuentes originales permanecen completas y vinculadas por identificador y offsets. Para entradas largas se forman bloques por encabezados/párrafos sin omitir caracteres, con consolidación entre bloques. Se distinguen etapas de lectura, coordinación, especialistas, aclaración, consolidación y revisión; avance de lectura no equivale a calidad aprobada.

Prioridad general: texto; imágenes para ubicación. Excepción acordada para `Contexto_transformadores.txt`: las imágenes son más fieles a lo existente y a su distribución. La revisión visual de referencia en `pruebas/contexto-transformadores.expected.json` es una anotación humana para evaluar, no una ejecución de visión ni un conjunto de coordenadas medidas. Las diferencias de cantidades se conservan con ambas procedencias. Los modelos sin visión no certifican imágenes.

Se conserva la captura manual, la confirmación masiva, SQLite, exportaciones, los especialistas de estudios y las rutas anteriores. El motor y el formato v3 no se cambian sin pruebas/migración correspondientes.

## Rutas y condiciones de entrega

- Los trabajos `kind=context` de `/api/workspaces/{id}/jobs` conservan `stage`, `stage_progress`, el maestro y entregas recuperables. Las etapas son `interpreting`, `specialists`, `clarifying`, `consolidating` y `review`. El estado `partial` conserva incidencias; `done` significa disponible para revisión, no comprensión certificada.
- `/api/story` recibe `context.master` de esquema 2 aceptado y lo construye directamente. Sin datos aceptados o sin dimensiones del recinto devuelve 422. Los clientes anteriores conservan su ruta de texto.
- `/api/master/verify` recibe `{plant, context}` y devuelve requisitos `met`, `unmet`, `unverifiable` o `not_geometric`, más supuestos y dudas. No cambia el plano. El estado `verified` solo indica cumplimiento de los requisitos comprobables recibidos; no certifica una medición ni la completitud semántica del relato.
- `/api/analyze` con un maestro requiere `reviewed: true`; conserva la comprobación contra el plano efectivamente entregado. La confirmación de versión de la interfaz sigue siendo necesaria. `/api/compact` admite contexto/maestro y objetivos, manteniendo compatibilidad con `{plant}`.
- Las entradas manuales nuevas y los cambios de prioridad de fuentes deben integrarse antes de reconstruir. Una corrección de redacción que cambia el valor aceptado no reutiliza en silencio sus magnitudes estructurales anteriores.
- Las entregas válidas se reutilizan en reintentos solo si coinciden entrada, esquema, modelo y contexto configurado. Las respuestas sin respaldo no se almacenan como entregas reutilizables.
- Los archivos originales y las lecturas de visión ya realizadas se incorporan como fuentes; una imagen adjunta sin lectura permanece pendiente. `source_policy` registra prioridad y, cuando corresponda, la revisión visual manual explícita.
