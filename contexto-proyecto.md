# Contexto del proyecto: Plataforma gamificada de ingeniería de procesos

> Archivo de contexto para pegar al inicio de cada sesión con una IA (o usar como `CLAUDE.md`).
> Lo marcado como **[Por definir]** son decisiones abiertas; no las des por tomadas.

## 1. Visión

Plataforma web a la que una empresa con línea de producción entra para ver su planta en 3D, detectar dónde pierde eficiencia (cuellos de botella, recorridos largos, tiempos muertos) y mejorarla con ayuda de IA, todo **gamificado** para que dueños, supervisores y operadores se involucren en la mejora continua.

Nombre del proyecto: **[Por definir]**

## 2. Problema

- Las pymes con líneas de producción rara vez tienen ingeniería de procesos: sus layouts crecen sin planeación y nadie mide recorridos, capacidad ni tiempos.
- Los análisis de ingeniería tradicionales son caros, lentos y requieren datos que el dueño no tiene a la mano.
- Las herramientas de mejora continua suelen ser aburridas y se quedan en el escritorio del gerente, sin llegar al piso de planta.

## 3. Usuarios objetivo

| Segmento | Tamaño | Qué necesita |
|---|---|---|
| Micro | 1 a 10 operadores | Panel simple: ver su bodega en 3D, detectar dónde pierde dinero, retos sencillos para el equipo |
| Mediana | 10 a 50 operadores | Varias áreas/células, roles básicos, métricas por estación |
| Industrial | 50 a 200+ operadores | Múltiples líneas y turnos, roles supervisor/operario, tableros de gamificación a gran escala, posible integración con sensores o reportes de piso |

Roles previstos: dueño/gerente, supervisor o líder de célula, operador.

## 4. Concepto base (flujo "historia → modelo → análisis → rediseño")

Inspirado en el caso de referencia (ver sección 9). El usuario **cuenta la historia de su planta** (por voz o texto) en vez de entregar planos técnicos. A partir de eso, el sistema:

1. **Captura historia y supuestos.** Máquinas/áreas, número de operarios, cómo sale el producto, procesos administrativos. Si faltan datos, la IA genera un caso hipotético con supuestos razonables y los deja escritos.
2. **Genera la vista base.** Foto aérea (cenital) de la planta y su modelo 3D interactivo en el navegador (Three.js).
3. **Diagnostica como ingeniero de procesos.** Flujo de materiales, recorridos diarios en metros, capacidad por estación (% de utilización), cuello de botella, tiempo de fabricación por pieza, carga y despacho.
4. **Propone un rediseño.** Compara alternativas (por ejemplo, flujo en U) y muestra el antes y el después, con un botón que mueve cada máquina a su nueva posición.

**Primera meta:** que esto funcione bien para **una sola empresa**. Después se generaliza a muchas.

## 5. Capa de gamificación

Ideas de partida **[Por definir el detalle]**:

- **Niveles de la fábrica.** La planta empieza en "Taller desordenado" (rojos, recorridos largos) y sube de nivel en el 3D conforme se aplican mejoras o se cumplen metas, desbloqueando mejoras visuales y estaciones.
- **Puntos de eficiencia / moneda del taller.** Cada metro de recorrido evitado, minuto ahorrado o reducción de tiempo de ciclo suma puntos, canjeables por incentivos que defina la empresa.
- **Misiones y retos.** Diarios y por turno, por ejemplo "liberar el cuello de botella de pulido antes de las 14:00" o "turno sin paradas".
- **Insignias.** Ejemplos: "Maestro del Flujo", "Cero Desperdicios", "Récord de Despacho", visibles en tableros dentro de la planta.
- **Leaderboards sanos.** Competencia entre células o turnos, enfocada en equipos y no en individuos señalados, para evitar presión negativa.

## 6. Escalabilidad

- **Plantillas por industria** (vidrio y aluminio, carpintería, metalmecánica, maquila textil, alimentos y bebidas): máquinas típicas, flujos estándar y cuellos de botella comunes.
- **Versiones por tamaño** (micro / mediana / industrial), con funciones que se activan según el plan o el tamaño.
- **Multiempresa (multi-tenant)** a futuro: cada empresa con su planta, usuarios y datos aislados. **[Por definir cuándo]**; se diseña pensando en esto pero no se construye en la primera fase.
- **Procesamiento con agentes en paralelo**: separar imagen, análisis, 3D, gráficos e interfaz en tareas independientes para reducir el tiempo de configuración de cada nueva empresa.

## 7. Arquitectura de IA (multi-modelo y MCP)

Requisito: la plataforma **no debe depender de una sola IA**.

- Capa de abstracción de proveedores: una interfaz común para llamar a distintos modelos (texto/análisis, generación de imagen, visión), intercambiables por configuración.
- **MCP (Model Context Protocol)** como vía para conectar herramientas y fuentes de datos externas (archivos de la planta, ERP, hojas de cálculo, sensores, etc.). **[Por definir qué servidores MCP y para qué]**.
- Uso previsto por tarea (a validar):
  - Generación de imagen aérea: modelo de imágenes (en el caso de referencia, ChatGPT vía Codex).
  - Análisis de ingeniería y código: modelo de razonamiento (en el caso de referencia, Claude).
  - Lectura de la foto para medir máquinas y pasarlas a metros: modelo con visión.
- Los supuestos de la IA deben quedar **escritos y editables** por el usuario.

## 8. Alcance sugerido por fases

**Fase 1 (piloto, una empresa):** captura de historia → foto aérea → 3D en navegador → análisis (recorridos, capacidad, cuello de botella) → rediseño con comparación antes/después.
**Fase 2:** capa de gamificación (niveles, puntos, retos, insignias, tablero).
**Fase 3:** plantillas por industria, roles, multiempresa, conexión a más IAs y MCPs, integraciones con datos reales.

**Stack:** [Por definir]. Referencia del caso base: Three.js para el 3D, app web en el navegador, gráficos tipo dashboard.

## 9. Caso de referencia (prueba de concepto)

Guía "Cómo rediseñé el taller de vidrio de mi papá con Claude Code" (Víctor Paytuvi, Nerdos de la IA, oct 2026). Es un caso **hipotético con datos supuestos**: taller de vidrio con corte, pulido, sandblasting, lavado, recorte, empaque, despacho y oficina.

Resultados que reporta (como orden de magnitud de lo que debería poder mostrar la plataforma):

| Métrica | Hoy | Propuesta | Cambio |
|---|---|---|---|
| Recorrido del vidrio al día | 2,955 m | 771 m | -74 % |
| Capacidad del taller | 77.5 piezas/día | 120 piezas/día | +55 % |
| Tiempo de fabricación | 6.3 h/pieza | 3.1 h/pieza | -51 % |
| Carga de camiones | 241 min/día | 98 min/día | -59 % |

Hallazgo clave del análisis: la pulidora operaba al 101 % de capacidad (cuello de botella). Proceso de construcción: 5 agentes en paralelo (imagen, análisis, 3D, gráficos, interfaz) terminaron en ~71 min frente a más de 4 h en secuencia.

Aprendizaje a conservar: **contar la historia, no la técnica**, y dejar que el criterio humano (idealmente un ingeniero de procesos con datos reales) decida; la IA hace el trabajo pesado.

## 10. Decisiones abiertas

- Nombre y marca del proyecto.
- Stack técnico (frontend, backend, base de datos, hosting).
- Modelo de negocio y precios por tamaño de empresa.
- Qué IAs conectar primero y qué servidores MCP.
- Cómo se capturan datos reales (carga manual, hojas de cálculo, sensores) frente a los supuestos.
- Mecánica concreta de puntos, niveles e incentivos, y quién define los premios.
- Si se parte de una empresa piloto real o del caso hipotético del taller de vidrio.

## 11. Instrucciones para la IA que lea este archivo

- Responde en español.
- No des por decididas las secciones marcadas **[Por definir]**; propón opciones con pros y contras.
- Prioriza la **Fase 1 (una sola empresa)** y no sobreingenierices la multiempresa todavía.
- Mantén separado lo que es dato real de lo que es supuesto; deja los supuestos escritos.
- Diseña los módulos para que el proveedor de IA sea intercambiable.
- Si falta información para avanzar, pregunta antes de construir.
