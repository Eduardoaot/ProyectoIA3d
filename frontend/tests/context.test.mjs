import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeConfirmed, appendEntry, contextSignature, currentEntries, plantForCapabilities, recordTimeChanges, summarizePlant } from '../src/context.js'
import { fixture } from './helpers.mjs'

test('context edits append immutable entries and supersede previous values', () => {
    const first = appendEntry('Historia original', { segment: 'tiempos', key: 'corte.t', value: [2, 4], source: 'medido', confidence: 'alta' })
    const snapshot = structuredClone(first)
    const next = appendEntry(first, { segment: 'tiempos', key: 'corte.t', value: [3, 5] })
    assert.deepEqual(first, snapshot)
    assert.equal(next.segments.tiempos.length, 2)
    assert.equal(next.segments.tiempos[1].supersedes, first.segments.tiempos[0].id)
    assert.equal(currentEntries(next).filter((e) => e.key === 'corte.t').length, 1)
    assert.match(plantForCapabilities({ context: next }, { features: [] }).context, /3 – 5/)
    assert.equal(plantForCapabilities({ context: next }, { features: ['segmented_context'] }).context, next)
})
test('editing and undoing a station time each append provenance without deleting history', async () => {
    const p = await fixture('transformadores-v3')
    const after = structuredClone(p)
    after.stations[0].t_cycle_min = [8, 12]
    const changed = recordTimeChanges(p, after)
    const undone = recordTimeChanges(changed, { ...changed, stations: p.stations })
    const initial = p.context.segments.tiempos.length
    assert.equal(changed.context.segments.tiempos.length, initial + 2)
    assert.equal(undone.context.segments.tiempos.length, initial + 3)
    assert.deepEqual(undone.context.segments.tiempos.slice(0, initial + 2), changed.context.segments.tiempos)
})
test('analysis never calls API without confirmation of exact current plant and context', async () => {
    const p = await fixture('transformadores-v3')
    let calls = 0
    const api = async () => { calls++; return 'ok' }
    await assert.rejects(analyzeConfirmed(p, null, api), /Confirma/)
    const confirmation = contextSignature(p)
    assert.equal(await analyzeConfirmed(p, confirmation, api), 'ok')
    await assert.rejects(analyzeConfirmed({ ...p, context: 'Otro dato' }, confirmation, api), /Confirma/)
    assert.equal(calls, 1)
    assert.equal(summarizePlant(p, p).stations.length, 11)
    assert.deepEqual(summarizePlant(p, p).changed, [])
})

test('changing only time provenance appends a version for the same numeric value', async () => {
    const plant = await fixture('transformadores-v3')
    const next = structuredClone(plant)
    next.stations[0].t_source = 'medido'
    const result = recordTimeChanges(plant, next)
    const current = currentEntries(result.context).find((e) => e.key === `${plant.stations[0].id}.t`)
    assert.equal(current.value, plant.stations[0].t)
    assert.equal(current.source, 'medido')
    assert.equal(current.confidence, 'alta')
})
test('API converts segmented context for old backend and preserves it when advertised', async (t) => {
    const p = await fixture('transformadores-v2')
    p.context = appendEntry('', { segment: 'negocio', key: 'producto', value: 'Transformador' })
    for (const active of [false, true]) {
        const bodies = []
        t.mock.method(globalThis, 'fetch', async (path, options) => {
            if (path === '/api/capabilities') return active ? Response.json({ features: ['segmented_context'] }) : new Response('', { status: 404 })
            bodies.push(JSON.parse(options.body)); return Response.json({})
        })
        const { api } = await import(`../src/api.js?context=${active}`)
        await api.analyze(p)
        await api.routes(p, p.layout)
        await api.evaluate(p, p.layout)
        for (const b of bodies) assert.equal(typeof b.plant.context, active ? 'object' : 'string')
        t.mock.restoreAll()
    }
})
