import test from 'node:test'
import assert from 'node:assert/strict'
import { labelFor, parallelPath, quantityPatch, unitGrid } from '../src/editor/display.js'
import { fixture } from './helpers.mjs'

test('transformer quantities produce grid cells and compact labels without altering data', async () => {
    const plant = await fixture('transformadores-v3')
    const before = structuredClone(plant)
    const s = plant.stations.find((x) => x.id === 'embobinado')
    assert.deepEqual(unitGrid(s), { count: 10, columns: 10, rows: 1 })
    assert.deepEqual(unitGrid({ ...s, arrangement: 'bloque' }), { count: 10, columns: 4, rows: 3 })
    assert.deepEqual(unitGrid({ ...s, arrangement: 'columna' }), { count: 10, columns: 1, rows: 10 })
    assert.equal(labelFor(s, 3, 8, 0.9), '4 ×10')
    assert.equal(labelFor(s, 3, 1, 0.4), '4')
    assert.deepEqual(plant, before)
    assert.deepEqual(quantityPatch(s, { count: 4, unit_w: 2 }), { count: 4, unit_w: 2, w: 8, d: 4 })
})

test('parallel and opposing routes have separate presentation paths', () => {
    const a = { id: 'a', from: 'A', to: 'B' }, b = { id: 'b', from: 'B', to: 'A' }
    const points = [[0, 0], [10, 0]]
    const p1 = parallelPath(a, [a, b], points)
    const p2 = parallelPath(b, [a, b], [...points].reverse())
    assert.notEqual(p1[0][1], p2[0][1])
    assert.deepEqual(points, [[0, 0], [10, 0]])
})
