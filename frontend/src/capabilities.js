/* Funciones del backend que se detectan, no se suponen (contrato v3 §6.1).
   Si /api/capabilities no existe o falla, la lista queda vacía y la interfaz
   oculta todo lo que depende de ella. */

export const NO_CAPS = Object.freeze({ schema_version: 2, features: [], vision: false })

export function normalizeCaps(raw) {
    if (!raw || typeof raw !== 'object') return NO_CAPS
    return {
        schema_version: Number(raw.schema_version) || 2,
        features: Array.isArray(raw.features) ? raw.features.filter((f) => typeof f === 'string') : [],
        vision: raw.vision === true,
    }
}

let cached = null

/* Una sola consulta por sesión; cualquier error equivale a "sin funciones nuevas". */
export function loadCapabilities(fetcher = (u) => fetch(u)) {
    if (!cached)
        cached = Promise.resolve()
            .then(() => fetcher('/api/capabilities'))
            .then((r) => {
                // 5xx: el proxy de Vite aún no alcanza al backend (arrancando o reiniciándose).
                if (r && r.status >= 500) throw new Error('backend no disponible')
                return r && r.ok ? r.json() : null
            })
            .then(normalizeCaps)
            .catch(() => {
                // Sin servidor no se guarda la respuesta: la siguiente consulta vuelve a preguntar.
                cached = null
                return NO_CAPS
            })
    return cached
}

export function resetCapabilities() {
    cached = null
}

export const has = (caps, feature) => !!caps?.features?.includes(feature)
