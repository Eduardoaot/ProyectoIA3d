import assert from 'node:assert/strict'
import { test } from 'node:test'
import { organizeText, reviewSignature, displayEntry, entryLabel } from '../src/contextWorkspace.js'
import { addEntry, EMPTY_CONTEXT } from '../src/context.js'
import { migrateProject, loadStored, saveStored, KEY_V3 } from '../src/migrate.js'

test('organizar clasifica fragmentos sin inventar valores ni modificar el texto original', () => {
    const text = 'El horno no se puede mover.\nEl ciclo tarda 3,5 minutos.\nTrabajan seis personas.'
    const proposals = organizeText(text)
    assert.deepEqual(proposals.map((p) => p.topic), ['restricciones', 'tiempos', 'personal'])
    assert.deepEqual(proposals.map((p) => p.excerpt), text.split('\n'))
    for (const p of proposals) {
        assert.equal(p.value, p.excerpt)
        assert.equal(p.status, 'pending')
        assert.equal(p.confidence, 'baja')
        assert.equal(p.unit, '')
    }
    assert.deepEqual(organizeText(text), proposals)
    assert.equal(new Set(proposals.map((p) => p.id)).size, proposals.length)
    assert.deepEqual(organizeText('  \n '), [])
})

test('números de confianza baja conservan su valor o su rango explícito', () => {
    assert.equal(displayEntry({ value: 10, unit: 'min', confidence: 'baja' }), '10 min')
    assert.equal(displayEntry({ value: [3.5, 4.5], unit: 'min' }), '3.5 – 4.5 min')
    assert.equal(displayEntry({ value: 0 }), '0')
    assert.equal(entryLabel({ key: 'pulido.t_ciclo' }), 'pulido · Tiempo de ciclo')
    assert.equal(entryLabel({ key: 'negocio.Producto principal' }), 'Producto principal')
    assert.equal(entryLabel({ key: 'tiempos.El ciclo tarda 3.5 minutos.' }), 'El ciclo tarda 3.5 minutos.')
})

test('cada parte del contexto revisado invalida la confirmación sin depender de métricas', () => {
    const project = { draft: { stations: [], size: { w: 30, d: 16 }, walls: [], gates: [] }, text: 'Taller', context: EMPTY_CONTEXT }
    const initial = reviewSignature(project)
    const changes = [
        { text: 'Taller modificado' },
        { draft: { ...project.draft, size: { w: 31, d: 16 } } },
        { draft: { ...project.draft, walls: [{ id: 'w', x: 5 }] } },
        { draft: { ...project.draft, gates: [{ id: 'a', x: 2 }] } },
        { context: addEntry(EMPTY_CONTEXT, { segment: 'negocio', key: 'producto', value: 'Mesas' }) },
        { weights: { manejo: .5, lead_time: .5 } },
        { contextWorkspace: { attachments: [{ id: 'file' }] } },
        { contextWorkspace: { activities: [{ id: 'study', time_min: '' }] } },
    ]
    for (const change of changes) assert.notEqual(reviewSignature({ ...project, ...change }), initial)
    assert.equal(reviewSignature({ ...project, context2Ok: initial, printed: true, maxStep: 3, analysis: {} }), initial)
    assert.equal(reviewSignature({ text: 'Sin plano' }), '')
})

test('proyectos anteriores y borrador de contexto sobreviven a migración y recarga', () => {
    const previous = { draft: { stations: [], routes: [], layout: {} }, plant: null, redesign: null, text: 'Texto original' }
    const migrated = migrateProject(previous)
    const project = { ...migrated, contextWorkspace: { activities: [{ id: 'one', time_min: '', distance_m: '' }], attachments: [{ id: 'file', status: 'pending' }] } }
    const memory = new Map()
    const storage = { getItem: (k) => memory.get(k), setItem: (k, v) => memory.set(k, v) }
    saveStored(storage, project)
    assert.ok(memory.has(KEY_V3))
    assert.deepEqual(loadStored(storage), project)
    assert.equal(loadStored(storage).contextWorkspace.activities[0].time_min, '')
    assert.equal(loadStored(storage).text, previous.text)
    assert.equal(previous.draft.schema_version, undefined)
})
