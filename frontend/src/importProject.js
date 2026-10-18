/* Lee un proyecto guardado como JSON: una planta suelta (como pruebas/transformadores.json)
   o un proyecto completo exportado de Cauce ({ plant, draft, ... }). Devuelve la planta
   lista para el editor o un error en palabras. No toca lo que ya está guardado. */

const DEFAULTS = {
    name: 'Planta importada',
    industry: '',
    size: { w: 30, d: 16 },
    gates: [{ id: 'A', x: 6, label: 'Portón A' }],
    stations: [],
    zones: [],
    walls: [],
    routes: [],
    use_assumptions: false,
    params: {},
    layout: {},
}

function asPlant(obj) {
    if (!obj || typeof obj !== 'object') return null
    if (Array.isArray(obj.stations)) return obj
    return asPlant(obj.draft) || asPlant(obj.plant)
}

export function parseProject(text) {
    let data
    try {
        data = JSON.parse(text)
    } catch {
        return { error: 'El archivo no es un JSON válido.' }
    }
    const src = asPlant(data)
    if (!src) return { error: 'El archivo no trae una planta (falta la lista de estaciones).' }

    const plant = { ...DEFAULTS, ...src }
    if (!plant.size || !(plant.size.w > 0) || !(plant.size.d > 0)) return { error: 'La planta no tiene medidas válidas (size.w y size.d).' }
    const gates = plant.gates?.length ? plant.gates : DEFAULTS.gates
    const ids = new Set(plant.stations.map((s) => s.id))
    const missing = plant.stations.filter((s) => !plant.layout?.[s.id]).map((s) => s.name || s.id)
    const routes = (plant.routes || []).filter((r) => ids.has(r.from) && ids.has(r.to))
    // Lo que no trae posición queda en el centro, a la vista, para acomodarlo a mano.
    const layout = { ...plant.layout }
    for (const s of plant.stations) if (!layout[s.id]) layout[s.id] = [plant.size.w / 2, plant.size.d / 2, 0]

    return {
        plant: {
            ...plant,
            layout,
            gates,
            receive_gate: plant.receive_gate || gates[0].id,
            dispatch_gate: plant.dispatch_gate || gates[gates.length - 1].id,
            routes,
        },
        warnings: [
            ...(missing.length ? [`Sin posición en el plano: ${missing.join(', ')}. Quedan en el centro del plano para acomodarlas.`] : []),
            ...(routes.length < (plant.routes || []).length ? ['Se quitaron rutas que apuntaban a estaciones inexistentes.'] : []),
        ],
    }
}
