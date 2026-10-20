import { useEffect, useRef, useState } from 'react'

const BEST_KEY = 'cauce-montacargas-record'

function readBest() {
    try {
        return Number(localStorage.getItem(BEST_KEY)) || 0
    } catch {
        return 0
    }
}

function saveBest(v) {
    try {
        localStorage.setItem(BEST_KEY, String(v))
    } catch {
        /* sin almacenamiento: el récord dura lo que dure la página */
    }
}

/* Montacargas: los pedidos aparecen en el almacén como tarimas con una figura (○ □ △).
   Hay que recogerlas (hasta dos a la vez) y llevarlas al andén de su figura antes de que se
   acabe su tiempo, sin chocar con los operarios. Espacio da un acelerón corto; el rayo da turbo.
   Cada entrega seguida sube el combo; cada 4 entregas sube el nivel (más pedidos, menos tiempo,
   más operarios y más rápidos). Flechas o WASD para manejar, clic para ir, P o Esc para pausar. */

const COLS = 16
const ROWS = 9
const SHAPES = ['circ', 'cuad', 'tri']
const DOCKS = [
    { c: 15, r: 1, shape: 'circ' },
    { c: 15, r: 4, shape: 'cuad' },
    { c: 15, r: 7, shape: 'tri' },
]
const RACKS = new Set(
    [
        ...[2, 3, 4, 5, 8, 9, 10, 11].flatMap((c) => [`${c},2`, `${c},6`]),
        ...[6, 7, 8, 9].map((c) => `${c},4`),
    ],
)
// Recorridos de los operarios, en el orden en que entran según el nivel.
const PATROLS = [
    { axis: 'r', fixed: 13, from: 0, to: 8 },
    { axis: 'c', fixed: 3, from: 0, to: 12 },
    { axis: 'c', fixed: 5, from: 0, to: 12 },
    { axis: 'r', fixed: 1, from: 0, to: 8 },
    { axis: 'c', fixed: 8, from: 12, to: 14 },
]
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
const CAP = 2 // tarimas que caben en las horquillas
const SPEED = 7.5 // casillas por segundo

const isDock = (c, r) => DOCKS.some((d) => d.c === c && d.r === r)
const free = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS && !RACKS.has(`${c},${r}`)

/* Camino más corto por casillas libres (para ir con el clic). */
function bfs(from, to) {
    if (!free(to[0], to[1])) return null
    const key = (c, r) => `${c},${r}`
    const prev = new Map([[key(...from), null]])
    const q = [from]
    while (q.length) {
        const [c, r] = q.shift()
        if (c === to[0] && r === to[1]) {
            const path = []
            let k = key(c, r)
            while (k && k !== key(...from)) {
                const [pc, pr] = k.split(',').map(Number)
                path.unshift([pc, pr])
                k = prev.get(k)
            }
            return path
        }
        for (const [dc, dr] of Object.values(DIRS)) {
            const n = [c + dc, r + dr]
            if (free(...n) && !prev.has(key(...n))) {
                prev.set(key(...n), key(c, r))
                q.push(n)
            }
        }
    }
    return null
}

function newGame() {
    return {
        playing: true,
        paused: false,
        t: 0,
        score: 0,
        lives: 3,
        level: 1,
        delivered: 0,
        combo: 1,
        p: { c: 0, r: 4, x: 0, y: 4, to: null, dir: 'right', load: [], invul: 0, turbo: 0, dash: 0, cool: 0 },
        path: [],
        held: [],
        pallets: [],
        spawn: 0,
        boost: null,
        boostIn: 8,
        workers: [],
        fx: [],
        sparks: [],
        flash: 0,
        shake: 0,
    }
}

function shapePath(ctx, shape, x, y, s) {
    ctx.beginPath()
    if (shape === 'circ') ctx.arc(x, y, s * 0.5, 0, Math.PI * 2)
    else if (shape === 'cuad') ctx.rect(x - s * 0.45, y - s * 0.45, s * 0.9, s * 0.9)
    else {
        ctx.moveTo(x, y - s * 0.52)
        ctx.lineTo(x + s * 0.55, y + s * 0.45)
        ctx.lineTo(x - s * 0.55, y + s * 0.45)
        ctx.closePath()
    }
}

export default function LoadingGame({ label = 'Juega mientras la IA lee' }) {
    const host = useRef(null)
    const canvas = useRef(null)
    const game = useRef(null)
    const [hud, setHud] = useState({ playing: false, paused: false, over: false, score: 0, lives: 3, level: 1, combo: 1, best: readBest() })

    useEffect(() => {
        const cv = canvas.current
        const ctx = cv.getContext('2d')
        const el = host.current
        let w = 0
        let h = 0
        let cell = 20
        let ox = 0
        let oy = 0
        let raf = 0
        let last = performance.now()
        let dirty = true
        game.current = { playing: false }

        const resize = () => {
            const r = el.getBoundingClientRect()
            const dpr = Math.min(window.devicePixelRatio || 1, 2)
            w = r.width
            h = r.height
            cv.width = w * dpr
            cv.height = h * dpr
            cv.style.width = `${w}px`
            cv.style.height = `${h}px`
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            cell = Math.floor(Math.min((w - 12) / COLS, (h - 12) / ROWS))
            ox = Math.round((w - cell * COLS) / 2)
            oy = Math.round((h - cell * ROWS) / 2)
            dirty = true
        }
        const ro = new ResizeObserver(resize)
        ro.observe(el)
        resize()

        const sync = () => {
            const g = game.current
            setHud((s) => ({ ...s, playing: g.playing, paused: g.paused, score: g.score, lives: g.lives, level: g.level, combo: g.combo }))
        }

        const px = (c) => ox + (c + 0.5) * cell
        const py = (r) => oy + (r + 0.5) * cell
        const pop = (g, text, c, r) => g.fx.push({ text, x: c, y: r, t: 0 })

        const hurt = (g, why, c, r) => {
            g.lives -= 1
            g.combo = 1
            g.flash = 0.35
            g.shake = 0.35
            pop(g, why, c, r)
            if (g.lives <= 0) end(g)
        }

        const level = (g) => {
            const n = Math.min(PATROLS.length, 1 + g.level)
            while (g.workers.length < n) {
                const pt = PATROLS[g.workers.length]
                const pos = pt.from + Math.random() * (pt.to - pt.from)
                g.workers.push({ ...pt, pos, dir: Math.random() < 0.5 ? 1 : -1 })
            }
        }

        const spawnPallet = (g) => {
            const max = Math.min(6, 3 + Math.floor(g.level / 2))
            if (g.pallets.length >= max) return
            for (let k = 0; k < 40; k++) {
                const c = Math.floor(Math.random() * 12)
                const r = Math.floor(Math.random() * ROWS)
                if (!free(c, r) || isDock(c, r) || (c === g.p.c && r === g.p.r) || g.pallets.some((q) => q.c === c && q.r === r)) continue
                const life = Math.max(7, 15 - g.level * 1.2)
                g.pallets.push({ c, r, shape: SHAPES[Math.floor(Math.random() * 3)], left: life, life })
                return
            }
        }

        const burst = (g, c, r, n = 14) => {
            for (let k = 0; k < n; k++) {
                const a = Math.random() * Math.PI * 2
                const v = 2 + Math.random() * 4
                g.sparks.push({ x: c, y: r, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0 })
            }
        }

        const arrive = (g) => {
            const p = g.p
            const i = g.pallets.findIndex((q) => q.c === p.c && q.r === p.r)
            if (i >= 0 && p.load.length < CAP) {
                p.load.push(g.pallets[i])
                g.pallets.splice(i, 1)
            }
            if (g.boost && g.boost.c === p.c && g.boost.r === p.r) {
                p.turbo = 5
                g.boost = null
                pop(g, 'TURBO', p.c, p.r)
            }
            const dock = DOCKS.find((d) => d.c === p.c && d.r === p.r)
            if (!dock || !p.load.length) return
            const good = p.load.filter((q) => q.shape === dock.shape)
            if (!good.length) return pop(g, 'Otro andén', p.c, p.r)
            let pts = 0
            for (const q of good) {
                pts += 10 * g.combo + Math.ceil(q.left)
                g.combo = Math.min(6, g.combo + 1)
                g.delivered += 1
            }
            // Dos de una sola vuelta: premio doble.
            if (good.length > 1) pts *= 2
            g.score += pts
            p.load = p.load.filter((q) => q.shape !== dock.shape)
            pop(g, `+${pts}${good.length > 1 ? ' DOBLE' : g.combo > 2 ? ` ×${g.combo - 1}` : ''}`, p.c, p.r)
            burst(g, p.c, p.r, good.length > 1 ? 26 : 14)
            if (Math.floor(g.delivered / 4) + 1 > g.level) {
                g.level = Math.floor(g.delivered / 4) + 1
                pop(g, `Nivel ${g.level}`, 7.5, 4)
                level(g)
            }
            sync()
        }

        const nextStep = (g) => {
            const p = g.p
            let target = null
            if (g.path.length) target = g.path.shift()
            else {
                const k = g.held[g.held.length - 1]
                if (k) {
                    const [dc, dr] = DIRS[k]
                    p.dir = k
                    if (free(p.c + dc, p.r + dr)) target = [p.c + dc, p.r + dr]
                }
            }
            if (!target) return
            const dc = target[0] - p.c
            const dr = target[1] - p.r
            p.dir = dc > 0 ? 'right' : dc < 0 ? 'left' : dr > 0 ? 'down' : 'up'
            p.to = target
        }

        const update = (g, dt) => {
            g.t += dt
            g.flash = Math.max(0, g.flash - dt)
            const p = g.p
            p.invul = Math.max(0, p.invul - dt)
            p.turbo = Math.max(0, p.turbo - dt)
            p.dash = Math.max(0, p.dash - dt)
            p.cool = Math.max(0, p.cool - dt)
            g.shake = Math.max(0, g.shake - dt)
            // Montacargas: avanza de casilla en casilla.
            if (!p.to) nextStep(g)
            if (p.to) {
                const speed = SPEED * (p.turbo ? 1.5 : 1) * (p.dash ? 2.1 : 1) * dt
                const dx = p.to[0] - p.x
                const dy = p.to[1] - p.y
                const d = Math.hypot(dx, dy)
                if (d <= speed) {
                    p.x = p.c = p.to[0]
                    p.y = p.r = p.to[1]
                    p.to = null
                    arrive(g)
                    if (!g.playing) return
                    nextStep(g)
                } else {
                    p.x += (dx / d) * speed
                    p.y += (dy / d) * speed
                }
            }
            // Pedidos: el tiempo corre también mientras se llevan.
            g.spawn -= dt
            if (g.spawn <= 0) {
                spawnPallet(g)
                g.spawn = Math.max(1.1, 3.2 - g.level * 0.3)
            }
            // Rayo de turbo de vez en cuando, en una casilla libre.
            g.boostIn -= dt
            if (g.boost) {
                g.boost.left -= dt
                if (g.boost.left <= 0) g.boost = null
            } else if (g.boostIn <= 0) {
                g.boostIn = 10 + Math.random() * 6
                for (let k = 0; k < 30; k++) {
                    const c = Math.floor(Math.random() * 14)
                    const r = Math.floor(Math.random() * ROWS)
                    if (free(c, r) && !isDock(c, r) && !g.pallets.some((q) => q.c === c && q.r === r)) {
                        g.boost = { c, r, left: 7 }
                        break
                    }
                }
            }
            for (let i = g.pallets.length - 1; i >= 0; i--) {
                const q = g.pallets[i]
                q.left -= dt
                if (q.left <= 0) {
                    g.pallets.splice(i, 1)
                    hurt(g, 'Pedido perdido', q.c, q.r)
                    sync()
                    if (!g.playing) return
                }
            }
            for (const q of [...p.load]) {
                q.left -= dt
                if (q.left <= 0) {
                    p.load = p.load.filter((x) => x !== q)
                    hurt(g, 'Se venció', p.x, p.y)
                    sync()
                    if (!g.playing) return
                }
            }
            // Operarios: van y vienen; chocar con uno cuesta una vida y la carga.
            const speedW = 2 + g.level * 0.3
            for (const wk of g.workers) {
                wk.pos += wk.dir * speedW * dt
                if (wk.pos <= wk.from || wk.pos >= wk.to) {
                    wk.pos = Math.min(wk.to, Math.max(wk.from, wk.pos))
                    wk.dir *= -1
                }
                const wx = wk.axis === 'r' ? wk.fixed : wk.pos
                const wy = wk.axis === 'r' ? wk.pos : wk.fixed
                if (!p.invul && !p.dash && Math.hypot(wx - p.x, wy - p.y) < 0.62) {
                    p.invul = 1.6
                    p.load = []
                    hurt(g, '¡Cuidado!', p.x, p.y)
                    sync()
                    if (!g.playing) return
                }
            }
            for (const f of g.fx) f.t += dt
            g.fx = g.fx.filter((f) => f.t < 1.1)
            for (const k of g.sparks) {
                k.t += dt
                k.x += k.vx * dt
                k.y += k.vy * dt
                k.vx *= 0.92
                k.vy *= 0.92
            }
            g.sparks = g.sparks.filter((k) => k.t < 0.6)
        }

        const draw = () => {
            const g = game.current
            ctx.setTransform(ctx.getTransform().a, 0, 0, ctx.getTransform().d, 0, 0)
            ctx.clearRect(0, 0, w, h)
            ctx.fillStyle = '#fff'
            ctx.fillRect(0, 0, w, h)
            if (g.shake > 0) ctx.translate((Math.random() - 0.5) * 10 * g.shake * 3, (Math.random() - 0.5) * 10 * g.shake * 3)
            // Piso con cuadrícula y franja de andenes.
            ctx.fillStyle = '#f4f4f4'
            ctx.fillRect(ox, oy, cell * COLS, cell * ROWS)
            ctx.fillStyle = '#e6e6e6'
            ctx.fillRect(ox + cell * 14, oy, cell * 2, cell * ROWS)
            ctx.strokeStyle = '#e2e2e2'
            ctx.lineWidth = 1
            for (let c = 0; c <= COLS; c++) {
                ctx.beginPath()
                ctx.moveTo(ox + c * cell + 0.5, oy)
                ctx.lineTo(ox + c * cell + 0.5, oy + ROWS * cell)
                ctx.stroke()
            }
            for (let r = 0; r <= ROWS; r++) {
                ctx.beginPath()
                ctx.moveTo(ox, oy + r * cell + 0.5)
                ctx.lineTo(ox + COLS * cell, oy + r * cell + 0.5)
                ctx.stroke()
            }
            ctx.strokeStyle = '#000'
            ctx.lineWidth = 2
            ctx.strokeRect(ox, oy, cell * COLS, cell * ROWS)
            // Estantes.
            for (const k of RACKS) {
                const [c, r] = k.split(',').map(Number)
                ctx.fillStyle = '#3b3b3b'
                ctx.fillRect(ox + c * cell + 1, oy + r * cell + 3, cell - 2, cell - 6)
                ctx.fillStyle = '#767676'
                ctx.fillRect(ox + c * cell + 3, oy + r * cell + cell * 0.45, cell - 6, 2)
            }
            const load = g.p?.load || []
            // Andenes: el de la figura que se lleva parpadea.
            for (const d of DOCKS) {
                const on = load.some((q) => q.shape === d.shape)
                const blink = on && Math.floor(performance.now() / 250) % 2 === 0
                ctx.fillStyle = blink ? '#000' : '#fff'
                ctx.strokeStyle = '#000'
                ctx.lineWidth = 2
                ctx.fillRect(ox + d.c * cell + 2, oy + d.r * cell + 2, cell - 4, cell - 4)
                ctx.strokeRect(ox + d.c * cell + 2, oy + d.r * cell + 2, cell - 4, cell - 4)
                shapePath(ctx, d.shape, px(d.c), py(d.r), cell * 0.42)
                ctx.strokeStyle = blink ? '#fff' : '#000'
                ctx.stroke()
            }
            if (!g.playing && !g.over) return
            // Camino del clic.
            if (g.path?.length) {
                ctx.strokeStyle = '#9a9a9a'
                ctx.setLineDash([3, 4])
                ctx.lineWidth = 2
                ctx.beginPath()
                ctx.moveTo(px(g.p.x), py(g.p.y))
                for (const [c, r] of g.path) ctx.lineTo(px(c), py(r))
                ctx.stroke()
                ctx.setLineDash([])
            }
            // Rayo de turbo.
            if (g.boost) {
                const x = px(g.boost.c)
                const y = py(g.boost.r)
                const pulse = 1 + Math.sin(performance.now() / 120) * 0.12
                ctx.fillStyle = '#000'
                ctx.beginPath()
                const s = cell * 0.36 * pulse
                ctx.moveTo(x + s * 0.2, y - s)
                ctx.lineTo(x - s * 0.6, y + s * 0.15)
                ctx.lineTo(x - s * 0.05, y + s * 0.15)
                ctx.lineTo(x - s * 0.2, y + s)
                ctx.lineTo(x + s * 0.6, y - s * 0.15)
                ctx.lineTo(x + s * 0.05, y - s * 0.15)
                ctx.closePath()
                ctx.fill()
            }
            // Tarimas con su tiempo.
            for (const q of g.pallets) {
                const x = px(q.c)
                const y = py(q.r)
                const urgent = q.left < 3 && Math.floor(performance.now() / 160) % 2 === 0
                ctx.fillStyle = '#b8b8b8'
                ctx.fillRect(x - cell * 0.38, y - cell * 0.3, cell * 0.76, cell * 0.6)
                ctx.fillStyle = '#fff'
                shapePath(ctx, q.shape, x, y, cell * 0.36)
                ctx.fill()
                ctx.strokeStyle = '#000'
                ctx.lineWidth = 1.6
                ctx.stroke()
                ctx.beginPath()
                ctx.arc(x, y, cell * 0.46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (q.left / q.life))
                ctx.strokeStyle = urgent ? '#000' : '#555'
                ctx.lineWidth = urgent ? 3 : 2
                ctx.stroke()
            }
            // Operarios con casco.
            for (const wk of g.workers) {
                const x = px(wk.axis === 'r' ? wk.fixed : wk.pos)
                const y = py(wk.axis === 'r' ? wk.pos : wk.fixed)
                ctx.fillStyle = '#767676'
                ctx.beginPath()
                ctx.arc(x, y + cell * 0.08, cell * 0.24, 0, Math.PI * 2)
                ctx.fill()
                ctx.fillStyle = '#000'
                ctx.beginPath()
                ctx.arc(x, y - cell * 0.06, cell * 0.2, Math.PI, 0)
                ctx.fill()
                ctx.fillRect(x - cell * 0.26, y - cell * 0.07, cell * 0.52, cell * 0.06)
            }
            // Montacargas (con estela cuando va rápido).
            const p = g.p
            if (p.turbo || p.dash) {
                ctx.strokeStyle = p.dash ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.22)'
                ctx.lineWidth = cell * 0.5
                ctx.lineCap = 'round'
                const [dx, dy] = DIRS[p.dir]
                ctx.beginPath()
                ctx.moveTo(px(p.x) - dx * cell * 0.3, py(p.y) - dy * cell * 0.3)
                ctx.lineTo(px(p.x) - dx * cell * 1.3, py(p.y) - dy * cell * 1.3)
                ctx.stroke()
                ctx.lineCap = 'butt'
            }
            const blinkInv = p.invul > 0 && Math.floor(performance.now() / 110) % 2 === 0
            if (!blinkInv) {
                const x = px(p.x)
                const y = py(p.y)
                const ang = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[p.dir]
                ctx.save()
                ctx.translate(x, y)
                ctx.rotate(ang)
                const s = cell
                ctx.fillStyle = '#000'
                ctx.fillRect(-s * 0.36, -s * 0.28, s * 0.5, s * 0.56)
                ctx.fillStyle = '#fff'
                ctx.fillRect(-s * 0.28, -s * 0.18, s * 0.2, s * 0.36)
                ctx.fillStyle = '#000'
                ctx.fillRect(s * 0.14, -s * 0.22, s * 0.3, s * 0.07)
                ctx.fillRect(s * 0.14, s * 0.15, s * 0.3, s * 0.07)
                if (p.load.length) {
                    ctx.fillStyle = '#b8b8b8'
                    ctx.fillRect(s * 0.12, -s * 0.24, s * 0.34, s * 0.48)
                    ctx.rotate(-ang)
                    p.load.forEach((q, k) => {
                        const off = p.load.length > 1 ? (k ? 0.12 : -0.12) * s : 0
                        const cx = Math.cos(ang) * s * 0.29 - Math.sin(ang) * off
                        const cy = Math.sin(ang) * s * 0.29 + Math.cos(ang) * off
                        ctx.fillStyle = '#fff'
                        shapePath(ctx, q.shape, cx, cy, s * (p.load.length > 1 ? 0.18 : 0.24))
                        ctx.fill()
                        ctx.strokeStyle = '#000'
                        ctx.lineWidth = 1.4
                        ctx.stroke()
                    })
                }
                ctx.restore()
            }
            // Chispas de cada entrega.
            for (const k of g.sparks) {
                ctx.globalAlpha = Math.max(0, 1 - k.t / 0.6)
                ctx.fillStyle = '#000'
                ctx.fillRect(px(k.x) - 2, py(k.y) - 2, 4, 4)
            }
            ctx.globalAlpha = 1
            // Mensajes que suben.
            ctx.textAlign = 'center'
            ctx.font = `800 ${Math.max(11, cell * 0.45)}px Archivo, system-ui, sans-serif`
            for (const f of g.fx) {
                ctx.globalAlpha = Math.max(0, 1 - f.t)
                ctx.fillStyle = '#000'
                ctx.fillText(f.text, px(f.x), py(f.y) - f.t * cell * 1.2)
            }
            ctx.globalAlpha = 1
            if (g.flash > 0) {
                ctx.fillStyle = `rgba(0,0,0,${g.flash * 0.5})`
                ctx.fillRect(0, 0, w, h)
            }
        }

        const end = (g) => {
            g.playing = false
            g.over = true
            dirty = true
            setHud((s) => {
                const best = Math.max(s.best, g.score)
                if (best > s.best) saveBest(best)
                return { ...s, playing: false, paused: false, over: true, score: g.score, lives: 0, level: g.level, best }
            })
        }

        const step = (now) => {
            raf = requestAnimationFrame(step)
            const dt = Math.min((now - last) / 1000, 0.05)
            last = now
            const g = game.current
            if (g.playing && !g.paused) {
                update(g, dt)
                draw()
            } else if (dirty) {
                draw()
                dirty = false
            }
        }

        const togglePause = (force) => {
            const g = game.current
            if (!g.playing) return
            g.paused = force ?? !g.paused
            g.held = []
            dirty = true
            sync()
        }
        game.current.togglePause = togglePause

        const keyDir = (k) => ({ arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' })[k]
        const onDown = (e) => {
            const g = game.current
            const k = e.key.toLowerCase()
            if (k === 'p' || k === 'escape') {
                if (g.playing) {
                    e.preventDefault()
                    togglePause()
                }
                return
            }
            if (k === ' ' && g.playing && !g.paused) {
                e.preventDefault()
                if (!g.p.cool) {
                    g.p.dash = 0.45
                    g.p.cool = 2.2
                }
                return
            }
            const dir = keyDir(k)
            if (!dir || !g.playing) return
            e.preventDefault()
            g.path = []
            if (!g.held.includes(dir)) g.held.push(dir)
        }
        const onUp = (e) => {
            const g = game.current
            const dir = keyDir(e.key.toLowerCase())
            if (dir && g.held) g.held = g.held.filter((d) => d !== dir)
        }
        const onClick = (e) => {
            const g = game.current
            if (!g.playing || g.paused) return
            const r = el.getBoundingClientRect()
            const c = Math.floor((e.clientX - r.left - ox) / cell)
            const rr = Math.floor((e.clientY - r.top - oy) / cell)
            const from = g.p.to || [g.p.c, g.p.r]
            const path = bfs(from, [c, rr])
            if (path) g.path = path
        }
        const onVis = () => document.hidden && togglePause(true)
        const onBlur = () => togglePause(true)

        el.addEventListener('keydown', onDown)
        el.addEventListener('keyup', onUp)
        el.addEventListener('pointerdown', onClick)
        el.addEventListener('blur', onBlur)
        document.addEventListener('visibilitychange', onVis)
        raf = requestAnimationFrame(step)

        return () => {
            cancelAnimationFrame(raf)
            ro.disconnect()
            el.removeEventListener('keydown', onDown)
            el.removeEventListener('keyup', onUp)
            el.removeEventListener('pointerdown', onClick)
            el.removeEventListener('blur', onBlur)
            document.removeEventListener('visibilitychange', onVis)
        }
    }, [])

    const start = () => {
        const tp = game.current.togglePause
        game.current = Object.assign(newGame(), { togglePause: tp })
        const g = game.current
        g.workers = [
            { ...PATROLS[0], pos: 6, dir: -1 },
            { ...PATROLS[1], pos: 2, dir: 1 },
        ]
        setHud((s) => ({ ...s, playing: true, paused: false, over: false, score: 0, lives: 3, level: 1, combo: 1 }))
        host.current.focus({ preventScroll: true })
    }

    const resume = () => {
        game.current.togglePause?.(false)
        host.current.focus({ preventScroll: true })
    }

    return (
        <div className="wgame">
            <div className="wgame-bar">
                <span className="wgame-stats num">
                    <b>{hud.score}</b> pts
                    <span>Nivel {hud.level}</span>
                    {hud.combo > 1 && <span className="wgame-combo">×{hud.combo}</span>}
                    <span className="wgame-lives" aria-label={`${hud.lives} vidas`}>
                        {Array.from({ length: 3 }, (_, i) => (
                            <i key={i} data-off={i >= hud.lives} />
                        ))}
                    </span>
                </span>
                {hud.playing && (
                    <button type="button" className="wgame-pause" onClick={() => (hud.paused ? resume() : game.current.togglePause?.(true))} aria-label={hud.paused ? 'Seguir' : 'Pausa'}>
                        {hud.paused ? '▶ Seguir' : 'Ⅱ Pausa'}
                    </button>
                )}
            </div>
            <div ref={host} className="wgame-field" tabIndex={0} aria-label="Minijuego del montacargas: flechas o WASD para manejar, Espacio para acelerar, clic para ir a una casilla, P para pausar">
                <canvas ref={canvas} />
                {!hud.playing && (
                    <button type="button" className="wgame-start" onClick={start}>
                        <strong>{hud.over ? `${hud.score} puntos · nivel ${hud.level}` : label}</strong>
                        <span className="small">
                            {hud.over ? `Récord: ${hud.best}. Clic para otra ronda.` : 'Lleva las tarimas al andén de su figura (○ □ △) antes de que se venzan. Cargas dos a la vez: entrégalas juntas y vale doble. Esquiva a los operarios.'}
                        </span>
                        {!hud.over && <span className="wgame-keys small">Flechas o WASD · Espacio acelera · clic para ir · P pausa</span>}
                    </button>
                )}
                {hud.playing && hud.paused && (
                    <button type="button" className="wgame-start" onClick={resume}>
                        <strong>En pausa</strong>
                        <span className="small">Clic o P para seguir.</span>
                    </button>
                )}
            </div>
        </div>
    )
}
