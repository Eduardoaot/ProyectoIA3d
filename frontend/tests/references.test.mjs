import test from 'node:test'
import assert from 'node:assert/strict'
import { appendEntry, currentEntries, plantForCapabilities } from '../src/context.js'
import { MAX_IMAGE_BYTES, readImageReference, referenceStatus, validateReferenceBudget } from '../src/references.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=', 'base64')
test('image references preserve bytes and note revisions without claiming interpretation', async () => {
    const image = await readImageReference(new File([png], 'referencia.png', { type: 'image/png' }))
    assert.equal(image.data_url, `data:image/png;base64,${png.toString('base64')}`)
    const first = appendEntry('', { segment: 'referencias', key: 'plano', value: { ...image, notes: 'Plano anterior' } })
    const next = appendEntry(first, { segment: 'referencias', key: 'plano', value: { ...image, notes: 'Puerta a la derecha' } })
    assert.equal(first.segments.referencias.length, 1)
    assert.equal(next.segments.referencias.length, 2)
    assert.equal(currentEntries(next)[0].value.notes, 'Puerta a la derecha')
    assert.equal(currentEntries(next)[0].value.interpreted, false)
    for (const vision of [false, undefined]) assert.match(referenceStatus(vision), /No interpretada/)
    assert.match(referenceStatus(true), /pendiente de interpretación/)
})
test('image bytes are never sent without explicit vision, including the full immutable history', async () => {
    const image = await readImageReference(new File([png], 'ref.png', { type: 'image/png' }))
    const context = appendEntry('', { segment: 'referencias', key: 'foto', value: { ...image, notes: 'Acceso lateral' } })
    const p = { context }, before = structuredClone(p)
    for (const caps of [{ features: [] }, { features: ['segmented_context'] }, { features: ['segmented_context'], vision: false }, { features: [], vision: true }]) {
        const payload = plantForCapabilities(p, caps)
        assert.doesNotMatch(JSON.stringify(payload), /data:image/)
        assert.match(JSON.stringify(payload), /Acceso lateral/)
    }
    assert.match(JSON.stringify(plantForCapabilities(p, { features: ['segmented_context'], vision: true })), /data:image/)
    assert.deepEqual(p, before)
})
test('invalid formats, oversized files and excessive image history are rejected before saving', async () => {
    await assert.rejects(readImageReference(new File(['<svg/>'], 'ref.svg', { type: 'image/svg+xml' })), /PNG/)
    await assert.rejects(readImageReference(new File(['wrong'], 'ref.png', { type: 'image/png' })), /no contiene/)
    await assert.rejects(readImageReference(new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'ref.png', { type: 'image/png' })), /256 KB/)
    assert.throws(() => validateReferenceBudget({}, { data_url: 'x'.repeat(700001) }), /espacio/)
})
test('nested engineer-chat payload strips image bytes on a provider without vision', async (t) => {
    const image = await readImageReference(new File([png], 'ref.png', { type: 'image/png' }))
    const context = appendEntry('', { segment: 'referencias', key: 'foto', value: image })
    let sent
    t.mock.method(globalThis, 'fetch', async (path, options) => {
        if (path === '/api/capabilities') return Response.json({ features: ['segmented_context'], vision: false })
        sent = JSON.parse(options.body); return new Response('Respuesta')
    })
    const { stream } = await import('../src/api.js?references=chat')
    await stream('/api/chat', { message: 'Mira mi planta', context: { plant: { context } } }, () => {})
    assert.doesNotMatch(JSON.stringify(sent), /data:image/)
})
