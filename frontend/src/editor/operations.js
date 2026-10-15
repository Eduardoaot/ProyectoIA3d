import { same } from '../revisions.js'

export const COLLECTIONS = ['stations', 'zones', 'walls', 'gates', 'conveyors', 'routes']
const geometry = new Set(['x', 'z', 'w', 'd', 'x1', 'z1', 'x2', 'z2', 'points', 'rot', 'unit_w', 'unit_d', 'count', 'arrangement'])
const clone = (value) => structuredClone(value)
const fail = (message) => { throw new Error(message) }
const validPoint = (values) => values.every(Number.isFinite)
export function locate(plant, id, collection) {
    for (const key of collection ? [collection] : COLLECTIONS) {
        const index = (plant[key] || []).findIndex((item) => item.id === id)
        if (index >= 0) return { key, index, element: plant[key][index] }
    }
    return null
}

// Private underscore fields preserve list order / absent properties in local
// undo. They are never sent to the backend or accepted from the assistant.
export function diffOps(before, after, restoring = false) {
    const ops = []
    for (const key of COLLECTIONS) {
        for (const element of before[key] || []) {
            if (!(after[key] || []).some((item) => item.id === element.id)) {
                if (restoring && element.locked) ops.push({ op: 'unlock', id: element.id, _collection: key })
                ops.push(key === 'routes' ? { op: 'disconnect', id: element.id, from: element.from, to: element.to, flow: element.flow || 'material' } : { op: 'delete', id: element.id, _collection: key })
            }
        }
    }
    for (const key of COLLECTIONS) {
        for (const [index, element] of (after[key] || []).entries()) {
            const previous = (before[key] || []).find((item) => item.id === element.id)
            if (!previous) {
                ops.push(key === 'routes' ? { op: 'connect', ...element, _exact: true, _index: index } : { op: 'add', element, _collection: key, _index: index, ...(key === 'stations' ? { _position: after.layout[element.id] } : {}) })
                continue
            }
            if (previous.locked && !element.locked) ops.push({ op: 'unlock', id: element.id, _collection: key })
            const set = Object.fromEntries(Object.entries(element).filter(([k, v]) => !same(previous[k], v)))
            const unset = Object.keys(previous).filter((k) => !Object.hasOwn(element, k))
            if (Object.keys(set).length || unset.length) ops.push({ op: 'update', id: element.id, set, _unset: unset, _collection: key })
            if (key === 'stations' && !same(before.layout[element.id], after.layout[element.id])) {
                const [x, z, rot] = after.layout[element.id]
                ops.push({ op: 'move', id: element.id, to: { x, z, ...(rot != null ? { rot } : {}) }, _position: after.layout[element.id] })
            }
        }
    }
    const rootKeys = new Set([...Object.keys(before), ...Object.keys(after)])
    const set = {}, unset = []
    for (const key of rootKeys) {
        if (key === 'layout' || COLLECTIONS.includes(key)) continue
        if (!Object.hasOwn(after, key)) unset.push(key)
        else if (!same(before[key], after[key])) set[key] = after[key]
    }
    for (const key of COLLECTIONS) if (Object.hasOwn(before, key) && !Object.hasOwn(after, key)) unset.push(key)
    if (Object.keys(set).length || unset.length) ops.push({ op: 'update', id: '$plant', set, _unset: unset })
    return ops
}

export function applyOps(original, ops) {
    if (!Array.isArray(ops)) fail('Se esperaba una lista de operaciones.')
    const plant = clone(original)
    for (const operation of ops) {
        const op = clone(operation)
        if (op.op === 'connect') {
            if (!plant.stations.some((s) => s.id === op.from) || !plant.stations.some((s) => s.id === op.to)) fail('La ruta necesita estaciones existentes.')
            if (op.frac != null && (!Number.isFinite(op.frac) || op.frac < 0 || op.frac > 1)) fail('La fracción debe estar entre 0 y 1.')
            const { op: _op, reason: _reason, _index, _exact, ...route } = op
            route.id ||= `r-${crypto.randomUUID()}`
            if (!op._exact) { route.flow ||= 'material'; route.frac ??= 1 }
            if ((plant.routes || []).some((r) => r.id === route.id)) fail('El id de ruta ya existe.')
            plant.routes ||= []
            plant.routes.splice(_index ?? plant.routes.length, 0, route)
            continue
        }
        if (op.op === 'disconnect') {
            plant.routes = (plant.routes || []).filter((r) => op.id ? r.id !== op.id : !(r.from === op.from && r.to === op.to && (r.flow || 'material') === (op.flow || 'material')))
            continue
        }
        if (op.op === 'add') {
            const element = clone(op.element)
            if (!element?.id || locate(plant, element.id)) fail('El elemento necesita un id único.')
            const key = op._collection || (element.points ? 'conveyors' : element.x1 != null ? 'walls' : element.kind === 'obstaculo' ? 'zones' : 'stations')
            if (!COLLECTIONS.includes(key)) fail('Tipo de elemento desconocido.')
            if (key === 'stations') {
                const position = op._position || [element.x, element.z, element.rot || 0]
                if (!validPoint(position) || position.length < 2) fail('La estación necesita coordenadas calculadas.')
                plant.layout[element.id] = clone(position)
                if (!op._position) { delete element.x; delete element.z; delete element.rot }
            }
            plant[key] ||= []
            plant[key].splice(op._index ?? plant[key].length, 0, element)
            continue
        }
        if (op.id === '$plant' && op.op === 'update') {
            if (Object.keys(op.set).some((key) => COLLECTIONS.includes(key) || key === 'layout')) fail('Los elementos se modifican por sus operaciones.')
            Object.assign(plant, op.set)
            for (const key of op._unset || []) delete plant[key]
            continue
        }
        const found = locate(plant, op.id, op._collection)
        if (!found) fail(`No existe el elemento «${op.id}».`)
        const { element, key, index } = found
        if (element.locked && (op.op === 'move' || op.op === 'delete' || (op.op === 'update' && [...Object.keys(op.set || {}), ...(op._unset || [])].some((k) => geometry.has(k))))) {
            fail(`${element.name || element.id}: ${element.lock_reason || 'Elemento bloqueado'}`)
        }
        if (op.op === 'lock') { element.locked = true; element.lock_reason = op.reason || '' }
        else if (op.op === 'unlock') { element.locked = false; element.lock_reason = '' }
        else if (op.op === 'delete') {
            if (key === 'stations' && (plant.conveyors || []).some((c) => c.locked && (c.from === op.id || c.to === op.id))) fail('La estación tiene una banda bloqueada conectada.')
            plant[key].splice(index, 1)
            if (key === 'stations') {
                delete plant.layout[op.id]
                plant.routes = (plant.routes || []).filter((r) => r.from !== op.id && r.to !== op.id)
                if (plant.conveyors) plant.conveyors = plant.conveyors.filter((c) => c.from !== op.id && c.to !== op.id)
            }
            if (key === 'conveyors') plant.routes = (plant.routes || []).map((r) => r.conveyor === op.id ? { ...r, conveyor: null } : r)
        } else if (op.op === 'move') {
            if (!validPoint([op.to?.x, op.to?.z])) fail('Coordenadas inválidas.')
            if (key === 'stations') plant.layout[op.id] = op._position || [op.to.x, op.to.z, op.to.rot ?? plant.layout[op.id]?.[2] ?? 0]
            else if (key === 'walls') {
                const dx = op.to.x - element.x1, dz = op.to.z - element.z1
                Object.assign(element, { x1: op.to.x, z1: op.to.z, x2: element.x2 + dx, z2: element.z2 + dz })
            } else if (key === 'conveyors') {
                const dx = op.to.x - element.points[0][0], dz = op.to.z - element.points[0][1]
                element.points = element.points.map(([x, z]) => [x + dx, z + dz])
            } else { element.x = op.to.x; if (key !== 'gates') element.z = op.to.z }
        } else if (op.op === 'update') {
            if (op.set.id && op.set.id !== op.id) fail('No se puede cambiar el id.')
            Object.assign(element, op.set)
            for (const field of op._unset || []) delete element[field]
        } else fail(`Operación desconocida: ${op.op}`)
    }
    for (const station of plant.stations) {
        if (!(station.w > 0 && station.d > 0) || !validPoint([station.w, station.d, ...(plant.layout[station.id] || [])])) fail('Dimensiones o posición inválidas.')
        if (station.count != null && (!Number.isInteger(station.count) || station.count < 1)) fail('La cantidad debe ser un entero positivo.')
    }
    for (const route of plant.routes || []) {
        if (!plant.stations.some((s) => s.id === route.from) || !plant.stations.some((s) => s.id === route.to)) fail('Ruta con estación inexistente.')
        if (route.frac != null && (!Number.isFinite(route.frac) || route.frac < 0 || route.frac > 1)) fail('La fracción debe estar entre 0 y 1.')
    }
    return { plant, inverse: diffOps(plant, original, true) }
}
