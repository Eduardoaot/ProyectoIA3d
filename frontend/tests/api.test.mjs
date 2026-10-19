import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture } from './helpers.mjs'

let instance = 0
const freshAPI = () => import(`../src/api.js?test=${instance++}`)

test('capabilities shares concurrent requests and caches the result', async (t) => {
    const full = await fixture('capabilities-full')
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(full))
    const { api, getCapabilities } = await freshAPI()
    const first = getCapabilities()
    assert.equal(api.getCapabilities(), first)
    assert.deepEqual(await first, full)
    assert.deepEqual(await getCapabilities(), full)
    assert.equal(fetch.mock.callCount(), 1)
    assert.equal(fetch.mock.calls[0].arguments[0], '/api/capabilities')
})

for (const status of [404, 500]) {
    test(`capabilities ${status} falls back silently and is cached`, async (t) => {
        const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('', { status }))
        const { getCapabilities } = await freshAPI()
        assert.deepEqual(await getCapabilities(), { features: [] })
        assert.deepEqual(await getCapabilities(), { features: [] })
        assert.equal(fetch.mock.callCount(), 1)
    })
}

test('capabilities handles an offline server', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
    const { getCapabilities } = await freshAPI()
    assert.deepEqual(await getCapabilities(), { features: [] })
})

for (const body of ['not json', 'null', '{}', '{"features":"count"}', '{"features":[null]}']) {
    test(`capabilities rejects malformed response: ${body}`, async (t) => {
        t.mock.method(globalThis, 'fetch', async () => new Response(body))
        const { getCapabilities } = await freshAPI()
        assert.deepEqual(await getCapabilities(), { features: [] })
    })
}

test('capabilities times out instead of leaving feature detection pending', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    t.mock.method(globalThis, 'fetch', (_path, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const { getCapabilities } = await freshAPI()
    const pending = getCapabilities()
    t.mock.timers.tick(5000)
    assert.deepEqual(await pending, { features: [] })
})

test('unknown capabilities are preserved and vision must be explicitly true', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ features: ['future_feature'], vision: 'true', extra: 1 }))
    const { getCapabilities } = await freshAPI()
    assert.deepEqual(await getCapabilities(), { features: ['future_feature'], vision: false, extra: 1 })
})

for (const version of ['v2', 'v3']) {
    test(`analyze sends the complete ${version} plant and preserves response fields`, async (t) => {
        const plant = await fixture(`transformadores-${version}`)
        const analysis = await fixture(`analyze-${version}`)
        const fetch = t.mock.method(globalThis, 'fetch', async (path) => Response.json(path === '/api/capabilities' ? { features: ['segmented_context'] } : analysis))
        const { api } = await freshAPI()
        assert.deepEqual(await api.analyze(plant), analysis)
        const [path, options] = fetch.mock.calls.find((call) => call.arguments[0] === '/api/analyze').arguments
        assert.equal(path, '/api/analyze')
        assert.equal(options.method, 'POST')
        assert.deepEqual(JSON.parse(options.body), { plant })
    })
}

test('the real v2 report remains a UTF-8 stream, including split accented characters', async (t) => {
    const report = await fixture('report-v2')
    const data = new TextEncoder().encode(report.body)
    t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
        start(controller) {
            for (const byte of data) controller.enqueue(new Uint8Array([byte]))
            controller.close()
        },
    }), { status: report.status, headers: { 'Content-Type': report.content_type } }))
    const { stream } = await freshAPI()
    let text = ''
    await stream('/api/report', { plant: await fixture('transformadores-v2') }, (token) => { text += token })
    assert.equal(text, report.body)
})

test('normal API failures still reach the caller', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 500 }))
    const { api } = await freshAPI()
    await assert.rejects(api.analyze({}), /\/api\/analyze respondió 500/)
})
