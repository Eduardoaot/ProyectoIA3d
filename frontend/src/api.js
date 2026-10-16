import { plantForCapabilities } from './context.js'
import { hasFeature, validWeights } from './features.js'
async function prepareBody(body) {
    if (!body?.plant?.context?.segments) return body
    return { ...body, plant: plantForCapabilities(body.plant, await getCapabilities()) }
}
async function post(path, body, signal) {
    body = await prepareBody(body)
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

async function featurePost(feature, path, body, signal) {
    if (!hasFeature(await getCapabilities(), feature)) throw new Error('El servidor no ofrece esta función.')
    return post(path, body, signal)
}

export const api = {
    getCapabilities,
    health: () => get('/api/health'),
    catalog: () => get('/api/catalog'),
    story: (text) => post('/api/story', { text }),
    routes: (plant, positions, signal) => post('/api/routes', { plant, positions }, signal),
    evaluate: (plant, positions, rebalance = true, signal) => post('/api/evaluate', { plant, positions, rebalance }, signal),
    analyze: async (plant, weights) => {
        if (weights != null && hasFeature(await getCapabilities(), 'weights')) {
            if (!validWeights(weights)) throw new Error('Los pesos deben sumar 1.')
            return post('/api/analyze', { plant, weights })
        }
        return post('/api/analyze', { plant })
    },
    planOps: (instruction, plant, signal) => featurePost('plan_ops', '/api/plan/ops', { instruction, plant }, signal),
    simulate: (plant, alternative, replicas, seed, signal) => {
        if (!Number.isInteger(replicas) || replicas < 1 || !Number.isInteger(seed) || seed < 0) return Promise.reject(new Error('Réplicas y semilla inválidas.'))
        return featurePost('simulate', '/api/simulate', { plant, alternative, replicas, seed }, signal)
    },
    missions: (context) => post('/api/missions', context),
}

export async function stream(path, body, onToken, signal) {
    body = await prepareBody(body)
    const structuredReport = path === '/api/report' && hasFeature(await getCapabilities(), 'report_validation')
    const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(structuredReport ? { Accept: 'application/json, text/plain;q=0.9' } : {}) },
        body: JSON.stringify(body),
        signal,
    })
    if (!r.ok || !r.body) throw new Error(`${path} respondió ${r.status}`)

    if (path === '/api/report' && r.headers.get('Content-Type')?.includes('application/json')) {
        const data = await r.json()
        if (typeof data.text !== 'string') throw new Error('El informe estructurado necesita el campo text.')
        onToken(data.text)
        return { validation: data.validation }
    }

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
