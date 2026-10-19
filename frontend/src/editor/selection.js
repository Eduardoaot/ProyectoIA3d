import { rectOf, snap, uid } from './geometry.js'
import { applyOps, diffOps, locate } from './operations.js'

export const FLOWS = ['material', 'personas', 'vehiculos', 'carga']
export const selected = (items, type, id) => items.some((s) => s.type === type && s.id === id)
export function toggleSelection(items, item) {
    return selected(items, item.type, item.id) ? items.filter((s) => s.id !== item.id || s.type !== item.type) : [...items, item]
}

function bounds(plant, type, e) {
    if (type === 'station') return rectOf(e, plant.layout[e.id])
    if (type === 'zone') return { x: e.x - e.w / 2, z: e.z - e.d / 2, w: e.w, d: e.d }
    if (type === 'gate') return { x: e.x - 2.2, z: plant.size.d - 0.35, w: 4.4, d: 1 }
    const points = type === 'wall' ? [[e.x1, e.z1], [e.x2, e.z2]] : e.points
    if (!points?.length) return null
    const xs = points.map((p) => p[0]), zs = points.map((p) => p[1])
    return { x: Math.min(...xs), z: Math.min(...zs), w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) }
}

export function rectangleSelection(plant, rectangle, full = true) {
    const x = Math.min(rectangle.x1, rectangle.x2), z = Math.min(rectangle.z1, rectangle.z2)
    const right = Math.max(rectangle.x1, rectangle.x2), bottom = Math.max(rectangle.z1, rectangle.z2)
    return (full ? ['station', 'zone', 'wall', 'gate', 'conveyor'] : ['station']).flatMap((type) =>
        (plant[`${type}s`] || []).filter((e) => {
            const b = bounds(plant, type, e)
            return b && b.x >= x && b.z >= z && b.x + b.w <= right && b.z + b.d <= bottom
        }).map((e) => ({ type, id: e.id })))
}

export function groupMoveOps(plant, selection, dx, dz) {
    const movable = selection.filter((s) => s.type !== 'route').map((s) => ({ ...s, ...locate(plant, s.id) })).filter((s) => s.element)
    if (!movable.length) return []
    const fixed = movable.find((s) => s.element.locked)
    if (fixed) throw new Error(`${fixed.element.name || fixed.id}: ${fixed.element.lock_reason || 'Elemento bloqueado'}`)
    const boxes = movable.map((s) => bounds(plant, s.type, s.element)).filter(Boolean)
    const left = Math.min(...boxes.map((b) => b.x)), right = Math.max(...boxes.map((b) => b.x + b.w))
    const top = Math.min(...boxes.map((b) => b.z)), bottom = Math.max(...boxes.map((b) => b.z + (b.z >= plant.size.d - 0.35 ? 0 : b.d)))
    dx = Math.min(Math.max(0, plant.size.w - right), Math.max(Math.min(0, -left), snap(dx)))
    dz = Math.min(Math.max(0, plant.size.d - bottom), Math.max(Math.min(0, -top), snap(dz)))
    if (movable.some((s) => s.type === 'gate')) dz = 0
    if (!dx && !dz) return []
    return movable.map(({ type, id, element: e }) => {
        const [x, z] = type === 'station' ? plant.layout[id] : type === 'wall' ? [e.x1, e.z1] : type === 'conveyor' ? e.points[0] : [e.x, e.z || plant.size.d]
        return { op: 'move', id, to: { x: x + dx, z: z + dz } }
    })
}

export function copySelection(plant, selection) {
    const ids = new Set(selection.filter((s) => s.type === 'station').map((s) => s.id))
    const items = selection.filter((s) => !['route', 'conveyor'].includes(s.type)).map((s) => ({ type: s.type, ...locate(plant, s.id) })).filter((s) => s.element)
    const conveyors = (plant.conveyors || []).filter((c) => ids.has(c.from) && ids.has(c.to))
    return structuredClone({ items, layout: plant.layout, conveyors, routes: plant.routes.filter((r) => ids.has(r.from) && ids.has(r.to)) })
}

export function pasteOps(clipboard, offset = 1) {
    if (!clipboard?.items.length) return { ops: [], selection: [] }
    const map = new Map([...clipboard.items.map((s) => s.element.id), ...clipboard.conveyors.map((c) => c.id)].map((id) => [id, uid('copy-')]))
    const shift = (e, type) => {
        const next = { ...e, id: map.get(e.id) }
        if (type === 'zone' || type === 'gate') { next.x += offset; if (type === 'zone') next.z += offset }
        if (type === 'wall') for (const k of ['x1', 'z1', 'x2', 'z2']) next[k] += offset
        return next
    }
    const ops = clipboard.items.map(({ type, key, element }) => ({ op: 'add', element: shift(element, type), _collection: key,
        ...(type === 'station' ? { _position: clipboard.layout[element.id].map((v, i) => i < 2 ? v + offset : v) } : {}) }))
    for (const c of clipboard.conveyors) ops.push({ op: 'add', _collection: 'conveyors', element: { ...c, id: map.get(c.id), from: map.get(c.from), to: map.get(c.to), points: c.points.map(([x, z]) => [x + offset, z + offset]) } })
    for (const r of clipboard.routes) ops.push({ op: 'connect', ...r, id: uid('r'), from: map.get(r.from), to: map.get(r.to), ...(r.conveyor ? { conveyor: map.get(r.conveyor) || null } : {}) })
    return { ops, selection: clipboard.items.map((s) => ({ type: s.type, id: map.get(s.element.id) })) }
}

export function deleteSelectionOps(plant, selection) {
    const ids = new Set(selection.map((s) => s.id))
    const gates = plant.gates.filter((g) => !ids.has(g.id))
    if (plant.gates.length && !gates.length) throw new Error('Conserva al menos un portón.')
    let next = plant
    // Explicitly selected dependents first; station deletion cascades to the rest.
    for (const s of [...selection].sort((a, b) => Number(a.type === 'station') - Number(b.type === 'station'))) {
        if (!locate(next, s.id)) continue
        next = applyOps(next, [s.type === 'route' ? { op: 'disconnect', id: s.id } : { op: 'delete', id: s.id }]).plant
    }
    next = { ...next, receive_gate: ids.has(plant.receive_gate) ? gates[0]?.id : plant.receive_gate, dispatch_gate: ids.has(plant.dispatch_gate) ? gates[0]?.id : plant.dispatch_gate }
    return diffOps(plant, next)
}

export function routeGroupOps(plant, selection, patch) {
    if (patch.flow != null && !FLOWS.includes(patch.flow)) throw new Error('Flujo desconocido.')
    if (patch.frac != null && (!Number.isFinite(patch.frac) || patch.frac < 0 || patch.frac > 1)) throw new Error('El porcentaje debe estar entre 0 y 100.')
    return selection.filter((s) => s.type === 'route' && plant.routes.some((r) => r.id === s.id)).map((s) => ({ op: 'update', id: s.id, set: patch }))
}
