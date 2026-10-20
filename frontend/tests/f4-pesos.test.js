import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DEFAULT_WEIGHTS, normalizeWeights, sensitiveCriteria, sumOf, validWeights } from '../src/weights.js'

test('los pesos por defecto suman 1', () => {
    assert.equal(validWeights(DEFAULT_WEIGHTS), true)
    assert.ok(Math.abs(sumOf(DEFAULT_WEIGHTS) - 1) < 1e-9)
})

test('pesos que no suman 1 no son válidos y se pueden normalizar', () => {
    const w = { ...DEFAULT_WEIGHTS, manejo: 0.6 }
    assert.equal(validWeights(w), false)
    const n = normalizeWeights(w)
    assert.equal(validWeights(n), true)
    assert.ok(n.manejo > n.lead_time)
    assert.equal(validWeights({ ...DEFAULT_WEIGHTS, manejo: -0.1, lead_time: 0.55 }), false)
    assert.deepEqual(normalizeWeights({}), DEFAULT_WEIGHTS)
})

test('sensibilidad: qué criterios cambian la recomendación', () => {
    const v3 = JSON.parse(readFileSync(new URL('./fixtures/analyze-v3.json', import.meta.url), 'utf8'))
    assert.deepEqual(sensitiveCriteria(v3.alternatives[0].sensitivity).map((c) => c.key), ['lead_time'])
    assert.deepEqual(sensitiveCriteria(undefined), [])
})
