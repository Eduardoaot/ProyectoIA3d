import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, fmt } from '../api'
import { arrowPoints, bboxOf, edgesOf, fitToOutline, gateInfo, GATE_HALF, midOf, outlineOf, pathD, polyD, projectToOutline, rectOf, shortName, snap, straight, uid, dims } from './geometry'
import Inspector from './Inspector'

const TOOLS_FULL = [
  { id: 'select', label: 'Mover', key: 'V', tip: 'Selecciona y arrastra máquinas, zonas, paredes y portones.' },
  { id: 'station', label: 'Máquina', key: 'M', tip: 'Clic en el plano para agregar una máquina del tipo elegido.' },
  { id: 'route', label: 'Ruta', key: 'T', tip: 'Clic en la máquina de origen y luego en la de destino. Sigue encadenando; Esc para terminar.' },
  { id: 'wall', label: 'Pared', key: 'P', tip: 'Arrastra para dibujar una pared. Se ajusta a 45°; con Alt queda libre.' },
  { id: 'zone', label: 'Zona', key: 'Z', tip: 'Arrastra un rectángulo: oficina, baños, comedor o zona bloqueada. Por ahí no pasa el material.' },
  { id: 'gate', label: 'Portón', key: 'O', tip: 'Clic sobre cualquier muro exterior para agregar un portón. La calle se agrega de ese lado.' },
  { id: 'shape', label: 'Forma', key: 'F', tip: 'Arrastra una esquina para moverla. Arrastra el punto medio de un lado para expandir o encoger desde ahí; un clic en él crea una esquina nueva. Doble clic en una esquina la borra.' },
]

/* Portapapeles compartido entre editores (se puede copiar en el paso 1 y pegar en el rediseño). */
let clipboard = null

/* Recorridos reales del motor, recalculados poco después de cada cambio. */
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

export default function PlanEditor({ plant, positions, onChange, catalog, mode = 'full', onMetrics, title, actions }) {
  const full = mode === 'full'
  const svg = useRef(null)
  const box = useRef(null)
  const [tool, setTool] = useState('select')
  const [sel, setSel] = useState(null)
  const [addKind, setAddKind] = useState('otro')
  const [zoneKind, setZoneKind] = useState('oficina')
  const [routeFrom, setRouteFrom] = useState(null)
  const [draft, setDraft] = useState(null)
  const [cursor, setCursorPt] = useState(null)
  const drag = useRef(null)
  const lastPt = useRef(null)
  const frozenVB = useRef(null)
  const undo = useRef([])
  const redo = useRef([])
  const [, force] = useState(0)
  const live = useLegs(plant, positions)
  const { w: W, d: D } = plant.size
  const outline = outlineOf(plant)
  const st = useMemo(() => Object.fromEntries(plant.stations.map((s) => [s.id, s])), [plant.stations])
  const kindName = useMemo(() => Object.fromEntries((catalog?.kinds || []).map((k) => [k.id, k.name])), [catalog])

  useEffect(() => {
    onMetrics?.(live)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  /* ---------- Historial ---------- */
  const remember = () => {
    undo.current.push({ plant, positions })
    if (undo.current.length > 100) undo.current.shift()
    redo.current = []
    force((k) => k + 1)
  }
  const commit = (np = plant, npos = positions) => {
    remember()
    onChange(np, npos)
  }
  const doUndo = () => {
    const prev = undo.current.pop()
    if (!prev) return
    redo.current.push({ plant, positions })
    onChange(prev.plant, prev.positions)
    force((k) => k + 1)
  }
  const doRedo = () => {
    const next = redo.current.pop()
    if (!next) return
    undo.current.push({ plant, positions })
    onChange(next.plant, next.positions)
    force((k) => k + 1)
  }

  /* ---------- Acciones ---------- */
  const snapOn = (v) => Math.round(v * 100) / 100
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plant, positions, st],
  )

  const remove = useCallback(() => {
    if (!sel || !full) return
    const { type, id } = sel
    if (type === 'station') {
      const pos = { ...positions }
      delete pos[id]
      commit({ ...plant, stations: plant.stations.filter((s) => s.id !== id), routes: plant.routes.filter((r) => r.from !== id && r.to !== id) }, pos)
    } else if (type === 'route') commit({ ...plant, routes: plant.routes.filter((r) => r.id !== id) })
    else if (type === 'zone') commit({ ...plant, zones: plant.zones.filter((z) => z.id !== id) })
    else if (type === 'wall') commit({ ...plant, walls: plant.walls.filter((w) => w.id !== id) })
    else if (type === 'gate') {
      if (plant.gates.length <= 1) return
      const gates = plant.gates.filter((g) => g.id !== id)
      commit({
        ...plant,
        gates,
        receive_gate: plant.receive_gate === id ? gates[0].id : plant.receive_gate,
        dispatch_gate: plant.dispatch_gate === id ? gates[0].id : plant.dispatch_gate,
      })
    }
    setSel(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, plant, positions, full])

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
    if (!routeFrom) {
      setRouteFrom(id)
      return
    }
    if (routeFrom !== id && !plant.routes.some((r) => r.from === routeFrom && r.to === id)) {
      const r = { id: uid('r'), from: routeFrom, to: id, frac: 1 }
      commit({ ...plant, routes: [...plant.routes, r] })
      setSel({ type: 'route', id: r.id })
    }
    setRouteFrom(id)
  }

  /* ---------- Teclado ---------- */
  useEffect(() => {
    const el = box.current
    const onKey = (e) => {
      if (e.target.closest('input, textarea, select')) return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'c') {
        if (copy()) e.preventDefault()
      } else if ((e.ctrlKey || e.metaKey) && k === 'v') {
        e.preventDefault()
        paste()
      } else if ((e.ctrlKey || e.metaKey) && k === 'd') {
        e.preventDefault()
        duplicate()
      } else if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) doRedo()
        else doUndo()
      } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault()
        doRedo()
      } else if (k === 'delete' || k === 'backspace') {
        e.preventDefault()
        if (sel?.type === 'vertex') removeVertex(sel.i)
        else remove()
      } else if (k === 'r' && sel?.type === 'station') rotate(sel.id)
      else if (k === 'escape') {
        setRouteFrom(null)
        setDraft(null)
        setSel(null)
        setTool('select')
      } else if (full && !e.ctrlKey && !e.metaKey) {
        const t = TOOLS_FULL.find((q) => q.key.toLowerCase() === k)
        if (t) {
          setTool(t.id)
          setRouteFrom(null)
        }
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  })

  /* ---------- Puntero ---------- */
  // El paso de deshacer se guarda al empezar a mover de verdad, no con un simple clic.
  const startDrag = (e, info) => {
    drag.current = { ...info, snap: { plant, positions }, moved: false }
    svg.current.setPointerCapture?.(e.pointerId)
  }
  const markMoved = (d) => {
    if (d.moved) return
    d.moved = true
    undo.current.push(d.snap)
    if (undo.current.length > 100) undo.current.shift()
    redo.current = []
    force((k) => k + 1)
  }

  const onDownStation = (e, s) => {
    e.stopPropagation()
    box.current.focus({ preventScroll: true })
    if (tool === 'route') return routeClick(s.id)
    if (tool !== 'select') return
    setSel({ type: 'station', id: s.id })
    const [x, z] = toPt(e)
    const p = positions[s.id]
    startDrag(e, { type: 'station', id: s.id, dx: x - p[0], dz: z - p[1] })
  }
  const onDownZone = (e, zn) => {
    if (!full || tool !== 'select') return
    e.stopPropagation()
    setSel({ type: 'zone', id: zn.id })
    const [x, z] = toPt(e)
    startDrag(e, { type: 'zone', id: zn.id, dx: x - zn.x, dz: z - zn.z })
  }
  const onDownWall = (e, w) => {
    if (!full || tool !== 'select') return
    e.stopPropagation()
    setSel({ type: 'wall', id: w.id })
    const [x, z] = toPt(e)
    startDrag(e, { type: 'wall', id: w.id, x0: x, z0: z, w0: w })
  }
  const onDownGate = (e, g) => {
    if (!full || tool !== 'select') return
    e.stopPropagation()
    setSel({ type: 'gate', id: g.id })
    startDrag(e, { type: 'gate', id: g.id })
  }
  const onDownRoute = (e, r) => {
    if (!full || tool !== 'select') return
    e.stopPropagation()
    setSel({ type: 'route', id: r.id })
  }

  const onDownBg = (e) => {
    box.current.focus({ preventScroll: true })
    const [x, z] = toPt(e)
    if (tool === 'select') return setSel(null)
    if (tool === 'station') {
      addStation(x, z)
      setTool('select')
    } else if (tool === 'wall' || tool === 'zone') {
      setDraft({ type: tool, x1: snap(x), z1: snap(z), x2: snap(x), z2: snap(z) })
      svg.current.setPointerCapture?.(e.pointerId)
    } else if (tool === 'gate') {
      const p = projectToOutline(outline, [x, z])
      if (p.dist > 3) return
      const used = new Set(plant.gates.map((g) => g.id))
      const id = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((c) => !used.has(c)) || uid('G')
      commit({ ...plant, gates: [...plant.gates, { id, x: snapOn(p.x), z: snapOn(p.z), label: `Portón ${id}` }] })
      setSel({ type: 'gate', id })
      setTool('select')
    } else if (tool === 'route') setRouteFrom(null)
  }

  const onMove = (e) => {
    const [x, z] = toPt(e)
    lastPt.current = x >= 0 && z >= 0 && x <= W && z <= D ? [x, z] : null
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
    if (d.type === 'station') {
      const p = positions[d.id]
      const [nx, nz] = clampStation(st[d.id], x - d.dx, z - d.dz, p[2])
      if (nx !== p[0] || nz !== p[1]) {
        markMoved(d)
        onChange(plant, { ...positions, [d.id]: [nx, nz, p[2] || 0] })
      }
    } else if (d.type === 'zone') {
      const zn = plant.zones.find((q) => q.id === d.id)
      const nx = Math.min(W - zn.w / 2, Math.max(zn.w / 2, snap(x - d.dx)))
      const nz = Math.min(D - zn.d / 2, Math.max(zn.d / 2, snap(z - d.dz)))
      if (nx !== zn.x || nz !== zn.z) {
        markMoved(d)
        onChange({ ...plant, zones: plant.zones.map((q) => (q.id === d.id ? { ...q, x: nx, z: nz } : q)) }, positions)
      }
    } else if (d.type === 'wall') {
      const dx = snap(x - d.x0)
      const dz = snap(z - d.z0)
      const w = d.w0
      if (!dx && !dz) return
      markMoved(d)
      onChange({ ...plant, walls: plant.walls.map((q) => (q.id === d.id ? { ...q, x1: w.x1 + dx, z1: w.z1 + dz, x2: w.x2 + dx, z2: w.z2 + dz } : q)) }, positions)
    } else if (d.type === 'gate') {
      // El portón se desliza por todo el contorno, de un muro exterior a otro.
      const p = projectToOutline(outline, [x, z])
      const g0 = plant.gates.find((g) => g.id === d.id)
      const nx = snapOn(p.x)
      const nz = snapOn(p.z)
      if (nx === g0?.x && nz === (g0?.z ?? D)) return
      markMoved(d)
      onChange({ ...plant, gates: plant.gates.map((g) => (g.id === d.id ? { ...g, x: nx, z: nz } : g)) }, positions)
    } else if (d.type === 'vertex') {
      const nx = snap(x)
      const nz = snap(z)
      const cur = d.outline[d.i]
      if (nx === cur[0] && nz === cur[1]) return
      markMoved(d)
      d.outline = d.outline.map((q, k) => (k === d.i ? [nx, nz] : q))
      onChange({ ...plant, outline: d.outline }, positions)
    } else if (d.type === 'edge') {
      // Empuja el lado completo sobre su normal: expande o encoge la planta desde ese lado.
      const e = edgesOf(d.base)[d.i]
      const delta = snap((x - d.x0) * e.n[0] + (z - d.z0) * e.n[1])
      if (!delta && !d.moved) return
      markMoved(d)
      const j = (d.i + 1) % d.base.length
      d.outline = d.base.map((q, k) => (k === d.i || k === j ? [q[0] + e.n[0] * delta, q[1] + e.n[1] * delta] : q))
      onChange({ ...plant, outline: d.outline }, positions)
    }
  }

  const onUp = () => {
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
    const d = drag.current
    if (d?.type === 'vertex' || d?.type === 'edge') {
      if (d.moved) {
        const fit = fitToOutline(plant, positions, d.outline)
        onChange(fit.plant, fit.positions)
      } else if (d.type === 'edge') {
        // Un clic (sin arrastrar) en el punto medio crea una esquina nueva ahí.
        const e = edgesOf(d.base)[d.i]
        const mid = [snap((e.a[0] + e.b[0]) / 2), snap((e.a[1] + e.b[1]) / 2)]
        commit({ ...plant, outline: [...d.base.slice(0, d.i + 1), mid, ...d.base.slice(d.i + 1)] }, positions)
        setSel({ type: 'vertex', i: d.i + 1 })
      }
      frozenVB.current = null
    }
    drag.current = null
  }

  const onDownVertex = (e, i) => {
    e.stopPropagation()
    box.current.focus({ preventScroll: true })
    setSel({ type: 'vertex', i })
    frozenVB.current = viewBox
    startDrag(e, { type: 'vertex', i, outline: outline.map((q) => [...q]) })
  }
  const onDownEdge = (e, i) => {
    e.stopPropagation()
    box.current.focus({ preventScroll: true })
    const [x, z] = toPt(e)
    frozenVB.current = viewBox
    startDrag(e, { type: 'edge', i, x0: x, z0: z, base: outline.map((q) => [...q]), outline: null })
  }
  const removeVertex = (i) => {
    if (outline.length <= 3) return
    const fit = fitToOutline(plant, positions, outline.filter((_, k) => k !== i))
    commit(fit.plant, fit.positions)
    setSel(null)
  }
  const reshape = (next, size) => {
    const fit = fitToOutline(size ? { ...plant, size } : plant, positions, next)
    commit(fit.plant, fit.positions)
  }

  /* ---------- Copiar y pegar ---------- */
  const copy = () => {
    if (!sel || !full) return false
    if (sel.type === 'station') {
      const s = st[sel.id]
      clipboard = s ? { type: 'station', item: s, rot: positions[sel.id]?.[2] || 0, at: positions[sel.id], n: 0 } : null
    } else if (sel.type === 'zone') {
      const z = plant.zones.find((q) => q.id === sel.id)
      clipboard = z ? { type: 'zone', item: z, n: 0 } : null
    } else if (sel.type === 'wall') {
      const w = plant.walls.find((q) => q.id === sel.id)
      clipboard = w ? { type: 'wall', item: w, n: 0 } : null
    } else return false
    return !!clipboard
  }

  const paste = () => {
    if (!clipboard || !full) return
    clipboard.n += 1
    const off = clipboard.n
    // Con el puntero sobre el plano se pega donde está el puntero; si no, corrido 1 m por cada copia.
    const at = lastPt.current
    const { type, item } = clipboard
    if (type === 'station') {
      const id = uid('s')
      const s = { ...item, id, name: `${item.name} (copia)` }
      const [x, z] = at || [clipboard.at[0] + off, clipboard.at[1] + off]
      const [cx, cz] = clampStation(s, x, z, clipboard.rot)
      commit({ ...plant, stations: [...plant.stations, s] }, { ...positions, [id]: [cx, cz, clipboard.rot] })
      setSel({ type: 'station', id })
    } else if (type === 'zone') {
      const id = uid('z')
      const [x, z] = at || [item.x + off, item.z + off]
      const zn = { ...item, id, name: `${item.name} (copia)`, x: Math.min(W - item.w / 2, Math.max(item.w / 2, snap(x))), z: Math.min(D - item.d / 2, Math.max(item.d / 2, snap(z))) }
      commit({ ...plant, zones: [...plant.zones, zn] })
      setSel({ type: 'zone', id })
    } else if (type === 'wall') {
      const id = uid('w')
      const mx = (item.x1 + item.x2) / 2
      const mz = (item.z1 + item.z2) / 2
      const [dx, dz] = at ? [snap(at[0] - mx), snap(at[1] - mz)] : [off, off]
      commit({ ...plant, walls: [...plant.walls, { id, x1: item.x1 + dx, z1: item.z1 + dz, x2: item.x2 + dx, z2: item.z2 + dz }] })
      setSel({ type: 'wall', id })
    }
  }

  const duplicate = () => {
    const keep = lastPt.current
    lastPt.current = null
    if (copy()) paste()
    lastPt.current = keep
  }

  /* ---------- Dibujo ---------- */
  const legBy = useMemo(() => Object.fromEntries((live.legs || []).map((l) => [l.id, l])), [live.legs])
  const recv = plant.receive_gate
  const disp = plant.dispatch_gate
  const tools = full ? TOOLS_FULL : TOOLS_FULL.slice(0, 1)
  const bb = bboxOf([...outline, [0, 0], [W, D]])
  const M = plant.gates.some((g) => g.x <= 0.5 || g.x >= W - 0.5) ? 7 : 4
  // Mientras se arrastra el contorno la vista queda fija, para que el punto no se escape del puntero.
  const viewBox = frozenVB.current || `${bb.x0 - M} ${bb.z0 - M} ${bb.x1 - bb.x0 + 2 * M} ${bb.z1 - bb.z0 + 2 * M}`
  const [vx, vz, vw, vh] = viewBox.split(' ').map(Number)
  const shapeOn = full && tool === 'shape'
  const activeTip = tools.find((t) => t.id === tool)?.tip

  return (
    <div className="editor" ref={box} tabIndex={0} aria-label={title || 'Editor del plano'}>
      <div className="editor-bar">
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
              <path d="M5 3 L2 6 L5 9 M2 6 H10 A4 4 0 0 1 10 14 H7" />
            </svg>
          </button>
          <button type="button" className="icon-btn icon-btn--flat" onClick={doRedo} disabled={!redo.current.length} title="Rehacer (Ctrl+Y)" aria-label="Rehacer">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 3 L14 6 L11 9 M14 6 H6 A4 4 0 0 0 6 14 H9" />
            </svg>
          </button>
        </div>
        {actions && <div className="editor-actions">{actions}</div>}
        <span className="editor-stat num">
          {live.loading ? 'Calculando…' : `Una pieza recorre ${fmt(live.piece_m, 1)} m`}
        </span>
      </div>

      <div className="editor-body">
        <div className="editor-canvas" data-tool={tool}>
          <svg
            ref={svg}
            viewBox={viewBox}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => {
              setCursorPt(null)
              lastPt.current = null
            }}
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

            <rect x={vx} y={vz} width={vw} height={vh} fill="transparent" onPointerDown={onDownBg} />
            <path d={polyD(outline)} fill="url(#grid)" stroke="#000" strokeWidth={0.3} onPointerDown={onDownBg} />

            {plant.zones.map((zn) => {
              const on = sel?.type === 'zone' && sel.id === zn.id
              return (
                <g key={zn.id} onPointerDown={(e) => onDownZone(e, zn)} style={{ cursor: full && tool === 'select' ? 'move' : undefined }}>
                  <rect x={zn.x - zn.w / 2} y={zn.z - zn.d / 2} width={zn.w} height={zn.d} fill={zn.kind === 'bloqueado' ? 'url(#hatch)' : '#eeeeee'} fillOpacity={zn.kind === 'bloqueado' ? 0.5 : 1} stroke="#000" strokeWidth={on ? 0.3 : 0.12} strokeDasharray={on ? undefined : '0.5 0.35'} />
                  <text x={zn.x} y={zn.z + 0.35} textAnchor="middle" fontSize="0.95" fill="#3b3b3b" pointerEvents="none">
                    {shortName(zn.name, 18)}
                  </text>
                </g>
              )
            })}

            {plant.walls.map((w) => {
              const on = sel?.type === 'wall' && sel.id === w.id
              return (
                <g key={w.id} onPointerDown={(e) => onDownWall(e, w)} style={{ cursor: full && tool === 'select' ? 'move' : undefined }}>
                  <line x1={w.x1} y1={w.z1} x2={w.x2} y2={w.z2} stroke="transparent" strokeWidth={1.4} />
                  <line x1={w.x1} y1={w.z1} x2={w.x2} y2={w.z2} stroke="#000" strokeWidth={on ? 0.5 : 0.3} strokeLinecap="square" />
                </g>
              )
            })}

            {plant.routes.map((r) => {
              const a = positions[r.from]
              const b = positions[r.to]
              if (!a || !b) return null
              const leg = legBy[r.id]
              const pts = leg?.path?.length > 1 ? leg.path : straight(a, b)
              const m = midOf(pts)
              const on = sel?.type === 'route' && sel.id === r.id
              const width = 0.12 + Math.min(1, r.frac ?? 1) * 0.22
              return (
                <g key={r.id} onPointerDown={(e) => onDownRoute(e, r)} style={{ cursor: full && tool === 'select' ? 'pointer' : undefined }}>
                  <path d={pathD(pts)} fill="none" stroke="transparent" strokeWidth={1.2} />
                  <path d={pathD(pts)} fill="none" stroke="#000" strokeOpacity={on ? 1 : 0.65} strokeWidth={on ? width + 0.18 : width} strokeDasharray={(r.frac ?? 1) < 1 ? '0.6 0.4' : leg && !leg.ok ? '0.25 0.25' : undefined} strokeLinejoin="round" />
                  <polygon points={arrowPoints(m, on ? 0.95 : 0.75)} fill="#000" />
                </g>
              )
            })}

            {plant.stations.map((s) => {
              const p = positions[s.id]
              if (!p) return null
              const r = rectOf(s, p)
              const on = sel?.type === 'station' && sel.id === s.id
              const start = routeFrom === s.id
              return (
                <g key={s.id} onPointerDown={(e) => onDownStation(e, s)} style={{ cursor: tool === 'select' ? 'grab' : tool === 'route' ? 'crosshair' : undefined }}>
                  <rect x={r.x} y={r.z} width={r.w} height={r.d} fill={on || start ? '#000' : '#fff'} stroke="#000" strokeWidth={on ? 0.3 : 0.18} />
                  <text x={p[0]} y={p[1] - 0.05} textAnchor="middle" fontSize="0.9" fontWeight="700" fill={on || start ? '#fff' : '#000'} pointerEvents="none">
                    {shortName(s.name, Math.max(6, Math.floor(r.w * 1.9)))}
                  </text>
                  <text x={p[0]} y={p[1] + 0.95} textAnchor="middle" fontSize="0.6" fill={on || start ? '#c2c2c2' : '#767676'} pointerEvents="none">
                    {shortName(kindName[s.kind] || s.kind, Math.max(6, Math.floor(r.w * 2.6)))}
                  </text>
                </g>
              )
            })}

            {plant.gates.map((g) => {
              const on = sel?.type === 'gate' && sel.id === g.id
              const role = g.id === recv && g.id === disp ? 'entra y sale' : g.id === recv ? 'entra' : g.id === disp ? 'sale' : ''
              const gi = gateInfo(plant, g)
              const lift = 1.7 + Math.abs(gi.n[0]) * 2.2
              return (
                <g key={g.id} onPointerDown={(e) => onDownGate(e, g)} style={{ cursor: full && tool === 'select' ? 'move' : undefined }}>
                  <rect x={-GATE_HALF} y={-0.35} width={GATE_HALF * 2} height={1} transform={`translate(${gi.x} ${gi.z}) rotate(${gi.deg})`} fill={role ? '#000' : '#fff'} stroke="#000" strokeWidth={on ? 0.3 : 0.15} />
                  <text x={gi.x + gi.n[0] * lift} y={gi.z + gi.n[1] * lift + 0.3} textAnchor="middle" fontSize="0.9" fontWeight={role ? 800 : 500} fill="#000" pointerEvents="none">
                    {g.id} {role}
                  </text>
                </g>
              )
            })}

            {shapeOn &&
              edgesOf(outline).map((e) => {
                const mx = (e.a[0] + e.b[0]) / 2
                const mz = (e.a[1] + e.b[1]) / 2
                return (
                  <g key={`e${e.i}`}>
                    <circle cx={mx} cy={mz} r={0.55} fill="#fff" stroke="#000" strokeWidth={0.15} style={{ cursor: 'grab' }} onPointerDown={(ev) => onDownEdge(ev, e.i)}>
                      <title>Arrastra para expandir o encoger. Clic para crear una esquina.</title>
                    </circle>
                    <text x={mx + e.n[0] * 1.6} y={mz + e.n[1] * 1.6 + 0.3} textAnchor="middle" fontSize="0.75" fill="#767676" pointerEvents="none">
                      {fmt(e.len, 1)} m
                    </text>
                  </g>
                )
              })}
            {shapeOn &&
              outline.map((q, i) => {
                const on = sel?.type === 'vertex' && sel.i === i
                return (
                  <rect
                    key={`v${i}`}
                    x={q[0] - 0.55}
                    y={q[1] - 0.55}
                    width={1.1}
                    height={1.1}
                    fill={on ? '#000' : '#fff'}
                    stroke="#000"
                    strokeWidth={0.2}
                    style={{ cursor: 'move' }}
                    onPointerDown={(ev) => onDownVertex(ev, i)}
                    onDoubleClick={() => removeVertex(i)}
                  />
                )
              })}

            {routeFrom && cursor && positions[routeFrom] && (
              <line x1={positions[routeFrom][0]} y1={positions[routeFrom][1]} x2={cursor[0]} y2={cursor[1]} stroke="#000" strokeWidth={0.15} strokeDasharray="0.4 0.3" pointerEvents="none" />
            )}
            {draft?.type === 'wall' && <line x1={draft.x1} y1={draft.z1} x2={draft.x2} y2={draft.z2} stroke="#000" strokeWidth={0.3} strokeOpacity={0.6} pointerEvents="none" />}
            {draft?.type === 'zone' && (
              <rect x={Math.min(draft.x1, draft.x2)} y={Math.min(draft.z1, draft.z2)} width={Math.abs(draft.x2 - draft.x1)} height={Math.abs(draft.z2 - draft.z1)} fill="#000" fillOpacity={0.12} stroke="#000" strokeWidth={0.15} strokeDasharray="0.4 0.3" pointerEvents="none" />
            )}
          </svg>
          <p className="editor-tip small">{tool === 'route' && routeFrom ? `Desde «${st[routeFrom]?.name}»: clic en la máquina de destino.` : activeTip}</p>
        </div>

        <Inspector plant={plant} positions={positions} sel={sel} setSel={setSel} commit={commit} rotate={rotate} remove={remove} catalog={catalog} full={full} live={live} duplicate={duplicate} reshape={reshape} removeVertex={removeVertex} />
      </div>
    </div>
  )
}
