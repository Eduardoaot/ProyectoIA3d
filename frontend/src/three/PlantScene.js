import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { M, SHARED, TALL, box, makeCart, makeMachine, makeOperator, makeTree, makeTruck } from './models'
import { edgesOf, gateInfo, outlineOf, pointInPoly } from '../editor/geometry'

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut = (t) => 1 - Math.pow(1 - t, 4)

/* Vacía un grupo liberando geometrías y materiales propios (los compartidos se quedan).
   Sin esto cada reconstrucción dejaba la memoria de la tarjeta de video ocupada. */
function empty(group) {
  for (const child of group.children) {
    child.traverse((o) => {
      o.geometry?.dispose?.()
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
      for (const m of mats) if (!SHARED.has(m) && !m.userData.keep) m.dispose()
    })
  }
  group.clear()
}

const FLOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.85 })
FLOW_MAT.userData.keep = true

function floorTexture(w, d) {
  const s = 24
  const c = document.createElement('canvas')
  c.width = w * s
  c.height = d * s
  const g = c.getContext('2d')
  g.fillStyle = '#d6d6d6'
  g.fillRect(0, 0, c.width, c.height)
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.035})`
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 2 + Math.random() * 30, 2 + Math.random() * 30)
  }
  g.strokeStyle = 'rgba(0,0,0,0.07)'
  g.lineWidth = 1
  for (let x = 0; x <= w; x += 2) {
    g.beginPath()
    g.moveTo(x * s, 0)
    g.lineTo(x * s, c.height)
    g.stroke()
  }
  for (let z = 0; z <= d; z += 2) {
    g.beginPath()
    g.moveTo(0, z * s)
    g.lineTo(c.width, z * s)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

export default class PlantScene {
  constructor(container, labels, { onHover, onSelect } = {}) {
    this.el = container
    this.labelsEl = labels
    this.onHover = onHover
    this.onSelect = onSelect
    this.tweens = []
    this.stations = new Map()
    this.labelNodes = new Map()
    this.particles = []
    this.operators = []
    this.hovered = null
    this.visible = true
    this.clock = new THREE.Clock()

    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    // Más de 1,5 píxeles por punto casi no se nota y cuesta mucho en pantallas 4K.
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFSoftShadowMap
    r.outputColorSpace = THREE.SRGBColorSpace
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.toneMappingExposure = 1.05
    container.appendChild(r.domElement)
    this.renderer = r

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xeeeeee)
    this.scene.fog = new THREE.Fog(0xeeeeee, 90, 170)

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.5, 400)
    this.camera.position.set(26, 38, 46)
    this.controls = new OrbitControls(this.camera, r.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.07
    this.controls.maxPolarAngle = 1.45
    this.controls.minDistance = 4
    this.controls.maxDistance = 160
    this.controls.screenSpacePanning = false
    this.controls.zoomToCursor = true
    this.controls.target.set(0, 0, 3)
    // Si la cámara se mueve, lo que hay bajo el puntero puede cambiar.
    this.controls.addEventListener('change', () => (this.pickDirty = true))
    this.view = '3d'
    this.keys = new Set()

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b0b0, 1.5))
    const sun = new THREE.DirectionalLight(0xffffff, 2.4)
    sun.position.set(-22, 42, 26)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const sc = sun.shadow.camera
    sc.left = -40
    sc.right = 40
    sc.top = 34
    sc.bottom = -34
    sc.far = 140
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.02
    this.scene.add(sun)

    this.root = new THREE.Group()
    this.scene.add(this.root)

    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2(-10, -10)
    this.onMove = (e) => {
      const b = r.domElement.getBoundingClientRect()
      this.pointer.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1)
      this.pointerInside = true
      this.pickDirty = true
    }
    this.onLeave = () => {
      this.pointerInside = false
      this.setHovered(null)
    }
    // Un arrastre (girar o mover la vista) no cuenta como clic sobre una máquina.
    this.onDown = (e) => {
      this.downAt = [e.clientX, e.clientY]
      r.domElement.focus({ preventScroll: true })
    }
    this.onClick = (e) => {
      const d = this.downAt ? Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) : 0
      if (d > 5) return
      if (this.hovered) {
        this.focus(this.hovered)
        this.onSelect?.(this.hovered)
      }
    }
    const MOVE_KEYS = ['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', '+', '=', '-', 'r', 'f']
    this.onKeyDown = (e) => {
      const k = e.key.toLowerCase()
      if (!MOVE_KEYS.includes(k) || e.ctrlKey || e.metaKey || e.altKey) return
      e.preventDefault()
      this.keys.add(k)
    }
    this.onKeyUp = (e) => this.keys.delete(e.key.toLowerCase())
    this.onBlur = () => this.keys.clear()
    r.domElement.tabIndex = 0
    r.domElement.style.outline = 'none'
    r.domElement.addEventListener('pointerdown', this.onDown)
    r.domElement.addEventListener('pointermove', this.onMove)
    r.domElement.addEventListener('pointerleave', this.onLeave)
    r.domElement.addEventListener('click', this.onClick)
    r.domElement.addEventListener('keydown', this.onKeyDown)
    r.domElement.addEventListener('keyup', this.onKeyUp)
    r.domElement.addEventListener('blur', this.onBlur)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.io = new IntersectionObserver(([e]) => (this.visible = e.isIntersecting))
    this.io.observe(container)
    this.resize()
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
  }

  /* ---------- Construcción ---------- */

  build(plant, positions, opts = {}) {
    this.plant = plant
    this.opts = opts
    this.W = plant.size.w
    this.D = plant.size.d
    empty(this.root)
    this.floorTex?.dispose()
    this.ring = null
    this.stations.clear()
    this.labelNodes.forEach((n) => n.remove())
    this.labelNodes.clear()
    this.root.position.set(-this.W / 2, 0, -this.D / 2)
    this.buildSite()
    this.walls = new THREE.Group()
    this.root.add(this.walls)
    this.buildWalls(opts)

    this.arms = []
    for (const s of plant.stations) {
      const g = new THREE.Group()
      const model = makeMachine(s.kind, s.w, s.d, { id: s.id, sorted: true })
      g.add(model)
      g.userData = { id: s.id, name: s.name, model, h: TALL[s.kind] ?? 1.9 }
      if (model.userData.arm) this.arms.push(model.userData.arm)
      const p = positions[s.id] || [this.W / 2, this.D / 2, 0]
      g.position.set(p[0], 0, p[1])
      g.rotation.y = -THREE.MathUtils.degToRad(p[2] || 0)
      g.traverse((o) => (o.userData.pick = s.id))
      this.root.add(g)
      this.stations.set(s.id, g)
      this.addLabel(s.id, s.name)
    }
    for (const f of plant.zones || []) {
      const g = makeMachine(f.kind, f.w, f.d)
      g.position.set(f.x, 0, f.z)
      g.userData = { id: f.id, name: f.name, h: TALL[f.kind] ?? 1.4 }
      g.traverse((o) => (o.userData.pick = f.id))
      this.root.add(g)
      this.stations.set(f.id, g)
      this.addLabel(f.id, f.name)
    }

    // Solo las máquinas y zonas se pueden señalar: el rayo no recorre árboles, calles ni carritos.
    this.pickables = [...this.stations.values()]
    this.pickDirty = true

    this.flow = new THREE.Group()
    this.root.add(this.flow)
    this.extras = new THREE.Group()
    this.root.add(this.extras)
    this.updateFlow(positions, false, opts.legs)
    this.applyExtras(opts)
  }

  buildSite() {
    const { W, D } = this
    const poly = outlineOf(this.plant)
    this.poly = poly
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 140, D + 140), new THREE.MeshStandardMaterial({ color: 0xdcdcdc, roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.set(W / 2, -0.02, D / 2)
    ground.receiveShadow = true
    this.root.add(ground)

    // Una calle frente a cada lado del contorno que tiene portón.
    const edges = edgesOf(poly)
    const used = [...new Set(this.plant.gates.map((g) => gateInfo(this.plant, g).edge))]
    const streets = []
    used.forEach((ei, k) => {
      const e = edges[ei]
      const th = Math.atan2(e.n[0], e.n[1])
      const mid = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]
      const ax = [Math.cos(th), -Math.sin(th)]
      const toWorld = (lx, lz) => [mid[0] + ax[0] * lx + e.n[0] * lz, mid[1] + ax[1] * lx + e.n[1] * lz]
      // La calle se alarga mientras no atraviese el edificio (en formas en L o U un lado interior queda corto).
      let ext = 0
      for (const tryExt of [70, 30, 12, 4, 0]) {
        ext = tryExt
        const half = e.len / 2 + tryExt
        const probe = [-half, -half / 2, 0, half / 2, half].flatMap((lx) => [2, 9.5, 16].map((lz) => toWorld(lx, lz)))
        if (!probe.some((p) => pointInPoly(poly, p))) break
      }
      const L = e.len + 2 * ext
      const g = new THREE.Group()
      g.position.set(mid[0], k * 0.003, mid[1])
      g.rotation.y = th
      const street = new THREE.Mesh(new THREE.PlaneGeometry(L, 13), new THREE.MeshStandardMaterial({ color: 0x3d3d3d, roughness: 0.95 }))
      street.rotation.x = -Math.PI / 2
      street.position.set(0, 0, 9.5)
      street.receiveShadow = true
      g.add(street)
      box(g, L, 0.12, 3, new THREE.MeshStandardMaterial({ color: 0xbdbdbd }), 0, 0, 1.5, false)
      for (let x = -L / 2 + 1.5; x < L / 2 - 1.5; x += 6) box(g, 3, 0.02, 0.22, M.white, x, 0.01, 10, false)
      for (let i = 0; i < 6; i++) box(g, 0.6, 0.02, 4, M.white, -Math.min(14, e.len / 2) + i * 1.2, 0.01, 9.5, false)
      this.root.add(g)
      streets.push({ toLocal: (x, z) => [(x - mid[0]) * ax[0] + (z - mid[1]) * ax[1], (x - mid[0]) * e.n[0] + (z - mid[1]) * e.n[1]], half: L / 2 })
    })

    // Piso con la forma de la planta.
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)))
    const tex = floorTexture(W, D)
    this.floorTex = tex
    tex.repeat.set(1 / W, 1 / D)
    tex.offset.set(0, 1)
    const floor = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false }), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.19
    floor.receiveShadow = true
    this.root.add(floor)

    const trees = [[-5, 3], [-6, 12], [-4, 20], [W + 5, 4], [W + 6, 14], [6, -5], [18, -6], [30, -5], [41, -6], [-14, D + 18], [W / 2, D + 19], [W + 12, D + 18]]
    for (const [x, z] of trees) {
      // Sin árboles dentro de la planta ni sobre una calle.
      if (pointInPoly(poly, [x, z])) continue
      const onStreet = streets.some((st) => {
        const [lx, lz] = st.toLocal(x, z)
        return Math.abs(lx) < st.half && lz > -1.5 && lz < 17.5
      })
      if (onStreet) continue
      const t = makeTree()
      t.position.set(x, 0, z)
      t.scale.setScalar(0.9 + ((x * 7 + z) % 5) / 10)
      this.root.add(t)
    }
  }

  buildWalls(opts) {
    empty(this.walls)
    // Altura real de los muros si el plano la trae (wall_h, en metros); si no, la de siempre.
    const h = Number(this.plant.wall_h) > 0 ? Number(this.plant.wall_h) : 2.3
    const t = 0.3
    const mat = M.white
    const poly = this.poly || outlineOf(this.plant)
    const open = opts.gates ? opts.gates.map((id) => this.plant.gates.find((g) => g.id === id)).filter(Boolean) : this.plant.gates
    const infos = open.map((g) => ({ ...gateInfo(this.plant, g), gh: Number(g.h) > 0 ? Number(g.h) : h }))
    // Muros exteriores por cada lado del contorno, con el hueco de cada portón.
    for (const e of edgesOf(poly)) {
      const seg = (s0, s1, y0 = 0) => {
        const len = s1 - s0
        const hh = h - y0
        if (len < 0.05 || hh < 0.05) return
        // En las esquinas el muro se alarga para cerrar el ángulo.
        const a0 = s0 <= 0.01 ? t : 0
        const a1 = s1 >= e.len - 0.01 ? t : 0
        const c = s0 - a0 + (len + a0 + a1) / 2
        const m = box(this.walls, len + a0 + a1, hh, t, mat, 0, 0, 0)
        m.position.set(e.a[0] + e.dir[0] * c + (e.n[0] * t) / 2, y0 + hh / 2, e.a[1] + e.dir[1] * c + (e.n[1] * t) / 2)
        m.rotation.y = -Math.atan2(e.dir[1], e.dir[0])
      }
      const here = infos.filter((gi) => gi.edge === e.i)
      // Sobre un portón más bajo que el muro queda el dintel.
      for (const gi of here) if (gi.gh < h) seg(gi.t - gi.half, gi.t + gi.half, gi.gh)
      const cuts = here.map((gi) => [gi.t - gi.half, gi.t + gi.half]).sort((a, b) => a[0] - b[0])
      let s0 = 0
      for (const [a, b] of cuts) {
        if (a > s0) seg(s0, a)
        s0 = Math.max(s0, b)
      }
      if (s0 < e.len) seg(s0, e.len)
    }
    for (const gi of infos) {
      const g = new THREE.Group()
      g.position.set(gi.x + gi.n[0] * 0.6, 0.03, gi.z + gi.n[1] * 0.6)
      g.rotation.y = Math.atan2(gi.n[0], gi.n[1])
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(gi.half * 2, 1.2), new THREE.MeshStandardMaterial({ map: this.hatch(), roughness: 0.9 }))
      stripe.rotation.x = -Math.PI / 2
      g.add(stripe)
      this.walls.add(g)
    }
    for (const w of this.plant.walls || []) {
      const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1)
      if (len < 0.1) continue
      const m = box(this.walls, len + 0.3, h, 0.3, mat, 0, 0, 0)
      m.position.set((w.x1 + w.x2) / 2, h / 2, (w.z1 + w.z2) / 2)
      m.rotation.y = -Math.atan2(w.z2 - w.z1, w.x2 - w.x1)
    }
  }

  hatch() {
    if (!this._hatch) {
      const c = document.createElement('canvas')
      c.width = 256
      c.height = 64
      const g = c.getContext('2d')
      g.fillStyle = '#f5f5f5'
      g.fillRect(0, 0, 256, 64)
      g.fillStyle = '#111'
      for (let i = -64; i < 320; i += 32) {
        g.beginPath()
        g.moveTo(i, 64)
        g.lineTo(i + 16, 64)
        g.lineTo(i + 80, 0)
        g.lineTo(i + 64, 0)
        g.fill()
      }
      this._hatch = new THREE.CanvasTexture(c)
      this._hatch.colorSpace = THREE.SRGBColorSpace
    }
    return this._hatch
  }

  applyExtras(opts = {}) {
    this.opts = { ...this.opts, ...opts }
    const o = this.opts
    this.buildWalls(o)
    empty(this.extras)
    for (const op of this.operators) {
      op.parent?.remove(op)
      empty(op)
    }
    this.operators = []

    // Los camiones esperan en la calle frente a su portón, de reversa hacia la planta.
    const info = (id) => {
      const g = this.plant.gates.find((q) => q.id === id) || this.plant.gates[0]
      return g ? gateInfo(this.plant, g) : { x: this.W / 2, z: this.D, n: [0, 1] }
    }
    const put = (obj, gi, along, out) => {
      const th = Math.atan2(gi.n[0], gi.n[1])
      obj.rotation.y = th
      obj.position.set(gi.x + Math.cos(th) * along + gi.n[0] * out, 0, gi.z - Math.sin(th) * along + gi.n[1] * out)
      obj.userData.bob = true
    }
    const dispId = o.dispatchGate || this.plant.dispatch_gate
    const recvId = o.receiveGate || this.plant.receive_gate
    const disp = info(dispId)
    const recv = info(recvId)
    const trucks = o.trucks ?? 2
    for (let i = 0; i < trucks; i++) {
      const tr = makeTruck(i === 0 ? 'flat' : 'box')
      put(tr, disp, i === 0 ? 0 : -6, 5.6 + (i ? 1.5 : 0))
      this.extras.add(tr)
    }
    if (recvId !== dispId && Math.hypot(recv.x - disp.x, recv.z - disp.z) > 1) {
      const van = makeTruck('flat')
      van.scale.setScalar(0.85)
      put(van, recv, 0, 5.4)
      this.extras.add(van)
    }

    const ops = o.ops || {}
    for (const [id, n] of Object.entries(ops)) {
      const g = this.stations.get(id)
      if (!g || !n) continue
      const s = this.plant.stations.find((q) => q.id === id)
      for (let i = 0; i < n; i++) {
        const op = makeOperator()
        op.position.set((i - (n - 1) / 2) * 1.1, 0, s.d / 2 + 0.8)
        op.rotation.y = Math.PI
        op.userData.phase = Math.random() * Math.PI * 2
        op.scale.setScalar(0.001)
        g.add(op)
        this.operators.push(op)
        this.tween({ duration: 0.6, delay: 0.1 + i * 0.12, update: (k) => op.scale.setScalar(Math.max(0.001, easeOut(k))) })
      }
    }

    if (this.ring) {
      this.ring.parent?.remove(this.ring)
      empty(this.ring)
    }
    this.ring = null
    this.labelNodes.forEach((n) => {
      n.dataset.strong = 'false'
      n.textContent = n.dataset.name
    })
    if (o.bottleneck) {
      const g = this.stations.get(o.bottleneck)
      const s = this.plant.stations.find((q) => q.id === o.bottleneck)
      if (g && s) {
        const ring = new THREE.Group()
        const r = Math.max(s.w, s.d) * 0.62
        for (let i = 0; i < 2; i++) {
          const m = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.18, 64), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.8 }))
          m.rotation.x = -Math.PI / 2
          m.position.y = 0.05
          m.userData.offset = i * 0.5
          ring.add(m)
        }
        g.add(ring)
        this.ring = ring
        const label = this.labelNodes.get(o.bottleneck)
        if (label) {
          label.dataset.strong = 'true'
          label.textContent = `${s.name} al ${Math.round(o.bottleneckUtil * 100)} %`
        }
      }
    }
  }

  addLabel(id, name) {
    if (!this.labelsEl) return
    const n = document.createElement('div')
    n.className = 'scene-label'
    n.textContent = name
    n.dataset.name = name
    n.style.opacity = 0
    this.labelsEl.appendChild(n)
    this.labelNodes.set(id, n)
  }

  /* ---------- Recorridos del material ---------- */

  pathPoints(a, b, i, leg) {
    const off = (i % 3) * 0.35 - 0.35
    const y = 0.07
    if (leg?.path?.length > 1) return leg.path.map(([x, z]) => new THREE.Vector3(x + off, y, z + off))
    return [new THREE.Vector3(a[0] + off, y, a[1] + off), new THREE.Vector3(b[0] + off, y, a[1] + off), new THREE.Vector3(b[0] + off, y, b[1] + off)]
  }

  updateFlow(positions, draw = false, legs = this.legs) {
    this.legs = legs
    empty(this.flow)
    this.particles = []
    this.plant.routes.forEach((e, i) => {
      const a = positions[e.from]
      const b = positions[e.to]
      if (!a || !b) return
      const frac = e.frac ?? 1
      const trips = frac * 20
      const width = 0.14 + Math.min(trips, 25) * 0.012
      const pts = this.pathPoints(a, b, i, legs?.find((l) => l.id === e.id))
      const dashed = frac < 1
      const segs = []
      let total = 0
      for (let k = 0; k < pts.length - 1; k++) {
        const len = pts[k].distanceTo(pts[k + 1])
        segs.push({ a: pts[k], b: pts[k + 1], len, start: total })
        total += len
        if (len < 0.01) continue
        const mid = pts[k].clone().lerp(pts[k + 1], 0.5)
        const horizontal = Math.abs(pts[k].x - pts[k + 1].x) > 0.01
        const pieces = dashed ? Math.max(1, Math.floor(len / 1.1)) : 1
        for (let q = 0; q < pieces; q++) {
          const pl = dashed ? 0.6 : len
          const m = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? pl : width, 0.03, horizontal ? width : pl), FLOW_MAT)
          if (dashed) {
            const t = (q + 0.5) / pieces
            m.position.copy(pts[k].clone().lerp(pts[k + 1], t))
          } else m.position.copy(mid)
          if (draw) {
            m.scale.set(0.001, 1, 0.001)
            const d = (segs.length - 1) * 0.12 + i * 0.07 + q * 0.01
            this.tween({ duration: 0.5, delay: d, update: (t) => m.scale.set(horizontal ? Math.max(0.001, easeOut(t)) : 1, 1, horizontal ? 1 : Math.max(0.001, easeOut(t))) })
          }
          this.flow.add(m)
        }
      }
      const half = total / 2
      const seg = segs.find((q) => half >= q.start && half <= q.start + q.len) || segs[segs.length - 1]
      if (seg && seg.len > 0.01) {
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.3, 3), M.black)
        arrow.position.copy(seg.a.clone().lerp(seg.b, (half - seg.start) / seg.len))
        arrow.position.y = 0.12
        const dir = seg.b.clone().sub(seg.a).normalize()
        arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
        this.flow.add(arrow)
      }
      for (const pt of [pts[0], pts[pts.length - 1]]) {
        const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 18), M.black)
        dot.position.copy(pt)
        this.flow.add(dot)
      }
      const count = Math.max(1, Math.round(trips / 7))
      for (let c = 0; c < count; c++) {
        const mesh = makeCart()
        this.flow.add(mesh)
        this.particles.push({ mesh, segs, total, t: c / count, speed: 3.2 / Math.max(total, 1) })
      }
    })
  }

  /* ---------- Movimiento de máquinas ---------- */

  setLayout(positions, { animate = true, onDone, legs } = {}) {
    let latest = 0
    const order = [...this.stations.keys()].filter((id) => positions[id])
    order.forEach((id, i) => {
      const g = this.stations.get(id)
      const from = g.position.clone()
      const fromRot = g.rotation.y
      const p = positions[id]
      const to = new THREE.Vector3(p[0], 0, p[1])
      const toRot = -THREE.MathUtils.degToRad(p[2] || 0)
      const moved = from.distanceTo(to) > 0.05 || Math.abs(fromRot - toRot) > 0.01
      if (!animate || !moved) {
        g.position.copy(to)
        g.rotation.y = toRot
        return
      }
      const lift = 2.6 + from.distanceTo(to) * 0.08
      const delay = i * 0.16
      const duration = 1.7
      latest = Math.max(latest, delay + duration)
      this.tween({
        duration,
        delay,
        update: (k) => {
          const e = easeInOut(k)
          g.position.lerpVectors(from, to, e)
          g.position.y = Math.sin(Math.PI * Math.min(1, k * 1.05)) * lift
          g.rotation.y = fromRot + (toRot - fromRot) * e
          g.rotation.z = Math.sin(Math.PI * k) * 0.05
        },
        done: () => {
          g.position.y = 0
          g.rotation.z = 0
          this.bump(g)
        },
      })
    })
    this.flow.visible = !animate
    const finish = () => {
      this.flow.visible = true
      this.updateFlow(positions, true, legs)
      onDone?.()
    }
    if (animate && latest > 0) setTimeout(finish, latest * 1000 + 80)
    else finish()
    return latest
  }

  bump(g) {
    this.tween({
      duration: 0.5,
      update: (k) => {
        const s = 1 + Math.sin(Math.PI * k) * 0.06 * (1 - k)
        g.scale.set(s, 1 - (s - 1), s)
      },
      done: () => g.scale.set(1, 1, 1),
    })
  }

  /* ---------- Cámara ---------- */

  setView(view) {
    const target = new THREE.Vector3(0, 0, view === 'top' ? 2.5 : 3)
    let pos
    if (view === 'top') {
      const fov = THREE.MathUtils.degToRad(this.camera.fov)
      const distH = (this.D / 2 + 9) / Math.tan(fov / 2)
      const distW = (this.W / 2 + 3) / (Math.tan(fov / 2) * this.camera.aspect)
      pos = new THREE.Vector3(0, Math.max(distH, distW), 2.6)
    } else {
      pos = new THREE.Vector3(this.W * 0.55, Math.max(this.W, this.D * 1.8) * 0.85, this.D * 1.4 + 16)
    }
    this.moveCamera(pos, target)
    this.view = view
    const top = view === 'top'
    this.controls.enableRotate = !top
    // Desde arriba el clic izquierdo arrastra la vista; en 3D gira y el derecho (o Shift) la mueve.
    this.controls.mouseButtons = top
      ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    this.controls.touches = top ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN } : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
  }

  /* ---------- Movimiento libre de cámara ---------- */

  // Desplaza cámara y objetivo sobre el piso, relativo a hacia dónde mira la cámara.
  pan(forward, right) {
    const fwd = new THREE.Vector3()
    this.camera.getWorldDirection(fwd)
    fwd.y = 0
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1)
    fwd.normalize()
    const side = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize()
    const move = fwd.multiplyScalar(forward).add(side.multiplyScalar(right))
    this.camera.position.add(move)
    this.controls.target.add(move)
  }

  orbit(angle) {
    if (this.view === 'top') return
    const off = this.camera.position.clone().sub(this.controls.target)
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle)
    this.camera.position.copy(this.controls.target).add(off)
  }

  // Sube o baja la mirada alrededor del objetivo, dentro de los límites de los controles.
  tilt(angle) {
    if (this.view === 'top') return
    const off = this.camera.position.clone().sub(this.controls.target)
    const s = new THREE.Spherical().setFromVector3(off)
    s.phi = Math.min(this.controls.maxPolarAngle, Math.max(0.12, s.phi + angle))
    off.setFromSpherical(s)
    this.camera.position.copy(this.controls.target).add(off)
  }

  zoom(factor) {
    const off = this.camera.position.clone().sub(this.controls.target)
    const len = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, off.length() * factor))
    off.setLength(len)
    this.camera.position.copy(this.controls.target).add(off)
  }

  stepKeys(dt) {
    if (!this.keys.size) return
    const k = this.keys
    const dist = this.camera.position.distanceTo(this.controls.target)
    const sp = dt * Math.max(6, dist * 0.7)
    const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0)
    const r = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0)
    if (f || r) this.pan(f * sp, r * sp)
    if (k.has('q')) this.orbit(dt * 1.4)
    if (k.has('e')) this.orbit(-dt * 1.4)
    if (k.has('r')) this.tilt(-dt * 0.9)
    if (k.has('f')) this.tilt(dt * 0.9)
    if (k.has('+') || k.has('=')) this.zoom(1 - dt * 1.6)
    if (k.has('-')) this.zoom(1 + dt * 1.6)
  }

  focus(id) {
    const g = this.stations.get(id)
    if (!g) return
    const wp = new THREE.Vector3()
    g.getWorldPosition(wp)
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    this.moveCamera(wp.clone().add(dir.multiplyScalar(26)), wp)
  }

  moveCamera(pos, target, duration = 1.3) {
    const p0 = this.camera.position.clone()
    const t0 = this.controls.target.clone()
    this.tween({
      duration,
      update: (k) => {
        const e = easeInOut(k)
        this.camera.position.lerpVectors(p0, pos, e)
        this.controls.target.lerpVectors(t0, target, e)
      },
    })
  }

  /* ---------- Bucle ---------- */

  tween(t) {
    this.tweens.push({ ...t, delay: t.delay || 0, elapsed: 0 })
  }

  setHovered(id) {
    if (id === this.hovered) return
    const prev = this.hovered && this.stations.get(this.hovered)
    if (prev) this.tween({ duration: 0.3, update: (k) => (prev.userData.model ?? prev).position.setY(0.35 * (1 - easeOut(k))) })
    this.hovered = id
    const g = id && this.stations.get(id)
    if (g) this.tween({ duration: 0.3, update: (k) => (g.userData.model ?? g).position.setY(0.35 * easeOut(k)) })
    this.renderer.domElement.style.cursor = id ? 'pointer' : ''
    this.onHover?.(id, g?.userData.name)
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(this.clock.getDelta(), 0.05)
    if (!this.visible) return
    const time = this.clock.elapsedTime

    this.stepKeys(dt)

    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i]
      t.elapsed += dt
      const k = (t.elapsed - t.delay) / t.duration
      if (k < 0) continue
      t.update(Math.min(1, k))
      if (k >= 1) {
        this.tweens.splice(i, 1)
        t.done?.()
      }
    }

    for (const p of this.particles) {
      p.t = (p.t + dt * p.speed) % 1
      const d = p.t * p.total
      const s = p.segs.find((q) => d >= q.start && d <= q.start + q.len) || p.segs[p.segs.length - 1]
      const k = s.len ? (d - s.start) / s.len : 0
      p.mesh.position.lerpVectors(s.a, s.b, k)
      p.mesh.position.y = 0.45
      p.mesh.rotation.y = Math.abs(s.a.x - s.b.x) > 0.01 ? 0 : Math.PI / 2
    }

    for (const op of this.operators) op.position.y = Math.abs(Math.sin(time * 2.2 + op.userData.phase)) * 0.06

    if (this.ring) {
      for (const m of this.ring.children) {
        const k = (time * 0.7 + m.userData.offset) % 1
        m.scale.setScalar(1 + k * 0.5)
        m.material.opacity = 0.85 * (1 - k)
      }
    }

    for (const arm of this.arms || []) arm.rotation.y = Math.sin(time * 0.4) * 0.6

    for (const tr of this.extras.children) if (tr.userData.bob) tr.position.y = Math.sin(time * 1.3) * 0.015

    // El rayo solo se lanza si el puntero o la cámara se movieron, y solo contra las máquinas.
    if (this.pointerInside && this.pickDirty && this.pickables) {
      this.pickDirty = false
      this.raycaster.setFromCamera(this.pointer, this.camera)
      const hits = this.raycaster.intersectObjects(this.pickables, true)
      const hit = hits.find((h) => h.object.userData.pick)
      this.setHovered(hit ? hit.object.userData.pick : null)
    }

    if (this.labelsEl && this.labelNodes.size) {
      const w = this.el.clientWidth
      const h = this.el.clientHeight
      const v = this._v || (this._v = new THREE.Vector3())
      for (const [id, n] of this.labelNodes) {
        const g = this.stations.get(id)
        if (!g) continue
        const show = n.dataset.strong === 'true' || id === this.hovered
        // Las etiquetas ocultas no se recolocan: ahorra escribir estilos en cada cuadro.
        if (n.dataset.show !== String(show)) {
          n.dataset.show = String(show)
          n.style.opacity = show ? 1 : 0
        }
        if (!show) continue
        g.getWorldPosition(v)
        v.y += g.userData.h + 0.8
        v.project(this.camera)
        n.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`
      }
    }

    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  resize() {
    const w = this.el.clientWidth
    const h = this.el.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.io.disconnect()
    const c = this.renderer.domElement
    c.removeEventListener('pointerdown', this.onDown)
    c.removeEventListener('pointermove', this.onMove)
    c.removeEventListener('pointerleave', this.onLeave)
    c.removeEventListener('click', this.onClick)
    c.removeEventListener('keydown', this.onKeyDown)
    c.removeEventListener('keyup', this.onKeyUp)
    c.removeEventListener('blur', this.onBlur)
    this.controls.dispose()
    this.scene.traverse((o) => {
      o.geometry?.dispose?.()
    })
    this.renderer.dispose()
    c.remove()
    this.labelNodes.forEach((n) => n.remove())
  }
}