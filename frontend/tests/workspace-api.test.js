import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acceptedContext, constructWorkspace } from '../src/workspaceApi.js'

test('solo actividades y operadores aceptados viajan al análisis; imágenes permanecen fuera', () => {
    const result = acceptedContext({ context: { segments: { referencias: [{ id: 'photo', image: 'data:image/png;base64,ABC', value: 'Plano' }] } },
        contextWorkspace: { activities: [{ id: 'a', status: 'confirmed', time: null }, { id: 'b', status: 'pending', time: 99 }],
            operators: [{ id: 'op', status: 'pending' }] } })
    assert.equal(result.activities.length, 1)
    assert.equal(result.activities[0].time, null)
    assert.equal(result.operators.length, 0)
    assert.equal(result.segments.referencias[0].image, undefined)
})

test('la construcción espera sus lotes y conserva la revisión del servidor para reintentar', async () => {
    const calls = [], progress = [], revisions = []
    const responses = [
        { id: 'project', revision: 3 },
        { id: 'build', status: 'queued' },
        { id: 'build', status: 'running', stage: 'entities', stage_progress: { completed: 5, total: 10 } },
        { id: 'build', status: 'done', result: { plant: { stations: [{ id: 'last' }] } } },
        { id: 'project', revision: 4 },
    ]
    const result = await constructWorkspace({ serverRevision: 2, constructionJob: { id: 'previous', status: 'interrupted' } }, 'project', {
        request: async (path, options) => { calls.push({ path, options }); return responses.shift() },
        wait: async () => {}, onProgress: (work) => progress.push(work), onSaved: (saved) => revisions.push(saved.revision),
    })
    assert.equal(calls[1].options.body.kind, 'construction')
    assert.equal(calls[1].options.body.retry_job_id, 'previous')
    assert.equal(calls[1].options.body.expected_revision, 3)
    assert.deepEqual(progress.map((p) => p.status), ['queued', 'running', 'done'])
    assert.deepEqual(revisions, [3, 4])
    assert.equal(result.plant.stations[0].id, 'last')
})

test('un lote bloqueado devuelve su comprobación y no reemplaza el plano guardado', async () => {
    const blocked = { id: 'build', status: 'blocked', error: 'Solape en el lote', verification: { totals: { unmet: 1 } } }
    const replies = [{ id: 'project', revision: 2 }, blocked]
    let reads = 0
    await assert.rejects(constructWorkspace({}, 'project', {
        request: async (_path, options) => { if (!options) reads++; return replies.shift() },
    }), (error) => error.job === blocked && error.message === 'Solape en el lote')
    assert.equal(reads, 0)
})
