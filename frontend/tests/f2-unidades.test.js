import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blockSize, fitLabel, resize, unitRects } from '../src/units.js'

test('el bloque mide lo mismo que en el motor (cauce/units.py)', () => {
    assert.deepEqual(blockSize(10, 2, 1.5, 'fila'), [25.4, 1.5])
    assert.deepEqual(blockSize(10, 2, 1.5, 'columna'), [2, 20.4])
    assert.deepEqual(blockSize(10, 2, 1.5, 'bloque'), [9.8, 5.7])
})

test('cambiar la cantidad recalcula el bloque y conserva operarios por unidad', () => {
    const s = { id: 'e', w: 2, d: 1.5, ops: 1, t: 90 }
    const n = resize(s, { count: 10, arrangement: 'bloque' })
    assert.equal(n.count, 10)
    assert.deepEqual([n.w, n.d], [9.8, 5.7])
    assert.equal(n.ops, 10)
    const back = resize(n, { count: 1 })
    assert.deepEqual([back.w, back.d, back.ops], [2, 1.5, 1])
})

test('se dibujan las N unidades dentro del bloque, también girado', () => {
    const s = { count: 10, unit_w: 2, unit_d: 1.5, arrangement: 'bloque', w: 9.8, d: 5.7 }
    const rs = unitRects(s, { x: 0, z: 0, w: 9.8, d: 5.7 })
    assert.equal(rs.length, 10)
    for (const r of rs) assert.ok(r.x >= 0 && r.z >= 0 && r.x + r.w <= 9.8 + 1e-9 && r.z + r.d <= 5.7 + 1e-9)
    const turned = unitRects(s, { x: 0, z: 0, w: 5.7, d: 9.8 }, 90)
    for (const r of turned) assert.ok(r.x + r.w <= 5.7 + 1e-9 && r.z + r.d <= 9.8 + 1e-9)
    assert.deepEqual(unitRects({ count: 1, w: 2, d: 2 }, { x: 0, z: 0, w: 2, d: 2 }), [])
})

test('etiquetas que no caben se numeran', () => {
    assert.deepEqual(fitLabel('Corte', 6, 0), { text: 'Corte', numbered: false })
    assert.deepEqual(fitLabel('Recepción de lámina y alambre', 6, 0), { text: '1', numbered: true })
})
