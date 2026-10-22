"""Interpreta solo entradas manuales nuevas y conserva el maestro anterior."""
import copy
import json

from .context import current
from .context_master import accepted_master, assemble, clean_fact
from .agents.context_pipeline import SPECIALIST_SCHEMA
from .versions import digest


async def integrate(project, provider):
    previous = accepted_master(project)
    if previous is None:
        raise ValueError('Primero organiza el contexto para crear un maestro.')
    pending = set(previous.get('pending_manual_ids', []))
    entries = [e for e in current(project.get('context')) if e['id'] in pending]
    if not entries:
        return None
    sources, facts = [], []
    # Solo nombres y tipos como referencia: no se reenvía el expediente anterior.
    entities = project['contextWorkspace']['masterDraft'].get('entities', [])
    names = [{k: e.get(k) for k in ('name', 'type')} for e in entities]
    for entry in entries:
        text = str(entry.get('label') or entry.get('key', '')) + ': ' + str(entry.get('value', '')) + ' ' + str(entry.get('unit', ''))
        source = dict(id='manual-' + digest([entry['id'], text])[:24], entry_id=entry['id'], text=text, kind='manual', offset=0)
        result = await provider.json(
            'Interpreta únicamente el dato nuevo como hechos estructurados. Conserva sus cifras y unidades literales. Usa el nombre de una entidad existente cuando corresponda. Las dimensiones del recinto son entity_type building, field width/depth, scope current. No inventes. Devuelve facts y questions.',
            json.dumps({'existing_entities': names, 'new_entry': text, 'topic': entry['segment']}, ensure_ascii=False), SPECIALIST_SCHEMA)
        rows = [clean_fact(raw, source) for raw in result.get('facts', [])]
        if not rows:
            raise ValueError('No se pudo interpretar el dato nuevo. Aclara su entidad, valor y unidad.')
        sources.append(source)
        facts.extend(rows)
    draft = copy.deepcopy(project['contextWorkspace']['masterDraft'])
    merged = assemble([*draft['facts'], *facts], [*draft.get('sources', []), *sources], draft.get('questions', []), draft.get('summary', ''), draft.get('trace', []), draft.get('handovers', []))
    for key in ('source_policy', 'pending_visual_sources', 'processing'):
        if key in draft:
            merged[key] = draft[key]
    return {'master': merged, 'proposals': [f for f in merged['facts'] if f['id'] in {row['id'] for row in facts}], 'source': 'ia_incremental', 'warnings': []}
