import * as THREE from 'three'

export const M = {
  white: new THREE.MeshStandardMaterial({ color: 0xf8f8f8, roughness: 0.75 }),
  light: new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.8 }),
  mid: new THREE.MeshStandardMaterial({ color: 0xa9a9a9, roughness: 0.65 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x4b4b4b, roughness: 0.55 }),
  black: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.45 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8d8d8d, roughness: 0.3, metalness: 0.6 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.38, depthWrite: false }),
  glassEdge: new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.6 }),
  card: new THREE.MeshStandardMaterial({ color: 0xbdbdbd, roughness: 0.95 }),
}

const EDGE = new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.55 })

/* Materiales que comparten todas las maquetas: no se liberan al reconstruir la escena. */
export const SHARED = new Set([...Object.values(M), EDGE])

let hatchTex = null
export function hatchTexture() {
  if (hatchTex) return hatchTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  g.fillStyle = '#f2f2f2'
  g.fillRect(0, 0, 128, 128)
  g.strokeStyle = '#1a1a1a'
  g.lineWidth = 14
  for (let i = -128; i < 256; i += 40) {
    g.beginPath()
    g.moveTo(i, 128)
    g.lineTo(i + 128, 0)
    g.stroke()
  }
  hatchTex = new THREE.CanvasTexture(c)
  hatchTex.wrapS = hatchTex.wrapT = THREE.RepeatWrapping
  hatchTex.colorSpace = THREE.SRGBColorSpace
  hatchTex.anisotropy = 8
  return hatchTex
}

export function box(parent, w, h, d, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y + h / 2, z)
  m.castShadow = shadow
  m.receiveShadow = true
  parent.add(m)
  return m
}

export function cyl(parent, r, h, mat, x = 0, y = 0, z = 0, axis = 'y', seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat)
  if (axis === 'x') m.rotation.z = Math.PI / 2
  if (axis === 'z') m.rotation.x = Math.PI / 2
  m.position.set(x, y + (axis === 'y' ? h / 2 : 0), z)
  m.castShadow = true
  m.receiveShadow = true
  parent.add(m)
  return m
}

/* Panel translúcido (solo para las ventanas de la oficina). */
function pane(parent, w, h, x, y, z, ry = 0) {
  const geo = new THREE.BoxGeometry(w, h, 0.03)
  const m = new THREE.Mesh(geo, M.glass)
  m.position.set(x, y, z)
  m.rotation.y = ry
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), M.glassEdge))
  parent.add(m)
  return m
}

/* Caja genérica: pieza, bulto o caja de cualquier industria. */
export function crate(parent, w, h, d, x = 0, y = 0, z = 0, mat = M.card, ry = 0) {
  const m = box(parent, w, h, d, mat, x, y, z)
  m.rotation.y = ry
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), EDGE))
  return m
}

/* Tarima con una pila de cajas. */
function pallet(g, x, z, levels = 2, ry = 0) {
  const p = new THREE.Group()
  p.position.set(x, 0, z)
  p.rotation.y = ry
  box(p, 1.2, 0.14, 1.0, M.dark, 0, 0, 0)
  for (let i = 0; i < levels; i++) crate(p, 1.05, 0.4, 0.85, 0, 0.14 + i * 0.4, 0, i % 2 ? M.light : M.card)
  g.add(p)
  return p
}

function zoneFloor(g, w, d) {
  const tex = hatchTexture().clone()
  tex.needsUpdate = true
  tex.repeat.set(w / 2.2, d / 2.2)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = 0.025
  floor.receiveShadow = true
  g.add(floor)
  const border = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.02, d)), new THREE.LineBasicMaterial({ color: 0x000000 }))
  border.position.y = 0.04
  g.add(border)
}

const builders = {
  /* Estantería con cajas: almacén de materia prima o de producto. */
  storage(g, w, d) {
    const bays = Math.max(2, Math.round(w / 2.2))
    const bw = w / bays
    box(g, w, 0.08, d, M.mid, 0, 0, 0)
    for (let i = 0; i <= bays; i++) for (const z of [-d / 2 + 0.1, d / 2 - 0.1]) box(g, 0.08, 2.5, 0.08, M.black, -w / 2 + i * bw, 0, z)
    ;[0.25, 1.05, 1.85].forEach((y, lv) => {
      box(g, w, 0.06, d - 0.1, M.dark, 0, y, 0)
      for (let i = 0; i < bays; i++) {
        if ((i + lv) % 4 === 3) continue
        crate(g, bw * 0.72, 0.5 - (lv % 2) * 0.12, d * 0.62, -w / 2 + (i + 0.5) * bw, y + 0.06, 0, (i + lv) % 2 ? M.card : M.light)
      }
    })
  },
  /* Mesa grande con pórtico: corte, trazado o mecanizado de piezas planas. */
  gantry(g, w, d) {
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, 0.12, 0.85, 0.12, M.black, lx * (w / 2 - 0.2), 0, lz * (d / 2 - 0.2))
    box(g, w, 0.1, d, M.white, 0, 0.85, 0)
    crate(g, w * 0.78, 0.05, d * 0.72, -0.2, 0.95, 0, M.light)
    box(g, 0.25, 0.25, d + 0.3, M.black, w * 0.12, 1.1, 0)
    box(g, 0.4, 0.35, 0.4, M.dark, w * 0.12, 1.05, -0.4)
    for (const z of [-1, 1]) box(g, 0.14, 1.25, 0.14, M.steel, w * 0.12, 0, z * (d / 2 + 0.15))
    box(g, 0.2, 1.3, d + 0.3, M.steel, -w / 2 - 0.1, 0, 0)
  },
  /* Banco de trabajo con piezas: ensamble, acabado manual, revisión. */
  workbench(g, w, d) {
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, 0.1, 0.85, 0.1, M.black, lx * (w / 2 - 0.15), 0, lz * (d / 2 - 0.15))
    box(g, w, 0.08, d, M.light, 0, 0.85, 0)
    for (let i = 0; i < 5; i++) crate(g, 0.35 + (i % 3) * 0.15, 0.14 + (i % 2) * 0.1, 0.3 + (i % 2) * 0.15, -w / 2 + 0.6 + i * 0.7, 0.93, i % 2 ? 0.35 : -0.35, i % 2 ? M.card : M.white, i * 0.4)
    box(g, 0.9, 0.5, 0.7, M.mid, w / 2 - 0.6, 0, d / 2 + 0.45)
  },
  /* Máquina con cuerpo central y transportadores de entrada y salida. */
  line(g, w, d) {
    const body = w * 0.42
    const len = (w - body) / 2
    box(g, body, 1.1, d * 0.72, M.light, 0, 0, 0)
    box(g, body * 0.82, 0.5, d * 0.62, M.black, 0, 1.1, 0)
    for (let i = 0; i < 5; i++) box(g, 0.14, 0.12, 0.14, M.white, -body * 0.32 + i * (body * 0.16), 1.6, -d * 0.16)
    box(g, 0.5, 1.5, 0.32, M.dark, body / 2 - 0.4, 0, d * 0.46)
    for (const side of [-1, 1]) {
      const cx = side * (body / 2 + len / 2)
      box(g, len, 0.7, d * 0.45, M.dark, cx, 0, 0)
      for (let i = 0; i < 6; i++) cyl(g, 0.05, d * 0.45, M.steel, cx - len / 2 + (i + 0.5) * (len / 6), 0.76, 0, 'z', 10)
    }
    crate(g, 0.55, 0.22, 0.4, -(body / 2 + len / 2), 0.78, 0, M.card)
    crate(g, 0.55, 0.22, 0.4, body / 2 + len / 2, 0.78, 0, M.light)
  },
  /* Cabina cerrada con extractor: pintura, arenado, soldadura, curado. */
  cabin(g, w, d) {
    box(g, w * 0.66, 2.3, d * 0.9, M.white, -w * 0.15, 0, 0)
    box(g, w * 0.4, 1.0, 0.05, M.black, -w * 0.15, 0.9, d * 0.45 + 0.03)
    box(g, w * 0.66 + 0.1, 0.12, d * 0.9 + 0.1, M.dark, -w * 0.15, 2.3, 0)
    cyl(g, 0.65, 2.8, M.mid, w * 0.32, 0, -d * 0.2, 'y', 24)
    cyl(g, 0.7, 0.2, M.black, w * 0.32, 2.8, -d * 0.2, 'y', 24)
    box(g, 1.0, 0.3, 0.3, M.dark, w * 0.12, 2.2, -d * 0.2)
  },
  /* Túnel de paso con rodillos a los lados: lavado, secado, horno. */
  tunnel(g, w, d) {
    box(g, w * 0.62, 1.15, d * 0.75, M.white, 0, 0, 0)
    box(g, w * 0.62, 0.08, d * 0.75, M.black, 0, 1.15, 0)
    for (const side of [-1, 1]) box(g, 0.05, 0.7, d * 0.5, M.black, side * w * 0.31, 0.2, 0)
    for (let i = 0; i < 3; i++) cyl(g, 0.2, 0.16, M.dark, -w * 0.2 + i * w * 0.2, 1.23, 0, 'y', 16)
    for (const side of [-1, 1]) {
      const cx = side * (w * 0.31 + w * 0.095)
      box(g, w * 0.19, 0.75, d * 0.5, M.dark, cx, 0, 0)
      for (let i = 0; i < 3; i++) cyl(g, 0.05, d * 0.5, M.steel, cx - w * 0.07 + i * w * 0.07, 0.8, 0, 'z', 10)
    }
  },
  /* Mesa de empaque con cajas listas. */
  packing(g, w, d) {
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, 0.1, 0.85, 0.1, M.black, lx * (w * 0.3 - 0.15), 0, lz * (d * 0.3 - 0.15))
    box(g, w * 0.6, 0.08, d * 0.6, M.white, 0, 0.85, 0)
    crate(g, w * 0.32, 0.26, d * 0.3, 0, 0.93, 0, M.card)
    for (let i = 0; i < 3; i++) for (let j = 0; j <= i % 2; j++) crate(g, 0.8, 0.55, 0.6, w * 0.36, j * 0.55, -d * 0.3 + i * 0.75, M.card)
    cyl(g, 0.35, 1.0, M.light, -w * 0.38, 0, d * 0.3, 'y', 18)
  },
  /* Zona de recepción: tarimas y un patín. */
  receiving(g, w, d) {
    zoneFloor(g, w, d)
    pallet(g, -w * 0.25, -d * 0.15, 3)
    pallet(g, w * 0.02, -d * 0.2, 2, 0.1)
    pallet(g, -w * 0.18, d * 0.2, 2, -0.08)
    box(g, 0.5, 0.12, 1.4, M.dark, w * 0.3, 0, d * 0.15)
    box(g, 0.14, 0.9, 0.14, M.black, w * 0.3, 0, d * 0.15 + 0.6)
  },
  /* Zona de salida: ordenada por ruta o amontonada. */
  dispatch(g, w, d, opts = {}) {
    zoneFloor(g, w, d)
    if (opts.sorted) {
      for (let i = 0; i < 3; i++) {
        pallet(g, -w / 2 + (w / 3) * (i + 0.5), -d * 0.12, 2 + (i % 2))
        pallet(g, -w / 2 + (w / 3) * (i + 0.5), d * 0.22, 1 + (i % 2))
        if (i) box(g, 0.08, 0.02, d * 0.9, M.black, -w / 2 + (w / 3) * i, 0.03, 0)
      }
    } else {
      for (let i = 0; i < 9; i++) {
        const x = -w / 2 + 0.8 + ((i * 1.7) % (w - 1.4))
        const z = -d / 2 + 0.8 + ((i * 1.3) % (d - 1.4))
        crate(g, 0.7 + (i % 3) * 0.25, 0.4 + (i % 2) * 0.3, 0.6 + (i % 2) * 0.2, x, 0, z, i % 2 ? M.card : M.light, i * 0.7)
      }
      crate(g, 0.9, 0.5, 0.7, w * 0.25, 0.4, -d * 0.3, M.card, 0.3)
    }
  },
  office(g, w, d) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M.white)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0.03
    floor.receiveShadow = true
    g.add(floor)
    const h = 2.3
    for (const [len, x, z, rot] of [[w, 0, -d / 2, 0], [w, 0, d / 2, 0], [d, -w / 2, 0, Math.PI / 2], [d, w / 2, 0, Math.PI / 2]]) {
      pane(g, len, h, x, h / 2, z, rot)
      box(g, rot ? 0.08 : len, 0.08, rot ? len : 0.08, M.black, x, h, z)
    }
    for (let i = 0; i < 3; i++) {
      box(g, 1.4, 0.75, 0.7, M.light, -w / 2 + 1.4 + i * 1.9, 0, -d / 2 + 0.9)
      box(g, 0.45, 0.32, 0.05, M.black, -w / 2 + 1.4 + i * 1.9, 0.75, -d / 2 + 0.75)
      cyl(g, 0.25, 0.5, M.black, -w / 2 + 1.4 + i * 1.9, 0, -d / 2 + 1.6, 'y', 12)
    }
    cyl(g, 0.7, 0.75, M.light, w * 0.22, 0, d * 0.12, 'y', 28)
    for (let i = 0; i < 4; i++) cyl(g, 0.22, 0.45, M.black, w * 0.22 + Math.cos(i * 1.57) * 1.05, 0, d * 0.12 + Math.sin(i * 1.57) * 1.05, 'y', 12)
    box(g, 0.6, 1.8, 0.4, M.mid, w / 2 - 0.5, 0, -d / 2 + 0.4)
  },
  restroom(g, w, d) {
    box(g, w, 2.2, 0.12, M.white, 0, 0, -d / 2)
    box(g, 0.12, 2.2, d, M.white, -w / 2, 0, 0)
    box(g, 0.12, 2.2, d, M.white, w / 2, 0, 0)
    box(g, 0.08, 2.0, d * 0.6, M.light, 0, 0, -d * 0.2)
    box(g, w * 0.36, 2.0, 0.08, M.light, -w * 0.25, 0, d * 0.1)
    box(g, w * 0.36, 2.0, 0.08, M.light, w * 0.25, 0, d * 0.1)
    for (const s of [-1, 1]) {
      cyl(g, 0.22, 0.42, M.white, s * w * 0.25, 0, -d * 0.3, 'y', 16)
      box(g, 0.4, 0.5, 0.18, M.white, s * w * 0.25, 0.3, -d / 2 + 0.2)
    }
    box(g, w * 0.7, 0.85, 0.5, M.light, 0, 0, d / 2 - 0.4)
  },
  /* Caja gris con huecos de entrada y salida: representa cualquier proceso sin maqueta propia. */
  generic(g, w, d) {
    const bw = Math.max(1, w - 1.2)
    box(g, bw, 1.8, d * 0.85, M.mid, 0, 0, 0)
    box(g, bw + 0.08, 0.08, d * 0.85 + 0.08, M.dark, 0, 1.8, 0)
    for (const side of [-1, 1]) {
      box(g, 0.04, 0.9, d * 0.42, M.black, side * (bw / 2 + 0.01), 0.35, 0)
      box(g, 0.6, 0.65, d * 0.42, M.dark, side * (bw / 2 + 0.3), 0, 0)
    }
    crate(g, 0.45, 0.25, 0.35, -(bw / 2 + 0.3), 0.65, 0, M.card)
  },
  /* Sierra: mesa con disco y guarda. */
  saw(g, w, d) {
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, 0.1, 0.85, 0.1, M.black, lx * (w / 2 - 0.2), 0, lz * (d / 2 - 0.2))
    box(g, w, 0.08, d * 0.8, M.light, 0, 0.85, 0)
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 32), M.steel)
    blade.rotation.x = Math.PI / 2
    blade.position.set(0, 1.0, 0)
    g.add(blade)
    box(g, 0.9, 0.35, 0.2, M.dark, 0, 1.25, 0)
    crate(g, w * 0.55, 0.05, 0.6, -w * 0.15, 0.93, d * 0.2, M.card)
    box(g, 0.6, 0.85, 0.6, M.dark, w / 2 - 0.5, 0, -d / 2 + 0.5)
  },
  /* Máquina CNC: cabina cerrada con ventana y panel. */
  cnc(g, w, d) {
    box(g, w * 0.78, 2.0, d * 0.85, M.light, -w * 0.08, 0, 0)
    box(g, w * 0.5, 0.9, 0.04, M.black, -w * 0.08, 0.8, d * 0.425 + 0.02)
    box(g, 0.5, 1.6, 0.35, M.dark, w * 0.38, 0, d * 0.3)
    cyl(g, 0.06, 0.6, M.black, w * 0.28, 2.0, -d * 0.3, 'y', 10)
    for (let i = 0; i < 3; i++) cyl(g, 0.09, 0.12, i === 0 ? M.white : M.mid, w * 0.28, 2.6 + i * 0.13, -d * 0.3, 'y', 12)
  },
  /* Torno: bancada larga con cabezal y contrapunto. */
  lathe(g, w, d) {
    for (const x of [-w * 0.35, w * 0.35]) box(g, 0.5, 0.75, d * 0.6, M.dark, x, 0, 0)
    box(g, w * 0.9, 0.25, d * 0.45, M.black, 0, 0.75, 0)
    box(g, w * 0.22, 0.75, d * 0.6, M.light, -w * 0.33, 1.0, 0)
    cyl(g, 0.22, 0.3, M.steel, -w * 0.17, 1.35, 0, 'x', 20)
    box(g, w * 0.12, 0.45, d * 0.4, M.light, w * 0.33, 1.0, 0)
    cyl(g, 0.05, w * 0.45, M.steel, 0.05, 1.35, 0, 'x', 10)
  },
  /* Prensa o troquel: marco alto con ariete. */
  press(g, w, d) {
    box(g, w * 0.8, 0.6, d * 0.8, M.dark, 0, 0, 0)
    for (const s of [-1, 1]) box(g, 0.35, 2.6, d * 0.5, M.black, s * w * 0.3, 0.6, 0)
    box(g, w * 0.8, 0.6, d * 0.6, M.dark, 0, 3.2, 0)
    box(g, w * 0.4, 0.5, d * 0.4, M.steel, 0, 2.2, 0)
    box(g, w * 0.5, 0.15, d * 0.5, M.light, 0, 0.6, 0)
  },
  /* Celda de soldadura: mesa, cortinas y equipo. */
  welding(g, w, d) {
    box(g, w * 0.5, 0.85, d * 0.4, M.steel, 0, 0, 0)
    for (const [x, z, cw, cd] of [[0, -d / 2 + 0.1, w * 0.9, 0.05], [-w / 2 + 0.1, 0, 0.05, d * 0.85], [w / 2 - 0.1, 0, 0.05, d * 0.85]]) box(g, cw, 1.9, cd, M.card, x, 0.2, z)
    box(g, 0.6, 0.8, 0.5, M.dark, w * 0.3, 0, -d * 0.25)
    cyl(g, 0.07, 1.8, M.black, -w * 0.3, 0, -d * 0.3, 'y', 10)
    box(g, 1.2, 0.08, 0.08, M.black, -w * 0.3 + 0.6, 1.8, -d * 0.3)
  },
  /* Horno: cuerpo grande con chimenea. */
  oven(g, w, d) {
    box(g, w * 0.7, 1.9, d * 0.85, M.mid, 0, 0, 0)
    box(g, w * 0.4, 1.1, 0.05, M.black, 0, 0.3, d * 0.425 + 0.03)
    cyl(g, 0.3, 2.2, M.dark, w * 0.2, 1.9, -d * 0.2, 'y', 16)
    for (const side of [-1, 1]) box(g, w * 0.15, 0.7, d * 0.5, M.dark, side * w * 0.42, 0, 0)
  },
  /* Secado: túnel con ventiladores arriba. */
  dryer(g, w, d) {
    builders.tunnel(g, w, d)
    for (let i = 0; i < 2; i++) cyl(g, 0.35, 0.12, M.black, -w * 0.12 + i * w * 0.24, 1.32, -d * 0.15, 'y', 18)
  },
  /* Ensamble: banco con un marco para herramientas colgadas. */
  assembly(g, w, d) {
    builders.workbench(g, w, d)
    for (const s of [-1, 1]) box(g, 0.08, 2.2, 0.08, M.black, s * (w / 2 - 0.15), 0, -d / 2 + 0.15)
    box(g, w - 0.2, 0.08, 0.08, M.black, 0, 2.2, -d / 2 + 0.15)
    for (let i = 0; i < 4; i++) box(g, 0.08, 0.4, 0.08, M.steel, -w / 2 + 0.7 + i * ((w - 1.4) / 3), 1.75, -d / 2 + 0.15)
  },
  /* Costura: filas de mesas pequeñas con máquina. */
  sewing(g, w, d) {
    const cols = Math.max(1, Math.floor(w / 1.6))
    const rows = Math.max(1, Math.floor(d / 1.6))
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const x = -w / 2 + (i + 0.5) * (w / cols)
        const z = -d / 2 + (j + 0.5) * (d / rows)
        box(g, 1.1, 0.75, 0.6, M.light, x, 0, z)
        box(g, 0.4, 0.3, 0.2, M.dark, x - 0.2, 0.75, z)
        cyl(g, 0.18, 0.45, M.black, x, 0, z + 0.55, 'y', 10)
      }
  },
  /* Mezcla o tanques: cilindros verticales con tubería. */
  tanks(g, w, d) {
    const n = w >= 3.5 ? 2 : 1
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : (i - 0.5) * w * 0.5
      const r = Math.min(w / (2 * n), d / 2) * 0.75
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, 0.08, 0.6, 0.08, M.black, x + lx * r * 0.6, 0, lz * r * 0.6)
      cyl(g, r, 1.8, M.white, x, 0.6, 0, 'y', 28)
      cyl(g, r * 0.6, 0.2, M.dark, x, 2.4, 0, 'y', 20)
    }
    box(g, w * 0.8, 0.12, 0.12, M.steel, 0, 2.0, d * 0.35)
  },
  /* Banda transportadora. */
  conveyor(g, w, d) {
    const n = Math.max(2, Math.round(w / 1.6))
    for (let i = 0; i <= n; i++) for (const s of [-1, 1]) box(g, 0.08, 0.75, 0.08, M.black, -w / 2 + 0.2 + i * ((w - 0.4) / n), 0, s * (d * 0.4 - 0.04))
    box(g, w, 0.12, d * 0.8, M.dark, 0, 0.75, 0)
    box(g, w, 0.02, d * 0.7, M.black, 0, 0.87, 0)
    for (let i = 0; i < 3; i++) crate(g, 0.55, 0.3, d * 0.5, -w * 0.3 + i * w * 0.3, 0.89, 0, i % 2 ? M.light : M.card)
  },
  /* Grúa o polipasto como estación propia. */
  hoistStation(g, w, d) {
    box(g, w * 0.6, 0.05, d * 0.6, M.mid, 0, 0, 0)
    const h = makeHoist()
    h.position.set(-w * 0.25, 0, 0)
    g.add(h)
    g.userData.arm = h.userData.arm
  },
  /* Inspección: mesa con lámpara. */
  inspection(g, w, d) {
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, 0.08, 0.85, 0.08, M.black, lx * (w / 2 - 0.15), 0, lz * (d / 2 - 0.15))
    box(g, w, 0.06, d, M.white, 0, 0.85, 0)
    crate(g, w * 0.3, 0.2, d * 0.35, -w * 0.15, 0.91, 0, M.card)
    cyl(g, 0.04, 1.1, M.black, w * 0.3, 0.91, -d * 0.3, 'y', 8)
    box(g, 0.5, 0.08, 0.25, M.dark, w * 0.2, 2.0, -d * 0.3)
  },
  /* Almacén en piso: tarimas en filas. */
  floor(g, w, d) {
    zoneFloor(g, w, d)
    const cols = Math.max(1, Math.floor(w / 1.6))
    const rows = Math.max(1, Math.floor(d / 1.4))
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if ((i + j) % 5 !== 4) pallet(g, -w / 2 + (i + 0.5) * (w / cols), -d / 2 + (j + 0.5) * (d / rows), 1 + ((i + j) % 3))
  },
  /* Comedor: mesas redondas con sillas. */
  canteen(g, w, d) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M.white)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0.03
    g.add(floor)
    const n = Math.max(1, Math.floor(w / 2.6))
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * (w / n)
      cyl(g, 0.6, 0.75, M.light, x, 0, 0, 'y', 24)
      for (let k = 0; k < 4; k++) cyl(g, 0.2, 0.45, M.black, x + Math.cos(k * 1.57) * 0.95, 0, Math.sin(k * 1.57) * 0.95, 'y', 10)
    }
  },
  /* Área de trabajo: piso apenas más oscuro con su contorno pintado. */
  areaMark(g, w, d) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.05, roughness: 1 }))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0.02
    g.add(floor)
    const line = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.8 })
    for (const [lw, ld, x, z] of [[w, 0.12, 0, -d / 2], [w, 0.12, 0, d / 2], [0.12, d, -w / 2, 0], [0.12, d, w / 2, 0]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(lw, ld), line)
      m.rotation.x = -Math.PI / 2
      m.position.set(x, 0.03, z)
      g.add(m)
    }
  },
  /* Pasillo reservado: solo líneas amarillas en el piso, sin barrera (por ahí se camina). */
  aisle(g, w, d) {
    const line = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.8 })
    const long = w >= d
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(long ? w : 0.15, long ? 0.15 : d), line)
      m.rotation.x = -Math.PI / 2
      m.position.set(long ? 0 : (s * w) / 2, 0.03, long ? (s * d) / 2 : 0)
      g.add(m)
    }
  },
  /* Zona bloqueada: piso rayado con barrera. */
  blocked(g, w, d) {
    zoneFloor(g, w, d)
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cyl(g, 0.08, 1.0, M.black, (x * w) / 2, 0, (z * d) / 2, 'y', 10)
    for (const [cw, cd, x, z] of [[w, 0.06, 0, -d / 2], [w, 0.06, 0, d / 2], [0.06, d, -w / 2, 0], [0.06, d, w / 2, 0]]) box(g, cw, 0.06, cd, M.dark, x, 0.9, z)
  },
}

/* De cada tipo del catálogo a su maqueta. Los nombres viejos siguen funcionando. */
const MODEL = {
  recepcion: 'receiving', despacho: 'dispatch', almacen: 'storage', almacen_piso: 'floor', corte: 'gantry', sierra: 'saw',
  cnc: 'cnc', torno: 'lathe', prensa: 'press', soldadura: 'welding', pulido: 'line', pintura: 'cabin', horno: 'oven',
  lavado: 'tunnel', secado: 'dryer', mesa: 'workbench', ensamble: 'assembly', costura: 'sewing', mezcla: 'tanks',
  banda: 'conveyor', grua: 'hoistStation', inspeccion: 'inspection', empaque: 'packing', otro: 'generic',
  oficina: 'office', banos: 'restroom', comedor: 'canteen', bloqueado: 'blocked',
  pasillo: 'aisle', area: 'areaMark', rack: 'storage', table: 'gantry', bench: 'workbench', polisher: 'line', booth: 'cabin', washer: 'tunnel', pack: 'packing', zone: 'dispatch',
}

/* Altura aproximada de cada maqueta, para poner la etiqueta encima. */
export const TALL = { pintura: 2.9, horno: 3.2, prensa: 3.8, grua: 4.3, cnc: 2.8, mezcla: 2.7, oficina: 2.4, banos: 2.3, area: 0.4, pasillo: 0.3 }

export function makeMachine(kind, w, d, opts = {}) {
  const g = new THREE.Group()
  ;(builders[MODEL[kind] || kind] || builders.generic)(g, w, d, opts)
  return g
}

/* Grúa de columna con gancho: mueve material pesado en cualquier taller. */
export function makeHoist() {
  const g = new THREE.Group()
  cyl(g, 0.22, 4.2, M.black, 0, 0, 0, 'y', 16)
  box(g, 0.9, 0.2, 0.9, M.dark, 0, 0, 0)
  const arm = new THREE.Group()
  arm.position.y = 4.0
  box(arm, 4.4, 0.24, 0.24, M.black, 2.1, 0, 0)
  box(arm, 0.5, 0.35, 0.4, M.dark, 4.2, -0.1, 0)
  const cable = box(arm, 0.04, 1.6, 0.04, M.black, 4.0, -1.8, 0)
  cable.castShadow = false
  const hook = new THREE.Group()
  hook.position.set(4.0, -2.0, 0)
  box(hook, 0.3, 0.28, 0.22, M.dark, 0, -0.1, 0)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.035, 8, 20, Math.PI * 1.5), M.steel)
  ring.position.y = -0.3
  ring.rotation.z = Math.PI * 0.75
  hook.add(ring)
  arm.add(hook)
  g.add(arm)
  g.userData.arm = arm
  return g
}

/* Carro con una caja: la unidad de material que viaja por la planta. */
export function makeCart() {
  const g = new THREE.Group()
  box(g, 0.85, 0.07, 0.6, M.dark, 0, -0.2, 0)
  for (const [x, z] of [[-0.35, -0.24], [0.35, -0.24], [-0.35, 0.24], [0.35, 0.24]]) box(g, 0.07, 0.26, 0.07, M.black, x, -0.46, z)
  crate(g, 0.6, 0.4, 0.46, 0, -0.13, 0, M.card)
  return g
}

export function makeOperator() {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.75, 4, 10), M.black)
  body.position.y = 0.6
  body.castShadow = true
  g.add(body)
  const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.35, 12), M.white)
  vest.position.y = 0.85
  g.add(vest)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), M.light)
  head.position.y = 1.32
  head.castShadow = true
  g.add(head)
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.white)
  helmet.position.y = 1.36
  g.add(helmet)
  return g
}

/* Camión: de plataforma con tarimas, o de caja cerrada. */
export function makeTruck(load = 'flat') {
  const g = new THREE.Group()
  box(g, 2.3, 0.35, 8.2, M.black, 0, 0.45, 0)
  for (const z of [-2.8, -1.6, 2.6]) for (const s of [-1, 1]) cyl(g, 0.45, 0.35, M.black, s * 1.05, 0.45, z, 'x', 18)
  box(g, 2.4, 2.1, 2.1, M.white, 0, 0.8, 3.1)
  box(g, 2.2, 0.8, 0.05, M.black, 0, 1.9, 4.16)
  if (load === 'box') {
    box(g, 2.4, 2.6, 5.6, M.white, 0, 0.8, -1.0)
    box(g, 2.42, 0.25, 5.62, M.dark, 0, 2.3, -1.0)
  } else {
    box(g, 2.4, 0.15, 5.6, M.light, 0, 0.8, -1.0)
    for (let i = 0; i < 4; i++) pallet(g, 0, -2.6 + i * 1.3, 1 + (i % 3), Math.PI / 2).position.y = 0.95
  }
  return g
}

export function makeTree() {
  const g = new THREE.Group()
  cyl(g, 0.18, 1.6, M.dark, 0, 0, 0, 'y', 8)
  const mat = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 1, flatShading: true })
  for (const [x, y, z, r] of [[0, 2.4, 0, 1.3], [0.7, 2.0, 0.3, 0.9], [-0.6, 2.1, -0.3, 0.95]]) {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat)
    s.position.set(x, y, z)
    s.castShadow = true
    g.add(s)
  }
  return g
}
