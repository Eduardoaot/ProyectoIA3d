"""Actividad real de llamadas, separada por navegador y sin contenido privado."""
from contextvars import ContextVar
from collections import OrderedDict
from uuid import uuid4
import time
import httpx

session = ContextVar('ai_session', default=None)
activities = OrderedDict()


def record(provider, role, state, call_id, detail=''):
    key = session.get()
    if not key:
        return
    rows = activities.setdefault(key, {})
    rows[call_id] = dict(id=call_id, provider=provider.name, model=provider.model,
                         role=role, state=state, detail=detail, updated=time.time())
    while len(rows) > 40:
        del rows[next(iter(rows))]
    activities.move_to_end(key)
    while len(activities) > 200:
        activities.popitem(last=False)


def instrument(provider, role):
    original = provider.json

    async def tracked(*args, **kwargs):
        call_id = uuid4().hex
        record(provider, role, 'running', call_id)
        try:
            result = await original(*args, **kwargs)
        except Exception as exc:
            detail = 'La llamada falló.'
            if isinstance(exc, httpx.HTTPStatusError):
                code = exc.response.status_code
                detail = 'Credencial o permiso rechazado.' if code in (401, 403) else f'El proveedor respondió HTTP {code}.'
            elif isinstance(exc, httpx.RequestError):
                detail = 'No se pudo completar la conexión con el proveedor.'
            record(provider, role, 'failed', call_id, detail)
            raise
        record(provider, role, 'completed', call_id)
        return result

    provider.json = tracked
    return provider
