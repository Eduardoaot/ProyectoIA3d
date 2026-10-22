"""El plano debe salir de lo que dice la descripción, no de un catálogo genérico."""
from cauce.story import build_plant

TEXT = ("Planta de transformadores. Embobinadoras: 10 unidades. Armado de núcleo: 4 estaciones. "
        "Tanque de impregnación en resina/barniz. Horno de bache para el curado. "
        "Pruebas eléctricas finales en el Tester 2. Recibimos la materia prima por los ingresos laterales.")
AI = {"estaciones": [
    {"nombre": "Embobinadoras", "tipo": "otro", "cantidad": 10},
    {"nombre": "Armado de núcleo", "tipo": "ensamble", "cantidad": 4},
    {"nombre": "Tanque de impregnación", "tipo": "otro", "cantidad": 1},
    {"nombre": "Horno de bache", "tipo": "horno", "cantidad": 1},
    {"nombre": "Tester 2", "tipo": "otro", "cantidad": 1},
], "flujo": [], "problemas": ["Se detectan fallas en el horno de bache."]}


def names(result):
    return [s["name"] for s in result["plant"]["stations"]]


def test_palabras_relacionadas_no_agregan_areas_genericas():
    result = build_plant(TEXT, AI)
    assert "Cabina de pintura" not in names(result)  # «barniz» no es una cabina de pintura
    assert "Recepción" not in names(result)  # «materia prima» no nombra un área de recepción
    assert any(n.startswith("Embobinadoras") for n in names(result))


def test_problemas_inventados_no_aparecen_si_la_historia_no_habla_de_problemas():
    assert not any("fallas" in n for n in build_plant(TEXT, AI)["notes"])
    con_problema = build_plant(TEXT + " El horno tiene fallas de temperatura.", AI)
    assert any("fallas" in n for n in con_problema["notes"])
