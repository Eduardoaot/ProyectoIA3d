import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addEntry, contextPayload, current, EMPTY_CONTEXT, history, parseValue, showValue, toText } from '../src/context.js'


test('editar un tiempo deja la entrada anterior en el historial', () => {
    let ctx = addEntry(EMPTY_CONTEXT, { segment: 'tiempos', key: 'pulido.t_ciclo', value: [5, 6], unit: 'min/pieza', source: 'estimado', confidence: 'baja' }, '2026-10-10')
    const first = ctx.segments.tiempos[0]
    ctx = addEntry(ctx, { segment: 'tiempos', key: 'pulido.t_ciclo', value: [3.5, 4.5], unit: 'min/pieza', source: 'medido', confidence: 'alta', supersedes: first.id }, '2026-10-14')
    assert.equal(ctx.segments.tiempos.length, 2)
    assert.deepEqual(ctx.segments.tiempos[0], first)
    const live = current(ctx)
    assert.equal(live.length, 1)
    assert.equal(live[0].version, 2)
    assert.equal(live[0].supersedes, first.id)
    assert.deepEqual(history(ctx, live[0].id).map((e) => e.id), [live[0].id, first.id])
})

test('el formato es el del contrato', () => {
    const ctx = addEntry(EMPTY_CONTEXT, { segment: 'tiempos', key: 'k', value: 4, source: 'medido', confidence: 'alta', owner: 'supervisor' }, '2026-10-14')
    assert.deepEqual(ctx.segments.tiempos[0], { id: 'tiempos-0001', segment: 'tiempos', version: 1, date: '2026-10-14', key: 'k', value: 4, source: 'medido', confidence: 'alta', owner: 'supervisor' })
})

test('valores y confianza baja como rango', () => {
    assert.deepEqual(parseValue('3,5 a 4,5'), [3.5, 4.5])
    assert.equal(parseValue('4'), 4)
    assert.equal(parseValue('dos turnos'), 'dos turnos')
    assert.equal(showValue({ value: 10, confidence: 'baja' }), '8 a 12 (aprox. 10)')
    assert.equal(showValue({ value: 10, confidence: 'alta' }), '10')
})

test('sin segmented_context se envía texto; con él, el objeto', () => {
    const ctx = addEntry(EMPTY_CONTEXT, { segment: 'operaciones', key: 'turnos', value: 2, source: 'usuario', confidence: 'alta' })
    const text = contextPayload(ctx, 'Taller de transformadores', false)
    assert.equal(typeof text, 'string')
    assert.ok(text.startsWith('Taller de transformadores') && text.includes('turnos: 2'))
    const obj = contextPayload(ctx, 'Taller', true)
    assert.equal(obj.segments.operaciones.length, 1)
    assert.equal(contextPayload(EMPTY_CONTEXT, '', true), undefined)
    assert.ok(toText(ctx).includes('confianza alta'))
})

test('las imágenes no viajan en el contexto', () => {
    const ctx = addEntry(EMPTY_CONTEXT, { segment: 'referencias', key: 'foto-1', value: 'Planta de referencia en U', image: 'data:image/png;base64,xx' })
    const obj = contextPayload(ctx, '', true)
    assert.equal(obj.segments.referencias[0].image, undefined)
    assert.equal(obj.segments.referencias[0].value, 'Planta de referencia en U')
})
