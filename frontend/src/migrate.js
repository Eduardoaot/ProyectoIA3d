/* Proyecto guardado en el navegador: formato v3 con migración desde v2 (contrato §4.6).
   La clave cauce-proyecto-v2 nunca se modifica ni se borra: v3 es una copia aparte. */

export const KEY_V2 = 'cauce-proyecto-v2'
export const KEY_V3 = 'cauce-proyecto-v3'

/* Valores por defecto del contrato §4. count: 1 da exactamente el mismo cálculo que v2.
   ops_per_unit no se escribe: su valor por defecto es ops / count y así no queda viejo
   cuando el usuario cambia los operarios. */
export function upgradePlant(plant) {
    if (!plant || !Array.isArray(plant.stations)) return plant
    // Sin supuestos: el análisis cubre recorridos y cercanía entre áreas.
    // eslint-disable-next-line no-unused-vars
    const { use_assumptions, ...rest } = plant
    return {
        ...rest,
        schema_version: 3,
        conveyors: plant.conveyors || [],
        stations: plant.stations.map((s) => ({
            count: 1,
            unit_w: s.w,
            unit_d: s.d,
            arrangement: 'fila',
            t_source: 'supuesto',
            locked: false,
            lock_reason: '',
            ...s,
        })),
        routes: (plant.routes || []).map((r) => ({ flow: 'material', is_return: false, conveyor: null, ...r })),
        zones: (plant.zones || []).map((z) => ({ locked: false, lock_reason: '', ...z })),
    }
}

export function migrateProject(p) {
    if (!p || typeof p !== 'object') return p
    const custom = p.redesign?.custom
    return {
        ...p,
        schema_version: 3,
        draft: upgradePlant(p.draft),
        plant: upgradePlant(p.plant),
        redesign: p.redesign && {
            ...p.redesign,
            // «Tu rediseño» puede ser solo posiciones (formato viejo) o { plant, positions }.
            custom: custom?.positions ? { ...custom, plant: upgradePlant(custom.plant) } : custom,
        },
    }
}

/* Lee v3; si no existe, copia v2 y la migra. storage es localStorage (o un sustituto en las pruebas). */
export function loadStored(storage) {
    try {
        const v3 = storage.getItem(KEY_V3)
        if (v3) return JSON.parse(v3)
        const v2 = storage.getItem(KEY_V2)
        return v2 ? migrateProject(JSON.parse(v2)) : null
    } catch {
        return null
    }
}

export function saveStored(storage, project) {
    try {
        storage.setItem(KEY_V3, JSON.stringify(project))
    } catch {
        /* sin espacio o almacenamiento bloqueado: se sigue trabajando en memoria */
    }
}
