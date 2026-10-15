import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, fmt } from '../api'
import { arrowPoints, bboxOf, centerOf, composeParts, dims, fitToOutline, fromPartLocal, gateInfo, GATE_HALF, midOf, movePart, nearestOnSeg, outlineOf, PART_KINDS, partPoly, partsOf, pathD, pointInPoly, polyD, projectToOutline, rectOf, rotatePart, round2, shortName, sizePart, smartPoint, snap, straight, toPartLocal, uid } from './geometry'
import Inspector from './Inspector'

const TOOLS_FULL = [
  { id: 'select', label: 'Mover', key: 'V', tip: 'Selecciona y arrastra máquinas, zonas, paredes y portones. Arrastra el fondo para mover la vista; la rueda acerca y aleja. Las flechas mueven lo seleccionado (Shift: 10 veces más).' },
  { id: 'station', label: 'Máquina', key: 'M', tip: 'Clic en el plano para agregar una máquina del tipo elegido.' },
  { id: 'route', label: 'Ruta', key: 'T', tip: 'Clic en la máquina de origen y luego en la de destino. Sigue encadenando; Esc para terminar.' },
  { id: 'wall', label: 'Pared', key: 'P', tip: 'Arrastra para dibujar una pared interior. Se pega a esquinas y muros cercanos y se ajusta a 45°; con Alt queda libre.' },
  { id: 'zone', label: 'Zona', key: 'Z', tip: 'Arrastra un rectángulo: oficina, baños, comedor o zona bloqueada. Por ahí no pasa el material.' },
  { id: 'gate', label: 'Portón', key: 'O', tip: 'Clic sobre cualquier muro exterior para agregar un portón. La calle se agrega de ese lado.' },
  { id: 'shape', label: 'Forma', key: 'F', tip: 'El edificio se arma con piezas: agrega formas sólidas o huecos desde el panel derecho. Arrastra una pieza para moverla, sus manijas cambian el tamaño y el círculo de arriba la gira. Cada pieza se edita sola.' },
]

const GRIDS = [
  { v: 1, label: '1 m' },
  { v: 0.5, label: '50 cm' },
  { v: 0.25, label: '25 cm' },
  { v: 0.1, label: '10 cm' },
]

/* Manijas de tamaño de una pieza: cuatro esquinas y cuatro lados (como en TinkerCAD). */
const HANDLES = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
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

/* Caja de una pieza en su propio marco: las dibujadas a mano usan su caja sin giro. */
const boxOf = (p) => {
  if (p.kind !== 'poly') return p
  const b = bboxOf(p.pts)
  return { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: b.x1 - b.x0, d: b.z1 - b.z0, rot: 0 }
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
  const [pen, setPen] = useState(null)
  const [arm, setArm] = useState(null)
  const [addHole, setAddHole] = useState(false)
  const [notice, setNotice] = useState(null)
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
  const { parts: rawParts, outline: rawOutline, size } = plant
  const parts = useMemo(() => partsOf({ parts: rawParts, outline: rawOutline, size }), [rawParts, rawOutline, size])
  const comp = useMemo(() => composeParts(parts), [parts])
  const st = useMemo(() => Object.fromEntries(plant.stations.map((s) => [s.id, s])), [plant.stations])
  const kindName = useMemo(() => Object.fromEntries((catalog?.kinds || []).map((k) => [k.id, k.name])), [catalog])
  const g = (v) => round2(snap(v, grid))

  useEffect(() => {
    onMetrics?.(live)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 3500)
    return () => clearTimeout(t)
  }, [notice])

  /* ---------- Vista: encuadre, acercar y mover ---------- */
  const bb = bboxOf([...outline, [0, 0], [W, D]])
  const M = tool === 'shape' ? Math.max(6, Math.max(W, D) * 0.25) : plant.gates.some((q) => q.x <= 0.5 || q.x >= W - 0.5) ? 7 : 4
  const fitVB = `${bb.x0 - M} ${bb.z0 - M} ${bb.x1 - bb.x0 + 2 * M} ${bb.z1 - bb.z0 + 2 * M}`
  // Mientras se arrastra una pieza la vista queda fija, para que no se escape del puntero.
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
  const magnetSegs = (skipWall) => [...outline.map((a, i) => [a, outline[(i + 1) % outline.length]]), ...plant.walls.filter((w) => w.id !== skipWall).map(wallSeg)]
  const partPoints = (skipId) => parts.filter((p) => p.id !== skipId).flatMap(partPoly)

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

  /* Aplica un nuevo juego de piezas: el contorno es su suma. Con fit, todo se corre para que
     la planta empiece en el origen; durante un arrastre se deja para el final. */
  const setParts = (next, { fit = true, record = true } = {}) => {
    const c = composeParts(next)
    if (!c) {
      setNotice('Debe quedar al menos una pieza sólida.')
      return false
    }
    const np = { ...plant, parts: next, outline: c.outline }
    if (!fit) {
      onChange(np, positions)
      return true
    }
    const f = fitToOutline(np, positions, c.outline)
    if (record) commit(f.plant, f.positions)
    else onChange(f.plant, f.positions)
    return true
  }

  const replacePart = (id, fn, opts) => setParts(parts.map((p) => (p.id === id ? fn(p) : p)), opts)

  /* Operaciones exactas sobre piezas, paredes y máquinas (las usa el inspector). */
  const ops = {
    addPart: (kind, x, z, hole) => {
      const k = PART_KINDS.find((q) => q.id === kind)
      const part = { id: uid('f'), kind, x: g(x), z: g(z), w: k.w, d: k.d, rot: 0, hole: !!hole }
      if (setParts([...parts, part])) setSel({ type: 'part', id: part.id })
    },
    setPart: (id, patch) => replacePart(id, (p) => ({ ...p, ...patch })),
    sizePart: (id, w, d) => replacePart(id, (p) => sizePart(p, w, d)),
    rotatePart: (id, deg) => replacePart(id, (p) => rotatePart(p, deg)),
    centerPart: (id, x, z) =>
      replacePart(id, (p) => {
        const [cx, cz] = p.kind === 'poly' ? centerOf(p.pts) : [p.x, p.z]
        return movePart(p, x - cx, z - cz)
      }),
    toggleHole: (id) => replacePart(id, (p) => ({ ...p, hole: !p.hole })),
    removePart: (id) => {
      if (setParts(parts.filter((p) => p.id !== id))) setSel(null)
    },
    duplicatePart: (id) => {
      const p = parts.find((q) => q.id === id)
      const copy = { ...movePart(p, Math.max(1, grid * 4), Math.max(1, grid * 4)), id: uid('f') }
      if (setParts([...parts, copy])) setSel({ type: 'part', id: copy.id })
    },
    movePVertex: (id, i, x, z) => replacePart(id, (p) => ({ ...p, pts: p.pts.map((q, k) => (k === i ? [round2(x), round2(z)] : q)) })),
    removePVertex: (id, i) => {
      const p = parts.find((q) => q.id === id)
      if (!p || p.pts.length <= 3) return
      replacePart(id, (q) => ({ ...q, pts: q.pts.filter((_, k) => k !== i) }))
      setSel({ type: 'part', id })
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

  const remove = () => {
    if (!sel || !full) return
    const { type, id } = sel
    if (type === 'station') {
      const pos = { ...positions }
      delete pos[id]
      commit({ ...plant, stations: plant.stations.filter((s) => s.id !== id), routes: plant.routes.filter((r) => r.from !== id && r.to !== id) }, pos)
    } else if (type === 'route') commit({ ...plant, routes: plant.routes.filter((r) => r.id !== id) })
    else if (type === 'zone') commit({ ...plant, zones: plant.zones.filter((z) => z.id !== id) })
    else if (type === 'wall') commit({ ...plant, walls: plant.walls.filter((w) => w.id !== id) })
    else if (type === 'part') return ops.removePart(id)
    else if (type === 'pvertex') return ops.removePVertex(id, sel.i)
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
  }

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
    } else if (sel.type === 'part') replacePart(sel.id, (p) => movePart(p, dx, dz))
    else if (sel.type === 'pvertex') {
      const q = parts.find((p) => p.id === sel.id)?.pts[sel.i]
      if (q) ops.movePVertex(sel.id, sel.i, q[0] + dx, q[1] + dz)
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

  /* ---------- Pieza dibujada a mano, esquina por esquina ---------- */
  const startPen = (hole) => {
    setArm(null)
    setSel(null)
    setPen({ pts: [], typed: '', hole: !!hole })
  }

  const penPoint = (raw, free) => {
    const pts = pen?.pts || []
    const from = pts[pts.length - 1] || null
    return smartPoint(raw, { points: [...pts, ...outline, ...partPoints(), ...plant.walls.flatMap(wallSeg)], segs: [], from, free, grid, tol })
  }

  // Al cerrarla se suma (o se resta, si es hueco) a lo que ya hay: no reemplaza el edificio.
  const closePen = (pts = pen?.pts) => {
    if (!pts || pts.length < 3) return
    const part = { id: uid('f'), kind: 'poly', pts, hole: !!pen?.hole }
    setPen(null)
    setGuides([])
    if (setParts([...parts, part])) setSel({ type: 'part', id: part.id })
  }

  const penAdd = (p) => {
    const pts = pen?.pts || []
    const first = pts[0]
    if (pts.length >= 3 && Math.hypot(p[0] - first[0], p[1] - first[1]) <= tol) return closePen(pts)
    const last = pts[pts.length - 1]
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.05) return
    // La vista queda fija mientras se dibuja, para que los clics no se corran.
    if (!pts.length && !cam) setCam(viewRef.current)
    setPen({ ...pen, pts: [...pts, p], typed: '' })
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

  // Sólido o hueco: vale para lo próximo que se agregue y para lo que se está colocando o dibujando.
  const setHole = (h) => {
    setAddHole(h)
    if (arm) setArm({ ...arm, hole: h })
    if (pen) setPen({ ...pen, hole: h })
  }

  const cancelShape = () => {
    setPen(null)
    setArm(null)
    setGuides([])
  }

  /* ---------- Teclado ---------- */
  useEffect(() => {
    const el = box.current
    const onKey = (e) => {
      if (e.target.closest('input, textarea, select')) return
      const k = e.key.toLowerCase()
      if (pen && !e.ctrlKey && !e.metaKey) {
        if (/^[0-9]$/.test(k) || k === ',' || k === '.') {
          e.preventDefault()
          setPen({ ...pen, typed: (pen.typed || '') + k })
          return
        }
        if (k === 'backspace') {
          e.preventDefault()
          if (pen.typed) setPen({ ...pen, typed: pen.typed.slice(0, -1) })
          else if (pen.pts.length > 0) setPen({ ...pen, pts: pen.pts.slice(0, -1) })
          return
        }
        if (k === 'enter') {
          e.preventDefault()
          if (!penTyped()) closePen()
          return
        }
        if (k === 'escape') {
          e.preventDefault()
          cancelShape()
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
      else if (k === 'r' && sel?.type === 'part') ops.rotatePart(sel.id, 90)
      else if (k === 'escape') {
        setRouteFrom(null)
        setDraft(null)
        cancelShape()
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
    cancelShape()
    if (id === 'shape' || tool === 'shape') setSel(null)
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

  // Piezas del edificio (herramienta Forma).
  const placeArm = (e) => {
    const [x, z] = toPt(e)
    ops.addPart(arm.kind, x, z, arm.hole)
    setArm(null)
  }
  const onDownPart = (e, part) => {
    if (e.button !== 0) return
    e.stopPropagation()
    box.current.focus({ preventScroll: true })
    if (arm) return placeArm(e)
    setSel({ type: 'part', id: part.id })
    const [x, z] = toPt(e)
    frozenVB.current = viewBox
    startDrag(e, { type: 'part', id: part.id, x0: x, z0: z, base: part })
  }
  const onDownPartHandle = (e, part, hx, hz) => {
    e.stopPropagation()
    frozenVB.current = viewBox
    startDrag(e, { type: 'partSize', id: part.id, base: part, hx, hz })
  }
  const onDownPartRotate = (e, part) => {
    e.stopPropagation()
    const b = boxOf(part)
    const [x, z] = toPt(e)
    frozenVB.current = viewBox
    startDrag(e, { type: 'partRot', id: part.id, base: part, cx: b.x, cz: b.z, a0: Math.atan2(z - b.z, x - b.x) })
  }
  const onDownPVertex = (e, part, i) => {
    e.stopPropagation()
    setSel({ type: 'pvertex', id: part.id, i })
    frozenVB.current = viewBox
    startDrag(e, { type: 'pvertex', id: part.id, i, base: part })
  }
  // Doble clic sobre un lado de una pieza dibujada a mano: esquina nueva justo ahí.
  const onDblPEdge = (e, part, i) => {
    e.stopPropagation()
    const a = part.pts[i]
    const b = part.pts[(i + 1) % part.pts.length]
    const q = nearestOnSeg(toPt(e), a, b)
    const p = [g(q.x), g(q.z)]
    replacePart(part.id, (pp) => ({ ...pp, pts: [...pp.pts.slice(0, i + 1), p, ...pp.pts.slice(i + 1)] }))
    setSel({ type: 'pvertex', id: part.id, i: i + 1 })
  }

  const onDownBg = (e) => {
    if (e.button !== 0) return
    box.current.focus({ preventScroll: true })
    const [x, z] = toPt(e)
    if (tool === 'shape' && arm) return placeArm(e)
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
    if (pen) {
      const sp = penPoint([x, z], e.altKey)
      setCursorPt(sp.p)
      setGuides(sp.guides)
      return
    }
    setCursorPt(arm ? [g(x), g(z)] : [x, z])
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
    } else if (d.type === 'part') {
      const dx = g(x - d.x0)
      const dz = g(z - d.z0)
      if (!dx && !dz && !d.moved) return
      markMoved(d)
      replacePart(d.id, () => movePart(d.base, dx, dz), { fit: false })
    } else if (d.type === 'partSize') {
      // En el marco de la pieza: el lado o la esquina opuesta quedan fijos.
      const b = boxOf(d.base)
      const [lx, lz] = toPartLocal(b, [x, z])
      let w = b.w
      let dd = b.d
      let cx = 0
      let cz = 0
      if (d.hx) {
        const fixed = (-d.hx * b.w) / 2
        w = Math.max(0.5, g((lx - fixed) * d.hx))
        cx = fixed + (d.hx * w) / 2
      }
      if (d.hz) {
        const fixed = (-d.hz * b.d) / 2
        dd = Math.max(0.5, g((lz - fixed) * d.hz))
        cz = fixed + (d.hz * dd) / 2
      }
      if (d.base.kind === 'cuadrado' && d.hx && d.hz) {
        const s = Math.max(w, dd)
        w = dd = s
        cx = (-d.hx * b.w) / 2 + (d.hx * s) / 2
        cz = (-d.hz * b.d) / 2 + (d.hz * s) / 2
      }
      if (w === b.w && dd === b.d) return
      markMoved(d)
      const [nx, nz] = fromPartLocal(b, [cx, cz])
      const next =
        d.base.kind === 'poly'
          ? { ...d.base, pts: d.base.pts.map(([px, pz]) => [round2(nx + ((px - b.x) * w) / (b.w || 1)), round2(nz + ((pz - b.z) * dd) / (b.d || 1))]) }
          : { ...d.base, x: round2(nx), z: round2(nz), w: round2(w), d: round2(dd) }
      replacePart(d.id, () => next, { fit: false })
    } else if (d.type === 'partRot') {
      let deg = ((Math.atan2(z - d.cz, x - d.cx) - d.a0) * 180) / Math.PI
      // Con Alt el giro es libre; si no, de 15 en 15 grados.
      if (!e.altKey) deg = Math.round(deg / 15) * 15
      if (!deg && !d.moved) return
      markMoved(d)
      replacePart(d.id, () => rotatePart(d.base, deg), { fit: false })
    } else if (d.type === 'pvertex') {
      const others = d.base.pts.filter((_, k) => k !== d.i)
      const sp = smartPoint([x, z], { points: [...others, ...partPoints(d.id), ...plant.walls.flatMap(wallSeg)], grid, tol })
      setGuides(sp.guides)
      const [nx, nz] = sp.p
      const cur = parts.find((p) => p.id === d.id)?.pts[d.i]
      if (cur && nx === cur[0] && nz === cur[1]) return
      markMoved(d)
      replacePart(d.id, (p) => ({ ...p, pts: p.pts.map((q, k) => (k === d.i ? [nx, nz] : q)) }), { fit: false })
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
    if (d && ['part', 'partSize', 'partRot', 'pvertex'].includes(d.type)) {
      // Al soltar, la planta se reacomoda al origen (sin otro paso de deshacer).
      if (d.moved) setParts(plant.parts || parts, { record: false })
      frozenVB.current = null
      setGuides([])
    }
    if (d?.type === 'wallEnd') setGuides([])
    drag.current = null
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
    if (sel?.type === 'part') return ops.duplicatePart(sel.id)
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
  const penOn = shapeOn && !!pen
  const activeTip = tools.find((t) => t.id === tool)?.tip
  const outside = useMemo(() => plant.stations.filter((s) => positions[s.id] && !pointInPoly(outline, positions[s.id])).length, [plant.stations, positions, outline])
  const selPart = sel && (sel.type === 'part' || sel.type === 'pvertex') ? parts.find((p) => p.id === sel.id) : null

  const penLast = pen?.pts[pen.pts.length - 1]
  const penLen = penLast && cursor ? Math.hypot(cursor[0] - penLast[0], cursor[1] - penLast[1]) : 0
  let tip = activeTip
  if (tool === 'route' && routeFrom) tip = `Desde «${st[routeFrom]?.name}»: clic en la máquina de destino.`
  else if (arm) tip = `Clic en el plano para colocar ${arm.hole ? 'el hueco' : 'la pieza'} (${PART_KINDS.find((k) => k.id === arm.kind)?.label.toLowerCase()}). Esc cancela.`
  else if (penOn && pen.typed) tip = `Largo: ${pen.typed} m. Enter para colocar el punto en la dirección del puntero.`
  else if (penOn) tip = pen.pts.length ? `${pen.pts.length} ${pen.pts.length === 1 ? 'esquina' : 'esquinas'}. Clic para la siguiente o escribe el largo y Enter. ${pen.pts.length >= 3 ? 'Enter o clic en el primer punto cierra la pieza.' : ''}` : `Dibuja ${pen.hole ? 'el hueco' : 'la pieza'} esquina por esquina; se ${pen.hole ? 'restará' : 'sumará'} al edificio. Alt quita el ajuste de ángulo; Esc cancela.`

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

  // Manijas de la pieza seleccionada: tamaño (esquinas y lados), giro y, si es dibujada a mano, sus esquinas.
  const partHandles = (p) => {
    const b = boxOf(p)
    const at = (hx, hz) => fromPartLocal(b, [(hx * b.w) / 2, (hz * b.d) / 2])
    const top = at(0, -1)
    const rot = fromPartLocal(b, [0, -b.d / 2 - u * 2.4])
    const [lx, lz] = fromPartLocal(b, [0, b.d / 2 + u * 1.9])
    return (
      <g>
        {p.kind === 'poly' && <path d={polyD([at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)])} fill="none" stroke="#767676" strokeWidth={u * 0.06} strokeDasharray={`${u * 0.3} ${u * 0.3}`} pointerEvents="none" />}
        {label(lx, lz, `${fmt(b.w, 2)} × ${fmt(b.d, 2)} m`, 0.75)}
        <line x1={top[0]} y1={top[1]} x2={rot[0]} y2={rot[1]} stroke="#000" strokeWidth={u * 0.08} pointerEvents="none" />
        <circle cx={rot[0]} cy={rot[1]} r={u * 0.55} fill="#fff" stroke="#000" strokeWidth={u * 0.15} style={{ cursor: 'grab' }} onPointerDown={(e) => onDownPartRotate(e, p)}>
          <title>Arrastra para girar (de 15 en 15°; con Alt, libre)</title>
        </circle>
        {HANDLES.map(([hx, hz]) => {
          const [x, z] = at(hx, hz)
          const s = hx && hz ? u * 1.0 : u * 0.75
          return <rect key={`${hx}${hz}`} x={x - s / 2} y={z - s / 2} width={s} height={s} fill={hx && hz ? '#000' : '#fff'} stroke="#000" strokeWidth={u * 0.14} style={{ cursor: hx && hz ? (hx === hz ? 'nwse-resize' : 'nesw-resize') : hx ? 'ew-resize' : 'ns-resize' }} onPointerDown={(e) => onDownPartHandle(e, p, hx, hz)} />
        })}
        {p.kind === 'poly' &&
          p.pts.map((q, i) => {
            const on = sel?.type === 'pvertex' && sel.i === i
            const nxt = p.pts[(i + 1) % p.pts.length]
            return (
              <g key={`pv${i}`}>
                <line x1={q[0]} y1={q[1]} x2={nxt[0]} y2={nxt[1]} stroke="transparent" strokeWidth={u * 0.9} onDoubleClick={(e) => onDblPEdge(e, p, i)} style={{ cursor: 'copy' }}>
                  <title>Doble clic para agregar una esquina aquí</title>
                </line>
                <circle cx={q[0]} cy={q[1]} r={u * 0.45} fill={on ? '#000' : '#fff'} stroke="#000" strokeWidth={u * 0.14} style={{ cursor: 'move' }} onPointerDown={(e) => onDownPVertex(e, p, i)} onDoubleClick={() => ops.removePVertex(p.id, i)} />
              </g>
            )
          })}
      </g>
    )
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
        <span className="editor-stat num">{live.loading ? 'Calculando…' : `Una pieza recorre ${fmt(live.piece_m, 1)} m`}</span>
      </div>

      <div className="editor-body">
        <div className="editor-canvas" data-tool={tool}>
          {/* Botones dentro del plano, como en la vista 3D. */}
          {actions && <div className="editor-float">{actions}</div>}
          <div className="scene-cam editor-cam" role="group" aria-label="Historial y vista">
            <button type="button" onClick={doUndo} disabled={!undo.current.length} title="Deshacer (Ctrl+Z)" aria-label="Deshacer">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 3 L2 6 L5 9 M2 6 H10 A4 4 0 0 1 10 14 H7" />
              </svg>
            </button>
            <button type="button" onClick={doRedo} disabled={!redo.current.length} title="Rehacer (Ctrl+Y)" aria-label="Rehacer">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 3 L14 6 L11 9 M14 6 H6 A4 4 0 0 0 6 14 H9" />
              </svg>
            </button>
            <button type="button" onClick={() => zoomAt(1 / 1.3)} title="Acercar (rueda del mouse)" aria-label="Acercar">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3 V13 M3 8 H13" />
              </svg>
            </button>
            <button type="button" onClick={() => zoomAt(1.3)} title="Alejar (rueda del mouse)" aria-label="Alejar">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 8 H13" />
              </svg>
            </button>
            <button type="button" onClick={() => setCam(null)} title="Ver toda la planta" aria-label="Ver toda la planta">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="10" height="10" />
                <circle cx="8" cy="8" r="1.5" fill="currentColor" />
              </svg>
            </button>
          </div>
          {notice && <p className="editor-notice small">{notice}</p>}

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

            {/* Piezas del edificio: las sólidas suman, los huecos restan. Cada una se toma y se edita sola. */}
            {shapeOn &&
              [...parts.filter((p) => !p.hole), ...parts.filter((p) => p.hole)].map((p) => {
                const on = selPart?.id === p.id
                return (
                  <path
                    key={p.id}
                    d={polyD(partPoly(p))}
                    fill={p.hole ? 'url(#hatch)' : 'transparent'}
                    fillOpacity={p.hole ? 0.35 : 1}
                    stroke={on ? '#000' : p.hole ? '#767676' : '#3b3b3b'}
                    strokeWidth={on ? u * 0.18 : u * 0.09}
                    strokeDasharray={on ? undefined : `${u * 0.45} ${u * 0.3}`}
                    style={{ cursor: arm ? 'crosshair' : 'move' }}
                    onPointerDown={(e) => onDownPart(e, p)}
                  >
                    <title>{p.hole ? 'Hueco' : 'Pieza'}: arrastra para moverla</title>
                  </path>
                )
              })}
            {shapeOn && selPart && !pen && partHandles(selPart)}

            {/* Vista previa de la pieza que se va a colocar. */}
            {shapeOn && arm && cursor && (
              <path d={polyD(partPoly({ kind: arm.kind, x: cursor[0], z: cursor[1], w: PART_KINDS.find((k) => k.id === arm.kind).w, d: PART_KINDS.find((k) => k.id === arm.kind).d, rot: 0 }))} fill={arm.hole ? 'url(#hatch)' : '#000'} fillOpacity={arm.hole ? 0.4 : 0.08} stroke="#000" strokeWidth={u * 0.1} strokeDasharray={`${u * 0.4} ${u * 0.3}`} pointerEvents="none" />
            )}

            {/* Pieza a mano en dibujo: tramos ya puestos, el que sigue al puntero y sus medidas. */}
            {penOn && (
              <g pointerEvents="none">
                {pen.pts.length > 1 && <path d={'M' + pen.pts.map((p) => p.join(' ')).join(' L')} fill="none" stroke="#000" strokeWidth={0.35} strokeDasharray={pen.hole ? `${u * 0.5} ${u * 0.3}` : undefined} />}
                {pen.pts.slice(1).map((p, i) => {
                  const a = pen.pts[i]
                  return <g key={`pl${i}`}>{segLabel(a, p, `${fmt(Math.hypot(p[0] - a[0], p[1] - a[1]), 2)} m`, 0.7)}</g>
                })}
                {penLast && cursor && (
                  <>
                    <line x1={penLast[0]} y1={penLast[1]} x2={cursor[0]} y2={cursor[1]} stroke="#000" strokeWidth={0.25} strokeDasharray={`${u * 0.5} ${u * 0.3}`} />
                    {segLabel(penLast, cursor, `${fmt(penLen, 2)} m`)}
                  </>
                )}
                {pen.pts.length >= 3 && cursor && <line x1={cursor[0]} y1={cursor[1]} x2={pen.pts[0][0]} y2={pen.pts[0][1]} stroke="#767676" strokeWidth={0.12} strokeDasharray={`${u * 0.3} ${u * 0.3}`} />}
                {pen.pts.map((p, i) => (
                  <rect key={`pp${i}`} x={p[0] - u * 0.4} y={p[1] - u * 0.4} width={u * 0.8} height={u * 0.8} fill={i === 0 ? '#000' : '#fff'} stroke="#000" strokeWidth={u * 0.15} />
                ))}
                {pen.pts.length >= 3 && <circle cx={pen.pts[0][0]} cy={pen.pts[0][1]} r={tol} fill="none" stroke="#000" strokeWidth={u * 0.08} strokeDasharray={`${u * 0.2} ${u * 0.2}`} />}
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

            {/* Encima de todo: al dibujar una pieza a mano cada clic pone una esquina, aunque caiga sobre una máquina. */}
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

        <Inspector
          plant={plant}
          positions={positions}
          sel={sel}
          setSel={setSel}
          commit={commit}
          rotate={rotate}
          remove={remove}
          catalog={catalog}
          full={full}
          live={live}
          duplicate={duplicate}
          ops={ops}
          outside={outside}
          tool={tool}
          parts={parts}
          comp={comp}
          shape={{ arm, setArm, addHole, setHole, startPen, pen, cancel: cancelShape }}
        />
      </div>
    </div>
  )
}
