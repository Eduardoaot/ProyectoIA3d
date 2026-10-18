/* Máquinas en paralelo dentro de una estación (contrato v3 §4.2). Solo geometría para
   dibujar: la capacidad y los tiempos los calcula el motor. Igual que backend/cauce/units.py. */

export const UNIT_GAP = 0.6
export const ARRANGEMENTS = [
    { id: 'fila', label: 'En fila' },
    { id: 'columna', label: 'En columna' },
    { id: 'bloque', label: 'En bloque' },
]

export const countOf = (s) => Math.max(1, Math.round(Number(s?.count) || 1))

function grid(n, arrangement) {
    if (arrangement === 'columna') return [1, n]
    if (arrangement === 'bloque') {
        const cols = Math.ceil(Math.sqrt(n))
        return [cols, Math.ceil(n / cols)]
    }
    return [n, 1]
}

const r2 = (v) => Math.round(v * 100) / 100

export function blockSize(n, unitW, unitD, arrangement = 'fila', gap = UNIT_GAP) {
    const [cols, rows] = grid(Math.max(1, n), arrangement)
    return [r2(cols * unitW + (cols - 1) * gap), r2(rows * unitD + (rows - 1) * gap)]
}

/* Cambiar cantidad, medida por unidad o acomodo recalcula el bloque (w, d) y conserva los
   operarios por unidad (ops = por unidad × N). */
export function resize(s, patch) {
    const next = { ...s, ...patch }
    const n = countOf(next)
    const uw = Number(next.unit_w) || (countOf(s) === 1 ? s.w : s.w / n)
    const ud = Number(next.unit_d) || (countOf(s) === 1 ? s.d : s.d / n)
    const [w, d] = blockSize(n, uw, ud, next.arrangement || 'fila')
    const perUnit = (Number(s.ops) || 0) / countOf(s)
    const ops = 'count' in patch ? Math.round(perUnit * n) : next.ops
    const { ops_per_unit: _drop, ...rest } = next
    return { ...rest, count: n, unit_w: uw, unit_d: ud, w, d, ops }
}

/* Rectángulos de cada unidad dentro del bloque ya girado (x, z de la esquina, w, d). */
export function unitRects(s, rect, rot = 0) {
    const n = countOf(s)
    if (n <= 1) return []
    const turned = Math.round(rot || 0) % 180 !== 0
    const arrangement = s.arrangement || 'fila'
    let [cols, rows] = grid(n, arrangement)
    let uw = Number(s.unit_w) || s.w / cols
    let ud = Number(s.unit_d) || s.d / rows
    if (turned) {
        ;[cols, rows] = [rows, cols]
        ;[uw, ud] = [ud, uw]
    }
    // Si el bloque se dibujó de otro tamaño, las unidades se reparten en él.
    const gx = cols > 1 ? Math.max(0, (rect.w - cols * uw) / (cols - 1)) : 0
    const gz = rows > 1 ? Math.max(0, (rect.d - rows * ud) / (rows - 1)) : 0
    const w = Math.min(uw, rect.w / cols)
    const d = Math.min(ud, rect.d / rows)
    const out = []
    for (let i = 0; i < n; i++) {
        const c = turned ? Math.floor(i / rows) : i % cols
        const r = turned ? i % rows : Math.floor(i / cols)
        out.push({ x: rect.x + c * (w + gx), z: rect.z + r * (d + gz), w, d })
    }
    return out
}

/* Etiqueta que cabe: el nombre si alcanza; si no, su número (el nombre va en la leyenda). */
export function fitLabel(name, widthM, index, charsPerM = 1.9) {
    const max = Math.max(3, Math.floor(widthM * charsPerM))
    return name.length <= max ? { text: name, numbered: false } : { text: String(index + 1), numbered: true }
}
