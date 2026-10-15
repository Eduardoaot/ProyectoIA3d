import { useEffect, useState } from 'react'
import { updateProject } from './revisions'

const KEY = 'cauce-proyecto-v2'

export const EMPTY_GAME = { missions: [], done: {} }

export const EMPTY = {
    text: '',
    info: null,
    draft: null,
    plant: null,
    analysis: null,
    redesign: { choice: null, custom: null, metrics: null },
    printed: false,
    game: EMPTY_GAME,
    maxStep: 0,
    plant_revision: 0,
    analysis_revision: 0,
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
        stations: [],
        zones: [],
        walls: [],
        routes: [],
        use_assumptions: false,
        params,
        layout: {},
    }
}

function load() {
    try {
        const raw = localStorage.getItem(KEY)
        return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY
    } catch {
        return EMPTY
    }
}

export function useProject() {
    const [p, setP] = useState(load)

    useEffect(() => {
        const t = setTimeout(() => {
        try {
            localStorage.setItem(KEY, JSON.stringify(p))
        } catch {
        }
        }, 300)
        return () => clearTimeout(t)
    }, [p])

    const update = (patch) => setP((prev) => updateProject(prev, typeof patch === 'function' ? patch(prev) : patch))
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
