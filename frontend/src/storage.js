export const PROJECT_KEY = 'cauce-proyecto-v3'
export const LEGACY_KEY = 'cauce-proyecto-v2'

export function migratePlant(source) {
    if (!source) return source
    const plant = structuredClone(source)
    plant.schema_version = 3
    plant.conveyors ??= []
    plant.stations = plant.stations.map((s) => ({
        count: 1, unit_w: s.w, unit_d: s.d, arrangement: 'fila',
        ops_per_unit: Math.max(0, Math.floor((s.ops || 0) / (s.count || 1))),
        t_source: 'supuesto', locked: false, lock_reason: '', ...s,
    }))
    plant.routes = plant.routes.map((r) => ({ flow: 'material', is_return: false, conveyor: null, ...r }))
    for (const key of ['zones', 'walls', 'gates', 'conveyors']) {
        plant[key] = (plant[key] || []).map((e) => ({ locked: e.kind === 'bloqueado' || e.kind === 'obstaculo', lock_reason: e.kind === 'bloqueado' || e.kind === 'obstaculo' ? 'Obstáculo fijo' : '', ...e }))
    }
    return plant
}

export function migrateProject(project) {
    const next = { ...project, schema_version: 3, plant_revision: project.plant_revision || 0, analysis_revision: project.analysis_revision || 0 }
    next.plant = migratePlant(project.plant)
    next.draft = migratePlant(project.draft)
    if (project.redesign?.custom) {
        const c = project.redesign.custom
        next.redesign = { ...project.redesign, custom: c.positions ? { ...c, plant: migratePlant(c.plant || project.plant) } : { plant: next.plant, positions: c } }
    }
    return next
}

export function loadProject(storage, empty) {
    const current = storage.getItem(PROJECT_KEY)
    if (current) return { ...empty, ...JSON.parse(current) }
    const old = storage.getItem(LEGACY_KEY)
    const project = migrateProject(old ? { ...empty, ...JSON.parse(old) } : empty)
    storage.setItem(PROJECT_KEY, JSON.stringify(project))
    return project
}
