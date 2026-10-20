import { useEffect, useState } from 'react'
import { addProject, clearProjectContext, listProjects, loadLibrary, saveLibrary, selectProject, updateProject } from './projectLibrary'

export const EMPTY = {
    text: '',
    info: null,
    draft: null,
    plant: null,
    analysis: null,
    redesign: { choice: null, custom: null, metrics: null },
    printed: false,
    maxStep: 0,
}

export function blankPlant(params = {}) {
    return {
        name: 'Mi planta',
        industry: '',
        size: { w: 30, d: 16 },
        gates: [
            { id: 'A', x: 6, label: 'Portón A' },
            { id: 'B', x: 22, label: 'Portón B' },
        ],
        receive_gate: 'A',
        dispatch_gate: 'B',
        schema_version: 3,
        stations: [],
        zones: [],
        walls: [],
        routes: [],
        conveyors: [],
        params,
        layout: {},
    }
}

export function useProject() {
    const [library, setLibrary] = useState(() => loadLibrary(localStorage))
    const activeId = library.activeId
    const p = { ...EMPTY, ...library.projects[activeId].data }

    useEffect(() => {
        saveLibrary(localStorage, library)
    }, [library])

    // Cada callback queda ligado al proyecto de su render. Una respuesta asíncrona de
    // otro proyecto no puede modificar el que el usuario acaba de abrir.
    const update = (patch) => setLibrary((prev) => updateProject(prev, activeId, patch))
    const reset = () => setLibrary((prev) => updateProject(prev, activeId, { ...EMPTY, name: prev.projects[activeId]?.name }))
    const create = (name) => setLibrary((prev) => addProject(prev, name, EMPTY))
    const select = (id) => setLibrary((prev) => selectProject(prev, id))
    const clearContext = () => setLibrary((prev) => clearProjectContext(prev, activeId))

    return [p, update, reset, { activeId, projects: listProjects(library), create, select, clearContext }]
}

export function customOf(project) {
    const c = project.redesign?.custom
    if (!c) return null

    return c.positions ? c : { plant: project.plant, positions: c }
}

export function chosen(project) {
    const { analysis, redesign, plant } = project
    if (!analysis || !redesign?.choice) return null
    
    const custom = customOf(project)

    if (redesign.choice === 'propio' && custom) return { id: 'propio', name: 'Tu rediseño', plant: custom.plant, positions: custom.positions, metrics: redesign.metrics }
    const alt = analysis.alternatives.find((a) => a.id === redesign.choice)

    return alt ? { id: alt.id, name: alt.name, plant, positions: alt.positions, metrics: alt.metrics } : null
}
