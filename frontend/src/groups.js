/* Trabajo en grupo sobre el plano (criterios §8.1–8.2): selección por rectángulo, mover,
   copiar, cortar y pegar varias estaciones con sus rutas internas. Todo se expresa como
   operaciones del contrato §5, así cada acción es un solo paso de deshacer. */

import { dims } from './editor/geometry.js'

export function stationRect(s, pos) {
    const [w, d] = dims(s, pos?.[2])
    return { x0: pos[0] - w / 2, z0: pos[1] - d / 2, x1: pos[0] + w / 2, z1: pos[1] + d / 2 }
}

/* Estaciones que toca el rectángulo (como en PowerPoint con «tocar»). */
export function selectInRect(plant, positions, r) {
    const x0 = Math.min(r.x1, r.x2)
    const x1 = Math.max(r.x1, r.x2)
    const z0 = Math.min(r.z1, r.z2)
    const z1 = Math.max(r.z1, r.z2)
    return plant.stations
        .filter((s) => {
            const p = positions[s.id]
            if (!p) return false
            const b = stationRect(s, p)
            return b.x0 < x1 && b.x1 > x0 && b.z0 < z1 && b.z1 > z0
        })
        .map((s) => s.id)
}

/* Copia: las estaciones, sus lugares y solo las rutas entre ellas. */
export function copyGroup(plant, positions, ids) {
    const set = new Set(ids)
    return {
        type: 'group',
        stations: plant.stations.filter((s) => set.has(s.id)).map((s) => structuredClone(s)),
        positions: Object.fromEntries(ids.filter((id) => positions[id]).map((id) => [id, [...positions[id]]])),
        routes: (plant.routes || []).filter((r) => set.has(r.from) && set.has(r.to)).map((r) => structuredClone(r)),
        n: 0,
    }
}

/* Pegar: ids nuevos, desplazado, y las rutas internas apuntando a las copias. */
export function pasteOps(clip, plant, offset, makeId) {
    const used = new Set(plant.stations.map((s) => s.id))
    const map = {}
    const ops = []
    for (const s of clip.stations) {
        let id = makeId('s')
        while (used.has(id)) id = makeId('s')
        used.add(id)
        map[s.id] = id
        const [x, z, rot] = clip.positions[s.id] || [0, 0, 0]
        ops.push({ op: 'add', element: { ...s, id, name: `${s.name} (copia)`, locked: false, lock_reason: '', x: x + offset[0], z: z + offset[1], rot: rot || 0 } })
    }
    for (const r of clip.routes) {
        const { id: _old, from, to, ...rest } = r
        ops.push({ op: 'connect', ...rest, id: makeId('r'), from: map[from], to: map[to] })
    }
    return { ops, ids: Object.values(map) }
}

export const deleteOps = (ids) => ids.map((id) => ({ op: 'delete', id }))

/* Mover el grupo: los fijos no se mueven (applyOps los rechaza y se avisa). */
export function moveOps(positions, ids, dx, dz) {
    return ids.filter((id) => positions[id]).map((id) => ({ op: 'move', id, to: { x: Math.round((positions[id][0] + dx) * 100) / 100, z: Math.round((positions[id][1] + dz) * 100) / 100, rot: positions[id][2] || 0 } }))
}

/* Rutas entre las estaciones elegidas (para cambiarles flujo o porcentaje juntas). */
export function routesAmong(plant, ids) {
    const set = new Set(ids)
    return (plant.routes || []).filter((r) => set.has(r.from) && set.has(r.to))
}

export function patchRoutes(plant, routeIds, patch) {
    const set = new Set(routeIds)
    return { ...plant, routes: plant.routes.map((r) => (set.has(r.id) ? { ...r, ...patch } : r)) }
}
