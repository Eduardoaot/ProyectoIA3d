import { useEffect, useRef, useState } from 'react'

const BEST_KEY = 'cauce-bloques-record'

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

/* Block puzzle: llegan cuatro piezas y hay que acomodarlas en la tarima de 8 × 8. Las piezas
   no giran ni caen: se arrastran a su lugar. Una fila o columna llena se despeja (como en el
   Tetris) y da segundos extra; despejar en jugadas seguidas sube el combo. Se acaba cuando
   el reloj llega a cero o ninguna pieza que queda cabe.
   Arrastrar con el ratón o el dedo; con teclado: 1-4 elige, flechas mueven, Enter coloca.
   P pausa, Esc suelta la pieza elegida (o pausa). */

const N = 8
const TRAY = 4
const START_TIME = 60 // segundos al empezar; también es el tope del reloj
const LINE_TIME = 3 // segundos que regala cada línea despejada
const COMBO_KEEP = 3 // jugadas seguidas sin despejar que aguanta el combo

// # es bloque, . es hueco.
const SHAPES = [
    ['#'],
    ['##'],
    ['#', '#'],
    ['###'],
    ['#', '#', '#'],
    ['####'],
    ['#', '#', '#', '#'],
    ['#####'],
    ['#', '#', '#', '#', '#'],
    ['##', '##'],
    ['###', '###', '###'],
    ['##', '#.'],
    ['##', '.#'],
    ['#.', '##'],
    ['.#', '##'],
    ['###', '#..', '#..'],
    ['###', '..#', '..#'],
    ['#..', '#..', '###'],
    ['..#', '..#', '###'],
    ['###', '.#.'],
    ['.#.', '###'],
    ['#.', '##', '#.'],
    ['.#', '##', '.#'],
    ['##.', '.##'],
    ['.##', '##.'],
    ['#.', '##', '.#'],
    ['.#', '##', '#.'],
    ['#..', '###'],
    ['..#', '###'],
    ['###', '#..'],
    ['###', '..#'],
].map((rows) => ({
    w: rows[0].length,
    h: rows.length,
    cells: rows.flatMap((row, r) => [...row].flatMap((t, c) => (t === '#' ? [[c, r]] : []))),
}))

// Un tono por lugar de la bandeja, para distinguir de dónde vino cada bloque.
const SHADES = ['#000', '#2b2b2b', '#4a4a4a', '#5a5a5a']

const emptyBoard = () => Array.from({ length: N }, () => Array(N).fill(null))

function fits(board, p, c, r) {
    return p.cells.every(([dc, dr]) => {
        const x = c + dc
        const y = r + dr
        return x >= 0 && x < N && y >= 0 && y < N && !board[y][x]
    })
}

function fitsAnywhere(board, p) {
    for (let r = 0; r <= N - p.h; r++) for (let c = 0; c <= N - p.w; c++) if (fits(board, p, c, r)) return true
    return false
}

/* Filas y columnas que quedarían llenas si la pieza se pone ahí. */
function linesAfter(board, p, c, r) {
    const filled = (x, y) => board[y][x] || p.cells.some(([dc, dr]) => c + dc === x && r + dr === y)
    const rows = []
    const cols = []
    for (let i = 0; i < N; i++) {
        if (Array.from({ length: N }, (_, k) => filled(k, i)).every(Boolean)) rows.push(i)
        if (Array.from({ length: N }, (_, k) => filled(i, k)).every(Boolean)) cols.push(i)
    }
    return { rows, cols }
}

/* Cuatro piezas al azar; se intenta que al menos una quepa para no cerrar la partida de golpe. */
function newTray(board) {
    let tray = []
    for (let tries = 0; tries < 20; tries++) {
        tray = Array.from({ length: TRAY }, () => SHAPES[Math.floor(Math.random() * SHAPES.length)])
        if (tray.some((p) => fitsAnywhere(board, p))) break
    }
    return tray
}

function newGame() {
    const board = emptyBoard()
    return { playing: true, paused: false, over: false, score: 0, time: START_TIME, combo: 0, miss: 0, board, tray: newTray(board), drag: null, kb: null, clearing: [], fx: [], flash: 0 }
}

export default function LoadingGame({ label = 'Juega mientras la IA lee' }) {
    const host = useRef(null)
    const canvas = useRef(null)
    const game = useRef(null)
    const [hud, setHud] = useState({ playing: false, paused: false, over: false, score: 0, time: START_TIME, combo: 0, reason: '', best: readBest() })

    useEffect(() => {
        const cv = canvas.current
        const ctx = cv.getContext('2d')
        const el = host.current
        let w = 0
        let h = 0
        let cell = 20
        let ox = 0
        let oy = 0
        let slots = []
        let mini = 10
        let raf = 0
        let last = performance.now()
        let lastSec = START_TIME
        let dirty = true
        game.current = { playing: false }

        /* Tarima y bandeja lado a lado si sobra ancho; si no, la bandeja va debajo. */
        const resize = () => {
            const rect = el.getBoundingClientRect()
            const dpr = Math.min(window.devicePixelRatio || 1, 2)
            w = rect.width
            h = rect.height
            cv.width = w * dpr
            cv.height = h * dpr
            cv.style.width = `${w}px`
            cv.style.height = `${h}px`
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            const pad = 12
            const bar = 8 // franja del reloj, abajo
            const side = w >= h * 1.25
            const S = side ? Math.min(h - pad * 2 - bar, (w - pad * 3) * 0.64) : Math.min(w - pad * 2, (h - pad * 3 - bar) * 0.74)
            cell = Math.max(8, Math.floor(S / N))
            const B = cell * N
            if (side) {
                const tw = Math.min(w - B - pad * 3, B)
                const s = Math.floor(Math.min((tw - pad) / 2, (B - pad) / 2))
                ox = Math.round((w - (B + pad + s * 2 + pad)) / 2)
                oy = Math.round((h - bar - B) / 2)
                const ty = oy + (B - (s * 2 + pad)) / 2
                slots = Array.from({ length: TRAY }, (_, i) => ({ x: ox + B + pad + (i % 2) * (s + pad), y: ty + Math.floor(i / 2) * (s + pad), s }))
            } else {
                const s = Math.floor(Math.max(24, Math.min((w - pad * 5) / 4, h - B - pad * 3 - bar)))
                ox = Math.round((w - B) / 2)
                oy = Math.round((h - bar - (B + pad + s)) / 2)
                const sx = (w - (s * TRAY + pad * (TRAY - 1))) / 2
                slots = Array.from({ length: TRAY }, (_, i) => ({ x: sx + i * (s + pad), y: oy + B + pad, s }))
            }
            mini = Math.min(cell * 0.7, (slots[0].s * 0.86) / 5)
            dirty = true
        }
        const ro = new ResizeObserver(resize)
        ro.observe(el)
        resize()

        const sync = () => {
            const g = game.current
            setHud((s) => ({ ...s, playing: g.playing, paused: g.paused, score: g.score, time: g.time, combo: g.combo }))
        }

        const pop = (g, text, c, r) => g.fx.push({ text, c, r, t: 0 })

        const end = (g, reason) => {
            g.playing = false
            g.over = true
            g.drag = null
            g.kb = null
            dirty = true
            setHud((s) => {
                const best = Math.max(s.best, g.score)
                if (best > s.best) saveBest(best)
                return { ...s, playing: false, paused: false, over: true, score: g.score, time: Math.max(0, g.time), combo: 0, reason, best }
            })
        }

        const place = (g, i, c, r) => {
            const p = g.tray[i]
            if (!p || !fits(g.board, p, c, r)) return false
            const { rows, cols } = linesAfter(g.board, p, c, r)
            for (const [dc, dr] of p.cells) g.board[r + dr][c + dc] = SHADES[i]
            g.score += p.cells.length
            const n = rows.length + cols.length
            if (n) {
                g.combo += 1
                g.miss = 0
                const pts = 10 * n * n * g.combo
                g.score += pts
                g.time = Math.min(START_TIME, g.time + LINE_TIME * n)
                // Los bloques despejados se encogen un momento antes de desaparecer.
                const gone = new Set()
                for (const y of rows) for (let x = 0; x < N; x++) gone.add(`${x},${y}`)
                for (const x of cols) for (let y = 0; y < N; y++) gone.add(`${x},${y}`)
                for (const k of gone) {
                    const [x, y] = k.split(',').map(Number)
                    g.clearing.push({ c: x, r: y, shade: g.board[y][x], t: 0 })
                    g.board[y][x] = null
                }
                pop(g, `+${pts}`, c + p.w / 2, r + p.h / 2)
                if (g.combo > 1) pop(g, `Combo ×${g.combo}`, c + p.w / 2, r + p.h / 2 + 1)
                g.flash = 0.18
            } else if (++g.miss >= COMBO_KEEP) g.combo = 0
            g.tray[i] = null
            if (g.tray.every((t) => !t)) g.tray = newTray(g.board)
            sync()
            if (!g.tray.some((t) => t && fitsAnywhere(g.board, t))) end(g, 'Ninguna pieza cabe en la tarima.')
            return true
        }

        /* Dónde caería la pieza que se está moviendo (arrastre o teclado). */
        const aim = (g) => {
            if (g.drag) {
                const p = g.tray[g.drag.i]
                const x0 = g.drag.x - (p.w * cell) / 2
                const y0 = g.drag.y - g.drag.lift - (p.h * cell) / 2
                return { i: g.drag.i, c: Math.round((x0 - ox) / cell), r: Math.round((y0 - oy) / cell), x0, y0 }
            }
            return g.kb
        }

        const update = (g, dt) => {
            g.flash = Math.max(0, g.flash - dt)
            for (const f of g.fx) f.t += dt
            g.fx = g.fx.filter((f) => f.t < 1.1)
            for (const b of g.clearing) b.t += dt
            g.clearing = g.clearing.filter((b) => b.t < 0.35)
            g.time -= dt
            const sec = Math.ceil(Math.max(0, g.time))
            if (sec !== lastSec) {
                lastSec = sec
                sync()
            }
            if (g.time <= 0) end(g, 'Se acabó el tiempo.')
        }

        const block = (x, y, s, fill) => {
            ctx.fillStyle = fill
            ctx.fillRect(x + 1, y + 1, s - 2, s - 2)
            ctx.fillStyle = 'rgba(255,255,255,0.22)'
            ctx.fillRect(x + 3, y + 3, s - 6, Math.max(2, s * 0.12))
        }

        const drawPiece = (p, x, y, s, fill) => {
            for (const [dc, dr] of p.cells) block(x + dc * s, y + dr * s, s, fill)
        }

        const draw = () => {
            const g = game.current
            const board = g.board || emptyBoard()
            const B = cell * N
            ctx.clearRect(0, 0, w, h)
            ctx.fillStyle = '#fff'
            ctx.fillRect(0, 0, w, h)
            ctx.fillStyle = '#f4f4f4'
            ctx.fillRect(ox, oy, B, B)

            const a = g.playing && !g.paused ? aim(g) : null
            const ok = a && fits(board, g.tray[a.i], a.c, a.r)
            // Las líneas que se despejarían quedan marcadas antes de soltar.
            if (ok) {
                const { rows, cols } = linesAfter(board, g.tray[a.i], a.c, a.r)
                ctx.fillStyle = 'rgba(0,0,0,0.1)'
                for (const y of rows) ctx.fillRect(ox, oy + y * cell, B, cell)
                for (const x of cols) ctx.fillRect(ox + x * cell, oy, cell, B)
            }
            ctx.strokeStyle = '#e0e0e0'
            ctx.lineWidth = 1
            ctx.beginPath()
            for (let i = 1; i < N; i++) {
                ctx.moveTo(ox + i * cell + 0.5, oy)
                ctx.lineTo(ox + i * cell + 0.5, oy + B)
                ctx.moveTo(ox, oy + i * cell + 0.5)
                ctx.lineTo(ox + B, oy + i * cell + 0.5)
            }
            ctx.stroke()
            for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (board[r][c]) block(ox + c * cell, oy + r * cell, cell, board[r][c])
            for (const b of g.clearing || []) {
                const k = 1 - b.t / 0.35
                const s = cell * k
                block(ox + b.c * cell + (cell - s) / 2, oy + b.r * cell + (cell - s) / 2, s, b.shade)
            }
            if (ok) drawPiece(g.tray[a.i], ox + a.c * cell, oy + a.r * cell, cell, '#bdbdbd')
            ctx.strokeStyle = '#000'
            ctx.lineWidth = 2
            ctx.strokeRect(ox, oy, B, B)

            // Bandeja: las cuatro piezas que tocan.
            for (let i = 0; i < slots.length; i++) {
                const sl = slots[i]
                const p = g.tray?.[i]
                ctx.strokeStyle = g.kb?.i === i ? '#000' : '#e0e0e0'
                ctx.lineWidth = g.kb?.i === i ? 2 : 1
                ctx.strokeRect(sl.x + 0.5, sl.y + 0.5, sl.s - 1, sl.s - 1)
                if (!p || g.drag?.i === i) continue
                const fill = fitsAnywhere(board, p) ? SHADES[i] : '#c8c8c8'
                drawPiece(p, sl.x + (sl.s - p.w * mini) / 2, sl.y + (sl.s - p.h * mini) / 2, mini, fill)
                if (g.playing) {
                    ctx.fillStyle = '#9a9a9a'
                    ctx.font = `700 ${Math.max(9, sl.s * 0.11)}px Archivo, system-ui, sans-serif`
                    ctx.textAlign = 'left'
                    ctx.fillText(String(i + 1), sl.x + 5, sl.y + Math.max(11, sl.s * 0.14))
                }
            }

            // La pieza que va en la mano, a tamaño real.
            if (g.drag && g.playing) {
                const d = aim(g)
                ctx.globalAlpha = 0.9
                drawPiece(g.tray[d.i], d.x0, d.y0, cell, SHADES[d.i])
                ctx.globalAlpha = 1
            }

            // Reloj: franja abajo que se vacía; titila los últimos segundos.
            const t = g.playing || g.over ? Math.max(0, g.time) : START_TIME
            const low = g.playing && t < 10 && Math.floor(performance.now() / 250) % 2 === 0
            ctx.fillStyle = '#e6e6e6'
            ctx.fillRect(0, h - 6, w, 6)
            ctx.fillStyle = low ? '#767676' : '#000'
            ctx.fillRect(0, h - 6, (w * t) / START_TIME, 6)

            ctx.textAlign = 'center'
            ctx.font = `800 ${Math.max(12, cell * 0.5)}px Archivo, system-ui, sans-serif`
            for (const f of g.fx || []) {
                const x = ox + f.c * cell
                const y = oy + f.r * cell - f.t * cell
                ctx.globalAlpha = Math.max(0, 1 - f.t)
                ctx.lineWidth = 4
                ctx.strokeStyle = '#fff'
                ctx.strokeText(f.text, x, y)
                ctx.fillStyle = '#000'
                ctx.fillText(f.text, x, y)
            }
            ctx.globalAlpha = 1
            if (g.flash > 0) {
                ctx.fillStyle = `rgba(0,0,0,${g.flash * 0.35})`
                ctx.fillRect(ox, oy, B, B)
            }
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
            g.drag = null
            dirty = true
            sync()
        }
        game.current.togglePause = togglePause

        const local = (e) => {
            const r = el.getBoundingClientRect()
            return [e.clientX - r.left, e.clientY - r.top]
        }

        const onPointerDown = (e) => {
            const g = game.current
            if (!g.playing || g.paused || g.drag) return
            const [x, y] = local(e)
            const i = slots.findIndex((s) => x >= s.x && x <= s.x + s.s && y >= s.y && y <= s.y + s.s)
            if (i < 0 || !g.tray[i]) return
            e.preventDefault()
            // Con el dedo la pieza va un poco arriba, para que no la tape.
            g.drag = { i, x, y, lift: e.pointerType === 'touch' ? cell * 1.6 : 0, id: e.pointerId }
            g.kb = null
            el.setPointerCapture?.(e.pointerId)
        }
        const onPointerMove = (e) => {
            const g = game.current
            if (!g.drag || g.drag.id !== e.pointerId) return
            ;[g.drag.x, g.drag.y] = local(e)
        }
        const onPointerUp = (e) => {
            const g = game.current
            if (!g.drag || g.drag.id !== e.pointerId) return
            const a = aim(g)
            g.drag = null
            place(g, a.i, a.c, a.r)
        }
        const onPointerCancel = () => {
            game.current.drag = null
        }

        const onDown = (e) => {
            const g = game.current
            const k = e.key.toLowerCase()
            if (k === 'escape' && g.kb) {
                e.preventDefault()
                g.kb = null
                return
            }
            if (k === 'p' || k === 'escape') {
                if (g.playing) {
                    e.preventDefault()
                    togglePause()
                }
                return
            }
            if (!g.playing || g.paused) return
            if (k >= '1' && k <= String(TRAY)) {
                const i = Number(k) - 1
                const p = g.tray[i]
                if (!p) return
                e.preventDefault()
                g.kb = { i, c: Math.floor((N - p.w) / 2), r: Math.floor((N - p.h) / 2) }
                return
            }
            if (!g.kb) return
            const p = g.tray[g.kb.i]
            const mv = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] }[k]
            if (mv) {
                e.preventDefault()
                g.kb.c = Math.max(0, Math.min(N - p.w, g.kb.c + mv[0]))
                g.kb.r = Math.max(0, Math.min(N - p.h, g.kb.r + mv[1]))
            } else if (k === 'enter' || k === ' ') {
                e.preventDefault()
                if (place(g, g.kb.i, g.kb.c, g.kb.r)) g.kb = null
            }
        }
        const onVis = () => document.hidden && togglePause(true)
        const onBlur = () => togglePause(true)

        el.addEventListener('keydown', onDown)
        el.addEventListener('pointerdown', onPointerDown)
        el.addEventListener('pointermove', onPointerMove)
        el.addEventListener('pointerup', onPointerUp)
        el.addEventListener('pointercancel', onPointerCancel)
        el.addEventListener('blur', onBlur)
        document.addEventListener('visibilitychange', onVis)
        raf = requestAnimationFrame(step)

        return () => {
            cancelAnimationFrame(raf)
            ro.disconnect()
            el.removeEventListener('keydown', onDown)
            el.removeEventListener('pointerdown', onPointerDown)
            el.removeEventListener('pointermove', onPointerMove)
            el.removeEventListener('pointerup', onPointerUp)
            el.removeEventListener('pointercancel', onPointerCancel)
            el.removeEventListener('blur', onBlur)
            document.removeEventListener('visibilitychange', onVis)
        }
    }, [])

    const start = () => {
        const tp = game.current.togglePause
        game.current = Object.assign(newGame(), { togglePause: tp })
        setHud((s) => ({ ...s, playing: true, paused: false, over: false, score: 0, time: START_TIME, combo: 0, reason: '' }))
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
                    <span aria-label={`Quedan ${Math.ceil(hud.time)} segundos`}>{Math.ceil(Math.max(0, hud.time))} s</span>
                    {hud.combo > 1 && <span className="wgame-combo">Combo ×{hud.combo}</span>}
                </span>
                {hud.playing && (
                    <button type="button" className="wgame-pause" onClick={() => (hud.paused ? resume() : game.current.togglePause?.(true))} aria-label={hud.paused ? 'Seguir' : 'Pausa'}>
                        {hud.paused ? '▶ Seguir' : 'Ⅱ Pausa'}
                    </button>
                )}
            </div>
            <div ref={host} className="wgame-field" tabIndex={0} aria-label="Minijuego de bloques: arrastra las piezas a la tarima, o elige con 1 a 4, mueve con las flechas y coloca con Enter. P para pausar">
                <canvas ref={canvas} />
                {!hud.playing && (
                    <button type="button" className="wgame-start" onClick={start}>
                        <strong>{hud.over ? `${hud.score} puntos` : label}</strong>
                        <span className="small">
                            {hud.over
                                ? `${hud.reason} Récord: ${hud.best}. Clic para otra ronda.`
                                : `Acomoda las cuatro piezas en la tarima. Llena una fila o columna para despejarla y ganar ${LINE_TIME} s más antes de que se acabe el reloj.`}
                        </span>
                        {!hud.over && <span className="wgame-keys small">Arrastra las piezas · 1-4 elige, flechas mueven, Enter coloca · P pausa</span>}
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
