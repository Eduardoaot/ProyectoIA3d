import test from 'node:test'
import assert from 'node:assert/strict'
import { applyOps, diffOps } from '../src/editor/operations.js'
import { migratePlant, loadProject, PROJECT_KEY, LEGACY_KEY } from '../src/storage.js'
import { fixture } from './helpers.mjs'

for (const op of [
    { op: 'move', id: 'corte', to: { x: 7, z: 9 } },
    { op: 'update', id: 'corte', set: { count: 2, t_cycle_min: [4, 8] } },
    { op: 'delete', id: 'corte' },
    { op: 'lock', id: 'corte', reason: 'Fijo' },
    { op: 'connect', from: 'corte', to: 'horno', frac: 0.3, flow: 'personas' },
    { op: 'disconnect', from: 'pruebas', to: 'config', flow: 'material' },
    { op: 'add', element: { id: 'nueva', kind: 'otro', name: 'Nueva', w: 2, d: 2, x: 10, z: 10, locked: true } },
]) {
    test(`${op.op} followed by inverse restores v2 exactly`, async () => {
        const plant = await fixture('transformadores-v2')
        const result = applyOps(plant, [op])
        assert.deepEqual(applyOps(result.plant, result.inverse).plant, plant)
    })
}

test('locked geometry, deletion and movement reject atomically', async () => {
    const plant = await fixture('transformadores-v3')
    for (const op of [{ op: 'move', id: 'horno', to: { x: 30, z: 4 } }, { op: 'delete', id: 'horno' }, { op: 'update', id: 'horno', set: { w: 4 } }]) {
        assert.throws(() => applyOps(plant, [{ op: 'move', id: 'corte', to: { x: 8, z: 9 } }, op]), /Horno/)
        assert.deepEqual(plant.layout.corte, [5, 12, 0])
    }
    const renamed = applyOps(plant, [{ op: 'update', id: 'horno', set: { name: 'Horno principal' } }])
    assert.equal(renamed.plant.stations.find((s) => s.id === 'horno').name, 'Horno principal')
})

test('legacy patch adapter and batch undo preserve walls, gates, metadata and route order', async () => {
    const plant = await fixture('transformadores-v2')
    const next = structuredClone(plant)
    next.name = 'Otra planta'
    next.layout.corte = [8, 8, 90]
    next.walls[0].x2 += 1
    next.gates[0].x += 1
    next.routes.splice(2, 2)
    const result = applyOps(plant, diffOps(plant, next))
    assert.deepEqual(result.plant, next)
    assert.deepEqual(applyOps(result.plant, result.inverse).plant, plant)
})

test('v3 migration copies v2 and never writes or deletes its key', async () => {
    const plant = await fixture('transformadores-v2')
    const old = JSON.stringify({ plant, draft: plant, redesign: { custom: plant.layout } })
    const data = new Map([[LEGACY_KEY, old]])
    const writes = []
    const storage = { getItem: (key) => data.get(key), setItem(key, value) { writes.push(key); data.set(key, value) } }
    const p = loadProject(storage, {})
    assert.equal(p.plant.schema_version, 3)
    assert.deepEqual(p.plant.layout, plant.layout)
    assert.equal(p.plant.zones.find((z) => z.id === 'columna-1').locked, true)
    assert.equal(p.plant.stations[0].count, 1)
    assert.equal(data.get(LEGACY_KEY), old)
    assert.deepEqual(writes, [PROJECT_KEY])
    assert.deepEqual(loadProject(storage, {}), p)
    assert.deepEqual(writes, [PROJECT_KEY])
    assert.deepEqual(migratePlant(p.plant), p.plant)
})
