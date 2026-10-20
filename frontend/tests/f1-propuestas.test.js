import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { isStale, protectLocked, splitValidation } from '../src/proposals.js'

const plant = JSON.parse(readFileSync(new URL('../../pruebas/transformadores.json', import.meta.url), 'utf8'))

test('aplicar una alternativa conserva los fijos y avisa si la respuesta los movía', () => {
    const p = { ...plant, stations: plant.stations.map((s) => (s.id === 'horno' ? { ...s, locked: true } : s)) }
    const proposed = { ...plant.layout, horno: [1, 1, 0], corte: [9, 9, 0] }
    const out = protectLocked(p, plant.layout, proposed)
    assert.deepEqual(out.positions.horno, plant.layout.horno)
    assert.deepEqual(out.positions.corte, [9, 9, 0])
    assert.deepEqual(out.moved, ['Horno de secado'])
})

test('sin fijos la alternativa se aplica tal cual', () => {
    const proposed = { ...plant.layout, corte: [9, 9, 0] }
    const out = protectLocked(plant, plant.layout, proposed)
    assert.deepEqual(out.positions, proposed)
    assert.deepEqual(out.moved, [])
})

test('aplicar y deshacer devuelve el plano idéntico', () => {
    const before = structuredClone(plant.layout)
    const history = []
    let custom = { plant, positions: plant.layout }
    history.push(custom)
    custom = { plant, positions: protectLocked(plant, plant.layout, { ...plant.layout, corte: [9, 9, 0] }).positions }
    custom = history.pop()
    assert.deepEqual(custom.positions, before)
})

test('desactualizado cuando el plano cambió después del análisis', () => {
    assert.equal(isStale({ analysis: {}, draftRev: 3, analysisRev: 3 }), false)
    assert.equal(isStale({ analysis: {}, draftRev: 4, analysisRev: 3 }), true)
    assert.equal(isStale({ analysis: null, draftRev: 4 }), false)
    // Proyectos guardados antes de este cambio no traen revisiones: no se marcan.
    assert.equal(isStale({ analysis: {} }), false)
})

test('el resumen de validación se separa del texto', () => {
    const raw = 'Hoy 163 m.\n\u001e{"validation": {"checked": 3, "discarded": [{"text": "x", "reason": "y"}]}}'
    const out = splitValidation(raw)
    assert.equal(out.text, 'Hoy 163 m.')
    assert.equal(out.validation.discarded.length, 1)
    assert.deepEqual(splitValidation('sin resumen'), { text: 'sin resumen', validation: null })
})
