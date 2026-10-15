async function post(path, body, signal) {
    const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    })

    if (!r.ok) throw new Error(`${path} respondió ${r.status}`)
    return r.json()
}

const get = (path, signal) =>
    fetch(path, { signal }).then((r) => {
        if (!r.ok) throw new Error(`${path} respondió ${r.status}`)
        return r.json()
    })

// Share the in-flight request as well as its result (including old-server 404s).
let capabilitiesRequest

export function getCapabilities() {
    if (!capabilitiesRequest) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        capabilitiesRequest = get('/api/capabilities', controller.signal)
            .then((data) => {
                if (!data || !Array.isArray(data.features) || !data.features.every((feature) => typeof feature === 'string')) {
                    return { features: [] }
                }
                return { ...data, vision: data.vision === true }
            })
            .catch(() => ({ features: [] }))
            .finally(() => clearTimeout(timeout))
    }
    return capabilitiesRequest
}

export const api = {
    getCapabilities,
    health: () => get('/api/health'),
    catalog: () => get('/api/catalog'),
    story: (text) => post('/api/story', { text }),
    routes: (plant, positions, signal) => post('/api/routes', { plant, positions }, signal),
    evaluate: (plant, positions, rebalance = true, signal) => post('/api/evaluate', { plant, positions, rebalance }, signal),
    analyze: (plant) => post('/api/analyze', { plant }),
    missions: (context) => post('/api/missions', context),
}

export async function stream(path, body, onToken, signal) {
    const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    })
    if (!r.ok || !r.body) throw new Error(`${path} respondió ${r.status}`)

    const reader = r.body.getReader()
    const dec = new TextDecoder()
    for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        onToken(dec.decode(value, { stream: true }))
    }
    const tail = dec.decode()
    if (tail) onToken(tail)
}

export const fmt = (n, d = 0) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d }))

export const pct = (a, b) => (a ? Math.round(((b - a) / a) * 100) : 0)
