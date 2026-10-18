"""F6: el contexto segmentado del frontend llega a facts() con su historia y sus datos vigentes."""

from cauce.context import lines


def test_contexto_segmentado_con_historia():
    ctx = {"story": "Taller de transformadores", "segments": {"operaciones": [{"id": "operaciones-0001", "segment": "operaciones", "version": 1, "key": "turnos", "value": 2, "source": "usuario", "confidence": "alta"}]}}
    assert lines(ctx) == ["Contexto del usuario: Taller de transformadores", "Dato (operaciones, usuario, confianza alta): turnos = 2."]


def test_report_usa_el_contexto_segmentado(client, fake):
    from test_compat import fixture

    fake.text = "Se trabajan 2 turnos. Se trabajan 3 turnos y 99 horas."
    body = {**fixture("frontend-report-v2.json"), "context": {"segments": {"operaciones": [{"id": "operaciones-0001", "segment": "operaciones", "version": 1, "key": "turnos", "value": 2, "source": "usuario", "confidence": "alta"}]}}}
    text = client.post("/api/report", json=body).text
    assert "2 turnos" in text and "99" not in text
