import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addEntry, contextPayload, EMPTY_CONTEXT, referenceStatus as status } from '../src/context.js'

test('sin visión la imagen queda como nota y se dice', () => {
    const ctx = addEntry(EMPTY_CONTEXT, { segment: 'referencias', key: 'referencia-1', value: 'Planta en U', image: 'data:image/png;base64,xx' })
    const e = ctx.segments.referencias[0]
    assert.equal(status(e, false), 'No interpretada: el proveedor actual no tiene visión.')
    // Lo que viaja al motor es la nota, nunca la imagen.
    assert.equal(contextPayload(ctx, '', true).segments.referencias[0].image, undefined)
    assert.ok(contextPayload(ctx, '', false).includes('Planta en U'))
})

test('interpretada crea una versión nueva y la anterior queda', () => {
    let ctx = addEntry(EMPTY_CONTEXT, { segment: 'referencias', key: 'referencia-1', value: 'Planta en U', image: 'x' })
    const e = ctx.segments.referencias[0]
    ctx = addEntry(ctx, { ...e, value: 'Planta en U — Lectura: se ve una U', supersedes: e.id, interpreted: true })
    assert.equal(ctx.segments.referencias.length, 2)
    assert.equal(status(ctx.segments.referencias[1], true), 'Interpretada por un modelo con visión.')
})
