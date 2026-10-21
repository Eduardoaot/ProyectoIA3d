# Orquestación del contexto maestro

Acuerdo del 21 de octubre de 2026. Extensión compatible de CONTRATO-DATA y planta v3. El usuario autorizó implementar el recorrido y publicar commits por fase.

1. El intérprete general comprende el encargo, identifica entidades y delega instrucciones concretas a especialistas. La selección es semántica; los diez temas siguen como navegación.
2. Cada especialista entrega afirmaciones con evidencia y dudas dirigidas al intérprete. Hay una ronda acotada de aclaraciones: solo se resuelven con fuentes existentes; el resto permanece incierto y se pregunta al usuario.
3. Un consolidador explícito recibe ordenadamente los entregables, aplica reclasificaciones y vincula entidades en una plantilla maestra versionada. Conserva datos actuales, objetivos, hipótesis y contradicciones por separado. Puede reformular explicaciones sin alterar magnitudes ni relaciones aportadas.
4. El usuario acepta la revisión de datos. El constructor consume las afirmaciones aceptadas y sus relaciones, sin volver a sustituirlas por una extracción independiente del relato. La geometría se calcula en código. Cada requisito queda cumplido, incumplido o sin datos para verificarlo.
5. El cliente revisa y confirma el plano antes del análisis. El analista/optimizador recibe maestro aceptado, plano realmente aprobado (incluidas correcciones manuales), prioridades y resultados del motor. El asistente de construcción aplica propuestas revisables sobre una copia; conserva fijos y no reemplaza silenciosamente el plano actual.
6. La calidad con un modelo real se evalúa aparte de las pruebas de integración. Se conservan trazas, errores y tiempos por agente; ninguna alternativa local se presenta como interpretación de IA.

## Datos y revisión

El maestro vive en `contextWorkspace.masterDraft`: versión de esquema, revisión/huella, fuentes, entidades, afirmaciones con ids estables, relaciones, dudas, resumen, entregas y trazas. Sus afirmaciones se enlazan a las propuestas revisables existentes. Una afirmación pendiente no alimenta el constructor; las correcciones aceptadas prevalecen. El estado de aceptación se deriva de las propuestas/entradas vigentes, no de una firma vieja.

Las fuentes originales permanecen completas y vinculadas por identificador y offsets. Para entradas largas se forman bloques por encabezados/párrafos sin omitir caracteres, con consolidación entre bloques. Se distinguen etapas de lectura, coordinación, especialistas, aclaración, consolidación y revisión; avance de lectura no equivale a calidad aprobada.

Prioridad general: texto; imágenes para ubicación. Excepción acordada para `Contexto_transformadores.txt`: las imágenes son más fieles a lo existente y a su distribución. La revisión visual de referencia en `pruebas/contexto-transformadores.expected.json` es una anotación humana para evaluar, no una ejecución de visión ni un conjunto de coordenadas medidas. Las diferencias de cantidades se conservan con ambas procedencias. Los modelos sin visión no certifican imágenes.

Se conserva la captura manual, la confirmación masiva, SQLite, exportaciones, los especialistas de estudios y las rutas anteriores. El motor y el formato v3 no se cambian sin pruebas/migración correspondientes.
