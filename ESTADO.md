# Cauce: estado del proyecto

Nombre: **Cauce**, el canal por donde corre el flujo. La marca es la planta vista desde arriba, con dos portones: el recorrido del material empieza enredado y se ordena en una U de portón a portón. La "u" de la palabra "cauce" es ese mismo trazo.

## Estado (sesión 5: reestructura del flujo)

Respaldo previo a la reestructura: commit `ea047c6`.

**Backend**
- `cauce/catalog.py`: 24 tipos de estación (recepción, despacho, almacén, corte, sierra, CNC, torno, prensa, soldadura, pulido, pintura, horno, lavado, secado, mesa, ensamble, costura, mezcla, banda, grúa, inspección, empaque, otro) y 4 de zona (oficina, baños, comedor, bloqueada). Áreas sucias y limpias para la tabla de relaciones.
- `cauce/providers/`: dos IAs, extractor (solo JSON, temperatura 0) e ingeniero (chat e informes), configurables por separado.
- `cauce/story.py`: reglas (números con letra, producción por día/semana/mes) + JSON de la IA validado contra el texto: descarta lo que la historia no menciona, portones y carros como estaciones y rutas que regresan.
- `cauce/engine.py`: rutas por pasillos que esquivan máquinas, zonas y paredes en cualquier ángulo. Sin supuestos: metros por pieza y relaciones. Con supuestos: capacidad, cuello de botella, tiempos y camiones.
- `cauce/layout.py`: acomodo inicial y las 3 alternativas para cualquier planta (U del ancho justo, línea en S, intercambio de lugares), penalizando áreas sucias junto a limpias.
- `main.py`: `/api/catalog`, `/api/story`, `/api/routes`, `/api/evaluate`, `/api/analyze`, `/api/report`, `/api/chat`, `/api/missions`, `/api/example`.

**Frontend**
- `src/editor/`: editor 2D (`PlanEditor`, `Inspector`, `geometry`).
- `src/project.js`: estado guardado en localStorage.
- Pasos: `Story` (historia, editor y supuestos opcionales), `Plant` (3D solo lectura), `Diagnosis`, `Redesign` (opciones, «Estado original», editor del rediseño), `Report` (+ `report/ReportDoc` imprimible en A4), `Summary` (resumen + chat), `Workshop` (extra).
- `three/models.js`: maqueta para cada tipo; «otro» y cualquier tipo desconocido es una caja gris con huecos de entrada y salida.

**Ajustes posteriores**: el número del paso activo ya no desaparece al pasar el mouse; el PDF usa el mismo diseño que la vista previa (sin márgenes de página, así el navegador no agrega fecha ni dirección); en el paso 4 el editor es completo y «Tu rediseño» guarda su propia bodega (paredes, zonas, portones y máquinas), que el reporte marca como obra.

**Verificado**: build y lint sin errores; recorrida completa en Edge sin pantalla (ejemplo y plano desde cero), PDF generado con la hoja de impresión; historias de prueba con la IA real.

**Sesión 6**
- IA: los tres papeles (extractor, ingeniero, espacial) usan `llama3.1:8b` por defecto (`ollama pull llama3.1:8b`), con `keep_alive` de 30 min.
- Velocidad: rutas con A* y malla base precalculada por forma y paredes (mismos resultados; análisis con forma propia y paredes de ~10 s a <1 s); endpoints de cálculo en hilos para no bloquear el servidor; 3D libera memoria al reconstruir, señala solo máquinas y se reconstruye al soltar; los pasos con 3D se cargan al llegar (three.js fuera del paquete inicial).
- Espera con IA (historia y «Compacta con IA»): reloj, barra con avance estimado y tiempo restante (aprendido de las esperas anteriores) y el minijuego.
- Editor: herramienta Contorno (dibujar muros exteriores con largos exactos), precisión de 1 m a 10 cm, zoom y paneo, imán y guías, lados y esquinas con medidas exactas, paredes con extremos, largo y división en tramos, zonas con manijas, flechas para mover.

## Pendiente
1. `llama3.1:8b` sin tarjeta de video tarda ~2 min por historia y 1–2 min la compacta; un modelo en la nube lo haría en segundos.
2. La foto aérea se sube a mano; no se genera ni se lee con visión.
3. three.js sigue siendo un archivo de ~630 KB, aunque ya se descarga solo al llegar al 3D.
4. Decisiones abiertas de contexto-proyecto.md (stack final, modelo de negocio, MCP).

