import test from 'node:test'
import assert from 'node:assert/strict'
import { previewOperations } from '../src/editor/assistant.js'
import { applyOps } from '../src/editor/operations.js'
import { DEFAULT_WEIGHTS, validWeights } from '../src/features.js'
import { fixture } from './helpers.mjs'

test('assistant preview validates without mutating; applying and undoing the fixture is one atomic batch', async () => {
    const p = await fixture('transformadores-v3'), original = structuredClone(p)
    const response = await fixture('plan-ops')
    const preview = previewOperations(p, response)
    assert.equal(preview.ops.length, 3)
    assert.equal(preview.rejected.length, 1)
    assert.deepEqual(p, original)
    const applied = applyOps(p, preview.ops)
    assert.ok(applied.plant.stations.some((s) => s.id === 'pulido-2'))
    assert.deepEqual(applyOps(applied.plant, applied.inverse).plant, p)
})
test('assistant rejects fixed movement and local history fields before presenting operations', async () => {
    const p = await fixture('transformadores-v3')
    const result = previewOperations(p, { ops: [
        { op: 'move', id: 'horno', to: { x: 1, z: 1 } },
        { op: 'update', id: 'horno', set: { locked: false } },
        { op: 'update', id: '$plant', set: { name: 'Changed' } },
        { op: 'delete', id: 'horno', _collection: 'routes' },
        { op: 'add', element: { id: 'missing-position', w: 1, d: 1 } },
    ] })
    assert.equal(result.ops.length, 0)
    assert.equal(result.rejected.length, 5)
})
test('weights are finite, nonnegative, complete and sum to one', () => {
    assert.ok(validWeights(DEFAULT_WEIGHTS))
    for (const bad of [{ ...DEFAULT_WEIGHTS, manejo: 0 }, { ...DEFAULT_WEIGHTS, manejo: NaN }, { ...DEFAULT_WEIGHTS, manejo: -0.25 }, { ...DEFAULT_WEIGHTS, manejo: '' }, {}]) assert.equal(validWeights(bad), false)
})
test('feature endpoints are never requested when capabilities is absent', async (t) => {
    const calls = []
    t.mock.method(globalThis, 'fetch', async (path) => { calls.push(path); return new Response('', { status: 404 }) })
    const { api } = await import('../src/api.js?features=none')
    await assert.rejects(api.planOps('agrega', {}), /no ofrece/)
    await assert.rejects(api.simulate({}, 'keep', 30, 42), /no ofrece/)
    assert.deepEqual(calls, ['/api/capabilities'])
})
test('feature requests follow the contract, invalid weights do not reach analyze', async (t) => {
    const calls = []
    const cap = await fixture('capabilities-full')
    t.mock.method(globalThis, 'fetch', async (path, options) => {
        if (path === '/api/capabilities') return Response.json(cap)
        calls.push({ path, body: JSON.parse(options.body) }); return Response.json({})
    })
    const { api } = await import('../src/api.js?features=full')
    await assert.rejects(api.analyze({}, { ...DEFAULT_WEIGHTS, manejo: 0 }), /sumar/)
    assert.equal(calls.length, 0)
    await api.analyze({}, DEFAULT_WEIGHTS)
    await api.planOps('agrega', {})
    await api.simulate({}, 'keep', 30, 42)
    assert.deepEqual(calls.map((c) => c.path), ['/api/analyze', '/api/plan/ops', '/api/simulate'])
    assert.deepEqual(calls[2].body, { plant: {}, alternative: 'keep', replicas: 30, seed: 42 })
})
test('structured report keeps text and discarded claims and negotiates only when supported', async (t) => {
    const validation = { checked: 2, discarded: [{ text: 'Inventado', reason: 'No está en facts()' }] }
    let accept
    t.mock.method(globalThis, 'fetch', async (path, options) => {
        if (path === '/api/capabilities') return Response.json({ features: ['report_validation'] })
        accept = options.headers.Accept
        return Response.json({ text: 'Informe verificado', validation })
    })
    const { stream } = await import('../src/api.js?report=json')
    let text = ''
    const response = await stream('/api/report', {}, (chunk) => { text += chunk })
    assert.equal(text, 'Informe verificado')
    assert.deepEqual(response.validation, validation)
    assert.match(accept, /application\/json/)
})
test('conveyor creation with linked route is reversible and rejects invalid points and speed', async () => {
    const p = await fixture('transformadores-v2')
    const belt = { id: 'band', from: 'corte', to: 'nucleo', points: [[5, 12], [10, 12]], capacity_ppm: 2, speed_mpm: 6 }
    const result = applyOps(p, [{ op: 'add', element: belt }, { op: 'update', id: 'r2', set: { conveyor: 'band', flow: 'carga', is_return: true } }])
    assert.deepEqual(applyOps(result.plant, result.inverse).plant, p)
    assert.throws(() => applyOps(p, [{ op: 'add', element: { ...belt, speed_mpm: -1 } }]), /positivas/)
    assert.throws(() => applyOps(p, [{ op: 'add', element: { ...belt, points: [[NaN, 1]] } }]), /puntos/)
})
