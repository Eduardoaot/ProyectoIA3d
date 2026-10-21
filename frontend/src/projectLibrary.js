import { loadStored, saveStored } from './migrate.js'
import { current } from './context.js'

export const LIBRARY_KEY = 'cauce-proyectos-v1'

const id = () => globalThis.crypto?.randomUUID?.() || `proyecto-${Date.now()}-${Math.random().toString(36).slice(2)}`
const nameOf = (data) => data?.name || data?.draft?.name || data?.plant?.name || 'Mi primer proyecto'

export function newRecord(name, data = {}) {
    const projectId = id()
    const title = String(name || 'Nuevo proyecto').trim().slice(0, 80) || 'Nuevo proyecto'
    return { id: projectId, name: title, data: { ...data, name: title } }
}

export function loadLibrary(storage) {
    try {
        const saved = JSON.parse(storage.getItem(LIBRARY_KEY) || 'null')
        if (saved?.activeId && saved.projects?.[saved.activeId]?.data && typeof saved.projects === 'object') return saved
    } catch { /* la copia anterior sigue disponible */ }
    const old = loadStored(storage)
    const first = newRecord(nameOf(old), old || {})
    return { version: 1, activeId: first.id, projects: { [first.id]: first } }
}

export function saveLibrary(storage, library) {
    try {
        storage.setItem(LIBRARY_KEY, JSON.stringify(library))
        // Copia de compatibilidad para clientes anteriores. La colección es la fuente de verdad.
        saveStored(storage, library.projects[library.activeId].data)
        return true
    } catch {
        return false
    }
}

export function listProjects(library) {
    return Object.values(library.projects).map(({ id: projectId, name, data }) => ({
        id: projectId, name, hasPlant: !!(data.plant || data.draft),
        contextItems: current(data.context).length, savedAt: data.savedAt || null,
    }))
}

export function addProject(library, name, empty) {
    const record = newRecord(name, empty)
    return { ...library, activeId: record.id, projects: { ...library.projects, [record.id]: record } }
}

export function selectProject(library, projectId) {
    return library.projects[projectId] ? { ...library, activeId: projectId } : library
}

export function updateProject(library, projectId, change) {
    const record = library.projects[projectId]
    if (!record) return library
    const data = { ...record.data, ...(typeof change === 'function' ? change(record.data) : change) }
    return { ...library, projects: { ...library.projects, [projectId]: { ...record, data } } }
}

export function clearProjectContext(library, projectId) {
    return updateProject(library, projectId, {
        text: '', info: null, context: { segments: {} }, contextWorkspace: { proposals: [], attachments: [], activities: [] },
        weights: null, prioritiesEnabled: true, context2Ok: null, analysisInputSignature: null, printed: false,
    })
}

// Guardar un proyecto terminado: le pone el nombre elegido y marca cuándo se guardó.
export function saveProject(library, projectId, name, date = new Date().toISOString()) {
    const title = String(name || '').trim().slice(0, 80)
    const record = library.projects[projectId]
    if (!record || !title) return library
    return { ...library, projects: { ...library.projects, [projectId]: { ...record, name: title, data: { ...record.data, name: title, savedAt: date } } } }
}
