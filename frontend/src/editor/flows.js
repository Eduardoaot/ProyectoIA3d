export const FLOW_STYLES = { material: { color: '#111', dash: undefined }, personas: { color: '#176b9c', dash: '0.4 0.3' }, vehiculos: { color: '#995018', dash: '0.9 0.25' }, carga: { color: '#774384', dash: '0.6 0.2 0.15 0.2' } }
export function returnPath(points, isReturn) {
    if (!isReturn || points.length < 2) return points
    const a = points[0], b = points[points.length - 1]
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1
    const bend = Math.min(4, len / 3)
    const c = [(a[0] + b[0]) / 2 - dz / len * bend, (a[1] + b[1]) / 2 + dx / len * bend]
    return Array.from({ length: 21 }, (_, i) => { const t = i / 20; return [0, 1].map((k) => (1 - t) ** 2 * a[k] + 2 * t * (1 - t) * c[k] + t * t * b[k]) })
}
