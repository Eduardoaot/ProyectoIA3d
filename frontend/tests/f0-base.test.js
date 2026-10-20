import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { has, loadCapabilities, NO_CAPS, normalizeCaps, resetCapabilities } from '../src/capabilities.js'

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const json = (name) => JSON.parse(fx(name))

test('backend viejo: /api/capabilities da 404 y no hay funciones nuevas', async () => {
    resetCapabilities()
    const caps = await loadCapabilities(async () => ({ ok: false, status: 404 }))
    assert.deepEqual(caps.features, [])
    assert.equal(has(caps, 'plan_ops'), false)
})

test('error de red equivale a backend viejo', async () => {
    resetCapabilities()
    const caps = await loadCapabilities(async () => {
        throw new Error('sin red')
    })
    assert.equal(caps, NO_CAPS)
})

test('backend nuevo: se leen las funciones anunciadas y se guarda en caché', async () => {
    resetCapabilities()
    let calls = 0
    const fetcher = async () => {
        calls += 1
        return { ok: true, json: async () => json('capabilities-full.json') }
    }
    const a = await loadCapabilities(fetcher)
    const b = await loadCapabilities(fetcher)
    assert.equal(calls, 1)
    assert.equal(a, b)
    assert.ok(has(a, 'plan_ops') && has(a, 'simulate'))
})

test('respuestas raras no rompen', () => {
    assert.deepEqual(normalizeCaps({ features: 'count' }).features, [])
    assert.deepEqual(normalizeCaps({ features: ['count', 3, null] }).features, ['count'])
    assert.equal(normalizeCaps(null), NO_CAPS)
})

test('respuestas simuladas v2 y v3 tienen lo que la interfaz lee', () => {
    const v2 = json('analyze-v2.json')
    const v3 = json('analyze-v3.json')
    for (const a of [v2, v3]) {
        assert.ok(a.current && Array.isArray(a.alternatives) && a.recommended)
    }
    assert.equal(v2.main_metric, undefined)
    assert.ok(v3.main_metric && v3.recommended_reason && v3.alternatives[0].scores)
})
