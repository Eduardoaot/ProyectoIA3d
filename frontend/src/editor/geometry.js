export const dims = (s, rot = 0) => (Math.round(rot || 0) % 180 ? [s.d, s.w] : [s.w, s.d])

export function rectOf(s, pos) {
    const [w, d] = dims(s, pos?.[2])
    return { x: pos[0] - w / 2, z: pos[1] - d / 2, w, d }
}

export const snap = (v, step = 0.5) => Math.round(v / step) * step

let n = 0
export const uid = (prefix) => `${prefix}${Date.now().toString(36)}${(n++).toString(36)}`

export function midOf(pts) {
    const segs = []
    let total = 0

    for (let i = 0; i < pts.length - 1; i++) {
        const [x1, z1] = pts[i]
        const [x2, z2] = pts[i + 1]
        const len = Math.hypot(x2 - x1, z2 - z1)
        segs.push({ x1, z1, x2, z2, len })
        total += len
    }

    let s = total / 2

    for (const g of segs) {
        if (s <= g.len || g === segs[segs.length - 1]) {
        const t = g.len ? Math.min(1, s / g.len) : 0
        return { x: g.x1 + (g.x2 - g.x1) * t, z: g.z1 + (g.z2 - g.z1) * t, angle: Math.atan2(g.z2 - g.z1, g.x2 - g.x1), total }
        }
        s -= g.len
    }

    return { x: pts[0]?.[0] ?? 0, z: pts[0]?.[1] ?? 0, angle: 0, total: 0 }
}

export function arrowPoints(m, size = 0.9) {
    const { x, z, angle } = m
    const a = (k, r) => [x + Math.cos(angle + k) * r, z + Math.sin(angle + k) * r]
    return [a(0, size), a(2.5, size * 0.75), a(-2.5, size * 0.75)].map((p) => p.join(',')).join(' ')
}

export const pathD = (pts) => 'M' + pts.map(([x, z]) => `${x} ${z}`).join(' L')

export const straight = (a, b) => [
    [a[0], a[1]],
    [b[0], a[1]],
    [b[0], b[1]],
]

export const shortName = (name = '', max = 16) => (name.length > max ? name.slice(0, max - 1) + '…' : name)