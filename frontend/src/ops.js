/* Operaciones sobre el plano (contrato v3 §5). Es el único formato de los cambios
   automáticos (aplicar una propuesta, el asistente, fijar, cambios en grupo): cada lote
   devuelve su inversa, así deshacer deja el plano idéntico.

   applyOps(plant, ops) → { plant, inverse, applied, rejected }
   - plant: copia nueva; la de entrada no se toca.
   - inverse: operaciones que, aplicadas sobre el resultado, devuelven el plano original.
   - rejected: [{ op, reason }] con el motivo en palabras (por ejemplo, un elemento fijo).

   Además del contrato, las inversas usan dos campos opcionales: `at` (posición en la lista,
   para que el orden quede igual) y `unset` en update (campos que antes no existían). */

const ZONE_KINDS = new Set(['oficina', 'banos', 'comedor', 'bloqueado', 'obstaculo'])
// Cambiar cualquiera de estos campos mueve o cambia de tamaño el elemento: no se permite si está fijo.
const GEOMETRY = new Set(['x', 'z', 'w', 'd', 'rot', 'unit_w', 'unit_d', 'count', 'arrangement', 'points', 'x1', 'z1', 'x2', 'z2'])
const LISTS = { station: 'stations', zone: 'zones', conveyor: 'conveyors', wall: 'walls' }

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))
const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 8)}`
const flowOf = (r) => r.flow || 'material'

export function classify(el) {
    if (Array.isArray(el?.points)) return 'conveyor'
    if (el && 'x1' in el) return 'wall'
    if (el?.type === 'zone' || ZONE_KINDS.has(el?.kind)) return 'zone'
    return 'station'
}

export function findElement(plant, id) {
    for (const [type, list] of Object.entries(LISTS)) {
        const i = (plant[list] || []).findIndex((x) => x.id === id)
        if (i >= 0) return { type, list, index: i, item: plant[list][i] }
    }
    return null
}

const label = (item) => `«${item.name || item.id}»`
const lockedMsg = (item) => `${label(item)} está fijo${item.lock_reason ? `: ${item.lock_reason}` : ''}`

function insert(p, name, item, at) {
    const list = (p[name] = p[name] || [])
    if (at == null || at < 0 || at > list.length) list.push(item)
    else list.splice(at, 0, item)
}

/* Copia de trabajo. Las listas que no existen no se crean salvo que se inserte algo,
   así la inversa deja el plano idéntico (sin `conveyors: []` de más). */
function prepare(plant) {
    const p = clone(plant)
    p.stations = p.stations || []
    p.routes = p.routes || []
    p.layout = p.layout || {}
    return p
}

function applyOne(p, op) {
    switch (op?.op) {
        case 'add': {
            const el = clone(op.element)
            if (!el?.id) return { error: 'Falta el id del elemento a agregar' }
            if (findElement(p, el.id)) return { error: `Ya existe un elemento con id ${el.id}` }
            const type = classify(el)
            if (type === 'station') {
                const { x, z, rot, type: _t, ...station } = el
                if (typeof x !== 'number' || typeof z !== 'number') return { error: `${label(el)} no tiene posición (x, z)` }
                insert(p, 'stations', station, op.at)
                p.layout[el.id] = [x, z, rot || 0]
            } else {
                const { type: _t, ...rest } = el
                insert(p, LISTS[type], rest, op.at)
            }
            return { inverse: [{ op: 'delete', id: el.id }] }
        }
        case 'delete': {
            const f = findElement(p, op.id)
            if (!f) return { error: `No existe ${op.id}` }
            if (f.item.locked) return { error: lockedMsg(f.item) }
            p[f.list].splice(f.index, 1)
            const inverse = []
            if (f.type === 'station') {
                const [x, z, rot] = p.layout[op.id] || [0, 0, 0]
                delete p.layout[op.id]
                inverse.push({ op: 'add', element: { ...f.item, x, z, rot }, at: f.index })
                // Las rutas que tocaban la estación se van con ella y vuelven con la inversa.
                const kept = []
                p.routes.forEach((r, i) => {
                    if (r.from === op.id || r.to === op.id) inverse.push({ op: 'connect', ...r, at: i })
                    else kept.push(r)
                })
                p.routes = kept
            } else inverse.push({ op: 'add', element: f.item, at: f.index })
            return { inverse }
        }
        case 'move': {
            const f = findElement(p, op.id)
            if (!f) return { error: `No existe ${op.id}` }
            if (f.item.locked) return { error: lockedMsg(f.item) }
            const to = op.to || {}
            if (typeof to.x !== 'number' || typeof to.z !== 'number') return { error: `Falta el destino (x, z) de ${label(f.item)}` }
            if (f.type === 'station') {
                const old = p.layout[op.id] || [0, 0, 0]
                p.layout[op.id] = [to.x, to.z, to.rot ?? old[2] ?? 0]
                return { inverse: [{ op: 'move', id: op.id, to: { x: old[0], z: old[1], rot: old[2] || 0 } }] }
            }
            const it = f.item
            let from
            if (f.type === 'zone') {
                from = { x: it.x, z: it.z }
                it.x = to.x
                it.z = to.z
            } else if (f.type === 'wall') {
                from = { x: it.x1, z: it.z1 }
                const dx = to.x - it.x1
                const dz = to.z - it.z1
                Object.assign(it, { x1: it.x1 + dx, z1: it.z1 + dz, x2: it.x2 + dx, z2: it.z2 + dz })
            } else {
                from = { x: it.points[0][0], z: it.points[0][1] }
                const dx = to.x - from.x
                const dz = to.z - from.z
                it.points = it.points.map(([a, b]) => [a + dx, b + dz])
            }
            return { inverse: [{ op: 'move', id: op.id, to: from }] }
        }
        case 'update': {
            const f = findElement(p, op.id)
            if (!f) return { error: `No existe ${op.id}` }
            const set = op.set || {}
            const unset = op.unset || []
            const keys = [...Object.keys(set), ...unset]
            if (f.item.locked && keys.some((k) => GEOMETRY.has(k))) return { error: lockedMsg(f.item) }
            const before = {}
            const missing = []
            for (const k of keys) {
                if (k in f.item) before[k] = clone(f.item[k])
                else missing.push(k)
            }
            for (const k of unset) delete f.item[k]
            Object.assign(f.item, clone(set))
            return { inverse: [{ op: 'update', id: op.id, set: before, ...(missing.length ? { unset: missing } : {}) }] }
        }
        case 'connect': {
            const ids = new Set(p.stations.map((s) => s.id))
            if (!ids.has(op.from) || !ids.has(op.to)) return { error: `La ruta ${op.from} → ${op.to} une estaciones que no existen` }
            if (op.from === op.to) return { error: 'Una ruta no puede salir y llegar a la misma estación' }
            const flow = op.flow || 'material'
            if (p.routes.some((r) => r.from === op.from && r.to === op.to && flowOf(r) === flow)) return { error: `Ya existe la ruta ${op.from} → ${op.to}` }
            const { op: _o, at, reason: _r, ...fields } = op
            const route = { id: op.id || uid('r'), ...fields, frac: op.frac ?? 1 }
            insert(p, 'routes', route, at)
            return { inverse: [{ op: 'disconnect', from: op.from, to: op.to, flow }] }
        }
        case 'disconnect': {
            const flow = op.flow || 'material'
            const i = p.routes.findIndex((r) => r.from === op.from && r.to === op.to && flowOf(r) === flow)
            if (i < 0) return { error: `No existe la ruta ${op.from} → ${op.to}` }
            const [r] = p.routes.splice(i, 1)
            return { inverse: [{ op: 'connect', ...r, at: i }] }
        }
        case 'lock':
        case 'unlock': {
            const f = findElement(p, op.id)
            if (!f) return { error: `No existe ${op.id}` }
            const set = op.op === 'lock' ? { locked: true, lock_reason: op.reason || f.item.lock_reason || '' } : { locked: false }
            return applyOne(p, { op: 'update', id: op.id, set, ...(op.op === 'unlock' && 'lock_reason' in f.item ? { unset: ['lock_reason'] } : {}) })
        }
        default:
            return { error: `Operación desconocida: ${op?.op}` }
    }
}

export function applyOps(plant, ops) {
    const p = prepare(plant)
    const inverse = []
    const applied = []
    const rejected = []
    for (const op of ops || []) {
        const r = applyOne(p, op)
        if (r.error) rejected.push({ op, reason: r.error })
        else {
            // La inversa del lote deshace de la última operación a la primera.
            inverse.unshift(...r.inverse)
            applied.push(op)
        }
    }
    return { plant: p, inverse, applied, rejected }
}

/* Las posiciones viajan aparte en el editor ({ plant, positions }); estas dos funciones las juntan. */
export const withLayout = (plant, positions) => ({ ...plant, layout: positions })
export const splitLayout = (plant) => ({ plant, positions: plant.layout })
