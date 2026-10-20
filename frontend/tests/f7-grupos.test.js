import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { copyGroup, deleteOps, moveOps, pasteOps, patchRoutes, routesAmong, selectInRect } from '../src/groups.js'
import { applyOps } from '../src/ops.js'

const plant = JSON.parse(readFileSync(new URL('../../pruebas/transformadores.json', import.meta.url), 'utf8'))
let k = 0
const makeId = (p) => `${p}-t${++k}`

test('selección por rectángulo', () => {
    // corte (5,12), núcleo (5,5) y recepción (5,20) están en la columna izquierda.
    assert.deepEqual(selectInRect(plant, plant.layout, { x1: 0, z1: 0, x2: 9, z2: 24 }).sort(), ['corte', 'nucleo', 'recepcion'])
    assert.deepEqual(selectInRect(plant, plant.layout, { x1: 46, z1: 0, x2: 48, z2: 2 }), [])
})

test('copiar 3 estaciones conectadas y pegarlas da 3 estaciones y sus rutas internas', () => {
    const ids = ['recepcion', 'corte', 'nucleo']
    const clip = copyGroup(plant, plant.layout, ids)
    assert.equal(clip.routes.length, 2) // recepción→corte y corte→núcleo; las que salen del grupo no
    const { ops, ids: news } = pasteOps(clip, plant, [2, 2], makeId)
    const out = applyOps(plant, ops)
    assert.deepEqual(out.rejected, [])
    assert.equal(out.plant.stations.length, plant.stations.length + 3)
    assert.equal(out.plant.routes.length, plant.routes.length + 2)
    const copied = out.plant.routes.filter((r) => news.includes(r.from))
    assert.ok(copied.every((r) => news.includes(r.to)))
    assert.deepEqual(out.plant.layout[news[0]], [plant.layout.recepcion[0] + 2, plant.layout.recepcion[1] + 2, 0])
    // Deshacer las elimina en un solo paso.
    assert.deepEqual(applyOps(out.plant, out.inverse).plant, plant)
})

test('cortar respeta lo fijo y se deshace en un paso', () => {
    const p = { ...plant, stations: plant.stations.map((s) => (s.id === 'corte' ? { ...s, locked: true } : s)) }
    const out = applyOps(p, deleteOps(['recepcion', 'corte']))
    assert.equal(out.rejected.length, 1)
    assert.ok(out.plant.stations.some((s) => s.id === 'corte'))
    assert.deepEqual(applyOps(out.plant, out.inverse).plant, p)
})

test('mover en grupo es un lote de move', () => {
    const ops = moveOps(plant.layout, ['corte', 'nucleo'], 1, -1)
    assert.deepEqual(ops.map((o) => o.op), ['move', 'move'])
    const out = applyOps(plant, ops)
    assert.deepEqual(out.plant.layout.corte, [6, 11, 0])
    assert.deepEqual(applyOps(out.plant, out.inverse).plant, plant)
})

test('cambiar flujo o porcentaje a varias rutas a la vez', () => {
    const rs = routesAmong(plant, ['recepcion', 'corte', 'nucleo'])
    const p = patchRoutes(plant, rs.map((r) => r.id), { flow: 'carga', frac: 0.5 })
    assert.ok(p.routes.filter((r) => rs.some((x) => x.id === r.id)).every((r) => r.flow === 'carga' && r.frac === 0.5))
    assert.equal(p.routes.filter((r) => r.flow === 'carga').length, 2)
})
