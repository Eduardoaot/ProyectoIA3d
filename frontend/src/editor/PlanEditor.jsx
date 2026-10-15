import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, fmt } from '../api'
import { arrowPoints, bboxOf, edgesOf, fitToOutline, gateInfo, GATE_HALF, midOf, nearestOnSeg, outlineOf, pathD, pointInPoly, polyD, projectToOutline, rectOf, round2, shortName, smartPoint, snap, straight, uid, dims } from './geometry'
import Inspector from './Inspector'

const TOOLS_FULL = [
  { id: 'select', label: 'Mover', key: 'V', tip: 'Selecciona y arrastra máquinas, zonas, paredes y portones. Arrastra el fondo para mover la vista; la rueda acerca y aleja. Las flechas mueven lo seleccionado (Shift: 10 veces más).' },
  { id: 'station', label: 'Máquina', key: 'M', tip: 'Clic en el plano para agregar una máquina del tipo elegido.' },
  { id: 'route', label: 'Ruta', key: 'T', tip: 'Clic en la máquina de origen y luego en la de destino. Sigue encadenando; Esc para terminar.' },
  { id: 'wall', label: 'Pared', key: 'P', tip: 'Arrastra para dibujar una pared interior. Se pega a esquinas y muros cercanos y se ajusta a 45°; con Alt queda libre.' },
  { id: 'zone', label: 'Zona', key: 'Z', tip: 'Arrastra un rectángulo: oficina, baños, comedor o zona bloqueada. Por ahí no pasa el material.' },
  { id: 'gate', label: 'Portón', key: 'O', tip: 'Clic sobre cualquier muro exterior para agregar un portón. La calle se agrega de ese lado.' },
  { id: 'outline', label: 'Contorno', key: 'C', tip: 'Dibuja tus muros exteriores: clic en cada esquina. Escribe un número y Enter para un largo exacto. Cierra con clic en el primer punto, doble clic o Enter. Retroceso borra el último punto; Alt quita el ajuste de ángulo.' },
  { id: 'shape', label: 'Forma', key: 'F', tip: 'Arrastra esquinas y lados. Clic en un lado para editarlo con medidas exactas; doble clic sobre un lado agrega una esquina ahí. Doble clic en una esquina la borra.' },
]

const GRIDS = [
  { v: 1, label: '1 m' },
  { v: 0.5, label: '50 cm' },
  { v: 0.25, label: '25 cm' },
  { v: 0.1, label: '10 cm' },
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

const wallSeg = (w) => [
  [w.x1, w.z1],
  [w.x2, w.z2],
]

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
  const [pen, setPen] = useState(null)
  const [cursor, setCursorPt] = useState(null)
  const [grid, setGrid] = useState(0.5)
  const [cam, setCam] = useState(null)
  const [guides, setGuides] = useState([])
  const drag = useRef(null)
  const lastPt = useRef(null)
  const frozenVB = useRef(null)
  const viewRef = useRef(null)
  const undo = useRef([])
  const redo = useRef([])
  const [, force] = useState(0)
  const live = useLegs(plant, positions)
  const { w: W, d: D } = plant.size
  const outline = outlineOf(plant)
  const st = useMemo(() => Object.fromEntries(plant.stations.map((s) => [s.id, s])), [plant.stations])
  const kindName = useMemo(() => Object.fromEntries((catalog?.kinds || []).map((k) => [k.id, k.name])), [catalog])
  const g = (v) => round2(snap(v, grid))

  useEffect(() => {
    onMetrics?.(live)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  /* ---------- Vista: encuadre, acercar y mover ---------- */
  const bb = bboxOf([...outline, [0, 0], [W, D]])
  const M = tool === 'outline' ? Math.max(8, Math.max(W, D) * 0.35) : plant.gates.some((q) => q.x <= 0.5 || q.x >= W - 0.5) ? 7 : 4
  const fitVB = `${bb.x0 - M} ${bb.z0 - M} ${bb.x1 - bb.x0 + 2 * M} ${bb.z1 - bb.z0 + 2 * M}`
  // Mientras se arrastra el contorno la vista queda fija, para que el punto no se escape del puntero.
  const viewBox = frozenVB.current || (cam ? `${cam.x} ${cam.z} ${cam.w} ${cam.h}` : fitVB)
  const [vx, vz, vw, vh] = viewBox.split(' ').map(Number)
  viewRef.current = { x: vx, z: vz, w: vw, h: vh }
  // Tamaño de manijas y tolerancia del imán según el acercamiento (siempre parecido en pantalla).
  const u = Math.max(vw, vh) / 70
  const tol = u * 0.9

  const zoomAt = useCallback((k, at) => {
    const v = viewRef.current
    const w = Math.min(400, Math.max(3, v.w * k))
    const kk = w / v.w
    const [px, pz] = at || [v.x + v.w / 2, v.z + v.h / 2]
    setCam({ x: px - (px - v.x) * kk, z: pz - (pz - v.z) * kk, w, h: v.h * kk })
  }, [])

  useEffect(() => {
    const el = svg.current
    const onWheel = (e) => {
      e.preventDefault()
      const pt = el.createSVGPoint()
      pt.x = e.clientX
      pt.y = e.clientY
      const p = pt.matrixTransform(el.getScreenCTM().inverse())
      zoomAt(Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0016), [p.x, p.y])
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

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
  const toPt = (e) => {
    const pt = svg.current.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.current.getScreenCTM().inverse())
    return [p.x, p.y]
  }

  const clampStation = (s, x, z, rot) => {
    const [w, d] = dims(s, rot)
    return [round2(Math.min(W - w / 2, Math.max(w / 2, g(x)))), round2(Math.min(D - d / 2, Math.max(d / 2, g(z))))]
  }

  // Puntos y lados a los que se pega lo que se dibuja (esquinas, muros y paredes).
  const magnetPoints = (skipWall) => [...outline, ...plant.walls.filter((w) => w.id !== skipWall).flatMap(wallSeg)]
  const magnetSegs = (skipWall) => [...edgesOf(outline).map((e) => [e.a, e.b]), ...plant.walls.filter((w) => w.id !== skipWall).map(wallSeg)]

  const rotate = useCallback(
    (id) => {
      const p = positions[id]
      const rot = ((p[2] || 0) + 90) % 360
      const [x, z] = clampStation(st[id], p[0], p[1], rot)
      commit(plant, { ...positions, [id]: [x, z, rot] })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plant, positions, st, grid],
  )

  const reshape = (next, size) => {
    const fit = fitToOutline(size ? { ...plant, size } : plant, positions, next)
    commit(fit.plant, fit.positions)
  }

  const removeVertex = (i) => {
    if (outline.length <= 3) return
    reshape(outline.filter((_, k) => k !== i))
    setSel(null)
  }

  /* Operaciones exactas sobre el contorno, paredes, máquinas y zonas (las usa el inspector). */
  const ops = {
    moveVertex: (i, x, z) => reshape(outline.map((q, k) => (k === i ? [round2(x), round2(z)] : q))),
    // Cambiar el largo de un lado corre el lado siguiente: un rectángulo sigue siendo rectángulo.
    setEdgeLength: (i, len) => {
      const e = edgesOf(outline)[i]
      const dl = len - e.len
      const n = outline.length
      const j = (i + 1) % n
      const k = (i + 2) % n
      reshape(outline.map((q, m) => (m === j || (m === k && k !== i) ? [round2(q[0] + e.dir[0] * dl), round2(q[1] + e.dir[1] * dl)] : q)))
    },
    pushEdge: (i, d) => {
      const e = edgesOf(outline)[i]
      const j = (i + 1) % outline.length
      reshape(outline.map((q, m) => (m === i || m === j ? [round2(q[0] + e.n[0] * d), round2(q[1] + e.n[1] * d)] : q)))
    },
    splitEdge: (i, at = 0.5) => {
      const e = edgesOf(outline)[i]
      const p = [round2(e.a[0] + (e.b[0] - e.a[0]) * at), round2(e.a[1] + (e.b[1] - e.a[1]) * at)]
      reshape([...outline.slice(0, i + 1), p, ...outline.slice(i + 1)])
      setSel({ type: 'vertex', i: i + 1 })
    },
    // Quitar un lado junta sus dos esquinas en una sola, en el centro del lado.
    removeEdge: (i) => {
      if (outline.length <= 3) return
      const e = edgesOf(outline)[i]
      const j = (i + 1) % outline.length
      const mid = [round2((e.a[0] + e.b[0]) / 2), round2((e.a[1] + e.b[1]) / 2)]
      const next = outline.map((q, m) => (m === i ? mid : q)).filter((_, m) => m !== j)
      reshape(next)
      setSel(null)
    },
    straightenEdge: (i) => {
      const e = edgesOf(outline)[i]
      const j = (i + 1) % outline.length
      const horizontal = Math.abs(e.b[0] - e.a[0]) >= Math.abs(e.b[1] - e.a[1])
      reshape(outline.map((q, m) => (m === j ? (horizontal ? [q[0], e.a[1]] : [e.a[0], q[1]]) : q)))
    },
    gateOnEdge: (i) => {
      const e = edgesOf(outline)[i]
      const used = new Set(plant.gates.map((q) => q.id))
      const id = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((c) => !used.has(c)) || uid('G')
      commit({ ...plant, gates: [...plant.gates, { id, x: round2((e.a[0] + e.b[0]) / 2), z: round2((e.a[1] + e.b[1]) / 2), label: `Portón ${id}` }] })
      setSel({ type: 'gate', id })
    },
    setWall: (id, patch) => commit({ ...plant, walls: plant.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)) }),
    setWallLength: (id, len) => {
      const w = plant.walls.find((q) => q.id === id)
      const L = Math.hypot(w.x2 - w.x1, w.z2 - w.z1) || 1
      ops.setWall(id, { x2: round2(w.x1 + ((w.x2 - w.x1) / L) * len), z2: round2(w.z1 + ((w.z2 - w.z1) / L) * len) })
    },
    // Una pared se parte en dos segmentos: así se puede borrar solo un tramo.
    splitWall: (id) => {
      const w = plant.walls.find((q) => q.id === id)
      const mx = round2((w.x1 + w.x2) / 2)
      const mz = round2((w.z1 + w.z2) / 2)
      const a = { ...w, x2: mx, z2: mz }
      const b = { id: uid('w'), x1: mx, z1: mz, x2: w.x2, z2: w.z2 }
      commit({ ...plant, walls: plant.walls.flatMap((q) => (q.id === id ? [a, b] : [q])) })
      setSel({ type: 'wall', id: b.id })
    },
    moveStation: (id, x, z) => {
      const p = positions[id]
      const [w, d] = dims(st[id], p[2])
      commit(plant, { ...positions, [id]: [round2(Math.min(W - w / 2, Math.max(w / 2, x))), round2(Math.min(D - d / 2, Math.max(d / 2, z))), p[2] || 0] })
    },
  }

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
    else if (type === 'vertex') return removeVertex(sel.i)
    else if (type === 'edge') return ops.removeEdge(sel.i)
    else if (type === 'gate') {
      if (plant.gates.length <= 1) return
      const gates = plant.gates.filter((q) => q.id !== id)
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

  /* Flechas: mueve lo seleccionado un paso de la malla (Shift: diez pasos). */
  const nudge = (dx, dz) => {
    if (!sel || !full) return false
    if (sel.type === 'station') {
      const p = positions[sel.id]
      ops.moveStation(sel.id, p[0] + dx, p[1] + dz)
    } else if (sel.type === 'zone') {
      const zn = plant.zones.find((q) => q.id === sel.id)
      commit({ ...plant, zones: plant.zones.map((q) => (q.id === sel.id ? { ...q, x: round2(Math.min(W - zn.w / 2, Math.max(zn.w / 2, q.x + dx))), z: round2(Math.min(D - zn.d / 2, Math.max(zn.d / 2, q.z + dz))) } : q)) })
    } else if (sel.type === 'wall') {
      const w = plant.walls.find((q) => q.id === sel.id)
      ops.setWall(sel.id, { x1: round2(w.x1 + dx), z1: round2(w.z1 + dz), x2: round2(w.x2 + dx), z2: round2(w.z2 + dz) })
    } else if (sel.type === 'vertex') {
      const q = outline[sel.i]
      ops.moveVertex(sel.i, q[0] + dx, q[1] + dz)
    } else if (sel.type === 'edge') {
      const j = (sel.i + 1) % outline.length
      reshape(outline.map((q, m) => (m === sel.i || m === j ? [round2(q[0] + dx), round2(q[1] + dz)] : q)))
    } else return false
    return true
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

  /* ---------- Dibujar el contorno punto por punto ---------- */
  const penPoint = (raw, free) => {
    const pts = pen?.pts || []
    const from = pts[pts.length - 1] || null
    return smartPoint(raw, { points: [...pts, ...outline, ...plant.walls.flatMap(wallSeg)], segs: [], from, free, grid, tol })
  }

  const closePen = (pts = pen?.pts) => {
    if (!pts || pts.length < 3) return
    reshape(pts)
    setPen(null)
    setGuides([])
    setCam(null)
    // Queda en Forma para afinar lados y esquinas con medidas exactas.
    setTool('shape')
    setSel(null)
  }

  const penAdd = (p) => {
    const pts = pen?.pts || []
    const first = pts[0]
    if (pts.length >= 3 && Math.hypot(p[0] - first[0], p[1] - first[1]) <= tol) return closePen(pts)
    const last = pts[pts.length - 1]
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.05) return
    // La vista queda fija mientras se dibuja, para que los clics no se corran.
    if (!pts.length && !cam) setCam(viewRef.current)
    setPen({ pts: [...pts, p], typed: '' })
  }

  // Largo escrito con el teclado: coloca el punto en la dirección del puntero.
  const penTyped = () => {
    const pts = pen?.pts || []
    const len = Number(String(pen?.typed || '').replace(',', '.'))
    const last = pts[pts.length - 1]
    if (!last || !(len > 0)) return false
    const aim = cursor || [last[0] + 1, last[1]]
    let ang = Math.atan2(aim[1] - last[1], aim[0] - last[0])
    ang = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4)
    penAdd([round2(last[0] + Math.cos(ang) * len), round2(last[1] + Math.sin(ang) * len)])
    return true
  }

  const onDownPen = (e) => {
    if (e.button !== 0) return
    e.stopPropagation()
    box.current.focus({ preventScroll: true })
    const { p } = penPoint(toPt(e), e.altKey)
    penAdd(p)
  }

  /* ---------- Teclado ---------- */
  useEffect(() => {
    const el = box.current
    const onKey = (e) => {
      if (e.target.closest('input, textarea, select')) return
      const k = e.key.toLowerCase()
      if (tool === 'outline' && pen && !e.ctrlKey && !e.metaKey) {
        if (/^[0-9]$/.test(k) || k === ',' || k === '.') {
          e.preventDefault()
          setPen({ ...pen, typed: (pen.typed || '') + k })
          return
        }
        if (k === 'backspace') {
          e.preventDefault()
          if (pen.typed) setPen({ ...pen, typed: pen.typed.slice(0, -1) })
          else if (pen.pts.length > 1) setPen({ ...pen, pts: pen.pts.slice(0, -1) })
          else setPen(null)
          return
        }
        if (k === 'enter') {
          e.preventDefault()
          if (!penTyped()) closePen()
          return
        }
        if (k === 'escape') {
          e.preventDefault()
          setPen(null)
          setGuides([])
          return
        }
      }
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
        remove()
      } else if (k.startsWith('arrow')) {
        const step = grid * (e.shiftKey ? 10 : 1)
        const [dx, dz] = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[k] || [0, 0]
        if (nudge(dx, dz)) e.preventDefault()
      } else if (k === 'r' && sel?.type === 'station') rotate(sel.id)
      else if (k === 'escape') {
        setRouteFrom(null)
        setDraft(null)
        setPen(null)
        setGuides([])
        setSel(null)
        setTool('select')
      } else if (full && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = TOOLS_FULL.find((q) => q.key.toLowerCase() === k)
        if (t) pickTool(t.id)
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  })

  const pickTool = (id) => {
    setTool(id)
    setRouteFrom(null)
    setPen(null)
    setGuides([])
    if (id === 'outline') setSel(null)
  }

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

  const startPan = (e) => {
    const ctm = svg.current.getScreenCTM()
    drag.current = { type: 'pan', cx: e.clientX, cy: e.clientY, view: { ...viewRef.current }, k: 1 / ctm.a }
    svg.current.setPointerCapture?.(e.pointerId)
  }

  const onDownCapture = (e) => {
    // Botón central: mover la vista con cualquier herramienta.
    if (e.button === 1) {
      e.preventDefault()
      e.stopPropagation()
      startPan(e)
    }
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
  const onDownZoneCorner = (e, zn, cx, cz) => {
    e.stopPropagation()
    // La esquina opuesta queda fija.
    startDrag(e, { type: 'zoneCorner', id: zn.id, fx: zn.x - cx * (zn.w / 2), fz: zn.z - cz * (zn.d / 2) })
  }
  const onDownWall = (e, w) => {
    if (!full || tool !== 'select') return
    e.stopPropagation()
    setSel({ type: 'wall', id: w.id })
    const [x, z] = toPt(e)
    startDrag(e, { type: 'wall', id: w.id, x0: x, z0: z, w0: w })
  }
  const onDownWallEnd = (e, w, end) => {
    e.stopPropagation()
    startDrag(e, { type: 'wallEnd', id: w.id, end })
  }
  const onDownGate = (e, gt) => {
    if (!full || tool !== 'select') return
    e.stopPropagation()
    setSel({ type: 'gate', id: gt.id })
    startDrag(e, { type: 'gate', id: gt.id })
  }
  const onDownRoute = (e, r) => {
    if (!full || tool !== 'select') return
    e.stopPropagation()
    setSel({ type: 'route', id: r.id })
  }

  const onDownBg = (e) => {
    if (e.button !== 0) return
    box.current.focus({ preventScroll: true })
    const [x, z] = toPt(e)
    if (tool === 'select' || tool === 'shape') {
      setSel(null)
      return startPan(e)
    }
    if (tool === 'station') {
      addStation(x, z)
      setTool('select')
    } else if (tool === 'wall') {
      const { p } = smartPoint([x, z], { points: magnetPoints(), segs: magnetSegs(), grid, tol })
      setDraft({ type: 'wall', x1: p[0], z1: p[1], x2: p[0], z2: p[1] })
      svg.current.setPointerCapture?.(e.pointerId)
    } else if (tool === 'zone') {
      setDraft({ type: 'zone', x1: g(x), z1: g(z), x2: g(x), z2: g(z) })
      svg.current.setPointerCapture?.(e.pointerId)
    } else if (tool === 'gate') {
      const p = projectToOutline(outline, [x, z])
      if (p.dist > 3) return
      const used = new Set(plant.gates.map((q) => q.id))
      const id = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((c) => !used.has(c)) || uid('G')
      commit({ ...plant, gates: [...plant.gates, { id, x: round2(p.x), z: round2(p.z), label: `Portón ${id}` }] })
      setSel({ type: 'gate', id })
      setTool('select')
    } else if (tool === 'route') setRouteFrom(null)
  }

  const onMove = (e) => {
    const [x, z] = toPt(e)
    lastPt.current = x >= 0 && z >= 0 && x <= W && z <= D ? [x, z] : null
    const d = drag.current
    if (d?.type === 'pan') {
      const dx = (e.clientX - d.cx) * d.k
      const dz = (e.clientY - d.cy) * d.k
      if (Math.abs(dx) + Math.abs(dz) > 0.01) setCam({ ...d.view, x: d.view.x - dx, z: d.view.z - dz })
      return
    }
    if (tool === 'outline') {
      const sp = penPoint([x, z], e.altKey)
      setCursorPt(sp.p)
      setGuides(sp.guides)
      return
    }
    setCursorPt([x, z])
    if (draft) {
      if (draft.type === 'wall') {
        const sp = smartPoint([x, z], { points: magnetPoints(), segs: magnetSegs(), from: [draft.x1, draft.z1], free: e.altKey, grid, tol })
        setGuides(sp.guides)
        setDraft({ ...draft, x2: sp.p[0], z2: sp.p[1] })
      } else setDraft({ ...draft, x2: Math.min(W, Math.max(0, g(x))), z2: Math.min(D, Math.max(0, g(z))) })
      return
    }
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
      const nx = round2(Math.min(W - zn.w / 2, Math.max(zn.w / 2, g(x - d.dx))))
      const nz = round2(Math.min(D - zn.d / 2, Math.max(zn.d / 2, g(z - d.dz))))
      if (nx !== zn.x || nz !== zn.z) {
        markMoved(d)
        onChange({ ...plant, zones: plant.zones.map((q) => (q.id === d.id ? { ...q, x: nx, z: nz } : q)) }, positions)
      }
    } else if (d.type === 'zoneCorner') {
      const cx = Math.min(W, Math.max(0, g(x)))
      const cz = Math.min(D, Math.max(0, g(z)))
      const w = Math.max(1, Math.abs(cx - d.fx))
      const dd = Math.max(1, Math.abs(cz - d.fz))
      const zx = round2(d.fx + (cx >= d.fx ? w / 2 : -w / 2))
      const zz = round2(d.fz + (cz >= d.fz ? dd / 2 : -dd / 2))
      const zn = plant.zones.find((q) => q.id === d.id)
      if (zn.x === zx && zn.z === zz && zn.w === round2(w) && zn.d === round2(dd)) return
      markMoved(d)
      onChange({ ...plant, zones: plant.zones.map((q) => (q.id === d.id ? { ...q, x: zx, z: zz, w: round2(w), d: round2(dd) } : q)) }, positions)
    } else if (d.type === 'wall') {
      const dx = g(x - d.x0)
      const dz = g(z - d.z0)
      const w = d.w0
      if (!dx && !dz) return
      markMoved(d)
      onChange({ ...plant, walls: plant.walls.map((q) => (q.id === d.id ? { ...q, x1: round2(w.x1 + dx), z1: round2(w.z1 + dz), x2: round2(w.x2 + dx), z2: round2(w.z2 + dz) } : q)) }, positions)
    } else if (d.type === 'wallEnd') {
      const w = plant.walls.find((q) => q.id === d.id)
      const other = d.end === 1 ? [w.x2, w.z2] : [w.x1, w.z1]
      const sp = smartPoint([x, z], { points: magnetPoints(d.id), segs: magnetSegs(d.id), from: other, free: e.altKey, grid, tol })
      setGuides(sp.guides)
      const [nx, nz] = sp.p
      const cur = d.end === 1 ? [w.x1, w.z1] : [w.x2, w.z2]
      if (nx === cur[0] && nz === cur[1]) return
      markMoved(d)
      onChange({ ...plant, walls: plant.walls.map((q) => (q.id === d.id ? { ...q, ...(d.end === 1 ? { x1: nx, z1: nz } : { x2: nx, z2: nz }) } : q)) }, positions)
    } else if (d.type === 'gate') {
      // El portón se desliza por todo el contorno, de un muro exterior a otro.
      const p = projectToOutline(outline, [x, z])
      const g0 = plant.gates.find((q) => q.id === d.id)
      const nx = round2(p.x)
      const nz = round2(p.z)
      if (nx === g0?.x && nz === (g0?.z ?? D)) return
      markMoved(d)
      onChange({ ...plant, gates: plant.gates.map((q) => (q.id === d.id ? { ...q, x: nx, z: nz } : q)) }, positions)
    } else if (d.type === 'vertex') {
      const others = d.outline.filter((_, k) => k !== d.i)
      const sp = smartPoint([x, z], { points: [...others, ...plant.walls.flatMap(wallSeg)], grid, tol })
      setGuides(sp.guides)
      const [nx, nz] = sp.p
      const cur = d.outline[d.i]
      if (nx === cur[0] && nz === cur[1]) return
      markMoved(d)
      d.outline = d.outline.map((q, k) => (k === d.i ? [nx, nz] : q))
      onChange({ ...plant, outline: d.outline }, positions)
    } else if (d.type === 'edge') {
      // Empuja el lado completo sobre su normal: expande o encoge la planta desde ese lado.
      const e = edgesOf(d.base)[d.i]
      const delta = g((x - d.x0) * e.n[0] + (z - d.z0) * e.n[1])
      if (!delta && !d.moved) return
      markMoved(d)
      const j = (d.i + 1) % d.base.length
      d.outline = d.base.map((q, k) => (k === d.i || k === j ? [round2(q[0] + e.n[0] * delta), round2(q[1] + e.n[1] * delta)] : q))
      onChange({ ...plant, outline: d.outline }, positions)
    }
  }

  const onUp = () => {
    if (draft) {
      const { type, x1, z1, x2, z2 } = draft
      if (type === 'wall' && Math.hypot(x2 - x1, z2 - z1) >= 0.3) {
        const id = uid('w')
        commit({ ...plant, walls: [...plant.walls, { id, x1, z1, x2, z2 }] })
        setSel({ type: 'wall', id })
      } else if (type === 'zone' && Math.abs(x2 - x1) >= 1 && Math.abs(z2 - z1) >= 1) {
        const zk = catalog?.zones.find((q) => q.id === zoneKind)
        const id = uid('z')
        const n = plant.zones.filter((q) => q.kind === zoneKind).length
        commit({
          ...plant,
          zones: [...plant.zones, { id, name: n ? `${zk?.name} ${n + 1}` : zk?.name || 'Zona', kind: zoneKind, x: round2((x1 + x2) / 2), z: round2((z1 + z2) / 2), w: round2(Math.abs(x2 - x1)), d: round2(Math.abs(z2 - z1)) }],
        })
        setSel({ type: 'zone', id })
      }
      setDraft(null)
      setGuides([])
      setTool('select')
    }
    const d = drag.current
    if (d?.type === 'vertex' || d?.type === 'edge') {
      if (d.moved) {
        const fit = fitToOutline(plant, positions, d.outline)
        onChange(fit.plant, fit.positions)
      } else if (d.type === 'edge') setSel({ type: 'edge', i: d.i })
      frozenVB.current = null
    }
    if (d?.type === 'wallEnd' || d?.type === 'vertex') setGuides([])
    drag.current = null
  }

  const onDownVertex = (e, i) => {
    if (e.button !== 0) return
    e.stopPropagation()
    box.current.focus({ preventScroll: true })
    setSel({ type: 'vertex', i })
    frozenVB.current = viewBox
    startDrag(e, { type: 'vertex', i, outline: outline.map((q) => [...q]) })
  }
  const onDownEdge = (e, i) => {
    if (e.button !== 0) return
    e.stopPropagation()
    box.current.focus({ preventScroll: true })
    const [x, z] = toPt(e)
    frozenVB.current = viewBox
    startDrag(e, { type: 'edge', i, x0: x, z0: z, base: outline.map((q) => [...q]), outline: null })
  }
  // Doble clic sobre un lado: esquina nueva justo donde se hizo clic.
  const onDblEdge = (e, i) => {
    e.stopPropagation()
    const ed = edgesOf(outline)[i]
    const q = nearestOnSeg(toPt(e), ed.a, ed.b)
    const t = Math.min(0.98, Math.max(0.02, round2(snap(q.t * ed.len, grid)) / ed.len))
    ops.splitEdge(i, t)
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
      const zn = { ...item, id, name: `${item.name} (copia)`, x: Math.min(W - item.w / 2, Math.max(item.w / 2, g(x))), z: Math.min(D - item.d / 2, Math.max(item.d / 2, g(z))) }
      commit({ ...plant, zones: [...plant.zones, zn] })
      setSel({ type: 'zone', id })
    } else if (type === 'wall') {
      const id = uid('w')
      const mx = (item.x1 + item.x2) / 2
      const mz = (item.z1 + item.z2) / 2
      const [dx, dz] = at ? [g(at[0] - mx), g(at[1] - mz)] : [off, off]
      commit({ ...plant, walls: [...plant.walls, { id, x1: round2(item.x1 + dx), z1: round2(item.z1 + dz), x2: round2(item.x2 + dx), z2: round2(item.z2 + dz) }] })
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
  const shapeOn = full && tool === 'shape'
  const penOn = full && tool === 'outline'
  const activeTip = tools.find((t) => t.id === tool)?.tip
  const outside = useMemo(() => plant.stations.filter((s) => positions[s.id] && !pointInPoly(outline, positions[s.id])).length, [plant.stations, positions, outline])

  const penLast = pen?.pts[pen.pts.length - 1]
  const penLen = penLast && cursor ? Math.hypot(cursor[0] - penLast[0], cursor[1] - penLast[1]) : 0
  let tip = activeTip
  if (tool === 'route' && routeFrom) tip = `Desde «${st[routeFrom]?.name}»: clic en la máquina de destino.`
  else if (penOn && pen?.typed) tip = `Largo: ${pen.typed} m. Enter para colocar el punto en la dirección del puntero.`
  else if (penOn && pen?.pts.length) tip = `${pen.pts.length} ${pen.pts.length === 1 ? 'esquina' : 'esquinas'}. Clic para la siguiente, o escribe el largo y Enter. ${pen.pts.length >= 3 ? 'Enter o clic en el primer punto cierra el contorno.' : ''}`

  const label = (x, z, text, size = 0.8) => (
    <text x={x} y={z} textAnchor="middle" fontSize={size * u} fontWeight="700" fill="#000" stroke="#fff" strokeWidth={0.25 * u} paintOrder="stroke" pointerEvents="none">
      {text}
    </text>
  )

  // Medida de un tramo, corrida hacia un costado para que no tape la línea.
  const segLabel = (a, b, text, size) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const k = u * 1.1
    return label((a[0] + b[0]) / 2 + (-(b[1] - a[1]) / L) * k, (a[1] + b[1]) / 2 + ((b[0] - a[0]) / L) * k + u * 0.3, text, size)
  }

  return (
    <div className="editor" ref={box} tabIndex={0} aria-label={title || 'Editor del plano'}>
      <div className="editor-bar">
        <div className="seg" role="group" aria-label="Herramientas">
          {tools.map((t) => (
            <button key={t.id} type="button" aria-pressed={tool === t.id} title={`${t.tip} (${t.key})`} onClick={() => pickTool(t.id)}>
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
        {full && (
          <label className="editor-grid small" title="Cada cuánto se ajustan las medidas al dibujar y mover. Con Alt se dibuja sin ajuste de ángulo.">
            Precisión
            <select className="editor-select" value={grid} onChange={(e) => setGrid(Number(e.target.value))}>
              {GRIDS.map((q) => (
                <option key={q.v} value={q.v}>
                  {q.label}
                </option>
              ))}
            </select>
          </label>
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
          <button type="button" className="icon-btn icon-btn--flat" onClick={() => zoomAt(1 / 1.3)} title="Acercar (rueda del mouse)" aria-label="Acercar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3 V13 M3 8 H13" />
            </svg>
          </button>
          <button type="button" className="icon-btn icon-btn--flat" onClick={() => zoomAt(1.3)} title="Alejar (rueda del mouse)" aria-label="Alejar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 8 H13" />
            </svg>
          </button>
          <button type="button" className="icon-btn icon-btn--flat" onClick={() => setCam(null)} disabled={!cam} title="Ver toda la planta" aria-label="Ver toda la planta">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 6 V2 H6 M10 2 H14 V6 M14 10 V14 H10 M6 14 H2 V10" />
            </svg>
          </button>
        </div>
        {actions && <div className="editor-actions">{actions}</div>}
        <span className="editor-stat num">{live.loading ? 'Calculando…' : `Una pieza recorre ${fmt(live.piece_m, 1)} m`}</span>
      </div>

      <div className="editor-body">
        <div className="editor-canvas" data-tool={tool}>
          <svg
            ref={svg}
            viewBox={viewBox}
            onPointerDownCapture={onDownCapture}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => {
              setCursorPt(null)
              lastPt.current = null
            }}
            onAuxClick={(e) => e.preventDefault()}
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

            <rect x={vx - vw} y={vz - vh} width={vw * 3} height={vh * 3} fill="transparent" onPointerDown={onDownBg} />
            {/* Al dibujar un contorno nuevo, el anterior queda tenue como referencia. */}
            <path d={polyD(outline)} fill="url(#grid)" stroke={penOn && pen ? '#c2c2c2' : '#000'} strokeWidth={0.3} onPointerDown={onDownBg} />

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
                  <line x1={w.x1} y1={w.z1} x2={w.x2} y2={w.z2} stroke="transparent" strokeWidth={Math.max(1.4, u * 1.2)} />
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

            {plant.gates.map((gt) => {
              const on = sel?.type === 'gate' && sel.id === gt.id
              const role = gt.id === recv && gt.id === disp ? 'entra y sale' : gt.id === recv ? 'entra' : gt.id === disp ? 'sale' : ''
              const gi = gateInfo(plant, gt)
              const lift = 1.7 + Math.abs(gi.n[0]) * 2.2
              return (
                <g key={gt.id} onPointerDown={(e) => onDownGate(e, gt)} style={{ cursor: full && tool === 'select' ? 'move' : undefined }}>
                  <rect x={-GATE_HALF} y={-0.35} width={GATE_HALF * 2} height={1} transform={`translate(${gi.x} ${gi.z}) rotate(${gi.deg})`} fill={role ? '#000' : '#fff'} stroke="#000" strokeWidth={on ? 0.3 : 0.15} />
                  <text x={gi.x + gi.n[0] * lift} y={gi.z + gi.n[1] * lift + 0.3} textAnchor="middle" fontSize="0.9" fontWeight={role ? 800 : 500} fill="#000" pointerEvents="none">
                    {gt.id} {role}
                  </text>
                </g>
              )
            })}

            {/* Manijas de la zona seleccionada: arrastra una esquina para cambiar su tamaño. */}
            {full &&
              tool === 'select' &&
              sel?.type === 'zone' &&
              (() => {
                const zn = plant.zones.find((q) => q.id === sel.id)
                if (!zn) return null
                return [
                  [-1, -1],
                  [1, -1],
                  [1, 1],
                  [-1, 1],
                ].map(([cx, cz]) => (
                  <rect key={`${cx}${cz}`} x={zn.x + (cx * zn.w) / 2 - u * 0.45} y={zn.z + (cz * zn.d) / 2 - u * 0.45} width={u * 0.9} height={u * 0.9} fill="#fff" stroke="#000" strokeWidth={u * 0.15} style={{ cursor: cx === cz ? 'nwse-resize' : 'nesw-resize' }} onPointerDown={(e) => onDownZoneCorner(e, zn, cx, cz)} />
                ))
              })()}

            {/* Pared seleccionada: extremos que se arrastran por separado y su largo. */}
            {full &&
              tool === 'select' &&
              sel?.type === 'wall' &&
              (() => {
                const w = plant.walls.find((q) => q.id === sel.id)
                if (!w) return null
                const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1)
                return (
                  <g>
                    {segLabel([w.x1, w.z1], [w.x2, w.z2], `${fmt(len, 2)} m`)}
                    {[1, 2].map((end) => (
                      <circle key={end} cx={end === 1 ? w.x1 : w.x2} cy={end === 1 ? w.z1 : w.z2} r={u * 0.55} fill="#fff" stroke="#000" strokeWidth={u * 0.15} style={{ cursor: 'move' }} onPointerDown={(e) => onDownWallEnd(e, w, end)} />
                    ))}
                  </g>
                )
              })()}

            {shapeOn &&
              edgesOf(outline).map((e) => {
                const mx = (e.a[0] + e.b[0]) / 2
                const mz = (e.a[1] + e.b[1]) / 2
                const on = sel?.type === 'edge' && sel.i === e.i
                return (
                  <g key={`e${e.i}`}>
                    <line x1={e.a[0]} y1={e.a[1]} x2={e.b[0]} y2={e.b[1]} stroke={on ? '#000' : 'transparent'} strokeWidth={on ? 0.6 : u * 1.2} strokeOpacity={on ? 0.35 : 1} style={{ cursor: 'pointer' }} onPointerDown={(ev) => onDownEdge(ev, e.i)} onDoubleClick={(ev) => onDblEdge(ev, e.i)}>
                      <title>Clic para editar este lado. Arrastra para moverlo. Doble clic agrega una esquina.</title>
                    </line>
                    <circle cx={mx} cy={mz} r={u * 0.5} fill={on ? '#000' : '#fff'} stroke="#000" strokeWidth={u * 0.14} style={{ cursor: 'grab' }} onPointerDown={(ev) => onDownEdge(ev, e.i)} />
                    <text x={mx + e.n[0] * u * 1.7} y={mz + e.n[1] * u * 1.7 + u * 0.3} textAnchor="middle" fontSize={u * 0.75} fontWeight={on ? 800 : 500} fill={on ? '#000' : '#767676'} pointerEvents="none">
                      {fmt(e.len, 2)} m
                    </text>
                  </g>
                )
              })}
            {shapeOn &&
              outline.map((q, i) => {
                const on = sel?.type === 'vertex' && sel.i === i
                return <rect key={`v${i}`} x={q[0] - u * 0.55} y={q[1] - u * 0.55} width={u * 1.1} height={u * 1.1} fill={on ? '#000' : '#fff'} stroke="#000" strokeWidth={u * 0.18} style={{ cursor: 'move' }} onPointerDown={(ev) => onDownVertex(ev, i)} onDoubleClick={() => removeVertex(i)} />
              })}

            {/* Contorno en dibujo: tramos ya puestos, el que sigue al puntero y sus medidas. */}
            {penOn && (
              <g pointerEvents="none">
                {pen?.pts.length > 1 && <path d={'M' + pen.pts.map((p) => p.join(' ')).join(' L')} fill="none" stroke="#000" strokeWidth={0.35} />}
                {pen?.pts.slice(1).map((p, i) => {
                  const a = pen.pts[i]
                  return <g key={`pl${i}`}>{segLabel(a, p, `${fmt(Math.hypot(p[0] - a[0], p[1] - a[1]), 2)} m`, 0.7)}</g>
                })}
                {penLast && cursor && (
                  <>
                    <line x1={penLast[0]} y1={penLast[1]} x2={cursor[0]} y2={cursor[1]} stroke="#000" strokeWidth={0.25} strokeDasharray={`${u * 0.5} ${u * 0.3}`} />
                    {segLabel(penLast, cursor, `${fmt(penLen, 2)} m`)}
                  </>
                )}
                {pen?.pts.length >= 3 && cursor && <line x1={cursor[0]} y1={cursor[1]} x2={pen.pts[0][0]} y2={pen.pts[0][1]} stroke="#767676" strokeWidth={0.12} strokeDasharray={`${u * 0.3} ${u * 0.3}`} />}
                {pen?.pts.map((p, i) => (
                  <rect key={`pp${i}`} x={p[0] - u * 0.4} y={p[1] - u * 0.4} width={u * 0.8} height={u * 0.8} fill={i === 0 ? '#000' : '#fff'} stroke="#000" strokeWidth={u * 0.15} />
                ))}
                {pen?.pts.length >= 3 && <circle cx={pen.pts[0][0]} cy={pen.pts[0][1]} r={tol} fill="none" stroke="#000" strokeWidth={u * 0.08} strokeDasharray={`${u * 0.2} ${u * 0.2}`} />}
                {cursor && <circle cx={cursor[0]} cy={cursor[1]} r={u * 0.3} fill="#000" />}
              </g>
            )}

            {guides.map((gd, i) =>
              gd.axis === 'x' ? (
                <line key={`g${i}`} x1={gd.v} y1={vz} x2={gd.v} y2={vz + vh} stroke="#000" strokeWidth={u * 0.06} strokeDasharray={`${u * 0.4} ${u * 0.3}`} pointerEvents="none" />
              ) : (
                <line key={`g${i}`} x1={vx} y1={gd.v} x2={vx + vw} y2={gd.v} stroke="#000" strokeWidth={u * 0.06} strokeDasharray={`${u * 0.4} ${u * 0.3}`} pointerEvents="none" />
              ),
            )}

            {routeFrom && cursor && positions[routeFrom] && (
              <line x1={positions[routeFrom][0]} y1={positions[routeFrom][1]} x2={cursor[0]} y2={cursor[1]} stroke="#000" strokeWidth={0.15} strokeDasharray="0.4 0.3" pointerEvents="none" />
            )}
            {draft?.type === 'wall' && (
              <g pointerEvents="none">
                <line x1={draft.x1} y1={draft.z1} x2={draft.x2} y2={draft.z2} stroke="#000" strokeWidth={0.3} strokeOpacity={0.6} />
                {segLabel([draft.x1, draft.z1], [draft.x2, draft.z2], `${fmt(Math.hypot(draft.x2 - draft.x1, draft.z2 - draft.z1), 2)} m`)}
              </g>
            )}
            {draft?.type === 'zone' && (
              <g pointerEvents="none">
                <rect x={Math.min(draft.x1, draft.x2)} y={Math.min(draft.z1, draft.z2)} width={Math.abs(draft.x2 - draft.x1)} height={Math.abs(draft.z2 - draft.z1)} fill="#000" fillOpacity={0.12} stroke="#000" strokeWidth={0.15} strokeDasharray="0.4 0.3" />
                {label((draft.x1 + draft.x2) / 2, Math.min(draft.z1, draft.z2) - u * 0.5, `${fmt(Math.abs(draft.x2 - draft.x1), 2)} × ${fmt(Math.abs(draft.z2 - draft.z1), 2)} m`)}
              </g>
            )}

            {/* Encima de todo: con la herramienta Contorno cada clic pone una esquina, aunque caiga sobre una máquina. */}
            {penOn && <rect x={vx - vw} y={vz - vh} width={vw * 3} height={vh * 3} fill="transparent" style={{ cursor: 'crosshair' }} onPointerDown={onDownPen} onDoubleClick={() => closePen()} />}
          </svg>
          <p className="editor-tip small">
            {tip}
            {cursor && full && (
              <span className="editor-coords num">
                {' '}
                x {fmt(cursor[0], 2)} · z {fmt(cursor[1], 2)} m
              </span>
            )}
          </p>
        </div>

        <Inspector plant={plant} positions={positions} sel={sel} setSel={setSel} commit={commit} rotate={rotate} remove={remove} catalog={catalog} full={full} live={live} duplicate={duplicate} reshape={reshape} removeVertex={removeVertex} ops={ops} outside={outside} />
      </div>
    </div>
  )
}
