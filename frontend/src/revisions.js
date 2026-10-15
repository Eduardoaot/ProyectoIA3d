export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// A response belongs to the revision sent, even if editing continued in flight.
export function updateProject(previous, patch) {
    const next = { ...previous, ...patch }
    const edited = (Object.hasOwn(patch, 'draft') && !same(previous.draft, next.draft)) ||
        (!Object.hasOwn(patch, 'analysis') && Object.hasOwn(patch, 'redesign') && !same(previous.redesign?.custom, next.redesign?.custom))
    next.plant_revision = (previous.plant_revision || 0) + (edited ? 1 : 0)
    return next
}

export function isStale(project) {
    return !!project.analysis && (project.analysis_revision ?? 0) !== (project.plant_revision || 0)
}

export function protectProposal(plant, positions, proposed) {
    const next = { ...positions }
    const rejected = []
    for (const station of plant.stations) {
        const target = proposed?.[station.id]
        if (!Array.isArray(target) || target.length < 2 || !target.every(Number.isFinite)) continue
        if (station.locked && !same(positions[station.id], target)) {
            rejected.push(`${station.name}: ${station.lock_reason || 'Elemento fijo'}`)
        } else next[station.id] = [...target]
    }
    return { positions: next, rejected, inverse: { ...positions } }
}
