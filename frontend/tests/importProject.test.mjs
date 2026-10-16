import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePlantJSON, readPlantFile } from '../src/importProject.js'
import { fixture } from './helpers.mjs'

for (const version of ['v2', 'v3']) {
    test(`imports ${version} without dropping fields or moving any element`, async () => {
        const plant = await fixture(`transformadores-${version}`)
        assert.deepEqual(parsePlantJSON(JSON.stringify(plant)), plant)
    })
}

test('imports the draft of a saved project, preserving the original object', async () => {
    const plant = await fixture('transformadores-v2')
    const draft = { ...plant, name: 'Borrador editado', layout: { ...plant.layout, horno: [28, 4, 90] } }
    const saved = JSON.stringify({ plant, draft, analysis: await fixture('analyze-v2') })
    assert.deepEqual(parsePlantJSON(saved), draft)
    assert.deepEqual(JSON.parse(saved).plant, plant)
    assert.deepEqual(parsePlantJSON(JSON.stringify({ plant })), plant)
})

test('imports a UTF-8 file with BOM and can read the same file again', async () => {
    const plant = await fixture('transformadores-v2')
    const file = new File(['\uFEFF' + JSON.stringify(plant)], 'transformadores.json', { type: 'application/json' })
    assert.deepEqual(await readPlantFile(file), plant)
    assert.deepEqual(await readPlantFile(file), plant)
})

test('imports without analysis or other API requests', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected request') })
    const plant = await fixture('transformadores-v2')
    parsePlantJSON(JSON.stringify(plant))
    assert.equal(fetch.mock.callCount(), 0)
})

for (const input of ['{', 'null', '[]', '{}', '{"plant":null}']) {
    test(`rejects invalid JSON or missing plant: ${input}`, () => {
        assert.throws(() => parsePlantJSON(input), /JSON|planta/)
    })
}

const invalidPlants = [
    ['missing coordinates', (plant) => { delete plant.layout.horno }, /posición válida/],
    ['invalid coordinates', (plant) => { plant.layout.horno = ['28', 4, 0] }, /posición válida/],
    ['invalid size', (plant) => { plant.size.w = -5 }, /ancho y el fondo/],
    ['duplicate station', (plant) => { plant.stations.push(plant.stations[0]) }, /repetido/],
    ['dangling route', (plant) => { plant.routes[0].to = 'missing' }, /no existe/],
    ['invalid fraction', (plant) => { plant.routes[0].frac = 5 }, /entre 0 y 1/],
    ['invalid list', (plant) => { plant.walls = null }, /debe ser una lista/],
    ['invalid wall', (plant) => { plant.walls[0].x1 = 'bad' }, /coordenadas válidas/],
    ['invalid zone', (plant) => { plant.zones[0].w = 0 }, /dimensiones válidas/],
    ['dangling gate', (plant) => { plant.dispatch_gate = 'missing' }, /no existe/],
]
for (const [name, change, expected] of invalidPlants) {
    test(`rejects ${name} before replacing the current draft`, async () => {
        const plant = await fixture('transformadores-v2')
        change(plant)
        assert.throws(() => parsePlantJSON(JSON.stringify(plant)), expected)
    })
}

test('reports oversized and unreadable files', async () => {
    await assert.rejects(readPlantFile({ size: 5 * 1024 * 1024 + 1, text() { throw new Error('Should not read') } }), /5 MB/)
    await assert.rejects(readPlantFile({ size: 10, async text() { throw new Error('No se pudo leer') } }), /No se pudo leer/)
})
