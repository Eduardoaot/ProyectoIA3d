import assert from 'node:assert/strict'
import { test } from 'node:test'
import { has, normalizeCaps } from '../src/capabilities.js'
import { bandText, topUtilization } from '../src/simText.js'

test('rangos y «sin datos»', () => {
    assert.equal(bandText(null, 'piezas'), 'sin datos')
    assert.equal(bandText({ p10: 5.6, p50: 5.8, p90: 6 }, 'piezas'), '5,6 a 6,0 piezas (mediana 5,8)')
    assert.equal(bandText({ p10: 8, p50: 8, p90: 8 }, 'piezas'), '8,0 piezas')
    assert.equal(bandText({ p10: 0.5, p50: 0.6, p90: 0.7 }, '%', 0, 100), '50 a 70 % (mediana 60)')
})

test('utilización ordenada', () => {
    const top = topUtilization({ a: { p10: 0.2, p50: 0.3, p90: 0.4 }, b: { p10: 0.8, p50: 0.9, p90: 1 } }, { b: 'Horno' }, 1)
    assert.deepEqual(top, [{ id: 'b', name: 'Horno', text: '80 a 100 % (mediana 90)' }])
})

test('el botón de simular solo aparece si el backend anuncia simulate', () => {
    assert.equal(has(normalizeCaps({ features: [] }), 'simulate'), false)
    assert.equal(has(normalizeCaps({ features: ['simulate'] }), 'simulate'), true)
})
