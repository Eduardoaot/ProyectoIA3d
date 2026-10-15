/* Geometría compartida por el editor, los planos y la escena 3D. */

export const dims = (s, rot = 0) => (Math.round(rot || 0) % 180 ? [s.d, s.w] : [s.w, s.d])

export function rectOf(s, pos) {
  const [w, d] = dims(s, pos?.[2])
  return { x: pos[0] - w / 2, z: pos[1] - d / 2, w, d }
}

export const snap = (v, step = 0.5) => Math.round(v / step) * step

let n = 0
export const uid = (prefix) => `${prefix}${Date.now().toString(36)}${(n++).toString(36)}`

/* Punto y ángulo a la mitad de una polilínea (para la flecha de dirección). */
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

/* Triángulo que apunta en la dirección del recorrido. */
export function arrowPoints(m, size = 0.9) {
  const { x, z, angle } = m
  const a = (k, r) => [x + Math.cos(angle + k) * r, z + Math.sin(angle + k) * r]
  return [a(0, size), a(2.5, size * 0.75), a(-2.5, size * 0.75)].map((p) => p.join(',')).join(' ')
}

export const pathD = (pts) => 'M' + pts.map(([x, z]) => `${x} ${z}`).join(' L')

/* Trazo provisional mientras el motor calcula la ruta real. */
export const straight = (a, b) => [
  [a[0], a[1]],
  [b[0], a[1]],
  [b[0], b[1]],
]

export const shortName = (name = '', max = 16) => (name.length > max ? name.slice(0, max - 1) + '…' : name)

/* ---------- Forma de la planta ----------
   La planta es un polígono de un solo piso dentro de size.w x size.d.
   Sin outline es el rectángulo completo. La calle de referencia queda abajo (z = d). */

export const GATE_HALF = 2.2

export function outlineOf(plant) {
  const { w: W, d: D } = plant.size
  return plant.outline?.length >= 3
    ? plant.outline
    : [
        [0, 0],
        [W, 0],
        [W, D],
        [0, D],
      ]
}

export const polyD = (poly) => 'M' + poly.map(([x, z]) => `${x} ${z}`).join(' L') + ' Z'

export function signedArea(poly) {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i]
    const [x2, z2] = poly[(i + 1) % poly.length]
    a += x1 * z2 - x2 * z1
  }
  return a / 2
}

/* Lados del polígono con dirección y normal hacia afuera. */
export function edgesOf(poly) {
  const s = signedArea(poly) >= 0 ? 1 : -1
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9
    const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
    return { i, a, b, len, dir, n: [s * dir[1], -s * dir[0]] }
  })
}

export function pointInPoly(poly, [x, z]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/* El punto del contorno más cercano, dejando espacio para un portón de 4,4 m. */
export function projectToOutline(poly, [x, z], margin = GATE_HALF) {
  let best = null
  for (const e of edgesOf(poly)) {
    const raw = (x - e.a[0]) * e.dir[0] + (z - e.a[1]) * e.dir[1]
    const t = e.len < 2 * margin ? e.len / 2 : Math.min(e.len - margin, Math.max(margin, raw))
    const px = e.a[0] + e.dir[0] * t
    const pz = e.a[1] + e.dir[1] * t
    const dist = Math.hypot(px - x, pz - z)
    if (!best || dist < best.dist) best = { x: px, z: pz, t, dist, edge: e }
  }
  return best
}

/* Dónde está un portón: punto sobre el contorno, lado y normal hacia la calle. */
export function gateInfo(plant, g) {
  const poly = outlineOf(plant)
  const p = projectToOutline(poly, [g.x, g.z ?? plant.size.d])
  const [nx, nz] = p.edge.n
  // Rotación en grados para dibujar el portón con su eje "y" hacia afuera.
  return { x: p.x, z: p.z, n: p.edge.n, dir: p.edge.dir, edge: p.edge.i, t: p.t, deg: (Math.atan2(-nx, nz) * 180) / Math.PI }
}

export function bboxOf(poly) {
  const xs = poly.map((p) => p[0])
  const zs = poly.map((p) => p[1])
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) }
}

/* Formas predefinidas dentro de W x D. null es el rectángulo completo. */
export function shapePreset(kind, W, D) {
  const r = (v) => Math.round(v * 2) / 2
  if (kind === 'L')
    return [
      [0, 0],
      [r(W * 0.5), 0],
      [r(W * 0.5), r(D * 0.5)],
      [W, r(D * 0.5)],
      [W, D],
      [0, D],
    ]
  if (kind === 'U')
    return [
      [0, 0],
      [r(W * 0.33), 0],
      [r(W * 0.33), r(D * 0.55)],
      [r(W * 0.67), r(D * 0.55)],
      [r(W * 0.67), 0],
      [W, 0],
      [W, D],
      [0, D],
    ]
  if (kind === 'T')
    return [
      [0, 0],
      [W, 0],
      [W, r(D * 0.45)],
      [r(W * 0.68), r(D * 0.45)],
      [r(W * 0.68), D],
      [r(W * 0.32), D],
      [r(W * 0.32), r(D * 0.45)],
      [0, r(D * 0.45)],
    ]
  if (kind === 'triangulo')
    return [
      [r(W / 2), 0],
      [W, D],
      [0, D],
    ]
  if (kind === 'circulo') {
    const pts = []
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2
      pts.push([Math.round((W / 2 + (Math.cos(a) * W) / 2) * 100) / 100, Math.round((D / 2 + (Math.sin(a) * D) / 2) * 100) / 100])
    }
    return pts
  }
  return null
}

/* Tras editar el contorno: lo que quedó en negativo se corre al origen y el tamaño se ajusta a la forma.
   Todo lo demás (máquinas, zonas, paredes y portones) se corre igual para que no cambie de lugar relativo. */
export function fitToOutline(plant, positions, outline) {
  if (!outline) {
    const np = { ...plant, outline: undefined }
    const rect = outlineOf(np)
    np.gates = plant.gates.map((g) => {
      const p = projectToOutline(rect, [g.x, g.z ?? plant.size.d])
      return { ...g, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 }
    })
    return { plant: np, positions }
  }
  const b = bboxOf(outline)
  const dx = -b.x0
  const dz = -b.z0
  const move = ([x, z]) => [Math.round((x + dx) * 100) / 100, Math.round((z + dz) * 100) / 100]
  const ol = outline.map(move)
  const size = { w: Math.round((b.x1 - b.x0) * 100) / 100, d: Math.round((b.z1 - b.z0) * 100) / 100 }
  const shifted = dx || dz
  const np = {
    ...plant,
    size,
    outline: ol,
    zones: shifted ? plant.zones.map((z) => ({ ...z, x: z.x + dx, z: z.z + dz })) : plant.zones,
    walls: shifted ? plant.walls.map((w) => ({ ...w, x1: w.x1 + dx, z1: w.z1 + dz, x2: w.x2 + dx, z2: w.z2 + dz })) : plant.walls,
  }
  // Los portones se quedan sobre el contorno nuevo.
  np.gates = plant.gates.map((g) => {
    const p = projectToOutline(ol, [g.x + dx, (g.z ?? plant.size.d) + dz])
    return { ...g, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 }
  })
  const npos = shifted ? Object.fromEntries(Object.entries(positions).map(([k, p]) => [k, [p[0] + dx, p[1] + dz, p[2] || 0]])) : positions
  return { plant: np, positions: npos }
}

export const round2 = (v) => Math.round(v * 100) / 100

/* Punto más cercano sobre el segmento a-b. */
export function nearestOnSeg([x, z], a, b) {
  const vx = b[0] - a[0]
  const vz = b[1] - a[1]
  const L = vx * vx + vz * vz
  const t = L ? Math.min(1, Math.max(0, ((x - a[0]) * vx + (z - a[1]) * vz) / L)) : 0
  const px = a[0] + vx * t
  const pz = a[1] + vz * t
  return { x: px, z: pz, t, dist: Math.hypot(px - x, pz - z) }
}

/* Ajuste al dibujar: imán a puntos existentes, luego a lados y paredes, luego ángulo
   (múltiplos de 45° desde el punto anterior) y la malla elegida. Devuelve también las
   guías de alineación con otros puntos. */
export function smartPoint(raw, { points = [], segs = [], from = null, free = false, grid = 0.5, tol = 0.5 }) {
  let best = null
  for (const p of points) {
    const d = Math.hypot(p[0] - raw[0], p[1] - raw[1])
    if (d <= tol && (!best || d < best.d)) best = { d, p }
  }
  if (best) return { p: [round2(best.p[0]), round2(best.p[1])], magnet: 'punto', guides: [] }

  for (const [a, b] of segs) {
    const q = nearestOnSeg(raw, a, b)
    if (q.dist <= tol * 0.7 && (!best || q.dist < best.d)) best = { d: q.dist, p: [q.x, q.z] }
  }
  if (best) return { p: [round2(best.p[0]), round2(best.p[1])], magnet: 'lado', guides: [] }

  let p
  let diagonal = false
  if (from && !free) {
    const ang = Math.atan2(raw[1] - from[1], raw[0] - from[0])
    const k = Math.round(ang / (Math.PI / 4))
    const a = k * (Math.PI / 4)
    diagonal = k % 2 !== 0
    const len = snap(Math.hypot(raw[0] - from[0], raw[1] - from[1]), grid)
    p = [round2(from[0] + Math.cos(a) * len), round2(from[1] + Math.sin(a) * len)]
  } else p = [round2(snap(raw[0], grid)), round2(snap(raw[1], grid))]

  // Guías: si queda casi en la misma línea que otro punto, se alinea con él.
  const guides = []
  if (!diagonal && !free) {
    const horizontalFrom = from && Math.abs(p[1] - from[1]) < 1e-6
    const verticalFrom = from && Math.abs(p[0] - from[0]) < 1e-6
    let gx = null
    let gz = null
    for (const q of points) {
      if (!verticalFrom && Math.abs(q[0] - p[0]) <= tol && (gx == null || Math.abs(q[0] - p[0]) < Math.abs(gx - p[0]))) gx = q[0]
      if (!horizontalFrom && Math.abs(q[1] - p[1]) <= tol && (gz == null || Math.abs(q[1] - p[1]) < Math.abs(gz - p[1]))) gz = q[1]
    }
    if (gx != null) {
      p[0] = round2(gx)
      guides.push({ axis: 'x', v: p[0] })
    }
    if (gz != null) {
      p[1] = round2(gz)
      guides.push({ axis: 'z', v: p[1] })
    }
  }
  return { p, magnet: null, guides }
}

/* Escala el contorno desde su centro (expandir o encoger toda la planta). */
export function scaleOutline(poly, k) {
  const b = bboxOf(poly)
  const cx = (b.x0 + b.x1) / 2
  const cz = (b.z0 + b.z1) / 2
  const r = (v) => Math.round(v * 100) / 100
  return poly.map(([x, z]) => [r(cx + (x - cx) * k), r(cz + (z - cz) * k)])
}
