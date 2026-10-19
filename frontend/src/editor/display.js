export function unitGrid(station) {
    const count = Math.max(1, Math.floor(station.count || 1))
    const columns = station.arrangement === 'columna' ? 1 : station.arrangement === 'bloque' ? Math.ceil(Math.sqrt(count)) : count
    return { count, columns, rows: Math.ceil(count / columns) }
}

export function quantityPatch(station, patch) {
    const next = { ...station, ...patch }
    const grid = unitGrid(next)
    return { ...patch, w: grid.columns * (next.unit_w || next.w), d: grid.rows * (next.unit_d || next.d) }
}

export function labelFor(station, index, width, fontSize) {
    const suffix = (station.count || 1) > 1 ? ` ×${station.count}` : ''
    const full = station.name + suffix
    const available = Math.max(1, Math.floor((width - 0.3) / (fontSize * 0.65)))
    if (full.length <= available) return full
    const numbered = `${index + 1}${suffix}`
    return numbered.length <= available ? numbered : String(index + 1)
}

// Only presentation geometry; metrics always use the unmodified engine paths.
export function parallelPath(route, routes, points) {
    const pair = [route.from, route.to].sort().join('|')
    const group = routes.filter((r) => [r.from, r.to].sort().join('|') === pair)
    if (group.length < 2) return points
    const offset = (group.findIndex((r) => r.id === route.id) - (group.length - 1) / 2) * 0.45
    const start = points[0], end = points.at(-1)
    const dx = end[0] - start[0], dz = end[1] - start[1]
    const length = Math.hypot(dx, dz) || 1
    const direction = route.from < route.to ? 1 : -1
    return points.map(([x, z]) => [x - dz / length * offset * direction, z + dx / length * offset * direction])
}
