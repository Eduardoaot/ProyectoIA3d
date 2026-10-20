/* Cada operación del contrato §5 en palabras, para que el usuario la vea antes de aplicarla. */

const FLOW = { material: 'material', personas: 'personas', vehiculos: 'vehículos', carga: 'carga' }

function nameOf(plant, id, extra = []) {
    const all = [...(plant.stations || []), ...(plant.zones || []), ...(plant.conveyors || []), ...extra]
    return all.find((x) => x.id === id)?.name || id
}

const m = (v) => (Math.round(Number(v) * 10) / 10).toLocaleString('es-CO')

/* added: elementos que agregan operaciones anteriores del mismo lote (para nombrarlos). */
export function describeOp(op, plant, added = []) {
    const n = (id) => `«${nameOf(plant, id, added)}»`
    switch (op.op) {
        case 'add':
            return `Agregar «${op.element?.name || op.element?.id}»${(op.element?.count || 1) > 1 ? ` (×${op.element.count})` : ''} en x ${m(op.element?.x)}, z ${m(op.element?.z)} m`
        case 'delete':
            return `Quitar ${n(op.id)}`
        case 'move':
            return `Mover ${n(op.id)} a x ${m(op.to?.x)}, z ${m(op.to?.z)} m`
        case 'update':
            return `Cambiar ${n(op.id)}: ${Object.entries(op.set || {})
                .map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join('–') : typeof v === 'object' ? JSON.stringify(v) : v}`)
                .join(', ')}`
        case 'connect':
            return `Ruta de ${FLOW[op.flow || 'material']} ${n(op.from)} → ${n(op.to)}${op.frac != null && op.frac !== 1 ? ` (${Math.round(op.frac * 100)} %)` : ''}`
        case 'disconnect':
            return `Quitar la ruta ${n(op.from)} → ${n(op.to)}`
        case 'lock':
            return `Fijar ${n(op.id)}${op.reason ? `: ${op.reason}` : ''}`
        case 'unlock':
            return `Liberar ${n(op.id)}`
        default:
            return `Operación desconocida (${op?.op})`
    }
}

export function describeAll(ops, plant) {
    const added = []
    return ops.map((op) => {
        const text = describeOp(op, plant, added)
        if (op.op === 'add' && op.element) added.push(op.element)
        return text
    })
}
