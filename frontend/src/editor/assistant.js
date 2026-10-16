import { applyOps } from './operations.js'

const fields = { add: ['element'], delete: ['id'], move: ['id', 'to'], update: ['id', 'set'], connect: ['from', 'to', 'frac', 'flow'], disconnect: ['from', 'to', 'flow'], lock: ['id'], unlock: ['id'] }
function validate(operation) {
    if (!operation || !fields[operation.op]) throw new Error('Operación desconocida.')
    if (Object.keys(operation).some((key) => !['op', 'reason', ...fields[operation.op]].includes(key))) throw new Error('La operación contiene campos internos o no admitidos.')
    if (operation.id === '$plant') throw new Error('El asistente solo edita elementos del plano.')
    if (operation.op === 'update' && Object.keys(operation.set || {}).some((key) => ['locked', 'lock_reason', 'id', '__proto__', 'constructor', 'prototype'].includes(key) || key.startsWith('_'))) throw new Error('Usa operaciones explícitas para bloquear o desbloquear.')
}
export function previewOperations(plant, response) {
    if (!Array.isArray(response?.ops)) throw new Error('El asistente no devolvió una lista de operaciones.')
    let preview = plant
    const ops = [], rejected = [...(Array.isArray(response.rejected) ? response.rejected : [])]
    for (const op of response.ops) {
        try { validate(op); preview = applyOps(preview, [op]).plant; ops.push(op) }
        catch (error) { rejected.push({ op, reason: error.message }) }
    }
    return { ops, rejected, notes: typeof response.notes === 'string' ? response.notes : '' }
}
