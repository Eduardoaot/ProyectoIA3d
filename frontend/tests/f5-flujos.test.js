import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { beltLength, flowOf, lateralOffsets, returnArc, shiftPath } from '../src/flows.js'

const v3 = JSON.parse(readFileSync(new URL('../../pruebas/transformadores-v3.json', import.meta.url), 'utf8'))

test('cada flujo tiene su estilo y material es el de siempre', () => {
    assert.equal(flowOf({}).id, 'material')
    assert.equal(flowOf({ flow: 'personas' }).id, 'personas')
    assert.notEqual(flowOf({ flow: 'personas' }).dash, flowOf({ flow: 'vehiculos' }).dash)
})

test('rutas entre el mismo par se separan; una sola ruta no se mueve', () => {
    const off = lateralOffsets(v3.routes)
    // recepción → soldadura va por material y por vehículos: quedan a lados distintos.
    assert.notEqual(off.r13, off.v1)
    assert.equal(off.r1, 0)
    // pruebas_int ↔ config: ida y retorno quedan a lados opuestos en el plano.
    const at = (r) => shiftPath([v3.layout[r.from], v3.layout[r.to]].map((p) => p.slice(0, 2)), off[r.id])
    const ida = at(v3.routes.find((r) => r.id === 'r9'))
    const vuelta = at(v3.routes.find((r) => r.id === 'r11'))
    assert.notDeepEqual(ida[0], vuelta[1])
})

test('desplazar una ruta horizontal la mueve en z', () => {
    assert.deepEqual(shiftPath([[0, 0], [10, 0]], 1), [[0, 1], [10, 1]])
    assert.deepEqual(shiftPath([[0, 0], [10, 0]], 0), [[0, 0], [10, 0]])
})

test('el retorno es una curva con punta entre los extremos', () => {
    const arc = returnArc([0, 0], [10, 0])
    assert.ok(arc.d.startsWith('M0 0 Q'))
    assert.ok(arc.tip[0] > 0 && arc.tip[0] < 10 && arc.tip[1] !== 0)
})

test('largo de la banda', () => {
    assert.equal(beltLength(v3.conveyors[0].points).toFixed(1), '6.7')
})
