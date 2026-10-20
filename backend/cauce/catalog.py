"""Catálogo de tipos de estación y de zona.

El tipo solo decide la maqueta 3D, el tamaño inicial y los minutos sugeridos.
El nombre de cada estación lo pone el usuario (o la IA) y puede ser cualquiera.
"""

from __future__ import annotations

# id, nombre por defecto, ancho, fondo, minutos por pieza sugeridos, operarios sugeridos, palabras clave
KINDS = [
    ("recepcion", "Recepción", 6, 4.5, 0.0, 0, ["recib", "llega", "ingres", "entrada", "materia prima"]),
    ("despacho", "Despacho", 6, 4.5, 2.0, 1, ["despach", "entreg", "salida", "camion", "camioneta", "envio", "ruta"]),
    ("almacen", "Almacén en estantes", 6, 3, 1.0, 1, ["almacen", "estante", "inventario", "guardab", "caballete", "bodega de"]),
    ("almacen_piso", "Almacén en piso", 6, 5, 0.8, 1, ["tarima", "pallet", "a piso"]),
    ("corte", "Mesa de corte", 6, 4, 4.0, 1, ["corte", "cortab", "cortar", "cortan", "cortaj", "trazo", "trazab"]),
    ("sierra", "Sierra", 4, 3, 2.5, 1, ["sierra", "escuadradora", "tronzad"]),
    ("cnc", "Máquina CNC", 4, 3, 6.0, 1, ["cnc", "router", "fresad", "mecaniz"]),
    ("torno", "Torno", 3.5, 1.8, 6.0, 1, ["torno", "tornead"]),
    ("prensa", "Prensa o troquel", 2.6, 2.6, 1.5, 1, ["prensa", "troquel", "doblad", "punzon", "estampad"]),
    ("soldadura", "Soldadura", 4, 4, 5.0, 1, ["sold"]),
    ("pulido", "Pulido o lijado", 6, 2.6, 4.0, 1, ["pulid", "pulidora", "lij", "bisel", "esmeril", "canto"]),
    ("pintura", "Cabina de pintura", 5, 4.5, 5.0, 1, ["pint", "barniz", "laca", "sandblast", "arenad", "chorro de arena", "recubr"]),
    ("horno", "Horno", 6, 3, 8.0, 1, ["horno", "hornea", "coccion", "curado", "templad"]),
    ("lavado", "Lavado", 5.5, 2.6, 1.0, 1, ["lavad", "lavar", "lavan"]),
    ("secado", "Secado", 5, 2.6, 2.0, 1, ["secado", "secador", "secan"]),
    ("mesa", "Mesa de trabajo", 4.5, 3, 2.0, 1, ["mesa de trabajo", "banco de trabajo", "a mano", "recorte", "retoque"]),
    ("ensamble", "Ensamble", 4.5, 3, 6.0, 1, ["ensambl", "arma", "montaje"]),
    ("costura", "Costura", 6, 4, 8.0, 3, ["costur", "cosen", "cosian", "confecc", "maquina de coser"]),
    ("mezcla", "Mezcla o tanques", 4, 3, 3.0, 1, ["mezcl", "tanque", "amasa", "licu", "marmita"]),
    ("banda", "Banda transportadora", 8, 1.2, 0.5, 0, ["banda", "transportador"]),
    ("grua", "Grúa o polipasto", 3, 3, 0.5, 0, ["grua", "pulpo", "polipasto", "ventosa"]),
    ("inspeccion", "Inspección", 3, 2, 1.0, 1, ["inspecc", "revis", "calidad", "control de"]),
    ("empaque", "Empaque", 5, 4, 2.0, 1, ["empaq", "embal", "envolv", "etiquet"]),
    ("otro", "Otro proceso", 4, 3, 3.0, 1, []),
]

KIND = {k[0]: {"id": k[0], "name": k[1], "w": k[2], "d": k[3], "t": k[4], "ops": k[5], "keywords": k[6]} for k in KINDS}

ZONE_KINDS = [
    ("oficina", "Oficina", 8, 6, ["oficina", "ventas", "nomina", "factur", "administr", "contab"]),
    ("banos", "Baños", 5, 5, ["bano"]),
    ("comedor", "Comedor", 6, 5, ["comedor del personal", "comedor de los trabajadores", "cafeteria"]),
    ("bloqueado", "Zona bloqueada", 4, 4, []),
]
ZONE = {z[0]: {"id": z[0], "name": z[1], "w": z[2], "d": z[3], "keywords": z[4]} for z in ZONE_KINDS}

# Tipos que ensucian (polvo, ruido, calor) y tipos que deben quedar limpios.
DIRTY = {"pintura", "soldadura", "pulido", "sierra", "horno", "prensa"}
CLEAN = {"empaque", "inspeccion", "oficina", "comedor"}

ASSUMPTIONS = [
    ("demand", "Producción", "piezas al día", "Pedidos promedio de un taller pequeño.", 60),
    ("shift_min", "Jornada", "minutos", "Un turno de 8 horas.", 480),
    ("efficiency", "Eficiencia", "fracción", "Descuenta pausas, ajustes y cambios de referencia.", 0.82),
    ("batch", "Lote por viaje", "piezas", "Piezas que se mueven juntas en un carro.", 4),
    ("speed", "Velocidad con carro", "m/min", "Caminar empujando material, con cuidado.", 30),
    ("load_min", "Carga al camión", "min/pieza", "Subir y asegurar una pieza.", 1.0),
    ("trucks", "Camiones al día", "salidas", "Salidas de entrega diarias.", 2),
    ("truck_setup", "Alistamiento por camión", "minutos", "Maniobra, papeles y amarre.", 12),
    ("cv2", "Variabilidad", "coef.", "Qué tan irregular es el trabajo (1 = normal).", 1.0),
]
DEFAULT_PARAMS = {k: v for k, *_, v in ASSUMPTIONS}


def public():
    """Lo que el frontend necesita para el editor."""
    return {
        "kinds": [{k: v for k, v in x.items() if k != "keywords"} for x in KIND.values()],
        "zones": [{k: v for k, v in x.items() if k != "keywords"} for x in ZONE.values()],
        "assumptions": [{"key": k, "label": l, "unit": u, "why": w, "value": v} for k, l, u, w, v in ASSUMPTIONS],
        "dirty": sorted(DIRTY),
        "clean": sorted(CLEAN),
    }
