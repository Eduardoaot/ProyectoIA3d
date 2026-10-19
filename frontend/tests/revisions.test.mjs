import test from 'node:test'
import assert from 'node:assert/strict'
import { protectProposal, updateProject, isStale } from '../src/revisions.js'
import { fixture } from './helpers.mjs'

test('manual edits change revision without API requests; late analysis stays stale', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected analysis') })
    const plant = await fixture('transformadores-v2')
    const p = { draft: plant, plant_revision: 5, analysis_revision: 5, analysis: {} }
    const edited = updateProject(p, { draft: { ...plant, name: 'Editada' } })
    assert.equal(edited.plant_revision, 6)
    assert.equal(isStale(edited), true)
    const response = updateProject(edited, { analysis: {}, analysis_revision: 5 })
    assert.equal(isStale(response), true)
    assert.equal(fetch.mock.callCount(), 0)
})

test('applying and undoing preserves exact positions and protects locked stations', async () => {
    const plant = await fixture('transformadores-v3')
    const alternative = (await fixture('analyze-v2')).alternatives[0]
    const result = protectProposal(plant, plant.layout, alternative.positions)
    assert.deepEqual(result.positions.horno, plant.layout.horno)
    assert.ok(result.rejected.some((reason) => reason.includes('Horno')))
    assert.deepEqual(result.inverse, plant.layout)
    assert.notEqual(result.positions, plant.layout)
})

test('analyzing a custom revision does not mark the new response stale by clearing its choice', () => {
    const previous = { plant_revision: 3, redesign: { custom: { positions: {} } } }
    const next = updateProject(previous, { analysis: {}, analysis_revision: 3, redesign: { custom: null } })
    assert.equal(isStale(next), false)
    assert.equal(next.plant_revision, 3)
})
