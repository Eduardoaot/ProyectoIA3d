/* Pesos del puntaje multicriterio (criterios §5.3, contrato §6.2). La interfaz solo los
   edita y valida que sumen 1; el puntaje lo calcula el motor. */

export const CRITERIA = [
    { key: 'manejo', label: 'Costo de manejo', hint: 'metros que camina el material' },
    { key: 'lead_time', label: 'Tiempo por pieza', hint: 'de que entra hasta que sale' },
    { key: 'capacidad', label: 'Capacidad', hint: 'piezas al día' },
    { key: 'obra', label: 'Obra', hint: 'máquinas que cambian de lugar' },
    { key: 'seguridad', label: 'Seguridad', hint: 'áreas sucias junto a limpias' },
    { key: 'flexibilidad', label: 'Espacio libre', hint: 'para crecer' },
]

export const DEFAULT_WEIGHTS = { manejo: 0.25, lead_time: 0.2, capacidad: 0.15, obra: 0.15, seguridad: 0.15, flexibilidad: 0.1 }

export const sumOf = (w) => CRITERIA.reduce((a, c) => a + (Number(w?.[c.key]) || 0), 0)

export function validWeights(w) {
    if (!w) return false
    if (CRITERIA.some((c) => !(Number(w[c.key]) >= 0))) return false
    return Math.abs(sumOf(w) - 1) < 0.005
}

/* Reparte para que sumen 1 conservando las proporciones (redondeo a 0,01 y el resto al mayor). */
export function normalizeWeights(w) {
    const total = sumOf(w)
    if (!(total > 0)) return { ...DEFAULT_WEIGHTS }
    const out = Object.fromEntries(CRITERIA.map((c) => [c.key, Math.round(((Number(w[c.key]) || 0) / total) * 100) / 100]))
    const diff = Math.round((1 - sumOf(out)) * 100) / 100
    if (diff) {
        const top = CRITERIA.map((c) => c.key).sort((a, b) => out[b] - out[a])[0]
        out[top] = Math.round((out[top] + diff) * 100) / 100
    }
    return out
}

/* Criterios cuyo peso, al cambiar, cambia la recomendación (lectura de sensitivity). */
export function sensitiveCriteria(sensitivity) {
    const keys = new Set()
    for (const [k, v] of Object.entries(sensitivity || {})) if (v === 'cambia') keys.add(k.replace(/_x(0\.5|2)$/, ''))
    return CRITERIA.filter((c) => keys.has(c.key))
}
