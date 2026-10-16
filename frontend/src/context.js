import { same } from './revisions.js'

export const SEGMENTS = ['negocio', 'operaciones', 'tiempos', 'maquinas', 'flujo', 'personal', 'calidad', 'restricciones', 'referencias']
export function segmented(context) {
    if (context?.segments) return structuredClone(context)
    return { segments: context ? { negocio: [{ id: 'contexto-original', segment: 'negocio', version: 1, date: '', key: 'historia', value: String(context), unit: '', source: 'usuario', confidence: 'baja', owner: 'usuario' }] } : {} }
}
export function currentEntries(context) {
    const entries = Object.values(segmented(context).segments).flat()
    const replaced = new Set(entries.map((e) => e.supersedes).filter(Boolean))
    return entries.filter((e) => !replaced.has(e.id))
}
export function appendEntry(context, data) {
    const next = segmented(context)
    const segment = data.segment
    if (!SEGMENTS.includes(segment) || !data.key?.trim()) throw new Error('Selecciona un segmento y una clave.')
    const previous = currentEntries(next).find((e) => e.segment === segment && e.key === data.key)
    const entry = { ...data, id: `${segment}-${crypto.randomUUID()}`, version: (previous?.version || 0) + 1,
        date: new Date().toISOString(), source: data.source || 'usuario', confidence: data.confidence || 'baja', owner: data.owner || 'usuario', unit: data.unit || '',
        ...(previous ? { supersedes: previous.id } : {}) }
    next.segments[segment] = [...(next.segments[segment] || []), entry]
    return next
}
export function displayValue(value) {
    return Array.isArray(value) ? value.map(displayValue).join(' – ') : value == null ? 'sin datos' : typeof value === 'object' ? JSON.stringify(value) : String(value)
}
export function contextText(context) {
    if (typeof context === 'string' || context == null) return context
    return currentEntries(context).map((e) => `[${e.segment}] ${e.key}: ${displayValue(e.value)} ${e.unit || ''} (fuente: ${e.source}; confianza: ${e.confidence}; fecha: ${e.date || 'sin fecha'}; responsable: ${e.owner})`).join('\n')
}
export function plantForCapabilities(plant, capabilities) {
    return plant?.context?.segments && !capabilities.features?.includes('segmented_context') ? { ...plant, context: contextText(plant.context) } : plant
}

// Undoing a time edit appends a new value too: provenance is never removed.
export function recordTimeChanges(before, after) {
    let context = before.context
    for (const station of after.stations) {
        const previous = before.stations.find((s) => s.id === station.id)
        if (!previous) continue
        for (const field of ['t', 't_cycle_min', 'batch']) {
            if (same(previous[field], station[field])) continue
            const key = `${station.id}.${field}`
            if (!currentEntries(context).some((e) => e.segment === 'tiempos' && e.key === key)) {
                context = appendEntry(context, { segment: 'tiempos', key, value: previous[field] ?? null, unit: 'min', source: previous.t_source || 'supuesto', confidence: previous.t_source === 'medido' ? 'alta' : 'baja', owner: 'usuario' })
            }
            context = appendEntry(context, { segment: 'tiempos', key, value: station[field] ?? null, unit: 'min', source: station.t_source || 'usuario', confidence: station.t_source === 'medido' ? 'alta' : 'baja', owner: 'usuario' })
        }
    }
    return context === before.context ? after : { ...after, context }
}

export const contextSignature = (plant) => JSON.stringify(plant)
export const isConfirmed = (plant, confirmation) => !!plant && confirmation === contextSignature(plant)
export async function analyzeConfirmed(plant, confirmation, request) {
    if (!isConfirmed(plant, confirmation)) throw new Error('Confirma el Contexto 2 antes de analizar.')
    return request(plant)
}
export function summarizePlant(plant, baseline) {
    const flows = {}
    for (const route of plant.routes || []) flows[route.flow || 'material'] = (flows[route.flow || 'material'] || 0) + 1
    const fixed = ['stations', 'zones', 'walls', 'gates', 'conveyors'].flatMap((k) => (plant[k] || []).filter((e) => e.locked).map((e) => `${e.name || e.id}: ${e.lock_reason || 'fijo'}`))
    const changed = baseline ? ['stations', 'layout', 'routes', 'zones', 'walls', 'gates', 'conveyors', 'context', 'params', 'size', 'use_assumptions'].filter((k) => !same(plant[k], baseline[k])) : []
    return { stations: plant.stations.map((s) => `${s.name} ×${s.count || 1}`), fixed, flows, conveyors: (plant.conveyors || []).length, changed }
}
