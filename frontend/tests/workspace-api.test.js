import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acceptedContext } from '../src/workspaceApi.js'

test('solo actividades y operadores aceptados viajan al análisis; imágenes permanecen fuera', () => {
    const result = acceptedContext({ context: { segments: { referencias: [{ id: 'photo', image: 'data:image/png;base64,ABC', value: 'Plano' }] } },
        contextWorkspace: { activities: [{ id: 'a', status: 'confirmed', time: null }, { id: 'b', status: 'pending', time: 99 }],
            operators: [{ id: 'op', status: 'pending' }] } })
    assert.equal(result.activities.length, 1)
    assert.equal(result.activities[0].time, null)
    assert.equal(result.operators.length, 0)
    assert.equal(result.segments.referencias[0].image, undefined)
})
