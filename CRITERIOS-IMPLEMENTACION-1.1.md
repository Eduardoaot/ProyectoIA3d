# Criterios de implementación: Cauce

Documento para guiar a la IA de desarrollo (VS Code) en los cambios de Cauce. Léelo completo antes de tocar código. Si una tarea choca con estos criterios, detente y pregunta.

Referencias: [README.md](README.md) (cómo funciona hoy), [ESTADO.md](ESTADO.md) (pendientes), [contexto-proyecto.md](contexto-proyecto.md) (visión).

---

## 0. Cómo trabajar

- Cambios pequeños y verificables. Un cambio = una idea; no reescribas archivos completos sin necesidad.
- Antes de cambiar el motor (`engine.py`, `layout.py`), escribe la prueba que falla con el caso real y luego arréglalo.
- No cambies el formato de la planta (JSON) sin una migración que lea los proyectos guardados en localStorage (`cauce-proyecto-v2`). Si hace falta, sube a `v3` con migración.
- Mantén la API compatible o versiona la ruta. El frontend es el único cliente.
- Si una decisión de este documento no encaja con el código real, propón el cambio por escrito antes de implementarlo.

---

## 1. Principios no negociables

1. **El motor calcula; la IA lee y redacta.** Ningún número sale de un modelo de lenguaje. Los informes y el chat solo pueden citar cifras que vengan de `facts()` o de la respuesta del motor.
2. **Nada se mueve ni se recalcula sin acción del usuario.** Una herramienta (agregar máquina, cambiar tipo, pedir un análisis) no debe reemplazar posiciones manuales. Si cambia algo, lo dice y ofrece aplicarlo; no lo aplica en silencio.
3. **Lo que el usuario fijó no se mueve.** Los elementos marcados como fijos se respetan en todas las alternativas, incluidas las de la IA.
4. **Todo número tiene procedencia.** Cada dato lleva fuente (medido, estimado, supuesto, indicado por el usuario), fecha y nivel de confianza.
5. **Cada resultado sabe de dónde viene.** Un análisis guarda la versión de la planta y la versión del contexto que usó. Si cambian, el resultado se marca como desactualizado.
6. **Ninguna recomendación contradice sus propios números.** Si la alternativa recomendada empeora la métrica principal, el sistema debe decirlo explícitamente y explicar por qué (por ejemplo, otro criterio con más peso).
7. **Proveedor de IA intercambiable.** El código de negocio no importa clientes concretos (Ollama, API). Todo pasa por la interfaz de `providers/base.py`.

---

## 2. Diagnóstico de la prueba del 14 de octubre

Caso: planta de transformadores tipo seco, 11 procesos y unas 33 máquinas o áreas (embobinado x10, montaje x4, soldadura x3, configuración x6, gabinete x4, y otras estaciones de una sola unidad). El reporte muestra **16 estaciones** y **16 rutas**. Ese caso debe quedar guardado como `pruebas/transformadores.json` para probar cada cambio.

Hallazgos, en orden de impacto:

**H1. La recomendación no es consistente con los números.** Según el README, sin supuestos el puntaje es `recorrido nuevo / recorrido hoy + 0,03 × obra + 0,2 × avisos`. Con 188 m frente a 86,5 m, "Línea recta" puntúa unos 2,2, y "Reordenar" puntúa 1,0. El motor no debería recomendar la línea recta. Antes de cambiar nada, verificar:

- qué campo `recommended` devuelve `/api/analyze` para este caso;
- si el texto que dice "es más eficiente" sale del informe de la IA (`/api/report`) y no del motor.
  Si el texto lo escribió la IA, es un error de **texto que contradice los datos**. Si el motor lo recomendó, es un error de puntaje.

**H2. El modelo pierde máquinas en paralelo.** Una estación tiene una sola posición, tamaño y `ops`. No existe "10 máquinas embobinadoras". La lectura de la historia colapsa grupos en pocas estaciones (16 en lugar de ~33 unidades). Sin cantidad por estación, la distancia, la capacidad y la distribución quedan mal.

**H3. Solo existe un flujo y no se modelan los regresos.** El proceso del transformador tiene ciclos y retornos (impregnación → horno → configuración → gabinete, con pruebas intermedias y finales). `flow_order` manda los ciclos al final, así que la "línea recta" obliga a cruzar la planta varias veces. Además, el usuario necesita distinguir **flujo de piezas**, **flujo de personas** y **flujo de camiones/montacargas**. Hoy solo existe el primero.

**H4. La búsqueda de "Reordenar en su lugar" es demasiado débil.** Solo intercambia pares de estaciones y el resultado fue 0 % de mejora. Esto no prueba que el acomodo sea óptimo; prueba que la búsqueda se quedó en un óptimo local. Para problemas de distribución hay métodos establecidos (CRAFT para intercambio por costo de manejo, SLP para bloques por relación, CORELAP/ALDEP para construcción). Ver sección 5.

**H5. La métrica sin supuestos solo mira distancia.** Con el horno (lote de 4 a 8 h) o el secado, el cuello de botella es de tiempo, no de metros. Optimizar distancia puede empeorar el lead time. La distancia es un criterio, no el objetivo único.

**H6. No hay concepto de "fijo".** `feasible()` solo respeta muros, zonas y otras máquinas. Las alternativas reacomodan todo. Pedir "no muevas la columna ni el horno" no es posible hoy.

**H7. Las herramientas pisan el trabajo manual.** Cada acción dispara un nuevo análisis que reubica el plano. El usuario pierde su acomodo. Esto corresponde a la nota "me manda a mover plano".

**H8. El editor es lento de usar.** Falta selección múltiple, copiar y pegar, deshacer por operación, conveyor (banda) como elemento y edición de rutas por grupo. Ver sección 8.

**H9. Las etiquetas y el dibujo no se leen con muchas estaciones.** En los PDFs las etiquetas se cortan y las flechas se superponen. Con 33 unidades el plano debe agrupar, escalar o permitir zoom.

**H10. La IA redacta conclusiones sin verificarlas.** El modelo pequeño (llama3.2:3b) puede afirmar cosas que el motor no respalda. Debe existir una validación: cada afirmación numérica del informe debe coincidir con un hecho de `facts()`, o se descarta.

---

## 3. Modelo de datos objetivo

### 3.1 Unidades y cantidades

```jsonc
{
  "id": "embobinado",
  "name": "Embobinado",
  "type": "embobinado",
  "count": 10, // máquinas idénticas en paralelo
  "unit_w": 2.0,
  "unit_d": 1.5, // tamaño de cada una
  "arrangement": "fila", // cómo se acomodan las N unidades
  "ops_per_unit": 1,
  "t_cycle_min": [60, 120], // rango por juego de bobinas (min)
  "t_source": "usuario",
}
```

- El motor trata cada unidad como servidor en paralelo para colas, capacidad y carga.
- El plano dibuja las N unidades. Se puede colapsar a un solo bloque cuando hay muchas, con etiqueta "×10".

### 3.2 Flujos separados

| Flujo             | Quién lo recorre              | Ejemplo                                |
| ----------------- | ----------------------------- | -------------------------------------- |
| Material / piezas | La pieza                      | Embobinado → montaje → soldadura       |
| Personas          | Operarios entre estaciones    | Operador de horno que camina a control |
| Vehículos         | Montacargas, camiones, carros | Grúa viga, camión de salida            |
| Paquete / carga   | Cajas y pallets               | Empaque → despacho                     |

Cada flujo tiene su propia métrica y su propio puntaje. El reporte muestra cada uno por separado.

### 3.3 Elementos fijos

```jsonc
{
  "id": "columna-1",
  "kind": "obstaculo",
  "x": 12,
  "z": 8,
  "w": 0.6,
  "d": 0.6,
  "locked": true,
  "reason": "Columna estructural",
}
```

- `locked: true` significa que ninguna alternativa ni la IA la mueve.
- Las alternativas deben aceptar como entrada los elementos fijos y resolver el resto alrededor de ellos.
- Si el resultado es imposible, se dice cuál fijo lo impide.

### 3.4 Procesos por lote

El horno y el secado tienen **tiempo de llenado**: la pieza espera a que se junte el lote. Ese tiempo se modela como `espera_lote` (ya existe para el transporte), no como tiempo de máquina. Debe aparecer separado en el desglose del tiempo.

### 3.5 Banda y conveyor

Un conveyor es un segmento con origen, destino, capacidad (piezas por minuto) y velocidad. Se dibuja sobre el plano y entra en la ruta si la ruta lo usa.

---

## 4. Contexto segmentado

El contexto deja de ser un texto plano. Es un conjunto de **segmentos** con historial.

### 4.1 Segmentos

| Segmento        | Contenido                                                                        |
| --------------- | -------------------------------------------------------------------------------- |
| `negocio`       | rubro, producto, demanda, clientes, temporadas                                   |
| `operaciones`   | turnos, jornada, eficiencia, procesos                                            |
| `tiempos`       | toma de tiempos: valores, muestras, método (cronómetro, estimado, ficha técnica) |
| `maquinas`      | catálogo y estado de cada equipo, cantidad, dimensiones                          |
| `flujo`         | rutas de piezas, personas, vehículos, frecuencias, lotes                         |
| `personal`      | operarios, turnos, habilidades                                                   |
| `calidad`       | scrap, retrabajo, reclamos                                                       |
| `restricciones` | fijos, reglas de seguridad, normas (distancias mínimas, pasillos)                |
| `referencias`   | imágenes de distribución de referencia y sus notas                               |

### 4.2 Entradas

Cada entrada es **inmutable** y tiene:

```jsonc
{
  "id": "tiempos-0007",
  "segment": "tiempos",
  "version": 3,
  "date": "2026-10-14",
  "key": "pulido.t_ciclo",
  "value": [3.5, 4.5],
  "unit": "min/pieza",
  "source": "medido",
  "confidence": "alta",
  "owner": "supervisor de pulido",
  "supersedes": "tiempos-0004",
}
```

- `source`: `medido` | `estimado` | `supuesto` | `usuario`.
- `confidence`: decide si el resultado se muestra como número (alta) o como rango (baja).
- Un cambio **agrega** una entrada nueva que reemplaza a la anterior. Nunca se borra.

### 4.3 Reglas

- Cada análisis guarda `context_version` y `plant_version`.
- Si el usuario edita el plano, se regenera el **Contexto 2**: un resumen de lo que el sistema entendió del plano (máquinas, flujos, fijos) para que el usuario lo confirme antes de analizar. Sin confirmación, el análisis no se recalcula.
- Las imágenes de referencia son entradas del segmento `referencias`. El sistema las usa como contexto solo si el proveedor activo tiene visión (sección 7).

---

## 5. Motor de distribución

### 5.1 Alternativas

Mantener tres alternativas y agregar métodos fundados. Cada alternativa declara su método y sus supuestos.

| Alternativa           | Método                                                                               | Cuándo                        |
| --------------------- | ------------------------------------------------------------------------------------ | ----------------------------- |
| Reordenar en su lugar | CRAFT: intercambios por pares y por tripletas hasta que no mejore el costo de manejo | Siempre; es la base           |
| Flujo en U / línea    | Construcción por relaciones (CORELAP o ALDEP) con el orden del flujo                 | Flujos lineales o en U        |
| Por bloques (SLP)     | Agrupar áreas con relación A o E en bloques y luego acomodar bloques                 | Plantas con muchas relaciones |
| Tu rediseño           | Lo que el usuario dibuja                                                             | Siempre disponible            |

### 5.2 Reglas de decisión

- Una alternativa **nunca** se recomienda si empeora la métrica principal sin declararlo.
- La métrica principal depende del caso: `piezas × distancia` (costo de manejo) cuando no hay supuestos; `lead time` y `capacidad` cuando sí los hay.
- El puntaje es **multicriterio** con pesos que define el usuario (ver sección 5.3). Si no los define, se usan los pesos por defecto y se muestra cuáles son.
- El resultado muestra **ideal** (mejor técnico sin restricciones) y **viable** (mejor con fijos, presupuesto de obra y orden de implementación).
- Cada alternativa muestra la sensibilidad: si el peso de la distancia baja a la mitad, ¿cambia la recomendación?

### 5.3 Criterios y pesos por defecto

| Criterio                                        | Peso por defecto | Medido por                    |
| ----------------------------------------------- | ---------------- | ----------------------------- |
| Costo de manejo (metros × viajes)               | 0,25             | motor de rutas                |
| Lead time                                       | 0,20             | desglose del tiempo           |
| Capacidad                                       | 0,15             | carga por estación            |
| Obra y cambio de máquinas                       | 0,15             | número de movimientos y fijos |
| Seguridad y separación (áreas sucias, pasillos) | 0,15             | reglas de cercanía            |
| Flexibilidad (espacio libre para crecer)        | 0,10             | área libre                    |

Los pesos deben sumar 1. La interfaz los muestra y permite editarlos.

### 5.4 Pruebas mínimas de regresión

1. Si una alternativa aumenta la distancia, no puede ganar por distancia.
2. Ningún elemento `locked` cambia de posición en ninguna alternativa.
3. "Reordenar en su lugar" nunca es peor que "Hoy".
4. Una estación con `count: N` produce N servidores en el cálculo de capacidad.
5. Una planta con retornos (ciclos en el flujo) se resuelve sin error y muestra los ciclos en el plano.
6. El caso `pruebas/transformadores.json` produce un resultado en el que el informe no contradice a `facts()`.

---

## 6. Simulación

- Usar **SimPy** (eventos discretos) para evaluar cada alternativa con variabilidad.
- Entradas: distribuciones tomadas del segmento `tiempos` (triangular con mínimo, moda y máximo cuando hay rango; determinista cuando es medido).
- Salidas: **rangos** (percentil 10, mediana, percentil 90) para piezas por día, lead time, utilización y tiempo muerto.
- Semilla fija y número de réplicas visible. El mismo caso debe dar el mismo resultado.
- La simulación no reemplaza a las fórmulas del motor: las fórmulas dan el resultado rápido; la simulación valida el más prometedor.

### KPIs a calcular (según disponibilidad de datos)

- **OEE** = disponibilidad × rendimiento × calidad. Si falta disponibilidad o calidad, mostrar "sin datos" en lugar de inventar.
- **Tiempo muerto** separado en: paro por falla, espera por material, espera por personal, cambio de herramienta, espera de lote.
- **Lead time**, **takt**, **WIP**, **throughput**, **utilización** por estación.

---

## 7. Agentes y proveedores de IA

### 7.1 Roles de IA

El motor **no** es un agente. Los agentes son los siguientes, cada uno con entrada y salida definidas:

| Agente                  | Entrada                                | Salida                                                      | Límites                                                      |
| ----------------------- | -------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| **Extractor**           | historia (texto)                       | JSON validado contra el esquema                             | No inventa estaciones que la historia no mencione            |
| **Editor de plano**     | instrucción del usuario + plano actual | lista de **operaciones** (agregar, mover, borrar, conectar) | Nunca devuelve el plano completo; no toca elementos `locked` |
| **Contexto**            | edición del plano                      | resumen "Contexto 2" para confirmar                         | No cambia datos sin confirmación                             |
| **Analista**            | `facts()` y resultados del motor       | explicación en lenguaje claro                               | Solo cita hechos del motor                                   |
| **Redactor de informe** | hechos y análisis                      | texto del reporte                                           | Cada cifra debe existir en los hechos                        |
| **Misiones**            | planta y análisis                      | 3 misiones para el taller                                   | Sin cifras inventadas                                        |
| **Ingeniero (chat)**    | pregunta y contexto reducido           | respuesta                                                   | Misma regla que el analista                                  |

Cada agente tiene su **prompt en un archivo propio** (`backend/cauce/agents/*.md`) y su **esquema de salida** en código. No se mezclan en un solo prompt.

### 7.2 Operaciones del editor de plano

El Editor de plano devuelve algo como:

```json
[
  {
    "op": "add",
    "type": "pulido",
    "name": "Pulidora 2",
    "near": "pulido",
    "count": 1
  },
  {
    "op": "move",
    "id": "horno",
    "to": { "x": 28, "z": 4 },
    "reason": "acercar a configuración"
  },
  { "op": "connect", "from": "horno", "to": "config", "frac": 1.0 }
]
```

- El sistema valida cada operación, la aplica y la deja en el historial de deshacer como **una sola acción**.
- Las operaciones que tocan elementos `locked` se rechazan y se explican.
- El usuario ve la lista antes de aplicarla.

### 7.3 Proveedores y capacidades

Cada proveedor declara sus capacidades:

```python
capabilities = {"json_schema": True, "stream": True, "vision": False, "max_context": 8192}
```

- Un rol pide capacidades. Si el proveedor no las tiene, el sistema usa el respaldo o lo indica.
- Configuración por rol (`CAUCE_EXTRACT_PROVIDER`, `CAUCE_EDITOR_PROVIDER`, etc.) y un modelo por defecto.
- **Llama 3.1 8B no interpreta imágenes.** Cualquier función que use fotos o imágenes de referencia requiere un proveedor con visión. Esto debe validarse antes de construir esa función.
- Agregar un proveedor nuevo = una clase que cumpla `base.py` + una rama en la fábrica. Nada más.

---

## 8. Editor de plano

Mínimo para que el editor sea usable con 30 o más unidades:

1. **Selección múltiple**: rectángulo de selección (como PowerPoint) y `Shift` / `Ctrl` para sumar.
2. **Copiar, cortar y pegar** (`Ctrl+C`, `Ctrl+X`, `Ctrl+V`) con desplazamiento al pegar. Incluye rutas entre las copias seleccionadas.
3. **Deshacer por operación** completa, incluidas las del asistente.
4. **Bloquear** (fijar) y **desbloquear** elementos; los bloqueados se ven distintos.
5. **Herramienta de conveyor / banda** y de **flujo de personas o vehículos** (tipos distintos en el plano).
6. **Agrupar** unidades en bloque (×10) y expandir.
7. **Zoom y etiquetas** que no se corten; con muchas unidades, mostrar el número en lugar del nombre.
8. **Asistente en el editor**: un cuadro de texto donde el usuario escribe "agrega una máquina de pulido junto a sandblasting y no muevas la columna" y el Editor de plano responde con operaciones para confirmar.

Regla: ninguna herramienta vuelve a calcular el layout completo. Solo recalcula rutas y métricas de lo que cambió.

---

## 9. Orden sugerido de trabajo

1. **Reproducir** el caso de transformadores (guardar el JSON) y escribir las pruebas de la sección 5.4 que hoy fallan.
2. **Consistencia de la recomendación** (H1) y **validación del informe** (H10).
3. **Cantidades por estación** (H2) y **elementos fijos** (H6).
4. **No pisar decisiones manuales** (H7) y **historial de deshacer** (sección 8).
5. **Contexto segmentado** con historial y Contexto 2 (sección 4).
6. **Separar agentes** y **capacidades de proveedor** (sección 7).
7. **Mejorar la búsqueda** de alternativas (CRAFT, SLP) (H4) y los pesos multicriterio (sección 5.3).
8. **Flujos separados** y **banda** (H3, sección 3.2).
9. **Simulación con SimPy** y rangos (sección 6).
10. **Referencias con imagen**, solo cuando haya proveedor con visión.

Cada paso termina cuando sus pruebas pasan y el caso de transformadores no empeora.

---

## 10. Audiencia

- Usuario principal: **ingeniero o supervisor** del área.
- En negocios muy pequeños: el **dueño** es quien usa la plataforma.
- Las pantallas deben hablar en términos de operación (estación, turno, cuello de botella, tiempo muerto) y no de fórmulas. Las fórmulas van en "Cómo se calculó".

---

## 11. Lo que no hacer

- No pedir a un modelo que calcule distancias, capacidades o tiempos.
- No reemplazar el plano completo desde la IA.
- No optimizar una sola métrica sin mostrar las demás.
- No ocultar que un resultado es hipotético o depende de supuestos.
- No agregar dependencias pesadas sin justificarlo en el PR.
- No cambiar el significado de una métrica existente sin actualizar `Cómo se calculó` y el README.

===========================================================

## AÑADIDO PLAN DE IMPLEMENTACIÓN

Plan de implementación basado en CRITERIOS-IMPLEMENTACION-1.1.md, priorizado para corregir primero los errores que afectan la confianza del resultado.
El caso base ya está disponible en [pruebas/transformadores.json](C:/Users/user/Desktop/Proyectos y Acts/Team 4/Proyecto 2/ProyectoIA3d/pruebas/transformadores.json). El archivo transformadoes.txt está vacío, por lo que no aporta aún una historia de entrada para probar al extractor.
Fase 0 — Base de pruebas y diagnóstico
Objetivo: convertir el caso de transformadores en una regresión automática.

- Crear pruebas para engine.py, layout.py, /api/analyze y /api/report.
- Cargar transformadores.json como fixture.
- Registrar el resultado actual: alternativas, métricas, recommended, rutas y texto del informe.
- Confirmar si el error H1 ocurre en el motor (recommended) o solo en el informe generado.
- Añadir las seis pruebas mínimas de regresión definidas en la sección 5.4.
  Criterio de salida: una prueba reproduce el problema sin depender de Ollama y falla cuando una recomendación o informe contradice las métricas.
  Fase 1 — Consistencia y trazabilidad básica
  Objetivo: ningún resultado contradice el cálculo del motor.
- Corregir la elección de recommended en [backend/cauce/layout.py](C:\Users\user\Desktop\Proyectos y Acts\Team 4\Proyecto 2\ProyectoIA3d\backend\cauce\layout.py) o en el cálculo de puntaje, según revele la Fase 0.
- Hacer explícita la métrica principal:
  - Sin supuestos: costo de manejo / recorrido ponderado.
  - Con supuestos: lead time y capacidad.
- Modificar el reporte y chat para que solo puedan usar datos generados por facts().
- Validar o descartar afirmaciones numéricas generadas por IA que no estén entre los hechos permitidos.
- Guardar en cada análisis plant_version y context_version; si el plano cambia, marcar el resultado como desactualizado.
  Criterio de salida: el caso de transformadores nunca recomienda una alternativa peor en la métrica declarada, y el informe no puede afirmar cifras ajenas al motor.
  Fase 2 — Modelo de planta: cantidades y elementos fijos
  Objetivo: representar una planta real con máquinas paralelas y restricciones físicas.
- Ampliar el modelo de estación con count, dimensiones unitarias, arrangement, ops_per_unit y ciclos por rango.
- Mantener compatibilidad con proyectos guardados bajo cauce-proyecto-v2; crear migración a v3 solo si el formato lo requiere.
- Actualizar el motor para calcular capacidad con count: N como N servidores paralelos.
- Actualizar el plano para mostrar las unidades individuales o un bloque agrupado con etiqueta ×N.
- Incorporar locked: true para estaciones y obstáculos.
- Hacer que feasible() y todas las alternativas preserven la posición de cada elemento fijo.
  Criterio de salida: embobinado ×10, montaje ×4 y demás grupos del caso de transformadores quedan representados; ningún fijo se mueve en una alternativa.
  Fase 3 — Protección de ediciones manuales y editor
  Objetivo: las herramientas ayudan sin destruir el plano del usuario.
- Separar “editar plano” de “generar alternativas”: editar no debe reacomodar automáticamente.
- Implementar historial por operación con deshacer/rehacer.
- Añadir bloquear/desbloquear visualmente.
- Implementar selección múltiple, copiar/cortar/pegar y desplazamiento al pegar.
- Añadir zoom, etiquetas adaptativas y agrupación/expansión para plantas de más de 30 unidades.
- Agregar edición de rutas por grupo.
  Criterio de salida: el usuario puede mover y fijar elementos, analizar el resultado y volver a editar sin perder su acomodo.
  Fase 4 — Contexto segmentado y agentes
  Objetivo: que cada dato tenga fuente, fecha, confianza e historial.
- Sustituir el contexto plano por segmentos: negocio, operaciones, tiempos, máquinas, flujo, personal, calidad, restricciones y referencias.
- Registrar cada dato como entrada inmutable con source, confidence, fecha, propietario y referencia a la entrada reemplazada.
- Crear “Contexto 2”: resumen del plano tras editarlo, que el usuario debe confirmar antes de recalcular.
- Separar prompts por rol en backend/cauce/agents/:
  - extractor;
  - editor de plano;
  - contexto;
  - analista;
  - informe;
  - misiones;
  - chat.
- Extender providers/base.py con capacidades, y configurar proveedor/modelo por agente.
  Criterio de salida: cambiar un tiempo o una máquina deja trazabilidad y obliga a confirmar antes de emitir métricas nuevas.
  Fase 5 — Alternativas y decisión multicriterio
  Objetivo: alternativas técnicamente defendibles para flujos complejos.
- Reforzar “Reordenar en su lugar” con CRAFT: pares y tripletas hasta no mejorar.
- Implementar alternativa por bloques con SLP/CORELAP o ALDEP.
- Mantener U/línea solo cuando el flujo sea adecuado; no usar orden topológico lineal para ciclos.
- Añadir pesos editables que sumen 1 para distancia, lead time, capacidad, obra, seguridad y flexibilidad.
- Mostrar alternativa “ideal” y “viable”, supuestos, método, sensibilidad y explicación de la decisión.
  Criterio de salida: “Reordenar” nunca empeora respecto a “Hoy”, y una alternativa no puede ganar por distancia si aumenta el costo de manejo.
  Fase 6 — Flujos, conveyor y ciclos
  Objetivo: modelar el movimiento real, no solo un flujo lineal de piezas.
- Añadir tipos de flujo: material, personas, vehículos y carga.
- Permitir retornos y ciclos sin que flow_order() los envíe al final.
- Añadir conveyor con origen, destino, capacidad y velocidad.
- Medir y presentar KPI por cada flujo.
- Diferenciar en plano rutas, retornos y uso de conveyor.
  Criterio de salida: el proceso de transformadores representa sus pruebas intermedias/finales y retornos sin cruces artificiales de la alternativa lineal.
  Fase 7 — Simulación y KPIs avanzados
  Objetivo: complementar fórmulas rápidas con rangos operativos.
- Incorporar SimPy como dependencia justificada.
- Ejecutar simulación solo sobre la alternativa prometedora, con semilla y réplicas visibles.
- Modelar ciclos, esperas de lote, colas y variabilidad.
- Mostrar P10, mediana y P90 de capacidad, lead time, utilización y tiempos muertos.
- Añadir OEE, takt, WIP y throughput únicamente cuando existan datos suficientes; de lo contrario, mostrar “sin datos”.
  Criterio de salida: el horno/secado puede aparecer como cuello de botella por tiempo, aun si el recorrido es corto.
  Fase 8 — Referencias visuales
  Objetivo: incorporar imágenes solo con soporte real de visión.
- Crear segmento referencias.
- Verificar capabilities.vision antes de permitir análisis visual.
- Si el proveedor no tiene visión, conservar la referencia como nota, sin fingir que fue interpretada.
  Criterio de salida: ninguna imagen se usa como contexto sin un proveedor que la pueda procesar.
  La primera entrega recomendable es Fases 0 y 1. Corrige la recomendación contradictoria y protege la confianza en los resultados sin modificar todavía el formato de planta ni el editor. Después seguiría Fase 2, porque cantidades y bloqueos son la base que necesitan el motor, las alternativas y el caso de transformadores.
