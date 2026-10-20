/* Resultados de la simulación como texto: rangos P10–P90 con su mediana, o «sin datos». */

const n = (v, d) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })

export function bandText(b, unit = '', d = 1, scale = 1) {
    if (!b) return 'sin datos'
    const [lo, mid, hi] = [b.p10, b.p50, b.p90].map((v) => v * scale)
    const u = unit ? ` ${unit}` : ''
    if (lo === hi) return `${n(mid, d)}${u}`
    return `${n(lo, d)} a ${n(hi, d)}${u} (mediana ${n(mid, d)})`
}

export const DOWNTIME = [
    { key: 'lote', label: 'Espera de lote' },
    { key: 'material', label: 'Estaciones esperando material' },
    { key: 'personal', label: 'Espera por personal' },
    { key: 'falla', label: 'Paro por falla' },
    { key: 'cambio', label: 'Cambio de herramienta' },
]

/* Utilización ordenada de mayor a menor (las primeras n). */
export function topUtilization(util, names, k = 5) {
    return Object.entries(util || {})
        .sort((a, b) => b[1].p50 - a[1].p50)
        .slice(0, k)
        .map(([id, b]) => ({ id, name: names[id] || id, text: bandText(b, '%', 0, 100) }))
}
