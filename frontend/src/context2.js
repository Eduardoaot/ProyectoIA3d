/* Resumen determinista, sin IA, de lo que el sistema entendió del plano. Se muestra en
   «Así entendimos tu planta» dentro del contexto antes de analizar. Solo cuenta y nombra. */

const FLOW_LABEL = { material: 'material', personas: 'personas', vehiculos: 'vehículos', carga: 'carga' }

const n = (s) => Math.max(1, Math.round(Number(s.count) || 1))

function changesSince(plant, previous) {
    const names = Object.fromEntries(plant.stations.map((s) => [s.id, s.name]))
    const before = new Map(previous.stations.map((s) => [s.id, s]))
    const now = new Map(plant.stations.map((s) => [s.id, s]))
    const added = plant.stations.filter((s) => !before.has(s.id)).map((s) => s.name)
    const removed = previous.stations.filter((s) => !now.has(s.id)).map((s) => s.name)
    const moved = plant.stations.filter((s) => before.has(s.id) && JSON.stringify(previous.layout?.[s.id]) !== JSON.stringify(plant.layout?.[s.id])).map((s) => s.name)
    const counted = plant.stations.filter((s) => before.has(s.id) && n(before.get(s.id)) !== n(s)).map((s) => `${s.name} ${n(before.get(s.id))} → ${n(s)}`)
    const key = (r) => `${r.from}>${r.to}>${r.flow || 'material'}`
    const label = (k) => {
        const [a, b] = k.split('>')
        return `${names[a] || a} → ${names[b] || b}`
    }
    const rb = new Set((previous.routes || []).map(key))
    const rn = new Set((plant.routes || []).map(key))
    const ra = [...rn].filter((k) => !rb.has(k))
    const rr = [...rb].filter((k) => !rn.has(k))
    const out = []
    if (added.length) out.push(`Nuevas: ${added.join(', ')}.`)
    if (removed.length) out.push(`Quitadas: ${removed.join(', ')}.`)
    if (moved.length) out.push(`Cambiaron de lugar: ${moved.join(', ')}.`)
    if (counted.length) out.push(`Cambió la cantidad: ${counted.join(', ')}.`)
    if (ra.length) out.push(`Rutas nuevas: ${ra.map(label).join(', ')}.`)
    if (rr.length) out.push(`Rutas quitadas: ${rr.map(label).join(', ')}.`)
    if (!out.length) out.push('Sin cambios en estaciones ni rutas desde el último análisis.')
    return out
}

export function summarize(plant, previous = null) {
    if (!plant) return { lines: [], changes: [], signature: '' }
    const machines = plant.stations.reduce((a, s) => a + n(s), 0)
    const lines = [`${plant.stations.length} estaciones con ${machines} máquinas o áreas: ` + plant.stations.map((s) => (n(s) > 1 ? `${s.name} ×${n(s)}` : s.name)).join(', ') + '.']
    const fixed = [...plant.stations.filter((s) => s.locked), ...(plant.zones || []).filter((z) => z.locked), ...(plant.conveyors || []).filter((c) => c.locked)]
    lines.push(fixed.length ? `Fijos (no se mueven): ${fixed.map((x) => x.name + (x.lock_reason ? ` (${x.lock_reason})` : '')).join(', ')}.` : 'Nada está fijo: todas las máquinas se pueden mover en las alternativas.')
    const byFlow = {}
    for (const r of plant.routes || []) (byFlow[r.flow || 'material'] = byFlow[r.flow || 'material'] || []).push(r)
    for (const [fl, rs] of Object.entries(byFlow)) {
        const ret = rs.filter((r) => r.is_return).length
        lines.push(`Rutas de ${FLOW_LABEL[fl] || fl}: ${rs.length}${ret ? ` (${ret} de retorno)` : ''}.`)
    }
    if ((plant.conveyors || []).length) lines.push(`Bandas: ${plant.conveyors.map((c) => c.name || c.id).join(', ')}.`)
    const changes = previous ? changesSince(plant, previous) : []
    // La firma cambia con cualquier edición del plano: lo confirmado deja de valer.
    const signature = JSON.stringify({ stations: plant.stations, routes: plant.routes, zones: plant.zones, conveyors: plant.conveyors || [], layout: plant.layout })
    return { lines, changes, signature }
}
