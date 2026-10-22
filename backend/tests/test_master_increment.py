import asyncio
import copy

from cauce.context_master import assemble
from cauce.master_increment import integrate
from cauce.workspace import merge_result


def test_increment_preserves_master_and_plan_and_skips_already_processed_entries():
    old = {'id': 'old', 'entity_id': 'old-entity', 'entity': 'Equipo', 'entity_type': 'station', 'field': 'description', 'scope': 'current', 'value': 'Existente', 'topic': 'maquinas'}
    project = {'text': 'RELATO COMPLETO ANTERIOR', 'draft': {'keep': True},
               'context': {'segments': {'maquinas': [{'id': 'manual1', 'key': 'Ancho', 'value': '40 metros'}]}},
               'contextWorkspace': {'masterDraft': assemble([old], []), 'proposals': []}}
    original = copy.deepcopy(project)

    class Fake:
        async def json(self, system, prompt, schema):
            assert project['text'] not in prompt
            return {'facts': [{'topic': 'maquinas', 'label': 'Ancho', 'value': '40 metros', 'excerpt': '40 metros', 'entity': 'Planta', 'entity_type': 'building', 'field': 'width', 'target': '', 'number': 40, 'unit': 'm', 'scope': 'current'}]}

    result = asyncio.run(integrate(project, Fake()))
    assert project == original
    merge_result(project, result)
    assert project['draft'] == original['draft']
    assert project['contextWorkspace']['masterDraft']['facts'][0] == old
    assert len(project['contextWorkspace']['proposals']) == 1
    assert asyncio.run(integrate(project, Fake())) is None
