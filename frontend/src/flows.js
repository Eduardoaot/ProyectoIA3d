/* Dibujo de flujos (contrato v3 §4.3): cada flujo con su color y trazo, los retornos como
   flecha curva y las rutas paralelas separadas para que no se encimen. Solo dibujo. */

export const FLOWS = [
    { id: 'material', label: 'Material', color: '#000000', dash: null },
    { id: 'personas', label: 'Personas', color: '#1d4ed8', dash: '0.15 0.35' },
    { id: 'vehiculos', label: 'Vehículos', color: '#b45309', dash: '1.1 0.45' },
    { id: 'carga', label: 'Carga', color: '#7e22ce', dash: '0.6 0.3 0.15 0.3' },
]

export const flowOf = (r) => FLOWS.find((f) => f.id === (r?.flow || 'material')) || FLOWS[0]

/* Desplazamiento lateral (en metros) de cada ruta: las que unen el mismo par de estaciones
   se reparten a los lados en vez de dibujarse una encima de otra. */
export function lateralOffsets(routes, gap = 0.45) {
    const groups = {}
    for (const r of routes) {
        const k = [r.from, r.to].sort().join('|')
        ;(groups[k] = groups[k] || []).push(r)
    }
    const out = {}
    for (const list of Object.values(groups)) {
        list.forEach((r, i) => {
            const centered = (i - (list.length - 1) / 2) * gap
            // La dirección importa: a→b y b→a quedan a lados opuestos con el mismo signo.
            out[r.id] = (r.from < r.to ? centered : -centered) || 0
        })
    }
    return out
}

export function shiftPath(pts, d) {
    if (!d || !pts || pts.length < 2) return pts
    const [a, b] = [pts[0], pts[pts.length - 1]]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const nx = -(b[1] - a[1]) / L
    const nz = (b[0] - a[0]) / L
    return pts.map(([x, z]) => [x + nx * d, z + nz * d])
}

/* Flecha curva de un retorno: arco de a hacia b que se abre hacia un costado. */
export function returnArc(a, b, bend = 0.25) {
    const mx = (a[0] + b[0]) / 2
    const mz = (a[1] + b[1]) / 2
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const cx = mx - ((b[1] - a[1]) / L) * L * bend
    const cz = mz + ((b[0] - a[0]) / L) * L * bend
    // Punto medio de la curva cuadrática, para la punta de flecha.
    const tip = [0.25 * a[0] + 0.5 * cx + 0.25 * b[0], 0.25 * a[1] + 0.5 * cz + 0.25 * b[1]]
    return { d: `M${a[0]} ${a[1]} Q${cx} ${cz} ${b[0]} ${b[1]}`, tip, dir: [b[0] - a[0], b[1] - a[1]] }
}

export const beltLength = (pts) => (pts || []).slice(1).reduce((acc, p, i) => acc + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0)
