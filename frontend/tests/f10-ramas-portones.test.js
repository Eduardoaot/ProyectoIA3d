import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyOps } from '../src/ops.js'

const plant = () => ({
    stations: [{ id: 's1', name: 'Bobinado 1', kind: 'bobinado', w: 2, d: 2, family: 's9', family_name: 'Bobinado', lane: 1 }],
    routes: [],
    layout: { s1: [3, 3, 0] },
    gates: [
        { id: 'A', x: 9, z: 20, label: 'Portón A' },
        { id: 'B', x: 30, z: 10, label: 'Portón B' },
    ],
})

test('un portón se fija y se libera con su inversa; fijo no se mueve', () => {
    const p0 = plant()
    const locked = applyOps(p0, [{ op: 'lock', id: 'B', reason: 'Salida a la calle' }])
    assert.equal(locked.rejected.length, 0)
    const gate = locked.plant.gates.find((g) => g.id === 'B')
    assert.equal(gate.locked, true)
    assert.equal(gate.lock_reason, 'Salida a la calle')
    const moved = applyOps(locked.plant, [{ op: 'update', id: 'B', set: { x: 5 } }])
    assert.equal(moved.rejected.length, 1)
    assert.match(moved.rejected[0].reason, /Portón B.*fijo/)
    assert.deepEqual(applyOps(locked.plant, locked.inverse).plant, p0)
})
