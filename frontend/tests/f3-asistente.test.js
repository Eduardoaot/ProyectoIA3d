import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { has, normalizeCaps } from '../src/capabilities.js'
import { describeAll } from '../src/opText.js'
import { applyOps } from '../src/ops.js'

const plant = JSON.parse(readFileSync(new URL('../../pruebas/transformadores.json', import.meta.url), 'utf8'))
const planOps = JSON.parse(readFileSync(new URL('./fixtures/plan-ops.json', import.meta.url), 'utf8'))
const full = JSON.parse(readFileSync(new URL('./fixtures/capabilities-full.json', import.meta.url), 'utf8'))

test('sin plan_ops el asistente no aparece; con capabilities-full sí', () => {
    assert.equal(has(normalizeCaps({ features: [] }), 'plan_ops'), false)
    assert.equal(has(normalizeCaps(full), 'plan_ops'), true)
})

test('las operaciones propuestas se leen en palabras antes de aplicarlas', () => {
    const lines = describeAll(planOps.ops, plant)
    assert.deepEqual(lines, [
        'Agregar «Pulidora 2» en x 30, z 16 m',
        'Ruta de material «Pintura de tanques» → «Pulidora 2»',
        'Cambiar «Embobinado»: count = 10',
    ])
})

test('aplicar la respuesta del asistente es un lote que se deshace en un paso', () => {
    const out = applyOps(plant, planOps.ops)
    assert.deepEqual(out.rejected, [])
    assert.ok(out.plant.stations.some((s) => s.id === 'pulido-2'))
    assert.deepEqual(out.plant.layout['pulido-2'], [30, 16, 0])
    assert.deepEqual(applyOps(out.plant, out.inverse).plant, plant)
})
