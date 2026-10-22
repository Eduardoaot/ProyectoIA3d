# Cauce

**Cuenta la historia de tu planta, corrige el plano y mira cómo quedaría con el recorrido del material en orden.**

Cauce es una aplicación web para talleres y plantas pequeñas que nunca tuvieron un ingeniero de procesos. En lugar de pedir planos técnicos, le pide al dueño que **cuente cómo es su taller** (escribiendo o dictando). Una IA convierte esa historia en un primer plano; el usuario lo corrige en un editor 2D; y a partir de ahí Cauce:

1. muestra la planta en **3D** con el recorrido del material animado,
2. hace un **diagnóstico** (metros que camina el material, cercanía entre áreas y, si hay datos, capacidad, cuello de botella, tiempos y carga de camiones),
3. propone **tres rediseños** calculados y deja ajustarlos a mano,
4. genera un **reporte en PDF** con el antes y el después,
5. ofrece un **ingeniero virtual** para preguntas y un **taller gamificado** para llevar la mejora al piso de planta.

Funciona para cualquier rubro (vidrio, carpintería, metalmecánica, costura, alimentos…): las máquinas son representaciones genéricas y los nombres los pone el usuario.

> El nombre: un *cauce* es el canal por donde corre el agua. La marca es la planta vista desde arriba con dos portones; el recorrido del material empieza enredado y se ordena en una U de portón a portón. La "u" de la palabra *cauce* es ese mismo trazo.

---

## Contexto, estudios y operadores conectados

El recorrido maestro añade un intérprete general que delega a especialistas, una ronda de aclaraciones y un consolidador explícito. El maestro conserva entidades, afirmaciones, fuentes y dudas. La construcción usa sus datos aceptados y comprueba cada requisito del plano. Contrato: [CONTRATO-MAESTRO.md](coordinacion/CONTRATO-MAESTRO.md).

Para probar: abre **Ver contexto de la planta**, pega el relato o adjunta documentos, organiza y revisa las propuestas. Confirma los datos y vuelve al paso inicial para construir. Después de editar el plano, usa **Comprobar el plano contra el contexto**; confirma la versión antes de analizar. Los requisitos incumplidos o desconocidos y las dimensiones ilustrativas quedan visibles.

El plano se construye por lotes de cinco entidades o recorridos (`CAUCE_BUILD_BATCH_SIZE`, entre 1 y 20), con comprobación y avance recuperable en SQLite. La pantalla muestra las etapas; si un lote incumple el contexto o se solapa, se detiene y conserva el avance anterior. Volver a construir permite reanudar una interrupción cuando el maestro coincide; cambiar sus datos inicia una construcción nueva. El plano anterior permanece guardado hasta terminar correctamente.

La prioridad general es texto para datos e imágenes para ubicación. Puedes indicar que las imágenes son la referencia principal de este proyecto. En ese caso se requiere interpretación de visión o revisión manual explícita; la aplicación no afirma haber leído una imagen con un modelo sin visión.

El ensayo con el modelo real se ejecuta desde la raíz:

```powershell
.\.venv\Scripts\python.exe -X utf8 backend/evaluate_master.py
```

Registra el resultado y las trazas en `.cauce-data/master-evaluation.json`. Si Ollama no está listo, registra `not_run`; no utiliza un modelo simulado para sustituir esa prueba. Las anotaciones visuales de `pruebas/contexto-transformadores.expected.json` son referencias humanas de evaluación y no se envían al modelo como respuestas esperadas.

`CAUCE_AGENT_CHUNK_CHARS` limita cada bloque de lectura de contexto/estudios (1000 caracteres por defecto, entre 256 y 4000). Las dudas y entregas internas se dividen en ciclos, con memoria auxiliar limitada y reserva de respuesta; no se reenvía todo el expediente en cada consulta. La estimación de tokens y los ciclos quedan en las trazas.

`CAUCE_CONTEXT_CONCURRENCY` permite 1–4 consultas simultáneas de especialistas (2 por defecto). `CAUCE_OLLAMA_CONTEXT` fija la ventana solicitada al servidor (8192 por defecto), enviada como `options.num_ctx` según la [documentación de Ollama](https://github.com/ollama/ollama/blob/main/docs/faq.mdx). El ajuste de rendimiento y la fidelidad con el caso real quedan pendientes del ensayo con un proveedor activo.

La rama de continuación `feature/data1` reúne el expediente local persistente en SQLite, con confirmación por lotes, documentos originales, trabajos de interpretación por bloques, estudios de más de cien actividades, base de operadores y entregables estructurados, junto con las mejoras de recinto, editor y presentación de Eduardo. Contrato, integración y próximos pasos: [CONTRATO-DATA.md](coordinacion/CONTRATO-DATA.md) y [PLAN-DATA.md](PLAN-DATA.md).

Desde la raíz, con las dependencias de `backend/requirements-dev.txt` instaladas en `.venv`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
```

En otra terminal: `cd frontend` y `npm run dev -- --host 127.0.0.1`. Abrir **Ver contexto de la planta**. El estado se guarda en el navegador; **Guardar copia del proyecto** persiste el expediente en el backend y **Exportar con archivos** permite trasladarlo. `CAUCE_DATA_DIR` cambia la carpeta de SQLite (por defecto `.cauce-data`, excluida de Git).

La interpretación utiliza el proveedor existente del rol contexto: `OLLAMA_HOST`, `CAUCE_CONTEXT_PROVIDER` y `CAUCE_CONTEXT_MODEL`. Si el modelo no está disponible, el servicio lo explica y conserva captura manual y documentos. Las pruebas no necesitan Ollama: usan proveedores simulados. No se ha equiparado esa prueba con la calidad de un modelo real.

En Windows también se puede usar `powershell -ExecutionPolicy Bypass -File .\iniciar.ps1`. Reutiliza `.venv` de la raíz o `backend/.venv`, inicia el backend oculto y deja el frontend en la terminal. El modelo se configura después; solo se descarga desde este script si se añade `-DescargarModelo`.

Los porcentajes de operadores importados conservan su escala y procedencia; la eficiencia calculada requiere definir sus observaciones. Las duraciones desconocidas quedan sin dato. Un promedio de muestras se calcula en código y no se llama tiempo estándar. Los formatos sin extracción real y los PDFs escaneados siguen pendientes de lectura.

Pruebas: `.venv\Scripts\python.exe -m pytest backend/tests -q`, y en frontend `npm test` / `npm run build`. La integración de navegador se comprueba con `backend/tests/serve_data_smoke.py` y `frontend/tests/data-smoke-server.mjs` en procesos separados, y después `node tests/data-backend.browser.mjs`; ese servidor de pruebas usa un expediente temporal y proveedor simulado, separado del servidor normal.

---

## Índice

1. [Idea y origen](#1-idea-y-origen)
2. [Cómo funciona en un minuto](#2-cómo-funciona-en-un-minuto)
3. [Requisitos, instalación y ejecución](#3-requisitos-instalación-y-ejecución)
4. [Configuración (variables de entorno)](#4-configuración-variables-de-entorno)
5. [Estructura de carpetas](#5-estructura-de-carpetas)
6. [Arquitectura general](#6-arquitectura-general)
7. [El modelo de datos: la planta](#7-el-modelo-de-datos-la-planta)
8. [Backend, archivo por archivo](#8-backend-archivo-por-archivo)
9. [Frontend, archivo por archivo](#9-frontend-archivo-por-archivo)
10. [Los pasos de la aplicación](#10-los-pasos-de-la-aplicación)
11. [El editor 2D](#11-el-editor-2d)
12. [La escena 3D](#12-la-escena-3d)
13. [Fórmulas de ingeniería](#13-fórmulas-de-ingeniería)
14. [Diseño visual y marca](#14-diseño-visual-y-marca)
15. [Pruebas y verificación](#15-pruebas-y-verificación)
16. [Limitaciones conocidas y pendientes](#16-limitaciones-conocidas-y-pendientes)
17. [Hoja de ruta y decisiones abiertas](#17-hoja-de-ruta-y-decisiones-abiertas)
18. [Flujo de trabajo con Git](#18-flujo-de-trabajo-con-git)
19. [Glosario](#19-glosario)

---

## 1. Idea y origen

El proyecto nace de un caso de referencia (hipotético): la guía *"Cómo rediseñé el taller de vidrio de mi papá con Claude Code"*. En ese caso, a partir de una historia contada de memoria, se armó la planta en 3D, se encontró que la pulidora trabajaba al 101 % (cuello de botella) y se propuso un flujo en U que reducía el recorrido diario del vidrio en un 74 %.

Cauce generaliza esa idea a **cualquier taller**:

- **El problema:** las pymes con líneas de producción rara vez tienen ingeniería de procesos. Sus layouts crecen sin planeación y nadie mide recorridos, capacidad ni tiempos. Los estudios tradicionales son caros y piden datos que el dueño no tiene a la mano.
- **La propuesta:** "contar la historia, no la técnica". La IA hace el trabajo pesado de convertir el relato en datos; el criterio humano corrige y decide.
- **Principios que guían todo el código:**
  - La IA **no inventa**: lo que la historia no menciona se descarta.
  - Los **números salen de fórmulas deterministas** y trazables, nunca de la IA.
  - Los **supuestos son opcionales, visibles y editables**. Sin ellos, Cauce solo analiza recorridos y cercanías.
  - El **proveedor de IA es intercambiable** por configuración.
  - Si la IA no responde, la app **sigue funcionando** con reglas y textos de respaldo.

El documento [contexto-proyecto.md](contexto-proyecto.md) guarda la visión completa (usuarios objetivo, gamificación, escalabilidad, fases) y [ESTADO.md](ESTADO.md) el estado de cada sesión de trabajo.

---

## 2. Cómo funciona en un minuto

```
 Historia (texto o voz)
        │
        ▼
 ┌───────────────────┐   IA extractora (JSON, temperatura 0)
 │  /api/story       │ + reglas (palabras clave, números en letra)
 └───────────────────┘   → validación contra el texto
        │
        ▼
 Primer plano (máquinas, rutas, zonas, portones)  ──►  Editor 2D: el usuario lo corrige
        │
        ▼
 ┌───────────────────┐   Motor determinista:
 │  /api/analyze     │   rutas por pasillos, métricas, relaciones,
 └───────────────────┘   3 alternativas de acomodo y la recomendada
        │
        ▼
 3D  →  Diagnóstico  →  Rediseño (+ editor)  →  Reporte PDF  →  Resumen + chat
                                                                     │
                                                         IA ingeniera (streaming)
```

---

## 3. Requisitos, instalación y ejecución

### Requisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| Python | 3.12 o superior | Backend (FastAPI) |
| Node.js | 20 o superior | Frontend (Vite + React) |
| [Ollama](https://ollama.com) | cualquiera reciente | Correr el modelo de IA en local (opcional) |

Modelo por defecto para **todos** los agentes: `llama3.1:8b` (Meta).

```bash
ollama pull llama3.1:8b
```

Con un solo modelo Ollama no cambia de modelo en memoria entre un agente y otro, y Cauce le pide que lo deje cargado 30 minutos entre llamadas. En un equipo sin tarjeta de video la historia tarda alrededor de 2 minutos y la opción compacta de 1 a 2; mientras tanto la app muestra el tiempo transcurrido, una estimación de lo que falta (aprendida de tus esperas anteriores en ese navegador) y un minijuego.

Sin Ollama la aplicación **funciona igual**: la historia se lee solo con reglas, el informe y el chat usan textos de respaldo y las misiones del taller salen de una lista fija.

### Backend (puerto 8000)

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt     # Windows (fastapi, uvicorn, httpx, pydantic, simpy)
# en Linux/macOS: .venv/bin/python -m pip install -r requirements.txt
# para las pruebas: -r requirements-dev.txt (agrega pytest)
.venv/Scripts/python -m uvicorn main:app --reload --port 8000
```

### Frontend (puerto 5173)

```bash
cd frontend
npm install
npm run dev
```

Abre <http://localhost:5173>. Vite redirige todas las llamadas a `/api` hacia `http://localhost:8000` (ver [frontend/vite.config.js](frontend/vite.config.js)), así que no hace falta configurar CORS ni URLs.

### Otros comandos del frontend

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con recarga en caliente |
| `npm run build` | Compila a `frontend/dist/` |
| `npm run preview` | Sirve la versión compilada |
| `npm run lint` | Revisa el código con **oxlint** (reglas de hooks de React) |

### Dónde se guardan los datos

No hay base de datos de proyectos en el servidor. **Mis proyectos** guarda varios espacios independientes en el navegador con la clave `cauce-proyectos-v1`; el proyecto activo se refleja en `cauce-proyecto-v3` por compatibilidad. Los documentos originales se guardan en IndexedDB. Borrar los datos del sitio o usar otra computadora no traslada estos proyectos ni sus adjuntos. La foto aérea **no** se guarda: vive solo mientras la pestaña está abierta.

---

## 4. Configuración (variables de entorno)

Cauce usa **tres papeles de IA**, configurables por separado. Todos usan `llama3.1:8b` por defecto:

| Papel | Qué hace | Temperatura | Variable del modelo | Variable del proveedor |
|---|---|---|---|---|
| **Extractor** | Lee la historia y devuelve **solo JSON** (máquinas, flujo, cifras, supuestos). También genera las misiones del taller. No conversa. | 0.0 | `CAUCE_EXTRACT_MODEL` | `CAUCE_EXTRACT_PROVIDER` |
| **Ingeniero** | Conversa, escribe el informe del diagnóstico y las conclusiones del reporte. | 0.5 | `CAUCE_CHAT_MODEL` | `CAUCE_CHAT_PROVIDER` |
| **Espacial** | Agentes que leen el espacio cuando la historia lo describe: forma y portones, zonas, lugar de cada máquina y paredes. Lo que la historia no dice en la misma oración se descarta. También da el criterio de la opción «Compacta con IA». Si su modelo no está instalado, lo hace el extractor. | 0.0 | `CAUCE_SPATIAL_MODEL` | `CAUCE_SPATIAL_PROVIDER` |

Variables generales:

| Variable | Valor por defecto | Efecto |
|---|---|---|
| `CAUCE_MODEL` | `llama3.1:8b` | Cambia el modelo de los tres papeles a la vez |
| `CAUCE_PROVIDER` | `ollama` | Cambia el proveedor de los tres papeles a la vez |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Dirección del servidor de Ollama |

Además, cada agente del contrato v3 tiene su propio proveedor y modelo (`cauce/providers/__init__.py`), con su prompt en `backend/cauce/agents/<rol>.md`:

| Rol | Variables | Si no están, usa | Necesita |
|---|---|---|---|
| Editor de plano (`/api/plan/ops`) | `CAUCE_EDITOR_PROVIDER`, `CAUCE_EDITOR_MODEL` | las del extractor | JSON |
| Misiones | `CAUCE_MISSIONS_*` | las del extractor | JSON |
| Informe | `CAUCE_REPORT_*` | las del chat | texto |
| Analista y Contexto | `CAUCE_ANALYST_*`, `CAUCE_CONTEXT_*` | las del chat | texto |
| Visión (imágenes de referencia) | `CAUCE_VISION_*` | las del chat | un modelo con visión (`llava`, `*vision*`…). `llama3.1:8b` **no** tiene visión |

Cada proveedor declara `capabilities = { json_schema, stream, vision, max_context }`; `/api/capabilities` publica `vision` según el proveedor de visión.

Las variables específicas (`CAUCE_EXTRACT_*`, `CAUCE_CHAT_*`, `CAUCE_SPATIAL_*` y las de cada rol) tienen prioridad sobre las generales. Ejemplo para volver al modelo pequeño (más rápido, menos preciso) solo en el chat:

```bash
set CAUCE_CHAT_MODEL=llama3.2:3b        # Windows (cmd)
$env:CAUCE_CHAT_MODEL = "llama3.2:3b"   # Windows (PowerShell)
export CAUCE_CHAT_MODEL=llama3.2:3b     # Linux/macOS
```

El indicador **"IA lista / Sin IA"** abajo a la izquierda de la app consulta `/api/health` y muestra, al pasar el mouse, qué modelo usa cada papel y si está disponible.

---

## 5. Estructura de carpetas

```
.
├── README.md                  ← este documento
├── ESTADO.md                  ← estado del proyecto por sesión y pendientes
├── contexto-proyecto.md       ← visión, usuarios, gamificación, fases, decisiones abiertas
├── .gitignore
│
├── backend/                   ← API en Python (FastAPI)
│   ├── main.py                ← rutas HTTP, textos del ingeniero, misiones
│   └── cauce/
│       ├── catalog.py         ← tipos de estación y de zona, supuestos por defecto
│       ├── story.py           ← de la historia a una planta (reglas + IA validada)
│       ├── engine.py          ← motor: rutas por pasillos, métricas, relaciones
│       ├── layout.py          ← acomodo inicial y las 3 alternativas de rediseño
│       ├── plant.py           ← planta de ejemplo (taller de vidrio)
│       └── providers/
│           ├── __init__.py    ← fábrica: extractor e ingeniero según variables
│           ├── base.py        ← interfaz común de proveedores de IA
│           └── ollama.py      ← proveedor Ollama (JSON y streaming)
│
├── frontend/                  ← interfaz en React 19 + Vite + three.js
│   ├── index.html
│   ├── vite.config.js         ← proxy /api → localhost:8000
│   ├── package.json
│   ├── .oxlintrc.json         ← reglas del linter
│   ├── public/favicon.svg
│   └── src/
│       ├── main.jsx           ← punto de entrada
│       ├── App.jsx            ← barra de pasos, estado global, navegación
│       ├── api.js             ← cliente HTTP, streaming, formato de números
│       ├── project.js         ← estado del proyecto en localStorage
│       ├── index.css          ← todos los estilos (tokens, componentes, impresión)
│       ├── steps/             ← un componente por paso de la app
│       │   ├── Story.jsx      ← 1. Historia y plano
│       │   ├── Plant.jsx      ← 2. Tu planta en 3D
│       │   ├── Diagnosis.jsx  ← 3. Diagnóstico
│       │   ├── Redesign.jsx   ← 4. Rediseño
│       │   ├── Report.jsx     ← 5. Reporte
│       │   ├── Summary.jsx    ← 6. Resumen
│       │   └── Workshop.jsx   ← Extra: taller de mejora gamificado
│       ├── editor/            ← editor 2D del plano
│       │   ├── PlanEditor.jsx ← lienzo SVG, herramientas, arrastre, deshacer
│       │   ├── Inspector.jsx  ← panel lateral para editar lo seleccionado
│       │   └── geometry.js    ← utilidades geométricas compartidas
│       ├── three/             ← escena 3D
│       │   ├── PlantView.jsx  ← envoltura React de la escena
│       │   ├── PlantScene.js  ← escena three.js: construcción, animación, cámara
│       │   └── models.js      ← maquetas 3D por tipo de máquina, personas, camiones
│       ├── charts/            ← gráficos SVG hechos a mano
│       │   ├── FlowPlan.jsx   ← plano con recorridos y dirección
│       │   ├── RelChart.jsx   ← tabla de relaciones A-E-I-O-U-X
│       │   ├── LoadChart.jsx  ← carga frente a capacidad por estación
│       │   ├── LeadChart.jsx  ← en qué se va el tiempo de una pieza
│       │   └── Tip.jsx        ← tooltip compartido
│       ├── report/
│       │   └── ReportDoc.jsx  ← documento imprimible A4 (pantalla y PDF)
│       ├── components/
│       │   ├── EngineerChat.jsx ← chat con el ingeniero (panel o en línea)
│       │   └── useReport.js   ← hook del informe en streaming
│       ├── brand/
│       │   ├── FlowMark.jsx   ← logotipo animado (enredado → U)
│       │   └── Wordmark.jsx   ← la palabra "cauce" dibujada
│       └── fx/                ← efectos de interacción
│           ├── Intro.jsx      ← animación de entrada
│           ├── Cursor.jsx     ← cursor propio con etiqueta
│           ├── ClickSplash.jsx← ondas al hacer clic
│           ├── Btn.jsx        ← botón magnético
│           └── Reveal.jsx     ← títulos que suben, apariciones, contadores, inclinación
│
└── pruebas/
    ├── historias.json         ← historias de prueba que no están en el código
    └── probar_historias.py    ← pasa cada historia por la API y resume el resultado
```

---

## 6. Arquitectura general

```
┌──────────────────────────── Navegador ─────────────────────────────┐
│  React 19 + motion (animaciones) + three.js (3D) + SVG (2D/gráficos)│
│  Estado del proyecto → localStorage                                 │
└───────────────────────────────┬────────────────────────────────────┘
                                │  fetch /api/*  (JSON y texto en streaming)
                                ▼
┌──────────────────────────── Backend ───────────────────────────────┐
│  FastAPI (main.py)                                                  │
│   ├── cauce.story    ── historia → planta                           │
│   ├── cauce.engine   ── rutas, métricas, relaciones (determinista)  │
│   ├── cauce.layout   ── acomodos y alternativas                     │
│   ├── cauce.catalog  ── tipos y supuestos                           │
│   └── cauce.providers── extractor + ingeniero                       │
└───────────────────────────────┬────────────────────────────────────┘
                                │  HTTP
                                ▼
                    Ollama (local) u otro proveedor
```

**Reparto de responsabilidades:**

- **La IA** solo hace dos cosas: *leer* (historia → JSON) y *redactar* (informe, chat, misiones). Nunca calcula una métrica.
- **El motor** (`engine.py` + `layout.py`) calcula todo lo numérico. Es puro Python sin dependencias externas, determinista y con caché (`lru_cache`) para las rutas.
- **El frontend** no tiene lógica de ingeniería: dibuja, edita y pide al backend que recalcule.
- **No hay estado en el servidor**: cada petición trae la planta completa. Esto simplifica todo y deja el camino abierto a una base de datos más adelante.

---

## 7. El modelo de datos: la planta

Todo gira alrededor de un objeto JSON llamado **planta**. Coordenadas en **metros**, origen en la esquina del fondo a la izquierda, `x` hacia la derecha y `z` hacia la calle (los portones están en `z = d`).

```jsonc
{
  "name": "Taller de vidrio",              // nombre de la planta
  "industry": "Vidrio para sala y comedor",// rubro o producto
  "size": { "w": 44, "d": 22 },            // ancho y fondo de la bodega (m)

  "gates": [                               // portones sobre el muro de la calle
    { "id": "A", "x": 30, "label": "Portón A" },
    { "id": "B", "x": 38, "label": "Portón B" }
  ],
  "receive_gate": "A",                     // por dónde entra el material
  "dispatch_gate": "A",                    // por dónde sale

  "stations": [                            // máquinas o áreas por donde pasa el material
    { "id": "corte", "name": "Mesa de corte", "kind": "corte",
      "w": 6, "d": 4,                      // tamaño (m)
      "t": 4.2,                            // minutos por pieza (solo con supuestos)
      "ops": 2,                            // operarios (0 = máquina automática)
      "t_source": "ia" }                   // de dónde salió el tiempo: ia | supuesto | usuario
  ],

  "routes": [                              // flujo del material, con dirección
    { "id": "r5", "from": "pulido", "to": "sandblast", "frac": 0.35 }  // 35 % de las piezas
  ],

  "zones": [                               // áreas por donde NO pasa el material
    { "id": "oficina", "name": "Oficina", "kind": "oficina", "x": 22.5, "z": 18, "w": 8, "d": 6 }
  ],

  "walls": [                               // paredes interiores en cualquier ángulo
    { "id": "w1", "x1": 10, "z1": 0, "x2": 10, "z2": 8 }
  ],

  "use_assumptions": true,                 // ¿calcular capacidad, tiempos y camiones?
  "params": { "demand": 78, "trucks": 3, "...": "..." },  // supuestos (ver catálogo)

  "layout": {                              // posición de cada estación: [x, z, rotación°]
    "corte": [21.5, 11, 0]
  }
}
```

Notas:

- `x`, `z` de estaciones y zonas son el **centro** del rectángulo.
- La rotación de una estación es 0, 90, 180 o 270 grados; a 90/270 se intercambian ancho y fondo.
- Una **ruta** con `frac < 1` significa que solo una parte de las piezas toma ese camino (por ejemplo, solo el 35 % pasa por sandblasting). Se dibuja punteada.
- Las **alternativas de rediseño** no cambian la planta, solo el `layout` (posiciones). **"Tu rediseño"** sí puede cambiar la bodega (paredes, zonas, portones, máquinas) y se guarda como `{ plant, positions }` aparte; la planta de hoy nunca se toca.

---

## 8. Backend, archivo por archivo

### 8.1 `main.py`: la API

Crea la app FastAPI, habilita CORS abierto (es una app local) e instancia las dos IAs.

| Método | Ruta | Recibe | Devuelve | Para qué |
|---|---|---|---|---|
| GET | `/api/health` | — | Estado del extractor y del ingeniero (proveedor, modelo, en línea, listo) | Indicador "IA lista" |
| GET | `/api/catalog` | — | Tipos de estación, tipos de zona, supuestos, listas de áreas sucias y limpias | Editor y supuestos |
| GET | `/api/example` | — | La planta de ejemplo (taller de vidrio) | Botón "Cargar el taller de vidrio" |
| POST | `/api/story` | `{ text }` | `plant`, `assumptions`, `source` (ia/reglas), `notes`, `ai_assumptions`, `rules`, `error`, `extracted` | Leer la historia |
| POST | `/api/context/organize` | `{ text }` (1–8000 caracteres) | `proposals`, `master` (`draft`), `errors` por especialista | Diez especialistas por tema y un consolidador preparan contexto revisable; requiere proveedor listo |
| POST | `/api/routes` | `{ plant, positions }` | `legs`, `piece_m`, `blocked_legs`, `avoid_hits` | Recorridos en vivo del editor (sin supuestos) |
| POST | `/api/evaluate` | `{ plant, positions, rebalance }` | Todas las métricas + `ops_moves` | Métricas de "Tu rediseño" |
| GET | `/api/capabilities` | — | `{ schema_version: 3, features, vision }` | El frontend muestra solo lo que el backend anuncia |
| POST | `/api/analyze` | `{ plant, context?, weights? }` | `current`, `alternatives` (4), `recommended`, `ideal`, `relations`, `comparison`, `plant_version`, `context_version`, `main_metric`, `recommended_reason`, `recommended_tradeoffs`, `weights_used`; por alternativa `method`, `assumptions`, `scores`, `kind`, `sensitivity`, `locked_respected`, `flows` | Al guardar el plano o recalcular con otros pesos |
| POST | `/api/report` | `{ plant, analysis, redesign, context?, with_validation? }` | Texto en **streaming**, validado oración por oración; con `with_validation` termina con `\u001e{"validation": …}` | Informe del ingeniero / conclusiones del PDF |
| POST | `/api/chat` | `{ messages, context, with_validation? }` | Texto en **streaming**, validado | Chat con el ingeniero |
| POST | `/api/missions` | `{ plant, analysis, redesign }` | `{ source, missions[3] }` (sin cifras inventadas) | Misiones del taller gamificado |
| POST | `/api/plan/ops` | `{ instruction, plant }` | `{ ops, rejected, notes }` (nunca el plano) | Asistente del editor |
| POST | `/api/simulate` | `{ plant, alternative?, replicas?, seed?, positions? }` | `{ seed, replicas, kpis, bottleneck, notes }` con P10, mediana y P90 | Simulación con variabilidad |
| POST | `/api/references/read` | `{ image, note }` | Descripción de la imagen, o 422 si el proveedor no tiene visión | Referencias con imagen |

`features` hoy: `report_validation`, `segmented_context`, `count`, `locked`, `plan_ops`, `weights`, `flows`, `conveyors`, `simulate`, `context_agents`. El contrato completo está en [coordinacion/CONTRATO-v3.md](coordinacion/CONTRATO-v3.md). El JSON maestro de `/api/context/organize` es un borrador que no modifica el plano; cada propuesta requiere revisión. Si la IA de contexto no está lista, la interfaz usa la clasificación local por palabras clave e informa esa limitación.

**Validación del informe (`cauce/validate.py`).** Cada oración del informe y del chat se revisa antes de mostrarse: si cita una cifra que no está en `facts()` (con tolerancia de redondeo) o elogia una alternativa que el motor muestra peor que hoy, se descarta y queda en `validation.discarded`.

**Textos del ingeniero.** La función `facts()` convierte la planta y el análisis en un resumen en texto plano ("Hoy una pieza recorre 120 m…", "Cuello de botella: Pulidora al 101 %…"). Ese resumen es lo **único** que ve la IA ingeniera, así no puede inventar cifras. El prompt `REPORT_SYSTEM` pide: un párrafo de diagnóstico, uno del rediseño y tres acciones para la semana, máximo 220 palabras, sin emojis.

**Respaldos sin IA.** `stream_or_fallback()` intenta el streaming del modelo; si falla, emite un texto de respaldo palabra por palabra (para que se vea igual que la IA escribiendo). Hay respaldo para el informe (`fallback_report`), para el chat y para las misiones (`fallback_missions`).

**Contexto del chat.** El historial se recorta a los últimos 12 mensajes.

### 8.2 `cauce/catalog.py`: tipos y supuestos

- **24 tipos de estación**: recepción, despacho, almacén en estantes, almacén en piso, mesa de corte, sierra, CNC, torno, prensa o troquel, soldadura, pulido o lijado, cabina de pintura, horno, lavado, secado, mesa de trabajo, ensamble, costura, mezcla o tanques, banda transportadora, grúa o polipasto, inspección, empaque y "otro proceso".
  Cada uno define: nombre por defecto, ancho y fondo, minutos por pieza sugeridos, operarios sugeridos y **palabras clave** (raíces como `"cort"`, `"sold"`, `"lij"`) para reconocerlo en una historia.
- **4 tipos de zona**: oficina, baños, comedor y zona bloqueada. Por las zonas no pasa el material.
- **Áreas sucias y limpias**: `DIRTY = {pintura, soldadura, pulido, sierra, horno, prensa}` (polvo, ruido o calor) y `CLEAN = {empaque, inspección, oficina, comedor}`. Se usan en la tabla de relaciones y en los avisos.
- **9 supuestos** con su valor por defecto y su porqué:

| Clave | Supuesto | Unidad | Por defecto |
|---|---|---|---|
| `demand` | Producción | piezas al día | 60 |
| `shift_min` | Jornada | minutos | 480 |
| `efficiency` | Eficiencia | fracción | 0.82 |
| `batch` | Lote por viaje | piezas | 4 |
| `speed` | Velocidad con carro | m/min | 30 |
| `load_min` | Carga al camión | min/pieza | 1.0 |
| `trucks` | Camiones al día | salidas | 2 |
| `truck_setup` | Alistamiento por camión | minutos | 12 |
| `cv2` | Variabilidad | coeficiente | 1.0 |

El **tipo** de una estación solo decide su maqueta 3D, su tamaño inicial y los minutos sugeridos. El **nombre** es libre.

### 8.3 `cauce/providers/`: las dos IAs

- **`base.py`** define la interfaz `Provider` que cualquier proveedor debe cumplir:
  - `status()` → ¿está en línea?, ¿el modelo está descargado?
  - `json(system, prompt, schema)` → respuesta estructurada (dict).
  - `stream(messages)` → generador asíncrono de fragmentos de texto.
- **`ollama.py`** implementa esa interfaz contra la API local de Ollama (`/api/tags`, `/api/chat`). Para el JSON usa el parámetro `format` con el **esquema JSON** (Ollama obliga al modelo a respetarlo), límite de 900 tokens y `keep_alive` de 30 min para que el modelo no se descargue entre llamadas.
- **`__init__.py`** es la fábrica: `get_extractor()` (temperatura 0, 300 s de espera), `get_engineer()` (temperatura 0.5) y `get_spatial()` (temperatura 0, 600 s), según las variables de entorno. Todos con `llama3.1:8b` por defecto.

**Agregar otro proveedor** (una API en la nube, un servidor MCP, etc.): crear una clase con esos tres métodos y añadir una rama en `_make()`. Nada más del código cambia.

### 8.4 `cauce/story.py`: de la historia a la planta

Es la parte que convierte un relato libre en una planta editable. Combina **dos lecturas**:

**A. Reglas (`by_rules`)** — siempre se ejecutan, con o sin IA:

1. Normaliza el texto: minúsculas y sin tildes.
2. Convierte números escritos con letra a cifras ("doce" → 12, "media docena" → 6).
3. Busca las palabras clave del catálogo **al inicio de una palabra** (así "carpintería" no se confunde con "pint").
4. Detecta personas ("12 operarios", "éramos 15"), vehículos ("2 camionetas", "4 rutas") y producción con su periodo ("8 muebles por semana", "40 piezas al día").
5. Ordena: recepción primero, despacho al final, lo demás en el orden en que se cuenta.

**B. IA extractora** — recibe `STORY_SYSTEM` (instrucciones estrictas) y `STORY_SCHEMA` (esquema JSON con `negocio`, `producto`, `estaciones`, `flujo`, `operarios`, `produccion`, `periodo`, `camiones_al_dia`, `problemas`, `supuestos`).

**C. Combinación y validación (`build_plant`)**:

| Paso | Qué hace |
|---|---|
| Filtrar estaciones | Descarta lo que **no es estación** (portones, puertas, carros, pasillos, patio) y lo que es zona (oficina, baños). |
| Validar contra el texto | Cada estación de la IA debe aparecer en la historia (por raíz de su nombre o palabra clave de su tipo). Si no, se descarta y se avisa: *"No incluí lo que la historia no menciona: …"*. |
| Corregir el tipo | Si el nombre contiene una palabra clave, ese tipo manda sobre el que dijo la IA. |
| Completar | Lo que las reglas encontraron y la IA no, se agrega. |
| Flujo | Se usa el de la IA solo si es coherente: las rutas que **regresan** a una estación anterior se descartan (casi siempre son errores de lectura). Las estaciones sueltas se encadenan en orden. |
| Números | Para producción, camiones y personas se prefiere lo que dicen las reglas (sale literal de la historia) y luego lo de la IA, siempre dentro de rangos razonables. La producción semanal se divide entre 5 y la mensual entre 22. |
| Personas | Se reparten 1 por estación empezando por las más lentas; las sobrantes, en ronda. |
| Bodega | El tamaño se estima como 3,2 veces el área de máquinas y zonas (mínimo 300 m²), en proporción 2:1. Se crean dos portones (A entra, B sale). |
| Acomodo inicial | `initial_layout()` coloca las estaciones en filas siguiendo el flujo. **No pretende ser la planta real**: el usuario la corrige. |

Si no se reconoce nada, se crea una sola caja genérica "Proceso 1" para empezar a dibujar. Todo empieza con `use_assumptions: false`.

### 8.5 `cauce/engine.py`: el motor de ingeniería

Todo es determinista y trazable.

**Rutas por pasillos.**

- La bodega se discretiza en una **malla de 0,5 m**.
- Se bloquean las celdas ocupadas por máquinas y zonas (con 0,25 m de holgura) y las que tocan paredes (paredes de 0,3 m de grosor, en cualquier ángulo).
- Se busca la ruta más corta con **A*** (distancia rectilínea como guía, así sigue siendo la más corta) en 4 direcciones, con un **castigo de 1 m por cada giro** (prefiere pasillos rectos, como camina la gente con un carro).
- Ningún paso puede **cruzar una pared**, ni siquiera saliendo de una máquina (prueba de intersección de segmentos).
- La ruta se simplifica a sus esquinas. Si no hay paso, se usa una L recta y la ruta se marca como bloqueada (`ok: false`, se dibuja punteada fina).
- Lo que no cambia entre rutas de la misma planta (celdas fuera del contorno o pegadas a paredes y los pasos que cruzan una pared) se calcula **una sola vez** por forma y paredes (`_base_grid`). Antes se revisaban todas las paredes en cada paso: con una forma propia y paredes el análisis tardaba ~10 s; ahora menos de 1 s.
- Los resultados se guardan en caché (`lru_cache` de 16 384 entradas), así el editor recalcula rápido.
- Los endpoints de cálculo (`/api/routes`, `/api/evaluate`, `/api/analyze`) son funciones normales: FastAPI los corre en otro hilo y el servidor sigue atendiendo el chat mientras calcula.

**Métricas sin supuestos** (`evaluate` con `use_assumptions: false`):

- `legs`: cada ruta con su trazo, distancia y metros ponderados.
- `piece_m`: metros que recorre **una pieza** (suma de distancia × fracción).
- `blocked_legs`: rutas sin paso libre.
- `avoid_hits`: áreas sucias a menos de 4 m de áreas limpias.

**Métricas con supuestos** — además: viajes al día por ruta, metros al día, carga y capacidad por estación, cuello de botella, tiempo de fabricación desglosado y minutos de carga de camiones. Ver [Fórmulas](#13-fórmulas-de-ingeniería).

**Reparto de operarios (`rebalance_ops`).** Con las mismas personas, asigna una a cada estación que trabaja y luego va sumando una persona al cuello de botella de turno, recalculando cada vez. Así las alternativas muestran "las mismas personas, mejor repartidas".

**Tabla de relaciones (`relations`)**, al estilo SLP (*Systematic Layout Planning*). Para cada par de áreas:

| Letra | Significado | Cuándo |
|---|---|---|
| **A** | Absolutamente necesaria | El flujo directo entre ellas es ≥ 60 % del flujo mayor |
| **E** | Especialmente importante | ≥ 30 % |
| **I** | Importante | Flujo menor, u oficina ↔ despacho (remisiones y facturas) |
| **O** | Ordinaria | Oficina ↔ recepción (verificar lo que llega) |
| **U** | Sin importancia | Sin relación directa |
| **X** | No deben estar juntas | Un área sucia junto a una limpia |

No depende de supuestos.

**Comparación (`compare`).** Para `piece_m`, `daily_m`, `capacity`, `lead_h` y `loading_min` devuelve antes, después y el cambio en %.

### 8.6 `cauce/layout.py`: acomodos y alternativas

**Factibilidad (`feasible`).** Una máquina cabe si:

- queda a ≥ 0,4 m de los muros de la bodega,
- a ≥ 0,8 m de cualquier zona,
- no toca ninguna pared interior (se muestrea la pared cada 0,25 m),
- deja un pasillo de ≥ 1,2 m con las demás máquinas.

`nearest_free()` busca el lugar factible más cercano a un punto, probando las dos orientaciones.

**Orden del flujo (`flow_order` → `flows.ordered`).** Ordenamiento topológico sobre las componentes fuertemente conexas (Tarjan) del flujo de material, sin las rutas marcadas `is_return`; los empates respetan el orden de la lista. Un ciclo (por ejemplo pruebas → configuración) ya no manda sus estaciones al final: queda en su lugar del proceso. Sin ciclos da el mismo orden que el Kahn de antes.

**Flujos y bandas (`cauce/flows.py`).** Cada ruta tiene `flow`: `material` (por defecto), `personas`, `vehiculos` o `carga`. Las métricas de siempre (`piece_m`, `daily_m`, capacidad, tiempo) son solo del material; cada flujo tiene sus metros en `flows` y las alternativas traen `flows` por flujo. En el costo de búsqueda pesan material y carga 1, vehículos 0,5 y personas 0,3. `cycles` lista los ciclos del material (con retornos). Una ruta con `conveyor` va por la banda: su distancia es la banda más la carga y descarga, nadie camina el tramo en banda (no suma a `daily_m`), su tiempo usa `speed_mpm` y `conveyor_load` compara las piezas por minuto con `capacity_ppm`.

**Costo de búsqueda (`search_cost`).** Para comparar acomodos rápido sin trazar rutas: distancia rectilínea ponderada por el flujo + 40 de castigo por cada área sucia a menos de 8 m de una limpia + distancia de recepción y despacho a sus portones.

**Las cuatro alternativas** (cada una declara `method` y `assumptions`):

| Id | Nombre | Método | Cómo se construye | Obra |
|---|---|---|---|---|
| `u` | **Flujo en U** | `linea` | Traza una U del ancho justo para las máquinas, centrada entre el portón de entrada y el de salida; coloca las estaciones en orden por ese trazo con el lado largo siguiendo la dirección. Recepción y despacho quedan junto a sus portones. | Mover máquinas al perímetro |
| `i` | **Línea recta** | `linea` | Una fila por el centro en el orden del proceso; si no cabe, sigue en una segunda fila (forma de S). | Mover máquinas al centro |
| `keep` | **Reordenar en su lugar** | `craft` | CRAFT: las máquinas **intercambian sus lugares actuales** por pares y, cuando ya no mejora, en rotaciones de tres (probando las orientaciones) mientras baje el costo de manejo. Si por las rutas reales caminara más que hoy, se queda como hoy: nunca es peor. | Ninguna |
| `slp` | **Por bloques (SLP)** | `slp` | Las áreas con relación A o E forman un bloque; los bloques siguen el orden del flujo y se empacan desde la esquina de menor costo. | Mover máquinas por grupos |

Para la U y la línea, `improve_order()` intenta además intercambiar estaciones vecinas en el orden mientras baje el costo.

Ninguna alternativa abre portones, mueve paredes ni cruza zonas, y ninguna mueve lo que el usuario fijó (`locked`): cada una trae `locked_respected` y, si algo no cabe, `infeasible` con el fijo que lo impide.

**Recomendación multicriterio.** Cada alternativa (y hoy, como referencia) recibe un puntaje de 0 a 1 por criterio, donde 1 es lo mejor entre las opciones (`scores`):

| Criterio | Peso por defecto | Se mide con | Puntaje |
|---|---|---|---|
| `manejo` | 0,25 | m al día (con supuestos) o m por pieza | menor / valor |
| `lead_time` | 0,20 | horas por pieza | menor / valor |
| `capacidad` | 0,15 | piezas al día | valor / mayor |
| `obra` | 0,15 | estaciones que cambian de lugar y obra | 1 − movidas / total − 0,25 × obra |
| `seguridad` | 0,15 | áreas sucias junto a limpias | 1 / (1 + avisos) |
| `flexibilidad` | 0,10 | área libre de la planta | libre / mayor libre |

El total es la suma ponderada con los pesos (`weights` en la petición; se validan y se normalizan para que sumen 1; la respuesta trae `weights_used`). Un criterio sin datos (por ejemplo tiempos sin supuestos) no cuenta y su peso se reparte. Más metros nunca dan mejor puntaje de manejo. La **recomendada** es la de mayor total entre las viables (respetan lo fijo y caben); `ideal` es la mejor técnica sin contar obra ni fijos. `sensitivity` dice si la recomendada sería la misma al multiplicar cada peso por 0,5 o por 2. `recommended_reason` y `recommended_tradeoffs` explican la elección y lo que empeora frente a hoy.

El campo `score` de antes (menor es mejor) se sigue enviando por compatibilidad, pero ya no decide la recomendación.

### 8.7 `cauce/plant.py`: la planta de ejemplo

El **taller de vidrio** del caso de referencia: bodega de 44 × 22 m, 9 estaciones (recepción de láminas, almacén, corte, recorte, pulidora, sandblasting, lavadora, empaque, despacho), oficina y baños, 78 piezas al día y 3 camiones. El 35 % de las piezas pasa por sandblasting y el 65 % va directo a lavado. Su acomodo reproduce el desorden del caso (el material cruza la bodega varias veces).

---

## 9. Frontend, archivo por archivo

### 9.1 Tecnologías

| Librería | Uso |
|---|---|
| **React 19** | Interfaz (componentes de función y hooks; `ref` como prop) |
| **Vite 8** | Servidor de desarrollo y compilación |
| **three.js** | Escena 3D (con `OrbitControls`) |
| **motion** | Animaciones de interfaz (transiciones, resortes, apariciones) |
| **@fontsource-variable/archivo** | Tipografía Archivo con eje de anchura |
| **oxlint** | Linter rápido con reglas de hooks |

No hay librería de gráficos ni de estado: los gráficos son SVG hechos a mano y el estado vive en un solo hook.

### 9.2 `App.jsx`: el esqueleto

- **Barra lateral (rail)** con el logotipo, los 7 pasos numerados (el último, "+", es el extra), una línea de progreso que se llena, el indicador de IA y el botón del chat.
- **Habilitación de pasos:** el 1 siempre; del 2 al 5 cuando hay planta guardada y análisis; el 6 (Resumen) solo después de imprimir el reporte; el extra cuando hay análisis.
- **Acciones principales:** `read` (leer la historia), `blank` (plano vacío), `example` (taller de vidrio), `save` (analizar y pasar al 3D), `restart` (borrar todo, con confirmación).
- **Contexto para la IA (`slim`)**: una versión reducida de la planta y las métricas, sin los trazos de las rutas, para no mandar datos innecesarios al ingeniero.
- **Informe compartido:** `useReport` vive aquí para que el informe no se pierda al cambiar de paso; se invalida cuando cambia lo que describe (`version`).
- Al guardar un plano nuevo se reinician el rediseño, el reporte y el juego.

### 9.3 `project.js`: el estado guardado

Cada proyecto tiene su propio objeto con `text` (historia), `info` (lo que entendió la lectura), `draft` (planta en edición), `plant` (planta guardada), `analysis`, `redesign`, `context`, `contextWorkspace`, `printed`, `game` y `maxStep`.

- `useProject()` administra la colección local, migra el proyecto anterior sin borrarlo y mantiene aisladas las respuestas asíncronas de cada proyecto. Si el almacenamiento está bloqueado o lleno, se sigue trabajando en memoria sin persistencia.
- En **Mis proyectos** se puede crear o abrir un proyecto y borrar solo el contexto del activo. Esta última operación conserva su plano y borra también los originales de sus adjuntos en IndexedDB.
- `blankPlant()` crea una bodega vacía de 30 × 16 m con dos portones.
- `customOf()` y `chosen()` resuelven qué rediseño está elegido (una alternativa o "Tu rediseño"), y mantienen compatibilidad con proyectos viejos que guardaban solo posiciones.

### 9.4 `api.js`

- `api.*`: una función por ruta del backend.
- `stream()`: lee una respuesta en streaming con `ReadableStream` y entrega cada fragmento.
- `fmt()`: formatea números al estilo `es-CO` (1.234,5) y muestra "—" si no hay valor.
- `pct()`: cambio porcentual entre dos valores.

### 9.5 Gráficos (`charts/`)

| Gráfico | Qué muestra |
|---|---|
| **FlowPlan** | Plano desde arriba con cada ruta en su trazo real por pasillos, flecha de dirección y grosor proporcional a los metros que suma. Resalta el cuello de botella. |
| **RelChart** | Matriz triangular de relaciones A-E-I-O-U-X con el motivo de cada celda en un tooltip. |
| **LoadChart** | Una barra por estación: carga frente a capacidad. La línea punteada es el 100 %; lo que la pasa es el cuello de botella. |
| **LeadChart** | Barra apilada del tiempo de una pieza: trabajo en máquina, espera en cola, espera de lote y transporte; hoy frente a la propuesta. |
| **Tip** | Tooltip compartido (`useTip`) que siguen todos los gráficos. |

### 9.6 Reporte (`report/ReportDoc.jsx`)

Documento A4 que **se ve igual en pantalla y en el PDF**. Secciones:

1. Encabezado con marca, fecha y nombre de la planta.
2. **Resumen**: tabla antes / después / cambio (recorrido; y con supuestos: metros al día, capacidad, tiempo, camiones).
3. **Planos** de hoy y del rediseño lado a lado.
4. **Qué se mueve**: cada estación que cambia de lugar, cuántos metros y, si "Tu rediseño" cambió la bodega, qué obra implica.
5. **Rutas del material**: distancia de cada ruta antes y después.
6. **Cercanía entre áreas** (tabla de relaciones).
7. **Supuestos usados** (si los hay).
8. **Conclusiones del ingeniero** (texto de la IA o lista de respaldo).

Para el PDF, `Report.jsx` monta una copia del documento en `document.body` (con un *portal*) que solo se ve al imprimir; las reglas `@media print` ocultan la app y quitan los márgenes de página (así el navegador no agrega fecha ni dirección). Al cerrar el diálogo de imprimir (`afterprint`) se marca el reporte como impreso y se pasa al Resumen.

### 9.7 Chat e informe (`components/`)

- **EngineerChat**: chat en streaming con el ingeniero. Funciona como panel lateral (botón de la barra, se cierra con Esc) o dentro de la página (paso Resumen). Ofrece tres preguntas sugeridas, una de ellas sobre el cuello de botella si existe.
- **useReport**: hook que pide `/api/report` en streaming, permite cancelar y reescribir, y se reinicia cuando cambia el análisis o el rediseño elegido.

---

## 10. Los pasos de la aplicación

### Paso 1 · Historia y plano (`Story.jsx`)

- **Área de texto** para describir la planta y el proceso.
- **Dictado por voz** (botón "Dictar") con la API de reconocimiento de voz del navegador en español (`es-CO`); solo aparece si el navegador la soporta (Chrome, Edge).
- Tres formas de empezar:
  - **Analizar** (activo en cuanto hay texto). Muestra el tiempo transcurrido, una barra con el avance estimado y un minijuego mientras se espera.
  - **Dibujar desde cero**: bodega vacía.
  - **Cargar el taller de vidrio**: la planta de ejemplo.
- **"Tu proceso · Resultado del análisis"**: chips con las estaciones y zonas encontradas y notas redactadas como descripción del análisis, nunca en primera persona (hallazgos, lo que se descartó, conversiones de producción semanal o mensual). Las instrucciones a la IA piden voz impersonal y `impersonal()` en `story.py` corrige las frases en primera persona que se escapen.
- **Editor 2D** completo (ver [sección 11](#11-el-editor-2d)).
- **Supuestos para calcular** (interruptor):
  - *Apagado*: solo recorridos y cercanías.
  - *Encendido*: se editan los 9 supuestos (marcados según vengan de la historia, de la IA o sean supuestos) y una tabla de **minutos por pieza y operarios por estación**. Con 0 operarios y minutos > 0 la estación se toma como máquina automática.
- **Guardar y ver en 3D**: llama a `/api/analyze` y pasa al paso 2.

### Paso 2 · Tu planta en 3D (`Plant.jsx`)

- La planta guardada en 3D, **solo lectura** (para cambiarla se vuelve al paso 1 con "Editar plano").
- Vista 3D o desde arriba; clic en una máquina para enfocarla.
- **"Lo que veo"**: tamaño de la bodega, número de estaciones, rutas y zonas, metros por pieza, rutas bloqueadas, avisos de áreas sucias junto a limpias y notas de la lectura.
- **Foto aérea opcional**: arrastrar o elegir una imagen para compararla con el modelo. No sale del navegador.

### Paso 3 · Diagnóstico (`Diagnosis.jsx`)

- **Sin supuestos**: titular con los metros que recorre una pieza, plano del recorrido (FlowPlan) y tabla de relaciones (RelChart).
- **Con supuestos**, además:
  - Titular con el **cuello de botella** y su % de uso.
  - 4 indicadores animados: metros al día, capacidad, tiempo por pieza y carga de camiones.
  - Carga frente a capacidad (LoadChart) y desglose del tiempo (LeadChart).
  - **Informe del ingeniero** escrito por la IA en vivo, con botón para reescribirlo.
- **"Cómo se calculó"**: explicación desplegable del método.

### Paso 4 · Rediseño (`Redesign.jsx`)

- **Tarjetas** con las 3 alternativas (y "Tu rediseño" si existe): metros por pieza, % frente a hoy, resumen y obra necesaria. Una lleva la etiqueta **RECOMENDADA**; la propia, **TUYA**.
- Al picar una, **las máquinas se mueven animadas en 3D** a su nuevo lugar. El botón **"Estado original"** regresa a la planta de hoy (y vuelve a alternar).
- **Editor del rediseño** (completo): al primer cambio se guarda como «Tu rediseño» a partir de la opción elegida, con su propia bodega. La escena 3D sigue al editor en vivo.
- **Indicadores de cambio** (Delta): % y barras antes/después.
- **Planos lado a lado** (hoy y propuesta).
- Con supuestos: desglose del tiempo antes/después y **cambios de operarios** (puntos que representan personas), con el nuevo cuello de botella.
- Avisos si alguna área sucia queda junto a una limpia.

### Paso 5 · Reporte (`Report.jsx`)

- Vista previa del documento A4.
- **Descargar PDF** abre el diálogo de imprimir del navegador; ahí se elige "Guardar como PDF".
- Mientras la IA escribe las conclusiones se puede esperar o descargar sin ellas; también **reescribirlas**.

### Paso 6 · Resumen (`Summary.jsx`)

- El % de recorrido ahorrado en grande, con la marca en U.
- **Lo que cambia**: metros por pieza, cuántas estaciones se mueven y, con supuestos, capacidad, tiempo y camiones antes → después.
- Botones para ver el reporte de nuevo, ir al taller de mejora o **empezar otra planta**.
- El **chat del ingeniero** dentro de la página.

### Extra · Taller de mejora (`Workshop.jsx`)

La capa de gamificación, pensada para llevar la mejora al piso de planta:

- **Puntos** = puntos de misiones cumplidas + 150 por haber elegido un rediseño + 5 por cada % de recorrido ahorrado.
- **4 niveles**: Taller desordenado (0) → Taller en marcha (150) → Flujo ordenado (350) → Maestro del flujo (600). Al subir aparece un aviso.
- **3 misiones** por equipo, propuestas por la IA a partir de los datos de la planta (o de una lista fija si no responde), con puntos de 50 a 150 y turno.
- **Tablero por turno**: compiten los equipos, no las personas.
- **6 insignias**: Primer plano, Recorrido corto (≥ 25 % ahorrado), Maestro del flujo (hacer tu propio rediseño), Equipo en marcha (2 misiones), Cero desperdicios (todas las misiones) y Equipo completo (600 puntos).

---

## 11. El editor 2D

`PlanEditor.jsx` es un lienzo SVG en metros (1 unidad = 1 m) con cuadrícula de 1 m. Lo que se dibuja y se mueve se ajusta a la **precisión** elegida en la barra (1 m, 50 cm, 25 cm o 10 cm; 50 cm por defecto). La **rueda** del mouse acerca y aleja sobre el puntero; arrastrar el fondo (o el botón central) mueve la vista, y el botón de centrar vuelve a ver toda la planta. Deshacer, rehacer, acercar, alejar y centrar están **dentro del plano**, arriba a la derecha (como en la vista 3D), y «Reiniciar plano» arriba a la izquierda. Abajo del lienzo se ven las coordenadas del puntero.

### Herramientas

| Herramienta | Tecla | Uso |
|---|---|---|
| **Mover** | `V` | Seleccionar y arrastrar máquinas, zonas, paredes y portones |
| **Máquina** | `M` | Elegir el tipo y hacer clic en el plano para agregarla |
| **Ruta** | `T` | Clic en la máquina de origen y luego en la de destino; se siguen encadenando. `Esc` termina |
| **Pared** | `P` | Arrastrar para dibujar una pared interior. Se pega a esquinas, extremos de paredes y muros cercanos (imán) y se ajusta a 45°; con `Alt` queda libre. Muestra el largo mientras se dibuja |
| **Zona** | `Z` | Elegir el tipo (oficina, baños, comedor, bloqueada) y arrastrar un rectángulo |
| **Portón** | `O` | Clic cerca de cualquier muro exterior para agregar un portón |
| **Forma** | `F` | El edificio se arma **con piezas, como en TinkerCAD**: rectángulo, cuadrado, L, U, T, triángulo, círculo o una pieza **a mano** (esquina por esquina, con largos exactos tecleados). Cada pieza es **sólida** (suma) o **hueco** (recorta una sección, también intermedia). Agregar una pieza no reinicia nada: se suma a lo que ya hay. Cada pieza se mueve, se estira con sus manijas (esquinas y lados) y se gira con el círculo de arriba (de 15 en 15°; con `Alt`, libre), sin tocar las demás |

### Atajos generales

| Atajo | Acción |
|---|---|
| `Ctrl+Z` | Deshacer (hasta 100 pasos) |
| `Ctrl+Y` o `Ctrl+Shift+Z` | Rehacer |
| `Supr` / `Retroceso` | Quitar lo seleccionado |
| `R` | Girar la máquina seleccionada 90° |
| Flechas | Mover lo seleccionado (máquina, zona, pared o pieza del edificio) un paso de la precisión; con `Shift`, diez pasos |
| `R` sobre una pieza | Girarla 90° |
| `Ctrl+D` | Duplicar lo seleccionado (también piezas del edificio) |
| `Esc` | Cancelar, deseleccionar y volver a Mover |

El editor debe tener el foco (clic en él) para que funcionen las teclas.

### Inspector (panel lateral)

Cambia según lo seleccionado:

- **Máquina**: nombre, tipo (cambia la maqueta 3D), ancho, fondo, **centro X y Z exactos**, girar, de dónde le llega material y a dónde lo manda (enlaces a esas rutas).
- **Ruta**: origen, destino, **% de piezas** que pasan por ahí, **invertir dirección**, distancia real calculada.
- **Zona**: nombre, tipo, ancho, fondo y centro X y Z. Al seleccionarla aparecen manijas en las esquinas para cambiar su tamaño.
- **Pared**: largo exacto, coordenadas de inicio y final, **dividir en dos** (para borrar solo un tramo) y quitar. Sus extremos se arrastran por separado.
- **Forma sin nada seleccionado**: elegir sólido o hueco, las formas para agregar (clic en la forma y luego en el plano) y la lista de piezas.
- **Pieza del edificio**: sólido o hueco, ancho, fondo, centro X y Z, giro, girar 90°, duplicar y quitar. En las piezas a mano, cada esquina se arrastra o se escribe con X y Z; doble clic en un lado agrega una y doble clic en una esquina la quita. Avisa si una pieza quedó suelta (solo cuenta la parte más grande) o si un hueco quedó encerrado (no se puede representar).
- **Portón**: nombre y si es **de entrada**, **de salida** o ambos.
- **Nada seleccionado**: nombre de la planta y medidas de la bodega. Avisa si alguna máquina quedó fuera del contorno.

Las piezas se guardan en `plant.parts`; el contorno (`plant.outline`) es su suma, calculada con [`polygon-clipping`](https://github.com/mfogel/polygon-clipping) en `composeParts()` de `geometry.js`. El backend solo usa el contorno. Una planta sin piezas (vieja o leída por la IA) se toma como una sola pieza.

### Detalles de implementación

- Cada cambio pide a `/api/routes` los recorridos reales (con 220 ms de espera para no saturar), y el editor muestra en vivo "Una pieza recorre X m".
- Mientras llega la respuesta, las rutas se dibujan con una L provisional.
- El paso de deshacer se guarda **al empezar a arrastrar**, no con un simple clic; los campos de texto confirman al salir o con Enter, así cada letra no es un paso de deshacer.
- Las rutas parciales (`frac < 1`) se ven punteadas; las bloqueadas, con punteado fino.
- Los portones de entrada y salida se pintan en negro con su papel ("entra", "sale", "entra y sale").

---

## 12. La escena 3D

### `PlantView.jsx`

Envoltura de React. Crea la escena una sola vez, la **reconstruye** cuando cambia la planta y aplica aparte los "extras" (operarios, camiones, cuello de botella) para no reconstruir todo. Expone por `ref`: `setLayout` (mover máquinas, animado o no), `applyExtras`, `focus` y `setView`. Trae los botones "Vista 3D / Desde arriba", la leyenda y una pista de uso.

### `PlantScene.js`

- **Render**: WebGL con sombras suaves, tono fílmico ACES, niebla y luz hemisférica + sol con sombra de 2048 px.
- **Cámara**: perspectiva con `OrbitControls` (amortiguada, sin bajar del piso, zoom entre 14 y 120 m). Vista cenital disponible. Al reconstruir, la cámara se queda donde estaba.
- **Construcción**: piso con textura generada en un `canvas` (manchas y líneas cada 2 m), muros, portones, calle, árboles, zonas, máquinas con etiqueta y paredes interiores.
- **Flujo del material**: cada ruta es una cinta con flechas y **partículas que viajan** por el trazo real. El grosor depende de los viajes al día (o de la fracción, sin supuestos). Las rutas parciales son punteadas.
- **Extras**: camiones en el portón de salida, una camioneta en el de entrada si es distinto, **personas** frente a cada estación (según operarios) y un anillo pulsante en el **cuello de botella**.
- **Animaciones**: al cambiar de layout, cada máquina se desplaza con una curva suave y un pequeño "salto"; las rutas se redibujan.
- **Interacción**: al pasar el mouse sobre una máquina el cursor muestra su nombre; al hacer clic, la cámara la enfoca.
- **Rendimiento**: deja de animar cuando la escena no está en pantalla (`IntersectionObserver`) y se adapta al tamaño (`ResizeObserver`). `dispose()` libera todo al desmontar.

### `models.js`

Maquetas hechas con primitivas de three.js (cajas, cilindros, planos), en una paleta de grises:

| Tipo | Maqueta |
|---|---|
| recepción / despacho | Área de entrada / área de salida con carga |
| almacén / almacén en piso | Estantería con cajas / tarimas en el piso |
| corte | Mesa grande con pórtico |
| sierra, CNC, torno, prensa | Una maqueta propia para cada una, reconocible por su silueta |
| soldadura, horno, secado | Una maqueta propia para cada una |
| pulido | Máquina con cuerpo central y transportadores de entrada y salida |
| pintura | Cabina cerrada con extractor |
| lavado | Túnel de paso con rodillos a los lados |
| mesa, ensamble, costura | Bancos de trabajo con distinta disposición |
| mezcla, banda, grúa, inspección, empaque | Tanques, banda transportadora, polipasto, mesa de revisión, mesa de empaque con cajas |
| oficina, baños, comedor | Escritorios, cubículos y mesas |
| zona bloqueada | Piso rayado |
| **otro** o tipo desconocido | **Caja gris con huecos de entrada y salida** |

También: carro, operario, camión (plano o de caja), grúa de columna y árbol. `TALL` guarda la altura de cada maqueta para colocar su etiqueta encima.

---

## 13. Fórmulas de ingeniería

Todas están en [backend/cauce/engine.py](backend/cauce/engine.py). Notación: `D` = producción al día, `b` = lote, `v` = velocidad con carro, `f` = fracción de piezas de una ruta, `d` = distancia de la ruta.

### Recorrido

```
metros por pieza   = Σ (f × d)                         por cada ruta
viajes al día      = D × f / b                          por cada ruta
metros al día      = Σ (viajes × d)
```

### Carga y capacidad por estación

```
minutos útiles     = jornada × eficiencia               (por persona)
manejo             = Σ viajes × 2 × d / v               (ida y vuelta, se carga a la estación de origen)
carga (min/día)    = D × participación × t + manejo
servidores         = operarios, o 1 si es automática (operarios = 0 y t > 0)
utilización        = carga / (servidores × minutos útiles)
capacidad          = servidores × minutos útiles / (carga / D)
```

- **Participación**: fracción de las piezas que pasa por la estación (suma de las rutas que llegan, máximo 1).
- **Cuello de botella**: la estación con mayor utilización. La **capacidad de la planta** es la menor de todas.

### Tiempo de fabricación de una pieza

```
tiempo = proceso + cola + espera de lote + transporte

proceso            = Σ t × participación
cola               = Σ Wq × participación                (aproximación de Sakasegawa)
espera de lote     = Σ (b − 1) / 2 × takt × min(1, f)    takt = minutos útiles / D
transporte         = Σ f × d / v
```

**Sakasegawa** (espera en cola para `c` servidores con utilización `ρ`, tope 0,985):

```
Wq = (cv² + cv²)/2 × ρ^(√(2(c+1)) − 1) / (c × (1 − ρ)) × te
```

donde `te` es el tiempo efectivo por pieza en esa estación y `cv²` la variabilidad (supuesto).

### Carga de camiones

```
distancia al camión = ruta por pasillos desde el despacho hasta el portón de salida
carga (min/día)     = camiones × alistamiento + D × (min de carga por pieza + 2 × distancia / v)
```

### Avisos de cercanía

Un área sucia (pintura, soldadura, pulido, sierra, horno, prensa) a **menos de 4 m** de una limpia (empaque, inspección, oficina, comedor) genera el aviso "X queda junto a Y".

---

## 14. Diseño visual y marca

- **Blanco y negro** con cinco grises (`#3b3b3b`, `#767676`, `#c2c2c2`, `#dedede`, `#eeeeee`). El color no se usa para decorar: el negro marca lo importante (cuello de botella, opción elegida, mejora).
- **Una sola tipografía**, Archivo Variable, usando su **eje de anchura**: expandida (125 %) para títulos y botones, normal para lectura y condensada (74 %) para cifras.
- **Marca**: `FlowMark` dibuja la planta desde arriba con dos portones; el recorrido interior se transforma (interpolando 120 puntos) de un trazo **enredado** a una **U**. Aparece en la intro, en la barra lateral (cambia a U fuera del paso 1 y al pasar el mouse) y en el resumen. `Wordmark` dibuja la palabra "cauce".
- **Efectos** (`fx/`):
  - *Intro*: el recorrido aparece enredado, se ordena en U y los portones se abren.
  - *Cursor propio*: un punto y un anillo con inercia que se llena sobre botones y muestra etiquetas (por ejemplo el nombre de una máquina en 3D). Solo con mouse.
  - *ClickSplash*: dos ondas en cada clic, como una gota sobre una lámina.
  - *Btn*: botón magnético que se inclina hacia el mouse.
  - *Reveal*: títulos que suben palabra por palabra, apariciones al hacer scroll, contadores animados e inclinación 3D en tarjetas.
- **Accesibilidad**: respeta `prefers-reduced-motion` (sin animaciones), roles y etiquetas ARIA en controles, `aria-live` en textos que se escriben en vivo, foco visible.
- **Responsivo**: puntos de quiebre en 1100 px y 760 px.
- **Impresión**: hoja propia en `@media print` para el reporte A4.
- Todos los estilos están en [frontend/src/index.css](frontend/src/index.css), organizados por componente y con variables CSS en `:root`.

---

## 15. Pruebas y verificación

### Pruebas automáticas (sin Ollama)

```bash
cd backend && .venv/Scripts/python -m pytest      # motor, API, agentes con proveedor falso
cd frontend && npm test                            # módulos puros del frontend (node --test)
backend/.venv/Scripts/python pruebas/probar_transformadores.py [transformadores-v3.json]
```

- `pruebas/transformadores.json` (v2) y `pruebas/transformadores-v3.json` (36 máquinas, fijos, lote, retornos, flujos y banda) son los casos de referencia; `pruebas/baseline-transformadores.json` guarda el comportamiento anterior a v3.
- `backend/tests/test_regresion_5_4.py` tiene las 6 pruebas mínimas de los criterios §5.4; todas pasan.
- `backend/tests/test_compat.py` asegura que el frontend anterior sigue funcionando con el backend nuevo y que el payload v3 no rompe nada.

### Historias de prueba

[pruebas/historias.json](pruebas/historias.json) tiene cinco historias **que no están en el código**, escritas para estresar la lectura:

| Id | Qué prueba |
|---|---|
| `vidrio-detallado` | Vidrio, pero con cifras y palabras distintas al ejemplo |
| `aluminio-ventanas` | Procesos que el ejemplo no conoce (perfilería, troquel, ensamble) |
| `carpinteria` | Otro rubro; producción por **semana** |
| `corta` | Historia muy corta y vaga |
| `desordenada` | Larga, coloquial, con números en letra y problemas contados |

Con el backend corriendo:

```bash
backend/.venv/Scripts/python pruebas/probar_historias.py
```

Para cada historia imprime: tiempo de lectura, si se leyó con IA o reglas, personas, producción al día, camiones, estaciones con su tipo, flujo, zonas, supuestos de la IA, recorrido de hoy, recorrido de cada alternativa y la recomendada.

### Verificación del frontend

```bash
cd frontend
npm run lint
npm run build
```

### Verificación manual recomendada

1. Cargar el taller de vidrio → guardar → recorrer los 6 pasos y el extra.
2. Dibujar una planta desde cero con paredes, zonas y dos portones.
3. Leer una historia con la IA y otra con Ollama apagado (debe funcionar por reglas).
4. Generar el PDF y revisar que tenga el mismo diseño que la vista previa.

---

## 16. Limitaciones conocidas y pendientes

1. **Velocidad de la IA local**: `llama3.1:8b` nombra mejor las cosas que el modelo de 3B, pero sin tarjeta de video tarda unos 2 minutos por historia. Un modelo en la nube lo haría en segundos; basta cambiar `CAUCE_EXTRACT_MODEL` y el proveedor.
2. **Foto aérea manual**: se sube a mano para comparar; no se genera ni se lee con visión para medir máquinas.
3. **Tamaño del bundle**: ~1 MB porque three.js no está dividido en partes que carguen bajo demanda.
4. **Sin persistencia en servidor**: pueden coexistir varias plantas en un navegador, pero aún no hay cuentas ni sincronización entre computadoras.
5. **Paredes y portones**: los portones solo van sobre el muro de la calle; las alternativas automáticas no proponen obra (eso se hace en "Tu rediseño").
6. **Supuestos**: con datos supuestos, los resultados son un orden de magnitud. Con tiempos medidos el método es el mismo y los números se vuelven confiables.

---

## 17. Hoja de ruta y decisiones abiertas

Según [contexto-proyecto.md](contexto-proyecto.md):

- **Fase 1 (piloto, una empresa)** — hecha en su mayor parte: historia → plano → 3D → diagnóstico → rediseño → reporte.
- **Fase 2** — capa de gamificación más profunda (hoy existe una primera versión en el paso extra): niveles visibles en el 3D, moneda del taller, retos por turno, tableros en planta.
- **Fase 3** — plantillas por industria, roles (dueño, supervisor, operario), multiempresa, más proveedores de IA y servidores MCP, integración con datos reales (hojas de cálculo, sensores).

Decisiones abiertas: stack final (base de datos, hosting), modelo de negocio y precios, qué IAs y MCP conectar primero, cómo capturar datos reales, mecánica final de puntos e incentivos.

---

## 18. Flujo de trabajo con Git

- `develop`: rama de trabajo, donde se integran los cambios.
- `main`: rama estable para versiones (se actualiza desde `develop` con un pull request).
- Archivos ignorados: `node_modules/`, `.venv/`, `__pycache__/`, `*.pyc`, `dist/`, `.env`.

---

## 19. Glosario

| Término | Significado |
|---|---|
| **Estación** | Máquina, proceso o área por donde pasa el material |
| **Zona** | Área por donde no pasa el material (oficina, baños, comedor, bloqueada) |
| **Ruta** | Paso del material de una estación a otra, con dirección y % de piezas |
| **Layout / acomodo** | Dónde está cada estación dentro de la bodega |
| **Recorrido por pieza** | Metros que camina una pieza desde que entra hasta que sale |
| **Cuello de botella** | La estación más cargada; limita lo que la planta puede producir |
| **Utilización** | Qué tanto de su tiempo disponible usa una estación (100 % = al límite) |
| **Capacidad** | Piezas al día que la planta podría sacar con su cuello de botella actual |
| **Tiempo de fabricación (lead time)** | Horas desde que una pieza entra hasta que sale, incluidas las esperas |
| **Takt** | Minutos disponibles entre una pieza y la siguiente según la demanda |
| **Lote** | Piezas que se mueven juntas en un viaje del carro |
| **SLP / tabla de relaciones** | Método clásico de distribución de plantas que califica qué tan cerca deben estar dos áreas (A, E, I, O, U, X) |
| **Sakasegawa** | Fórmula aproximada para la espera en cola con varios servidores |
| **Supuesto** | Valor que no se midió y se tomó por defecto o lo estimó la IA; siempre visible y editable |
| **Extractor / Ingeniero** | Los dos papeles de IA: uno solo devuelve datos, el otro redacta y conversa |
