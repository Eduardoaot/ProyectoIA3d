import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KEY_V2, KEY_V3 } from '../src/migrate.js'
import { addProject, clearProjectContext, LIBRARY_KEY, listProjects, loadLibrary, saveLibrary, selectProject, updateProject } from '../src/projectLibrary.js'

const memory = () => {
    const values = new Map()
    return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}

test('el proyecto anterior se incorpora a la colección sin perder su contenido', () => {
    const storage = memory()
    const previous = { text: 'Planta anterior', draft: { name: 'Transformadores', stations: [], routes: [] }, context: { segments: { negocio: [{ id: 'n-1', value: '80 piezas' }] } } }
    storage.setItem(KEY_V3, JSON.stringify(previous))
    const library = loadLibrary(storage)
    assert.equal(library.projects[library.activeId].name, 'Transformadores')
    assert.equal(library.projects[library.activeId].data.text, 'Planta anterior')
    assert.equal(library.projects[library.activeId].data.context.segments.negocio.length, 1)
    assert.equal(saveLibrary(storage, library), true)
    assert.ok(storage.getItem(LIBRARY_KEY))
    assert.deepEqual(loadLibrary(storage), library)
    assert.deepEqual(JSON.parse(storage.getItem(KEY_V3)), library.projects[library.activeId].data)
    assert.equal(storage.getItem(KEY_V2), null)
})

test('cada proyecto conserva su contexto, plano y adjuntos; borrar contexto afecta solo al activo', () => {
    const storage = memory()
    const base = loadLibrary(storage)
    const firstId = base.activeId
    const first = updateProject(base, firstId, {
        text: 'Proyecto A', draft: { name: 'Plano A' }, weights: { manejo: 1 },
        context: { segments: { tiempos: [{ id: 'a', value: 12 }] } },
        contextWorkspace: { attachments: [{ id: 'archivo-a' }], activities: [{ id: 'estudio-a' }] },
    })
    const second = addProject(first, 'Proyecto B', {})
    const secondId = second.activeId
    const populated = updateProject(second, secondId, {
        text: 'Proyecto B', info: { notes: ['lectura anterior'] }, draft: { name: 'Plano B' },
        context: { segments: { operaciones: [{ id: 'b', value: 'corte' }] } },
        contextWorkspace: { attachments: [{ id: 'archivo-b' }], activities: [] },
    })
    const cleared = clearProjectContext(populated, secondId)
    assert.equal(cleared.projects[secondId].data.text, '')
    assert.equal(cleared.projects[secondId].data.info, null)
    assert.deepEqual(cleared.projects[secondId].data.contextWorkspace.attachments, [])
    assert.equal(cleared.projects[secondId].data.draft.name, 'Plano B')
    const back = selectProject(cleared, firstId)
    assert.equal(back.projects[firstId].data.text, 'Proyecto A')
    assert.equal(back.projects[firstId].data.contextWorkspace.attachments[0].id, 'archivo-a')
    assert.equal(back.projects[firstId].data.draft.name, 'Plano A')
    assert.equal(listProjects(back).length, 2)
    saveLibrary(storage, back)
    assert.equal(loadLibrary(storage).activeId, firstId)
    assert.equal(JSON.parse(storage.getItem(KEY_V3)).text, 'Proyecto A')
})

test('una respuesta tardía asociada al proyecto anterior no escribe en el proyecto activo', () => {
    const first = loadLibrary(memory())
    const previousId = first.activeId
    const next = addProject(first, 'Nuevo', {})
    const result = updateProject(next, previousId, { analysis: { from: 'respuesta tardía' } })
    assert.equal(result.projects[result.activeId].data.analysis, undefined)
    assert.equal(result.projects[previousId].data.analysis.from, 'respuesta tardía')
})
