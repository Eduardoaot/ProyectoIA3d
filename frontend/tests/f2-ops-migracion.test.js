import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { KEY_V2, KEY_V3, loadStored, migrateProject, saveStored, upgradePlant } from '../src/migrate.js'
import { applyOps } from '../src/ops.js'

const read = (name) => JSON.parse(readFileSync(new URL(`../../pruebas/${name}`, import.meta.url), 'utf8'))

const LOTE = [
    { op: 'add', element: { id: 'pulido-2', name: 'Pulidora 2', kind: 'pulido', w: 6, d: 2.6, t: 4, ops: 1, x: 30, z: 16, rot: 0 } },
    { op: 'connect', from: 'pintura', to: 'pulido-2', frac: 1, flow: 'material' },
    { op: 'move', id: 'corte', to: { x: 9, z: 12 } },
    { op: 'update', id: 'embobinado', set: { count: 10, name: 'Embobinadoras' } },
    { op: 'disconnect', from: 'recepcion', to: 'corte' },
    { op: 'delete', id: 'nucleo' },
    { op: 'move', id: 'columna-1', to: { x: 20, z: 10 } },
    { op: 'lock', id: 'horno', reason: 'Instalación de gas' },
    { op: 'move', id: 'horno', to: { x: 1, z: 1 } },
    { op: 'update', id: 'oficina', set: { w: 9 } },
    { op: 'unlock', id: 'horno' },
]

test('un lote y su inversa devuelven el plano original', () => {
    const plant = read('transformadores.json')
    const out = applyOps(plant, LOTE)
    assert.notDeepEqual(out.plant, plant)
    const back = applyOps(out.plant, out.inverse)
    assert.deepEqual(back.rejected, [])
    assert.deepEqual(back.plant, plant)
})

test('la planta de entrada no se modifica', () => {
    const plant = read('transformadores.json')
    const copy = structuredClone(plant)
    applyOps(plant, LOTE)
    assert.deepEqual(plant, copy)
})

test('un move sobre un elemento fijo se rechaza con su motivo', () => {
    const plant = read('transformadores.json')
    const out = applyOps(plant, [
        { op: 'lock', id: 'horno', reason: 'Instalación de gas' },
        { op: 'move', id: 'horno', to: { x: 1, z: 1 } },
        { op: 'delete', id: 'horno' },
        { op: 'update', id: 'horno', set: { w: 9 } },
        { op: 'update', id: 'horno', set: { name: 'Horno grande' } },
    ])
    assert.equal(out.rejected.length, 3)
    assert.equal(out.rejected[0].reason, '«Horno de secado» está fijo: Instalación de gas')
    assert.deepEqual(out.plant.layout.horno, plant.layout.horno)
    // Cambiar el nombre no mueve nada: se permite.
    assert.equal(out.plant.stations.find((s) => s.id === 'horno').name, 'Horno grande')
})

test('borrar una estación se lleva sus rutas y la inversa las devuelve en su lugar', () => {
    const plant = read('transformadores.json')
    const out = applyOps(plant, [{ op: 'delete', id: 'ensamble' }])
    assert.ok(!out.plant.routes.some((r) => r.from === 'ensamble' || r.to === 'ensamble'))
    assert.equal(out.plant.layout.ensamble, undefined)
    assert.deepEqual(applyOps(out.plant, out.inverse).plant, plant)
})

test('operaciones inválidas se rechazan sin romper el lote', () => {
    const plant = read('transformadores.json')
    const out = applyOps(plant, [
        { op: 'connect', from: 'corte', to: 'no-existe' },
        { op: 'connect', from: 'recepcion', to: 'corte' },
        { op: 'add', element: { id: 'corte', name: 'x', x: 1, z: 1 } },
        { op: 'add', element: { id: 'sin-pos', name: 'Sin posición' } },
        { op: 'volar' },
        { op: 'move', id: 'pintura', to: { x: 30, z: 20 } },
    ])
    assert.equal(out.rejected.length, 5)
    assert.equal(out.applied.length, 1)
})

test('mover zonas, paredes y bandas', () => {
    const plant = read('transformadores-v3.json')
    const out = applyOps(plant, [
        { op: 'move', id: 'muro-pintura', to: { x: 25, z: 21 } },
        { op: 'move', id: 'banda-1', to: { x: 40, z: 14.5 } },
        { op: 'move', id: 'banos', to: { x: 45, z: 4 } },
    ])
    assert.deepEqual(out.rejected, [])
    const wall = out.plant.walls[0]
    assert.deepEqual([wall.x1, wall.x2], [25, 25])
    assert.deepEqual(out.plant.conveyors[0].points, [[40, 14.5], [40, 21.2]])
    assert.deepEqual(applyOps(out.plant, out.inverse).plant, plant)
    // Las columnas de la v3 están fijas.
    assert.equal(applyOps(plant, [{ op: 'move', id: 'columna-1', to: { x: 1, z: 1 } }]).rejected.length, 1)
})

test('migración v2 → v3 agrega los valores por defecto sin perder nada', () => {
    const plant = read('transformadores.json')
    const v3 = upgradePlant(plant)
    assert.equal(v3.schema_version, 3)
    assert.deepEqual(v3.conveyors, [])
    for (const s of v3.stations) {
        const orig = plant.stations.find((x) => x.id === s.id)
        assert.equal(s.count, 1)
        assert.equal(s.unit_w, orig.w)
        assert.equal(s.ops_per_unit, undefined) // lo deriva el motor: ops / count
        assert.equal(s.locked, false)
        for (const [k, v] of Object.entries(orig)) assert.deepEqual(s[k], v)
    }
    assert.ok(v3.routes.every((r) => r.flow === 'material' && r.is_return === false && r.conveyor === null))
    assert.deepEqual(v3.layout, plant.layout)
    // Lo que ya era v3 se conserva.
    const already = upgradePlant(read('transformadores-v3.json'))
    assert.equal(already.stations.find((s) => s.id === 'embobinado').count, 10)
    assert.equal(already.stations.find((s) => s.id === 'horno').locked, true)
})

test('al arrancar sin v3 se copia v2; v2 queda intacta', () => {
    const plant = read('transformadores.json')
    const v2 = { text: 'hola', draft: plant, plant, analysis: null, redesign: { choice: 'propio', custom: { plant, positions: plant.layout } }, maxStep: 3 }
    const raw = JSON.stringify(v2)
    const mem = new Map([[KEY_V2, raw]])
    const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) }
    const loaded = loadStored(storage)
    assert.equal(loaded.schema_version, 3)
    assert.equal(loaded.draft.stations[0].count, 1)
    assert.equal(loaded.redesign.custom.plant.schema_version, 3)
    assert.equal(loaded.text, 'hola')
    saveStored(storage, loaded)
    assert.equal(mem.get(KEY_V2), raw)
    assert.ok(mem.get(KEY_V3))
    // Ya con v3 guardada, se lee v3.
    mem.set(KEY_V3, JSON.stringify({ ...loaded, text: 'otro' }))
    assert.equal(loadStored(storage).text, 'otro')
})

test('migración tolera proyectos vacíos', () => {
    assert.equal(migrateProject(null), null)
    const p = migrateProject({ draft: null, plant: null, redesign: { choice: null, custom: null } })
    assert.equal(p.draft, null)
    assert.equal(loadStored({ getItem: () => '{roto' }), null)
})
