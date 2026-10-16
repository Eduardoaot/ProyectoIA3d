import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture } from './helpers.mjs'

test('v2 capture contains the complete transformer case and actual response shapes', async () => {
    const plant = await fixture('transformadores-v2')
    const analysis = await fixture('analyze-v2')
    const report = await fixture('report-v2')
    const metadata = await fixture('capture-v2.meta')
    assert.equal(plant.stations.length, 11)
    assert.equal(plant.routes.length, 13)
    assert.equal(analysis.alternatives.length, 3)
    assert.ok(analysis.alternatives.some((alternative) => alternative.id === analysis.recommended))
    for (const alternative of analysis.alternatives) {
        for (const station of plant.stations) assert.ok(alternative.positions[station.id])
    }
    assert.equal(metadata.capabilities_status, 404)
    assert.equal(report.status, 200)
    assert.match(report.content_type, /text\/plain/)
    assert.match(report.body, /Hoy una pieza recorre/)
})

test('v3 fixtures represent the additive capabilities and operations contract', async () => {
    const plant = await fixture('transformadores-v3')
    const analysis = await fixture('analyze-v3')
    const capabilities = await fixture('capabilities-full')
    const plan = await fixture('plan-ops')
    assert.equal(plant.schema_version, 3)
    assert.equal(plant.stations.find((station) => station.id === 'embobinado').count, 10)
    assert.equal(plant.zones.find((zone) => zone.id === 'columna-1').locked, true)
    assert.ok(plant.routes.some((route) => route.is_return))
    assert.match(analysis.plant_version, /^[a-f0-9]{64}$/)
    assert.ok(Math.abs(Object.values(analysis.weights_used).reduce((a, b) => a + b, 0) - 1) < 1e-9)
    assert.ok(capabilities.features.includes('plan_ops'))
    assert.equal(capabilities.vision, false)
    assert.ok(plan.ops.every((op) => ['add', 'delete', 'move', 'update', 'connect', 'disconnect', 'lock', 'unlock'].includes(op.op)))
    assert.ok(plan.rejected.every((item) => item.op && item.reason))
    assert.equal(plan.plant, undefined)
})
