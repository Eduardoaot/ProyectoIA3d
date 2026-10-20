import { useEffect, useRef, useState } from 'react'

const BEST_KEY = 'cauce-pacman-record'

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

/* Pac-Man en la nave: el montacargas recorre los pasillos entre estantes juntando piezas (◆).
   Cuatro inspectores lo persiguen, cada uno a su modo (como los fantasmas del original):
   uno va directo, otro se adelanta, otro le corta el paso con el primero y otro se acerca y
   se aleja. Las tuercas grandes los asustan unos segundos: entonces se los puede atrapar y
   vuelven a la oficina. Por el pasillo del medio se sale por un lado y se entra por el otro.
   Flechas o WASD (o clic hacia donde ir), P o Esc para pausar. */

// # estante · . pieza · o tuerca · - puerta de la oficina · G oficina · P salida del montacargas
const MAZE = [
    '#######################',
    '#o.........#.........o#',
    '#.###.####.#.####.###.#',
    '#.....................#',
    '#.###.#.###-###.#.###.#',
    '#.....#.#GGGGG#.#.....#',
    '......#.#GGGGG#.#......',
    '#.###.#.#######.#.###.#',
    '#.....#....P....#.....#',
    '#.###.####.#.####.###.#',
    '#o..#......#......#..o#',
    '#.....................#',
    '#######################',
]
const ROWS = MAZE.length
const COLS = MAZE[0].length
const TUNNEL = 6
const DOOR = [11, 4]
const OUT = [11, 3] // casilla justo afuera de la oficina
const HOME = [11, 5] // donde revive un inspector atrapado
const START = [11, 8]
const BONUS_AT = 60 // piezas comidas para que aparezca la tarima de bono

const DIRS = { up: [0, -1], left: [-1, 0], down: [0, 1], right: [1, 0] }
const ORDER = ['up', 'left', 'down', 'right'] // desempate, como en el original
const BACK = { up: 'down', down: 'up', left: 'right', right: 'left' }
// Dispersión y persecución se alternan; al final solo persiguen.
const PHASES = [
    ['scatter', 6],
    ['chase', 18],
    ['scatter', 5],
    ['chase', 20],
    ['scatter', 4],
    ['chase', Infinity],
]

const GHOSTS = [
    { id: 'directo', mark: 'circ', shade: '#000', corner: [COLS - 2, -2], start: OUT, wait: 0 },
    { id: 'adelantado', mark: 'cuad', shade: '#3b3b3b', corner: [1, -2], start: [11, 6], wait: 2 },
    { id: 'cortador', mark: 'tri', shade: '#5a5a5a', corner: [COLS - 1, ROWS], start: [10, 6], wait: 5 },
    { id: 'timido', mark: 'cruz', shade: '#767676', corner: [0, ROWS], start: [12, 6], wait: 8 },
]

const cellAt = (c, r) => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? MAZE[r][c] : r === TUNNEL ? ' ' : '#')
const key = (c, r) => `${c},${r}`

// ¿Se puede pasar? La puerta y la oficina solo para los inspectores que salen o vuelven.
function open(c, r, inside = false) {
    const t = cellAt(c, r)
    if (t === '#') return false
    if (t === '-' || t === 'G') return inside
    return true
}

function wrap(e) {
    if (e.c < 0) e.c = e.x = COLS - 1
    else if (e.c >= COLS) e.c = e.x = 0
}

/* Siguiente paso del camino más corto (para los ojos que vuelven a la oficina). */
function stepToward(from, to) {
    const goal = key(...to)
    const prev = new Map([[key(...from), null]])
    const q = [from]
    while (q.length) {
        const [c, r] = q.shift()
        if (key(c, r) === goal) {
            let k = goal
            while (prev.get(k) && prev.get(k) !== key(...from)) k = prev.get(k)
            return k.split(',').map(Number)
        }
        for (const d of ORDER) {
            const n = [c + DIRS[d][0], r + DIRS[d][1]]
            if (n[0] < 0 || n[0] >= COLS || !open(n[0], n[1], true) || prev.has(key(...n))) continue
            prev.set(key(...n), key(c, r))
            q.push(n)
        }
    }
    return null
}

function dirTo(from, to) {
    const dc = to[0] - from[0]
    const dr = to[1] - from[1]
    return dc > 0 ? 'right' : dc < 0 ? 'left' : dr > 0 ? 'down' : 'up'
}

function newDots() {
    const dots = new Map()
    MAZE.forEach((row, r) => [...row].forEach((t, c) => (t === '.' || t === 'o') && dots.set(key(c, r), t === 'o' ? 'power' : 'dot')))
    return dots
}

function placeActors(g) {
    g.p = { c: START[0], r: START[1], x: START[0], y: START[1], to: null, dir: 'left', want: 'left', mouth: 0 }
    g.ghosts = GHOSTS.map((d) => ({
        ...d,
        c: d.start[0],
        r: d.start[1],
        x: d.start[0],
        y: d.start[1],
        to: null,
        dir: 'left',
        state: d.wait === 0 ? 'out' : 'house',
        left: d.wait,
        path: [],
    }))
    g.phase = 0
    g.phaseLeft = PHASES[0][1]
    g.fright = 0
    g.chain = 0
    g.ready = 1.6
}

function newGame() {
    const g = { playing: true, paused: false, over: false, score: 0, lives: 3, level: 1, eaten: 0, dots: newDots(), bonus: null, fx: [], flash: 0, dying: 0 }
    placeActors(g)
    return g
}

function shapePath(ctx, shape, x, y, s) {
    ctx.beginPath()
    if (shape === 'circ') ctx.arc(x, y, s * 0.5, 0, Math.PI * 2)
    else if (shape === 'cuad') ctx.rect(x - s * 0.42, y - s * 0.42, s * 0.84, s * 0.84)
    else if (shape === 'tri') {
        ctx.moveTo(x, y - s * 0.52)
        ctx.lineTo(x + s * 0.55, y + s * 0.42)
        ctx.lineTo(x - s * 0.55, y + s * 0.42)
        ctx.closePath()
    } else {
        ctx.moveTo(x - s * 0.4, y - s * 0.4)
        ctx.lineTo(x + s * 0.4, y + s * 0.4)
        ctx.moveTo(x + s * 0.4, y - s * 0.4)
        ctx.lineTo(x - s * 0.4, y + s * 0.4)
    }
}

export default function LoadingGame({ label = 'Juega mientras la IA lee' }) {
    const host = useRef(null)
    const canvas = useRef(null)
    const game = useRef(null)
    const [hud, setHud] = useState({ playing: false, paused: false, over: false, score: 0, lives: 3, level: 1, best: readBest() })

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
            setHud((s) => ({ ...s, playing: g.playing, paused: g.paused, score: g.score, lives: g.lives, level: g.level }))
        }

        const px = (c) => ox + (c + 0.5) * cell
        const py = (r) => oy + (r + 0.5) * cell
        const pop = (g, text, c, r) => g.fx.push({ text, x: c, y: r, t: 0 })

        const speeds = (g) => {
            const up = Math.min(g.level - 1, 6) * 0.25
            return { pac: 5.6 + up, ghost: 5.1 + up, fright: 3.2, eyes: 11, house: 3, tunnel: 3 }
        }

        /* Avanza una entidad hacia `to`; al llegar devuelve true (está en el centro de su casilla). */
        const advance = (e, v) => {
            const dx = e.to[0] - e.x
            const dy = e.to[1] - e.y
            const d = Math.abs(dx) + Math.abs(dy)
            if (d <= v) {
                e.x = e.c = e.to[0]
                e.y = e.r = e.to[1]
                e.to = null
                wrap(e)
                return v - d
            }
            e.x += Math.sign(dx) * v
            e.y += Math.sign(dy) * v
            return -1
        }

        const eat = (g) => {
            const k = key(g.p.c, g.p.r)
            const t = g.dots.get(k)
            if (t) {
                g.dots.delete(k)
                g.eaten += 1
                if (t === 'power') {
                    g.score += 50
                    g.fright = Math.max(2, 7 - g.level)
                    g.chain = 0
                    for (const gh of g.ghosts) {
                        if (gh.state === 'out') {
                            gh.scared = true
                            // Al asustarse dan media vuelta, como en el original.
                            if (gh.to) {
                                ;[gh.to, gh.c, gh.r] = [[gh.c, gh.r], gh.to[0], gh.to[1]]
                                gh.dir = BACK[gh.dir]
                            }
                        }
                    }
                } else g.score += 10
                if (g.eaten === BONUS_AT) g.bonus = { c: START[0], r: START[1], left: 9 }
                if (!g.dots.size) {
                    g.level += 1
                    g.dots = newDots()
                    g.eaten = 0
                    g.bonus = null
                    g.flash = 0.4
                    placeActors(g)
                    pop(g, `Nivel ${g.level}`, 11, 6)
                }
                sync()
            }
            if (g.bonus && g.bonus.c === g.p.c && g.bonus.r === g.p.r) {
                const pts = 100 * g.level
                g.score += pts
                pop(g, `+${pts}`, g.p.c, g.p.r)
                g.bonus = null
                sync()
            }
        }

        const movePac = (g, dt) => {
            const p = g.p
            const v = speeds(g).pac
            let left = v * dt
            // Media vuelta inmediata, aunque vaya entre dos casillas.
            if (p.to && p.want === BACK[p.dir]) {
                ;[p.to, p.c, p.r] = [[p.c, p.r], p.to[0], p.to[1]]
                p.dir = p.want
            }
            for (let guard = 0; guard < 3 && left > 0; guard++) {
                if (!p.to) {
                    const pick = [p.want, p.dir].find((d) => open(p.c + DIRS[d][0], p.r + DIRS[d][1]))
                    if (!pick) return
                    p.dir = pick
                    p.to = [p.c + DIRS[pick][0], p.r + DIRS[pick][1]]
                }
                const rest = advance(p, left)
                if (rest < 0) break
                left = rest
                eat(g)
                // Si se acabó el nivel, todo se reacomodó: este montacargas ya no es el del juego.
                if (!g.playing || g.p !== p) return
            }
            p.mouth += dt * 14
        }

        const target = (g, gh) => {
            const p = g.p
            const [dc, dr] = DIRS[p.dir]
            if (gh.scared) return null
            if (PHASES[g.phase][0] === 'scatter') return gh.corner
            if (gh.id === 'adelantado') return [p.c + dc * 4, p.r + dr * 4]
            if (gh.id === 'cortador') {
                const b = g.ghosts[0]
                const a = [p.c + dc * 2, p.r + dr * 2]
                return [a[0] * 2 - b.c, a[1] * 2 - b.r]
            }
            if (gh.id === 'timido' && Math.hypot(gh.c - p.c, gh.r - p.r) < 6) return gh.corner
            return [p.c, p.r]
        }

        const chooseDir = (g, gh) => {
            const opts = ORDER.filter((d) => d !== BACK[gh.dir] && open(gh.c + DIRS[d][0], gh.r + DIRS[d][1]))
            if (!opts.length) return BACK[gh.dir]
            const t = target(g, gh)
            if (!t) return opts[Math.floor(Math.random() * opts.length)]
            let best = opts[0]
            let bd = Infinity
            for (const d of opts) {
                const n = [gh.c + DIRS[d][0], gh.r + DIRS[d][1]]
                const dd = (n[0] - t[0]) ** 2 + (n[1] - t[1]) ** 2
                if (dd < bd) {
                    bd = dd
                    best = d
                }
            }
            return best
        }

        const moveGhost = (g, gh, dt) => {
            const sp = speeds(g)
            if (gh.state === 'house') {
                gh.left -= dt
                if (gh.left <= 0) {
                    gh.state = 'leaving'
                    gh.path = [...(gh.c !== HOME[0] ? [[HOME[0], gh.r]] : []), HOME, DOOR, OUT].filter((q, i, a) => !(q[0] === gh.c && q[1] === gh.r) && (i === 0 || key(...q) !== key(...a[i - 1])))
                }
                return
            }
            const v = gh.state === 'eyes' ? sp.eyes : gh.state === 'leaving' ? sp.house : gh.scared ? sp.fright : gh.r === TUNNEL && (gh.c < 5 || gh.c > COLS - 6) ? sp.tunnel : sp.ghost
            let left = v * dt
            for (let guard = 0; guard < 3 && left > 0; guard++) {
                if (!gh.to) {
                    if (gh.state === 'leaving' || gh.state === 'entering') {
                        if (!gh.path.length) {
                            if (gh.state === 'entering') {
                                gh.state = 'leaving'
                                gh.path = [DOOR, OUT]
                                continue
                            }
                            gh.state = 'out'
                            gh.scared = false
                            gh.dir = 'left'
                        } else {
                            gh.to = gh.path.shift()
                            gh.dir = dirTo([gh.c, gh.r], gh.to)
                        }
                    } else if (gh.state === 'eyes') {
                        if (gh.c === OUT[0] && gh.r === OUT[1]) {
                            gh.state = 'entering'
                            gh.path = [DOOR, HOME]
                            continue
                        }
                        const n = stepToward([gh.c, gh.r], OUT)
                        if (!n) return
                        gh.dir = dirTo([gh.c, gh.r], n)
                        gh.to = n
                    }
                    if (gh.state === 'out' && !gh.to) {
                        gh.dir = chooseDir(g, gh)
                        gh.to = [gh.c + DIRS[gh.dir][0], gh.r + DIRS[gh.dir][1]]
                    }
                }
                const rest = advance(gh, left)
                if (rest < 0) break
                left = rest
            }
        }

        const hit = (g) => {
            const p = g.p
            for (const gh of g.ghosts) {
                if (gh.state !== 'out' || Math.abs(gh.x - p.x) + Math.abs(gh.y - p.y) > 0.7) continue
                if (gh.scared) {
                    g.chain += 1
                    const pts = 200 * 2 ** (g.chain - 1)
                    g.score += pts
                    pop(g, `+${pts}`, gh.x, gh.y)
                    gh.state = 'eyes'
                    gh.scared = false
                    sync()
                } else {
                    g.lives -= 1
                    g.dying = 1.1
                    g.flash = 0.35
                    sync()
                    return
                }
            }
        }

        const update = (g, dt) => {
            g.flash = Math.max(0, g.flash - dt)
            for (const f of g.fx) f.t += dt
            g.fx = g.fx.filter((f) => f.t < 1.1)
            // Atrapado: una pausa corta y se reacomoda todo (o se acaba la partida).
            if (g.dying > 0) {
                g.dying -= dt
                if (g.dying <= 0) {
                    if (g.lives <= 0) return end(g)
                    placeActors(g)
                }
                return
            }
            if (g.ready > 0) {
                g.ready -= dt
                return
            }
            if (g.fright > 0) {
                g.fright -= dt
                if (g.fright <= 0) for (const gh of g.ghosts) gh.scared = false
            } else {
                g.phaseLeft -= dt
                if (g.phaseLeft <= 0 && g.phase < PHASES.length - 1) {
                    g.phase += 1
                    g.phaseLeft = PHASES[g.phase][1]
                    for (const gh of g.ghosts) {
                        if (gh.state === 'out' && gh.to) {
                            ;[gh.to, gh.c, gh.r] = [[gh.c, gh.r], gh.to[0], gh.to[1]]
                            gh.dir = BACK[gh.dir]
                        }
                    }
                }
            }
            if (g.bonus) {
                g.bonus.left -= dt
                if (g.bonus.left <= 0) g.bonus = null
            }
            movePac(g, dt)
            if (!g.playing) return
            hit(g)
            if (g.dying > 0) return
            for (const gh of g.ghosts) moveGhost(g, gh, dt)
            hit(g)
        }

        const drawGhost = (g, gh) => {
            const x = px(gh.x)
            const y = py(gh.y)
            const s = cell * 0.42
            const t = performance.now() / 120
            const [dc, dr] = DIRS[gh.dir]
            if (gh.state !== 'eyes') {
                const ending = gh.scared && g.fright < 2 && Math.floor(performance.now() / 180) % 2 === 0
                ctx.beginPath()
                ctx.arc(x, y - s * 0.15, s, Math.PI, 0)
                ctx.lineTo(x + s, y + s * 0.85)
                // Falda en ondas que se mueven: el bata del inspector.
                for (let k = 0; k <= 4; k++) {
                    const fx = x + s - (k * s * 2) / 4
                    const fy = y + s * (k % 2 === Math.floor(t) % 2 ? 0.85 : 0.55)
                    ctx.lineTo(fx, fy)
                }
                ctx.closePath()
                ctx.fillStyle = gh.scared ? (ending ? '#c2c2c2' : '#fff') : gh.shade
                ctx.fill()
                if (gh.scared) {
                    ctx.strokeStyle = '#000'
                    ctx.lineWidth = 2
                    ctx.stroke()
                    // Cara de susto: ojos chicos y boca en zigzag.
                    ctx.fillStyle = '#000'
                    ctx.fillRect(x - s * 0.42, y - s * 0.4, s * 0.22, s * 0.22)
                    ctx.fillRect(x + s * 0.2, y - s * 0.4, s * 0.22, s * 0.22)
                    ctx.beginPath()
                    for (let k = 0; k <= 4; k++) ctx.lineTo(x - s * 0.5 + (k * s) / 4, y + s * (k % 2 ? 0.1 : 0.3))
                    ctx.lineWidth = 1.6
                    ctx.stroke()
                    return
                }
                // Su figura en la frente, para distinguirlos.
                shapePath(ctx, gh.mark, x, y + s * 0.42, s * 0.42)
                ctx.strokeStyle = '#fff'
                ctx.lineWidth = 1.6
                ctx.stroke()
            }
            // Ojos que miran hacia donde va.
            for (const side of [-1, 1]) {
                const ex = x + side * s * 0.38
                const ey = y - s * 0.25
                ctx.fillStyle = '#fff'
                ctx.beginPath()
                ctx.arc(ex, ey, s * 0.27, 0, Math.PI * 2)
                ctx.fill()
                ctx.strokeStyle = '#000'
                ctx.lineWidth = 1.2
                ctx.stroke()
                ctx.fillStyle = '#000'
                ctx.beginPath()
                ctx.arc(ex + dc * s * 0.12, ey + dr * s * 0.12, s * 0.12, 0, Math.PI * 2)
                ctx.fill()
            }
        }

        const drawPac = (g) => {
            const p = g.p
            const x = px(p.x)
            const y = py(p.y)
            const s = cell * 0.42
            const ang = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[p.dir]
            // Al ser atrapado, la boca se abre hasta desaparecer.
            const open_ = g.dying > 0 ? Math.PI * (1 - g.dying / 1.1) : (Math.abs(Math.sin(p.mouth)) * 0.7 + 0.05) * (Math.PI / 4)
            ctx.save()
            ctx.translate(x, y)
            ctx.rotate(ang)
            ctx.fillStyle = '#000'
            ctx.beginPath()
            ctx.moveTo(0, 0)
            ctx.arc(0, 0, s, open_, Math.PI * 2 - open_)
            ctx.closePath()
            ctx.fill()
            ctx.restore()
            if (g.dying > 0) return
            // Casco de obra: siempre arriba, aunque el cuerpo gire.
            ctx.fillStyle = '#fff'
            ctx.strokeStyle = '#000'
            ctx.lineWidth = 1.6
            ctx.beginPath()
            ctx.arc(x, y - s * 0.55, s * 0.5, Math.PI, 0)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = '#000'
            ctx.fillRect(x - s * 0.72, y - s * 0.6, s * 1.44, s * 0.14)
        }

        const draw = () => {
            const g = game.current
            ctx.clearRect(0, 0, w, h)
            ctx.fillStyle = '#fff'
            ctx.fillRect(0, 0, w, h)
            ctx.fillStyle = '#f4f4f4'
            ctx.fillRect(ox, oy, cell * COLS, cell * ROWS)
            // Estantes: bloques oscuros con la línea de cada repisa.
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    const t = MAZE[r][c]
                    const x = ox + c * cell
                    const y = oy + r * cell
                    if (t === '#') {
                        ctx.fillStyle = '#2b2b2b'
                        ctx.fillRect(x, y, cell, cell)
                        ctx.fillStyle = '#4a4a4a'
                        ctx.fillRect(x + 2, y + cell * 0.48, cell - 4, 1.5)
                    } else if (t === 'G') {
                        ctx.fillStyle = '#e6e6e6'
                        ctx.fillRect(x, y, cell, cell)
                    } else if (t === '-') {
                        ctx.fillStyle = '#000'
                        ctx.fillRect(x, y + cell * 0.42, cell, cell * 0.16)
                    }
                }
            }
            ctx.strokeStyle = '#000'
            ctx.lineWidth = 2
            ctx.strokeRect(ox, oy, cell * COLS, cell * ROWS)
            // Piezas (◆) y tuercas que laten.
            const dots = g.dots || newDots()
            const beat = 1 + Math.sin(performance.now() / 160) * 0.12
            for (const [k, t] of dots) {
                const [c, r] = k.split(',').map(Number)
                const x = px(c)
                const y = py(r)
                ctx.fillStyle = '#000'
                if (t === 'dot') {
                    const s = cell * 0.09
                    ctx.beginPath()
                    ctx.moveTo(x, y - s)
                    ctx.lineTo(x + s, y)
                    ctx.lineTo(x, y + s)
                    ctx.lineTo(x - s, y)
                    ctx.closePath()
                    ctx.fill()
                } else {
                    const s = cell * 0.3 * (g.playing ? beat : 1)
                    ctx.beginPath()
                    for (let i = 0; i < 6; i++) ctx.lineTo(x + Math.cos((i * Math.PI) / 3) * s, y + Math.sin((i * Math.PI) / 3) * s)
                    ctx.closePath()
                    ctx.fill()
                    ctx.fillStyle = '#f4f4f4'
                    ctx.beginPath()
                    ctx.arc(x, y, s * 0.42, 0, Math.PI * 2)
                    ctx.fill()
                }
            }
            if (!g.playing && !g.over) return
            // Tarima de bono.
            if (g.bonus) {
                const x = px(g.bonus.c)
                const y = py(g.bonus.r)
                const s = cell * 0.36
                ctx.fillStyle = '#767676'
                ctx.fillRect(x - s, y - s * 0.7, s * 2, s * 1.4)
                ctx.fillStyle = '#fff'
                for (let k = -1; k <= 1; k++) ctx.fillRect(x - s + 2, y + k * s * 0.42 - 1, s * 2 - 4, 2)
                ctx.strokeStyle = '#000'
                ctx.lineWidth = 1.5
                ctx.strokeRect(x - s, y - s * 0.7, s * 2, s * 1.4)
            }
            if (!(g.dying > 0 && g.dying < 0.8)) for (const gh of g.ghosts) drawGhost(g, gh)
            drawPac(g)
            if (g.ready > 0) {
                ctx.textAlign = 'center'
                ctx.font = `800 ${Math.max(12, cell * 0.6)}px Archivo, system-ui, sans-serif`
                ctx.fillStyle = '#000'
                ctx.fillText('¡LISTO!', px(11), py(START[1] - 1.5) + cell * 0.2)
            }
            ctx.textAlign = 'center'
            ctx.font = `800 ${Math.max(11, cell * 0.45)}px Archivo, system-ui, sans-serif`
            for (const f of g.fx) {
                ctx.globalAlpha = Math.max(0, 1 - f.t)
                ctx.fillStyle = '#000'
                ctx.fillText(f.text, px(f.x), py(f.y) - f.t * cell)
            }
            ctx.globalAlpha = 1
            if (g.flash > 0) {
                ctx.fillStyle = `rgba(0,0,0,${g.flash * 0.4})`
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
            const dir = keyDir(k)
            if (!dir || !g.playing) return
            e.preventDefault()
            g.p.want = dir
        }
        // Clic o toque: gira hacia ese lado (el eje en que el clic está más lejos).
        const onClick = (e) => {
            const g = game.current
            if (!g.playing || g.paused) return
            const r = el.getBoundingClientRect()
            const dx = e.clientX - r.left - px(g.p.x)
            const dy = e.clientY - r.top - py(g.p.y)
            g.p.want = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
        }
        const onVis = () => document.hidden && togglePause(true)
        const onBlur = () => togglePause(true)

        el.addEventListener('keydown', onDown)
        el.addEventListener('pointerdown', onClick)
        el.addEventListener('blur', onBlur)
        document.addEventListener('visibilitychange', onVis)
        raf = requestAnimationFrame(step)

        return () => {
            cancelAnimationFrame(raf)
            ro.disconnect()
            el.removeEventListener('keydown', onDown)
            el.removeEventListener('pointerdown', onClick)
            el.removeEventListener('blur', onBlur)
            document.removeEventListener('visibilitychange', onVis)
        }
    }, [])

    const start = () => {
        const tp = game.current.togglePause
        game.current = Object.assign(newGame(), { togglePause: tp })
        setHud((s) => ({ ...s, playing: true, paused: false, over: false, score: 0, lives: 3, level: 1 }))
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
            <div ref={host} className="wgame-field" tabIndex={0} aria-label="Minijuego tipo Pac-Man: flechas o WASD para moverte, clic hacia donde ir, P para pausar">
                <canvas ref={canvas} />
                {!hud.playing && (
                    <button type="button" className="wgame-start" onClick={start}>
                        <strong>{hud.over ? `${hud.score} puntos · nivel ${hud.level}` : label}</strong>
                        <span className="small">
                            {hud.over ? `Récord: ${hud.best}. Clic para otra ronda.` : 'Junta todas las piezas (◆) de la nave sin que te atrapen los inspectores. Con una tuerca grande se asustan: atrápalos para mandarlos a la oficina.'}
                        </span>
                        {!hud.over && <span className="wgame-keys small">Flechas o WASD · clic hacia donde ir · P pausa</span>}
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
