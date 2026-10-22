/* Cuánto suele tardar cada espera con la IA, en segundos. Se ajusta con lo que
   tardó de verdad en este navegador (promedio que pesa más lo reciente). */
const DEFAULTS = { story: 110, compact: 90, organize: 60, context: 600 }
const key = (k) => `cauce-espera-${k}`

export function expected(k) {
    try {
        const v = Number(localStorage.getItem(key(k)))
        if (v > 0) return v
    } catch {
        /* sin almacenamiento: se usa el valor por defecto */
    }
    return DEFAULTS[k] || 60
}

/* Empieza a medir una espera. Llama a la función que devuelve cuando termine bien. */
export function startWait(k) {
    const t0 = performance.now()
    return () => {
        const s = (performance.now() - t0) / 1000
        if (s < 1) return
        try {
            const prev = Number(localStorage.getItem(key(k))) || s
            localStorage.setItem(key(k), String(Math.round(prev * 0.6 + s * 0.4)))
        } catch {
            /* sin almacenamiento: la próxima estimación usa el valor por defecto */
        }
    }
}
