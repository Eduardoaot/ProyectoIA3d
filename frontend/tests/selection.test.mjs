import test from 'node:test'
import assert from 'node:assert/strict'
import { applyOps } from '../src/editor/operations.js'
import { copySelection, deleteSelectionOps, groupMoveOps, pasteOps, rectangleSelection, routeGroupOps, toggleSelection } from '../src/editor/selection.js'
import { fixture } from './helpers.mjs'

const three = ['corte', 'nucleo', 'ensamble'].map((id) => ({ type: 'station', id }))
test('copy three connected stations duplicates only internal routes with new ids; one inverse restores everything', async () => {
    const p = await fixture('transformadores-v3')
    const content = copySelection(p, three)
    const pasted = pasteOps(content)
    const result = applyOps(p, pasted.ops)
    assert.equal(result.plant.stations.length, p.stations.length + 3)
    assert.ok(content.routes.length > 0)
    assert.equal(result.plant.routes.length, p.routes.length + content.routes.length)
    const ids = new Set(pasted.selection.map((s) => s.id))
    for (const route of result.plant.routes.slice(p.routes.length)) {
        assert.ok(ids.has(route.from) && ids.has(route.to))
        assert.ok(!p.routes.some((r) => r.id === route.id))
    }
    assert.deepEqual(result.plant.layout[pasted.selection[0].id], [6, 13, 0])
    assert.deepEqual(applyOps(result.plant, result.inverse).plant, p)
    assert.notEqual(pasteOps(content).selection[0].id, pasted.selection[0].id)
})
test('group movement preserves spacing, clamps the group and returns exactly through undo', async () => {
    const p = await fixture('transformadores-v2')
    const ops = groupMoveOps(p, three, 500, 500)
    assert.equal(ops.length, 3)
    const result = applyOps(p, ops)
    const delta = three.map(({ id }) => result.plant.layout[id].map((v, i) => v - p.layout[id][i]))
    assert.deepEqual(delta[0], delta[1])
    assert.deepEqual(delta[1], delta[2])
    assert.deepEqual(applyOps(result.plant, result.inverse).plant, p)
    assert.throws(() => groupMoveOps({ ...p, stations: p.stations.map((s) => ({ ...s, locked: true })) }, three, 1, 1), /bloqueado/)
})
test('cut cascades internal/external routes and conveyors and restores them in one step', async () => {
    const p = await fixture('transformadores-v2')
    p.conveyors = [{ id: 'belt', from: 'corte', to: 'nucleo', points: [[5, 12], [10, 12]] }]
    p.routes[1].conveyor = 'belt'
    const result = applyOps(p, deleteSelectionOps(p, three))
    assert.equal(result.plant.conveyors.length, 0)
    assert.deepEqual(applyOps(result.plant, result.inverse).plant, p)
    const pasted = applyOps(p, pasteOps(copySelection(p, three)).ops).plant
    assert.notEqual(pasted.conveyors[1].id, 'belt')
    assert.ok(pasted.routes.some((r) => r.conveyor === pasted.conveyors[1].id))
})
test('route group edits validate atomically and preserve legacy routes on undo', async () => {
    const p = await fixture('transformadores-v2')
    const selection = p.routes.slice(0, 3).map((r) => ({ type: 'route', id: r.id }))
    const result = applyOps(p, routeGroupOps(p, selection, { flow: 'personas', frac: 0.4 }))
    assert.ok(result.plant.routes.slice(0, 3).every((r) => r.flow === 'personas' && r.frac === 0.4))
    assert.deepEqual(applyOps(result.plant, result.inverse).plant, p)
    assert.throws(() => routeGroupOps(p, selection, { frac: 2 }), /porcentaje/)
})
test('rectangle and modifier selection leave plant untouched, include rotated bounds and toggle items', async () => {
    const p = await fixture('transformadores-v2')
    const snapshot = structuredClone(p)
    const all = rectangleSelection(p, { x1: 100, z1: 100, x2: -1, z2: -1 })
    assert.equal(all.filter((s) => s.type === 'station').length, p.stations.length)
    assert.deepEqual(toggleSelection(toggleSelection([], three[0]), three[0]), [])
    assert.deepEqual(p, snapshot)
})
