import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { api, fmt } from '../api'
import { arrowPoints, dims, midOf, pathD, rectOf, shortName, snap, straight, uid } from './geometry'
import Inspector from './Inspector'
import { applyOps, diffOps, locate } from './operations'
import StationGlyph from './StationGlyph'
import { parallelPath } from './display'
import { copySelection, deleteSelectionOps, groupMoveOps, pasteOps, rectangleSelection, routeGroupOps, selected, toggleSelection } from './selection'
import GroupInspector from './GroupInspector'
import { recordTimeChanges } from '../context'
import { hasFeature } from '../features'
import PlanAssistant from './PlanAssistant'
import { ConveyorGlyph, FlowLegend } from './FlowGlyph'
import { FLOW_STYLES, returnPath } from './flows'

const TOOLS_FULL = [
    { id: 'conveyor', label: 'Banda', key: 'B', tip: 'Clic en origen, puntos intermedios y destino para dibujar una banda.' },
    { id: 'select', label: 'Mover', key: 'V', tip: 'Selecciona y arrastra máquinas, zonas, paredes y portones.' },
    { id: 'station', label: 'Máquina', key: 'M', tip: 'Clic en el plano para agregar una máquina del tipo elegido.' },
    { id: 'route', label: 'Ruta', key: 'T', tip: 'Clic en la máquina de origen y luego en la de destino. Sigue encadenando; Esc para terminar.' },
    { id: 'wall', label: 'Pared', key: 'P', tip: 'Arrastra para dibujar una pared. Se ajusta a 45°; con Alt queda libre.' },
    { id: 'zone', label: 'Zona', key: 'Z', tip: 'Arrastra un rectángulo: oficina, baños, comedor o zona bloqueada. Por ahí no pasa el material.' },
    { id: 'gate', label: 'Portón', key: 'O', tip: 'Clic sobre el muro de la calle para agregar un portón.' },
]

function useLegs(plant, positions) {
    const [out, setOut] = useState({ legs: [], piece_m: 0, blocked_legs: 0, avoid_hits: [], loading: true })
    
    useEffect(() => {
        const c = new AbortController()
        const t = setTimeout(() => {
            api
                .routes(plant, positions, c.signal)
                .then((r) => setOut({ ...r, loading: false }))
                .catch(() => {})
        }, 220)

        return () => {
            clearTimeout(t)
            c.abort()
        }
    }, [plant, positions])

    return out
}

export default function PlanEditor({ plant, positions, onChange: emitChange, catalog, mode = 'full', onMetrics, title, controller, capabilities = { features: [] } }) {
    const full = mode === 'full'
    const tools = full ? TOOLS_FULL.filter((t) => t.id !== 'conveyor' || hasFeature(capabilities, 'conveyors')) : TOOLS_FULL.filter((t) => t.id === 'select')
    const svg = useRef(null)
    const box = useRef(null)
    const [tool, setTool] = useState('select')
    const [selection, setSelection] = useState([])
    const currentSelection = selection.filter((s) => locate(plant, s.id))
    const sel = currentSelection.length === 1 ? currentSelection[0] : null
    const setSel = (item) => setSelection(item ? [item] : [])
    const clipboard = useRef(null)
    const [hasClipboard, setHasClipboard] = useState(false)
    const pasteCount = useRef(0)
    const marquee = useRef(null)
    const [selectionRect, setSelectionRect] = useState(null)
    const [addKind, setAddKind] = useState('otro')
    const [zoneKind, setZoneKind] = useState('oficina')
    const [routeFrom, setRouteFrom] = useState(null)
    const [flow, setFlow] = useState('material')
    const [isReturn, setIsReturn] = useState(false)
    const [beltDraft, setBeltDraft] = useState(null)
    const [draft, setDraft] = useState(null)
    const [cursor, setCursorPt] = useState(null)
    const drag = useRef(null)
    const undo = useRef([])
    const redo = useRef([])
    const [, force] = useState(0)
    const [notice, setNotice] = useState('')
    const [expanded, setExpanded] = useState({})
    const [viewport, setViewport] = useState(null)
    const pan = useRef(null)
    const live = useLegs(plant, positions)
    const { w: W, d: D } = plant.size
    const frame = viewport || { x: -1.5, z: -1.5, w: W + 3, d: D + 5 }
    const st = useMemo(() => Object.fromEntries(plant.stations.map((s) => [s.id, s])), [plant.stations])
    useEffect(() => {
        const node = svg.current
        const preventScroll = (event) => event.preventDefault()
        node.addEventListener('wheel', preventScroll, { passive: false })
        return () => node.removeEventListener('wheel', preventScroll)
    }, [])

    useEffect(() => {
        onMetrics?.(live)
    }, [live])

    const applyBatch = (ops, remember = true) => {
        if (!ops.length) return
        try {
            const result = applyOps({ ...plant, layout: positions }, ops)
            result.plant = recordTimeChanges({ ...plant, layout: positions }, result.plant)
            if (remember) {
                undo.current.push(result.inverse)
                if (undo.current.length > 100) undo.current.shift()
                redo.current = []
            }
            if (drag.current) drag.current.last = result.plant
            emitChange(result.plant, result.plant.layout)
            setNotice('')
            force((k) => k + 1)
            return result
        } catch (error) { setNotice(error.message); return null }
    }
    const commit = (np = plant, npos = positions) => applyBatch(diffOps({ ...plant, layout: positions }, { ...np, layout: npos }))

    const doUndo = () => {
        const prev = undo.current.pop()
        if (!prev) return
        const result = applyBatch(prev, false)
        if (result) redo.current.push(result.inverse)
        else undo.current.push(prev)
        force((k) => k + 1)
    }

    const doRedo = () => {
        const next = redo.current.pop()
        if (!next) return
        const result = applyBatch(next, false)
        if (result) undo.current.push(result.inverse)
        else redo.current.push(next)
        force((k) => k + 1)
    }

    useImperativeHandle(controller, () => ({ apply: applyBatch, undo: doUndo }))

    const toPt = (e) => {
        const pt = svg.current.createSVGPoint()
        pt.x = e.clientX
        pt.y = e.clientY
        const p = pt.matrixTransform(svg.current.getScreenCTM().inverse())
        return [p.x, p.y]
    }

    const clampStation = (s, x, z, rot) => {
        const [w, d] = dims(s, rot)
        return [Math.min(W - w / 2, Math.max(w / 2, snap(x))), Math.min(D - d / 2, Math.max(d / 2, snap(z)))]
    }

    const rotate = useCallback(
        (id) => {
            const p = positions[id]
            const rot = ((p[2] || 0) + 90) % 360
            const [x, z] = clampStation(st[id], p[0], p[1], rot)
            commit(plant, { ...positions, [id]: [x, z, rot] })
        },
        [plant, positions, st],
    )

    const remove = () => {
        if (!currentSelection.length || !full) return null
        try {
            const result = applyBatch(deleteSelectionOps({ ...plant, layout: positions }, currentSelection))
            if (result) setSel(null)
            return result
        } catch (error) { setNotice(error.message); return null }
    }
    const copy = (cut = false) => {
        const content = copySelection({ ...plant, layout: positions }, currentSelection)
        if (!content.items.length) { setNotice('Selecciona maquinas, zonas, paredes o portones para copiar.'); return }
        if (cut && !remove()) return
        clipboard.current = content
        setHasClipboard(true)
        pasteCount.current = 0
        force((k) => k + 1)
        setNotice(content.items.length + ' elementos copiados, con sus rutas internas.')
    }
    const paste = () => {
        if (!full) return
        const result = pasteOps(clipboard.current, pasteCount.current + 1)
        if (applyBatch(result.ops)) { pasteCount.current += 1; setSelection(result.selection) }
    }

    const addStation = (x, z) => {
        const k = catalog?.kinds.find((q) => q.id === addKind) || { id: 'otro', name: 'Proceso', w: 4, d: 3, t: 3, ops: 1 }
        const id = uid('s')
        const n = plant.stations.filter((s) => s.kind === k.id).length
        const s = { id, name: n ? `${k.name} ${n + 1}` : k.name, kind: k.id, w: k.w, d: k.d, t: k.t, ops: k.ops }
        const [cx, cz] = clampStation(s, x, z, 0)
        commit({ ...plant, stations: [...plant.stations, s] }, { ...positions, [id]: [cx, cz, 0] })
        setSel({ type: 'station', id })
    }

    const routeClick = (id) => {
        if (tool === 'conveyor') {
            if (!beltDraft) { setBeltDraft({ from: id, points: [positions[id].slice(0, 2)] }); return }
            if (beltDraft.from === id) return
            const belt = { id: uid('band-'), from: beltDraft.from, to: id, points: [...beltDraft.points, positions[id].slice(0, 2)], capacity_ppm: 1, speed_mpm: 6, locked: false }
            const route = plant.routes.find((r) => r.from === belt.from && r.to === belt.to && (r.flow || 'material') === 'material')
            const ops = [{ op: 'add', element: belt }]
            ops.push(route ? { op: 'update', id: route.id, set: { conveyor: belt.id } } : { op: 'connect', from: belt.from, to: belt.to, frac: 1, flow: 'material', conveyor: belt.id })
            if (applyBatch(ops)) { setSel({ type: 'conveyor', id: belt.id }); setBeltDraft(null); setTool('select') }
            return
        }
        if (!routeFrom) {
            setRouteFrom(id)
            return
        }
        if (routeFrom !== id && !plant.routes.some((r) => r.from === routeFrom && r.to === id && (r.flow || 'material') === flow)) {
            const r = { id: uid('r'), from: routeFrom, to: id, frac: 1, ...(hasFeature(capabilities, 'flows') ? { flow, is_return: isReturn } : {}) }
            commit({ ...plant, routes: [...plant.routes, r] })
            setSel({ type: 'route', id: r.id })
        }
        setRouteFrom(id)
    }

    useEffect(() => {
        const el = box.current
        const onKey = (e) => {
            
            if (e.target.closest('input, textarea, select')) return

            const k = e.key.toLowerCase()
            if ((e.ctrlKey || e.metaKey) && full && ['c', 'x', 'v'].includes(k)) {
                e.preventDefault()
                if (k === 'v') paste()
                else copy(k === 'x')
            } else if ((e.ctrlKey || e.metaKey) && k === 'z') {
                e.preventDefault()
                if (e.shiftKey) doRedo()
                else doUndo()
            } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
                e.preventDefault()
                doRedo()
            } else if (k === 'delete' || k === 'backspace') {
                e.preventDefault()
                remove()
            } else if (k === 'r' && sel?.type === 'station') rotate(sel.id)
            else if (k === 'escape') {
                marquee.current = null
                setSelectionRect(null)
                setBeltDraft(null)
                setRouteFrom(null)
                setDraft(null)
                setSel(null)
                setTool('select')
            } else if (full && !e.ctrlKey && !e.metaKey) {
                const t = tools.find((q) => q.key.toLowerCase() === k)
                if (t) {
                setBeltDraft(null); setTool(t.id)
                setRouteFrom(null)
                }
            }
        }

        el.addEventListener('keydown', onKey)
        return () => el.removeEventListener('keydown', onKey)
    })

    const startDrag = (e, info) => {
        box.current.focus({ preventScroll: true })
        const item = { type: info.type, id: info.id }
        if (e.shiftKey || e.ctrlKey || e.metaKey) { setSelection(toggleSelection(currentSelection, item)); return }
        const items = selected(currentSelection, item.type, item.id) ? currentSelection : [item]
        setSelection(items)
        try { groupMoveOps({ ...plant, layout: positions }, items, 0, 0) }
        catch (error) { setNotice(error.message); return }
        drag.current = { type: 'group', items, origin: toPt(e), snap: { plant, positions }, moved: false }
        svg.current.setPointerCapture?.(e.pointerId)
    }

    const markMoved = (d) => {
        if (d.moved) return
        d.moved = true
    }

    const onDownStation = (e, s) => {
        e.stopPropagation()
        box.current.focus({ preventScroll: true })
        if (tool === 'route' || tool === 'conveyor') return routeClick(s.id)
        if (tool !== 'select') return

        const [x, z] = toPt(e)
        const p = positions[s.id]
        startDrag(e, { type: 'station', id: s.id, dx: x - p[0], dz: z - p[1] })
    }

    const onDownZone = (e, zn) => {
        if (!full || tool !== 'select') return
        e.stopPropagation()

        const [x, z] = toPt(e)
        startDrag(e, { type: 'zone', id: zn.id, dx: x - zn.x, dz: z - zn.z })
    }

    const onDownWall = (e, w) => {
        if (!full || tool !== 'select') return
        e.stopPropagation()

        const [x, z] = toPt(e)
        startDrag(e, { type: 'wall', id: w.id, x0: x, z0: z, w0: w })
    }

    const onDownGate = (e, g) => {
        if (!full || tool !== 'select') return
        e.stopPropagation()

        startDrag(e, { type: 'gate', id: g.id })
    }

    const onDownRoute = (e, r) => {
        if (!full || tool !== 'select') return
        e.stopPropagation()
        box.current.focus({ preventScroll: true })
        const item = { type: 'route', id: r.id }
        setSelection(e.shiftKey || e.ctrlKey || e.metaKey ? toggleSelection(currentSelection, item) : [item])
    }

    const onDownBg = (e) => {
        box.current.focus({ preventScroll: true })
        const [x, z] = toPt(e)
        if (tool === 'select') {
            marquee.current = { x1: x, z1: z, x2: x, z2: z, base: e.shiftKey || e.ctrlKey || e.metaKey ? currentSelection : [] }
            setSelection(marquee.current.base)
            setSelectionRect(marquee.current)
            svg.current.setPointerCapture?.(e.pointerId)
            return
        }
        if (tool === 'conveyor') {
            if (beltDraft) setBeltDraft({ ...beltDraft, points: [...beltDraft.points, [snap(x), snap(z)]] })
        } else if (tool === 'station') {
            addStation(x, z)
            setTool('select')
        } else if (tool === 'wall' || tool === 'zone') {
            setDraft({ type: tool, x1: snap(x), z1: snap(z), x2: snap(x), z2: snap(z) })
            svg.current.setPointerCapture?.(e.pointerId)
        } else if (tool === 'gate') {
            if (z < D - 3) return
            const used = new Set(plant.gates.map((g) => g.id))
            const id = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((c) => !used.has(c)) || uid('G')
            commit({ ...plant, gates: [...plant.gates, { id, x: Math.min(W - 2.2, Math.max(2.2, snap(x))), label: `Portón ${id}` }] })
            setSel({ type: 'gate', id })
            setTool('select')
        } else if (tool === 'route') setRouteFrom(null)
    }

    const onMove = (e) => {
        if (pan.current) {
            const b = svg.current.getBoundingClientRect()
            const p = pan.current
            const scale = Math.max(p.frame.w / b.width, p.frame.d / b.height)
            setViewport({ ...p.frame, x: p.frame.x - (e.clientX - p.x) * scale, z: p.frame.z - (e.clientY - p.y) * scale })
            return
        }
        const [x, z] = toPt(e)
        if (marquee.current) {
            const rectangle = { ...marquee.current, x2: x, z2: z }
            marquee.current = rectangle
            setSelectionRect(rectangle)
            const hits = rectangleSelection({ ...plant, layout: positions }, rectangle, full)
            setSelection(hits.reduce((items, item) => selected(items, item.type, item.id) ? items : [...items, item], rectangle.base))
            return
        }
        if (tool === 'route' && routeFrom) setCursorPt([x, z])
        if (draft) {
            let x2 = snap(x)
            let z2 = snap(z)

            if (draft.type === 'wall' && !e.altKey) {
                const ang = Math.atan2(z2 - draft.z1, x2 - draft.x1)
                const a = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4)
                const len = Math.hypot(x2 - draft.x1, z2 - draft.z1)
                x2 = snap(draft.x1 + Math.cos(a) * len)
                z2 = snap(draft.z1 + Math.sin(a) * len)
            }
            
            setDraft({ ...draft, x2: Math.min(W, Math.max(0, x2)), z2: Math.min(D, Math.max(0, z2)) })
            return
        }

        const d = drag.current
        if (!d) return

        if (d.type === 'group') {
            const original = { ...d.snap.plant, layout: d.snap.positions }
            try {
                const target = applyOps(original, groupMoveOps(original, d.items, x - d.origin[0], z - d.origin[1])).plant
                const ops = diffOps(d.last || { ...plant, layout: positions }, target)
                if (ops.length) { markMoved(d); applyBatch(ops, false) }
            } catch (error) { setNotice(error.message) }
        }
    }

    const onUp = () => {
        marquee.current = null
        setSelectionRect(null)
        pan.current = null
        const moved = drag.current
        if (moved?.moved && moved.last) {
            const inverse = diffOps(moved.last, { ...moved.snap.plant, layout: moved.snap.positions }, true)
            if (inverse.length) { undo.current.push(inverse); if (undo.current.length > 100) undo.current.shift(); redo.current = []; force((k) => k + 1) }
        }
        if (draft) {
            const { type, x1, z1, x2, z2 } = draft

            if (type === 'wall' && Math.hypot(x2 - x1, z2 - z1) >= 0.5) {
                const id = uid('w')
                commit({ ...plant, walls: [...plant.walls, { id, x1, z1, x2, z2 }] })
                setSel({ type: 'wall', id })
            } else if (type === 'zone' && Math.abs(x2 - x1) >= 1 && Math.abs(z2 - z1) >= 1) {
                const zk = catalog?.zones.find((q) => q.id === zoneKind)
                const id = uid('z')
                const n = plant.zones.filter((q) => q.kind === zoneKind).length
                commit({
                    ...plant,
                    zones: [...plant.zones, { id, name: n ? `${zk?.name} ${n + 1}` : zk?.name || 'Zona', kind: zoneKind, x: (x1 + x2) / 2, z: (z1 + z2) / 2, w: Math.abs(x2 - x1), d: Math.abs(z2 - z1) }],
                })
                setSel({ type: 'zone', id })
            }
            setDraft(null)
            setTool('select')
        }
        drag.current = null
    }

    const legBy = useMemo(() => Object.fromEntries((live.legs || []).map((l) => [l.id, l])), [live.legs])
    const recv = plant.receive_gate
    const disp = plant.dispatch_gate

    const activeTip = tools.find((t) => t.id === tool)?.tip

    return (
        <div className="editor" ref={box} tabIndex={0} aria-label={title || 'Editor del plano'}>
            {hasFeature(capabilities, 'plan_ops') && <PlanAssistant plant={{ ...plant, layout: positions }} onApply={applyBatch} />}
            {notice && <p className="editor-notice" role="status">{notice}</p>}
            <div className="editor-bar">
                {full && <div className="row editor-clipboard">
                    <button type="button" className="btn btn--ghost btn--small" disabled={!currentSelection.length} onClick={() => copy()}>Copiar</button>
                    <button type="button" className="btn btn--ghost btn--small" disabled={!currentSelection.length} onClick={() => copy(true)}>Cortar</button>
                    <button type="button" className="btn btn--ghost btn--small" disabled={!hasClipboard} onClick={paste}>Pegar</button>
                </div>}
                <button type="button" className="btn btn--ghost btn--small" onClick={() => setViewport(null)}>Ajustar vista</button>
                <div className="seg" role="group" aria-label="Herramientas">
                    {tools.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            aria-pressed={tool === t.id}
                            title={`${t.tip} (${t.key})`}
                            onClick={() => {
                                setTool(t.id)
                                setRouteFrom(null)
                            }}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {full && tool === 'route' && hasFeature(capabilities, 'flows') && <><label>Flujo <select value={flow} onChange={(e) => setFlow(e.target.value)}>{Object.keys(FLOW_STYLES).map((f) => <option key={f}>{f}</option>)}</select></label><label><input type="checkbox" checked={isReturn} onChange={(e) => setIsReturn(e.target.checked)} /> Retorno</label></>}
                {full && tool === 'station' && (
                    <select className="editor-select" value={addKind} onChange={(e) => setAddKind(e.target.value)} aria-label="Tipo de máquina">
                        {catalog?.kinds.map((k) => (
                            <option key={k.id} value={k.id}>
                                {k.name}
                            </option>
                        ))}
                    </select>
                )}

                {full && tool === 'zone' && (
                    <select className="editor-select" value={zoneKind} onChange={(e) => setZoneKind(e.target.value)} aria-label="Tipo de zona">
                        {catalog?.zones.map((k) => (
                            <option key={k.id} value={k.id}>
                                {k.name}
                            </option>
                        ))}
                    </select>
                )}

                <div className="editor-history">
                    <button type="button" className="icon-btn icon-btn--flat" onClick={doUndo} disabled={!undo.current.length} title="Deshacer (Ctrl+Z)" aria-label="Deshacer">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                        <   path d="M5 3 L2 6 L5 9 M2 6 H10 A4 4 0 0 1 10 14 H7" />
                        </svg>
                    </button>

                    <button type="button" className="icon-btn icon-btn--flat" onClick={doRedo} disabled={!redo.current.length} title="Rehacer (Ctrl+Y)" aria-label="Rehacer">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 3 L14 6 L11 9 M14 6 H6 A4 4 0 0 0 6 14 H9" />
                        </svg>
                    </button>
                </div>

                <span className="editor-stat num">
                    {live.loading ? 'Calculando…' : `Una pieza recorre ${fmt(live.piece_m, 1)} m`}
                </span>
            </div>

            <div className="editor-body">
                <div className="editor-canvas" data-tool={tool}>
                    <svg
                        ref={svg}
                        viewBox={`${frame.x} ${frame.z} ${frame.w} ${frame.d}`}
                        onWheel={(e) => {
                            const [x, z] = toPt(e)
                            const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12
                            const width = Math.max(3, Math.min((W + 3) * 3, frame.w * factor))
                            const scale = width / frame.w
                            setViewport({ x: x - (x - frame.x) * scale, z: z - (z - frame.z) * scale, w: width, d: frame.d * scale })
                        }}
                        onPointerDownCapture={(e) => {
                            if (e.button === 1 || e.altKey) {
                                e.stopPropagation(); e.preventDefault()
                                pan.current = { x: e.clientX, y: e.clientY, frame }
                                svg.current.setPointerCapture(e.pointerId)
                            }
                        }}
                        onPointerMove={onMove}
                        onPointerUp={onUp}
                        onPointerCancel={onUp}
                        onPointerLeave={() => setCursorPt(null)}
                        role="img"
                        aria-label="Plano de la planta"
                    >
                        <defs>
                        <pattern id="hatch" width="1" height="1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                            <rect width="1" height="1" fill="#fff" />
                            <rect width="0.35" height="1" fill="#000" />
                        </pattern>
                        <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
                            <path d="M1 0 H0 V1" fill="none" stroke="#dedede" strokeWidth="0.03" />
                        </pattern>
                        </defs>

                        <rect x={0} y={0} width={W} height={D} fill="url(#grid)" stroke="#000" strokeWidth={0.3} onPointerDown={onDownBg} />
                        <text x={W / 2} y={D + 3.2} textAnchor="middle" fontSize="1" fill="#767676" letterSpacing="0.3" pointerEvents="none">
                            CALLE
                        </text>

                        {plant.zones.map((zn) => {
                            const on = selected(currentSelection, 'zone', zn.id)
                            return (
                                <g key={zn.id} onPointerDown={(e) => onDownZone(e, zn)} style={{ cursor: full && tool === 'select' ? 'move' : undefined }}>
                                <rect x={zn.x - zn.w / 2} y={zn.z - zn.d / 2} width={zn.w} height={zn.d} fill={zn.kind === 'bloqueado' ? 'url(#hatch)' : '#eeeeee'} fillOpacity={zn.kind === 'bloqueado' ? 0.5 : 1} stroke="#000" strokeWidth={on ? 0.3 : 0.12} strokeDasharray={on ? undefined : '0.5 0.35'} />
                                <text x={zn.x} y={zn.z + 0.35} textAnchor="middle" fontSize="0.95" fill="#3b3b3b" pointerEvents="none">
                                    {zn.locked ? '🔒 ' : ''}{shortName(zn.name, 18)}
                                </text>
                                </g>
                            )
                        })}

                        {plant.walls.map((w) => {
                            const on = selected(currentSelection, 'wall', w.id)
                            return (
                                <g key={w.id} onPointerDown={(e) => onDownWall(e, w)} style={{ cursor: full && tool === 'select' ? 'move' : undefined }}>
                                <line x1={w.x1} y1={w.z1} x2={w.x2} y2={w.z2} stroke="transparent" strokeWidth={1.4} />
                                <line x1={w.x1} y1={w.z1} x2={w.x2} y2={w.z2} stroke="#000" strokeWidth={on ? 0.5 : 0.3} strokeLinecap="square" />
                                {w.locked && <text x={w.x1} y={w.z1} fontSize="0.7">🔒</text>}
                                </g>
                            )
                        })}

                        {(plant.conveyors || []).map((c) => <ConveyorGlyph key={c.id} conveyor={c} selected={selected(currentSelection, 'conveyor', c.id)} onPointerDown={(e) => {
                            if (!full || tool !== 'select') return
                            e.stopPropagation(); startDrag(e, { type: 'conveyor', id: c.id })
                        }} />)}
                        {beltDraft && <path d={pathD(beltDraft.points)} fill="none" stroke="#555" strokeWidth={0.8} pointerEvents="none" />}
                        {plant.routes.map((r) => {
                            const a = positions[r.from]
                            const b = positions[r.to]
                            if (!a || !b) return null
                            const leg = legBy[r.id]
                            const pts = returnPath(parallelPath(r, plant.routes, leg?.path?.length > 1 ? leg.path : straight(a, b)), r.is_return)
                            const style = FLOW_STYLES[r.flow || 'material'] || FLOW_STYLES.material
                            const m = midOf(pts)
                            const on = selected(currentSelection, 'route', r.id)
                            const width = 0.12 + Math.min(1, r.frac ?? 1) * 0.22
                            
                            return (
                                <g key={r.id} onPointerDown={(e) => onDownRoute(e, r)} style={{ cursor: full && tool === 'select' ? 'pointer' : undefined }}>
                                <path d={pathD(pts)} fill="none" stroke="transparent" strokeWidth={1.2} />
                                <path d={pathD(pts)} fill="none" stroke={style.color} strokeOpacity={on ? 1 : 0.65} strokeWidth={on ? width + 0.18 : width} strokeDasharray={style.dash || ((r.frac ?? 1) < 1 ? '0.6 0.4' : leg && !leg.ok ? '0.25 0.25' : undefined)} strokeLinejoin="round" />
                                <polygon points={arrowPoints(m, on ? 0.95 : 0.75)} fill={style.color} />
                                </g>
                            )
                        })}

                        {plant.stations.map((s, index) => {
                            const p = positions[s.id]
                            if (!p) return null
                            const r = rectOf(s, p)
                            const on = selected(currentSelection, 'station', s.id)
                            const start = routeFrom === s.id

                            return (
                                <g key={s.id} onPointerDown={(e) => onDownStation(e, s)} style={{ cursor: tool === 'select' ? 'grab' : tool === 'route' ? 'crosshair' : undefined }}>
                                <title>{`${s.name} ×${s.count || 1}`}</title>
                                <rect x={r.x} y={r.z} width={r.w} height={r.d} fill="transparent" />
                                <StationGlyph station={s} position={p} index={index} selected={on || start} expanded={!!expanded[s.id]} />
                                </g>
                            )
                        })}

                        {plant.gates.map((g) => {
                            const on = selected(currentSelection, 'gate', g.id)
                            const role = g.id === recv && g.id === disp ? 'entra y sale' : g.id === recv ? 'entra' : g.id === disp ? 'sale' : ''
                            
                            return (
                                <g key={g.id} onPointerDown={(e) => onDownGate(e, g)} style={{ cursor: full && tool === 'select' ? 'ew-resize' : undefined }}>
                                <rect x={g.x - 2.2} y={D - 0.35} width={4.4} height={1} fill={role ? '#000' : '#fff'} stroke="#000" strokeWidth={on ? 0.3 : 0.15} />
                                <text x={g.x} y={D + 1.9} textAnchor="middle" fontSize="0.9" fontWeight={role ? 800 : 500} fill="#000" pointerEvents="none">
                                    {g.locked ? '🔒 ' : ''}{g.id} {role}
                                </text>
                                </g>
                            )
                        })}

                        {selectionRect && <rect x={Math.min(selectionRect.x1, selectionRect.x2)} y={Math.min(selectionRect.z1, selectionRect.z2)} width={Math.abs(selectionRect.x2 - selectionRect.x1)} height={Math.abs(selectionRect.z2 - selectionRect.z1)} fill="#000" fillOpacity={0.08} stroke="#000" strokeWidth={0.1} strokeDasharray="0.4 0.2" pointerEvents="none" />}
                        {routeFrom && cursor && positions[routeFrom] && (
                            <line x1={positions[routeFrom][0]} y1={positions[routeFrom][1]} x2={cursor[0]} y2={cursor[1]} stroke="#000" strokeWidth={0.15} strokeDasharray="0.4 0.3" pointerEvents="none" />
                        )}
                        {draft?.type === 'wall' && <line x1={draft.x1} y1={draft.z1} x2={draft.x2} y2={draft.z2} stroke="#000" strokeWidth={0.3} strokeOpacity={0.6} pointerEvents="none" />}
                        {draft?.type === 'zone' && (
                            <rect x={Math.min(draft.x1, draft.x2)} y={Math.min(draft.z1, draft.z2)} width={Math.abs(draft.x2 - draft.x1)} height={Math.abs(draft.z2 - draft.z1)} fill="#000" fillOpacity={0.12} stroke="#000" strokeWidth={0.15} strokeDasharray="0.4 0.3" pointerEvents="none" />
                        )}
                    </svg>
                    <p className="editor-tip small">{tool === 'route' && routeFrom ? `Desde «${st[routeFrom]?.name}»: clic en la máquina de destino.` : activeTip} Shift/Ctrl + clic: sumar o quitar. Arrastra el fondo para seleccionar. Rueda: zoom. Alt + arrastrar o botón central: desplazar vista.</p>
                    {hasFeature(capabilities, 'flows') && <FlowLegend />}
                    <ol className="plan-legend">{plant.stations.map((s) => <li key={s.id}>{s.name}{(s.count || 1) > 1 ? ` ×${s.count}` : ''}</li>)}</ol>
                </div>

                <div>
                    {sel && sel.type !== 'route' && locate(plant, sel.id) && <div className="inspector-lock">
                        <button type="button" className="btn btn--small" onClick={() => {
                            const e = locate(plant, sel.id).element
                            const reason = e.locked ? '' : window.prompt('Motivo del bloqueo', 'Posición fijada por el usuario')
                            if (reason !== null) applyBatch([{ op: e.locked ? 'unlock' : 'lock', id: e.id, reason }])
                        }}>{locate(plant, sel.id).element.locked ? '🔒 Desbloquear' : 'Bloquear'}</button>
                        <p className="small">{locate(plant, sel.id).element.lock_reason}</p>
                    </div>}
                    <GroupInspector flowsEnabled={hasFeature(capabilities, 'flows')} selection={currentSelection} full={full} remove={remove} onRoutes={(patch) => {
                        try { applyBatch(routeGroupOps(plant, currentSelection, patch)) } catch (error) { setNotice(error.message) }
                    }} />
                    {currentSelection.length <= 1 && <Inspector capabilities={capabilities} plant={plant} positions={positions} sel={sel} setSel={setSel} commit={commit} rotate={rotate} remove={remove} catalog={catalog} full={full} live={live} expanded={!!expanded[sel?.id]} onToggleExpanded={() => setExpanded((values) => ({ ...values, [sel.id]: !values[sel.id] }))} />}
                </div>
            </div>
        </div>
    )
}
