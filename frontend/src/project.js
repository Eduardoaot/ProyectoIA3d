import { useEffect, useState } from 'react'
import { loadStored, saveStored } from './migrate'

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

/* Se guarda en cauce-proyecto-v3; la primera vez se copia y migra desde v2, que no se toca. */
function load() {
    try {
        const stored = loadStored(localStorage)
        return stored ? { ...EMPTY, ...stored } : EMPTY
    } catch {
        return EMPTY
    }
}

export function useProject() {
    const [p, setP] = useState(load)

    useEffect(() => {
        const t = setTimeout(() => saveStored(localStorage, p), 300)
        return () => clearTimeout(t)
    }, [p])

    const update = (patch) => setP((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }))
    const reset = () => setP(EMPTY)

    return [p, update, reset]
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