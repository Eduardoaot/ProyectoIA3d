import { useEffect, useRef, useState } from 'react'

const BEST_KEY = 'cauce-juego-record'

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

/* Minijuego para la espera: el carro atrapa piezas buenas y esquiva los retazos.
   Se mueve con el mouse o con las flechas (también A y D). */
export default function LoadingGame({ label = 'Juega mientras la IA lee' }) {
    const host = useRef(null)
    const canvas = useRef(null)
    const [state, setState] = useState({ playing: false, score: 0, lives: 3, best: readBest(), over: false })
    const game = useRef(null)

    useEffect(() => {
        const c = canvas.current
        const ctx = c.getContext('2d')
        let w = 0
        let h = 0
        let raf = 0
        let last = performance.now()
        // Sin partida en curso el dibujo no cambia: solo se repinta al cambiar de tamaño o al terminar.
        let dirty = true

        const g = {
            playing: false,
            x: 0.5,
            target: 0.5,
            keys: { left: false, right: false },
            items: [],
            spawn: 0,
            t: 0,
            score: 0,
            lives: 3,
        }
        game.current = g

        const el = host.current
        const resize = () => {
            const r = el.getBoundingClientRect()
            const dpr = Math.min(window.devicePixelRatio || 1, 2)
            w = r.width
            h = r.height
            c.width = w * dpr
            c.height = h * dpr
            c.style.width = `${w}px`
            c.style.height = `${h}px`
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            dirty = true
        }
        const ro = new ResizeObserver(resize)
        ro.observe(el)
        resize()

        const cartW = () => Math.max(56, w * 0.13)

        const draw = () => {
            ctx.clearRect(0, 0, w, h)
            ctx.strokeStyle = '#eeeeee'
            ctx.lineWidth = 1
            for (let x = 0; x < w; x += 24) {
                ctx.beginPath()
                ctx.moveTo(x + 0.5, 0)
                ctx.lineTo(x + 0.5, h)
                ctx.stroke()
            }
            for (const it of g.items) {
                const s = it.size
                ctx.save()
                ctx.translate(it.x * w, it.y)
                ctx.rotate(it.rot)
                if (it.bad) {
                    ctx.strokeStyle = '#767676'
                    ctx.lineWidth = 3
                    ctx.beginPath()
                    ctx.moveTo(-s / 2, -s / 2)
                    ctx.lineTo(s / 2, s / 2)
                    ctx.moveTo(s / 2, -s / 2)
                    ctx.lineTo(-s / 2, s / 2)
                    ctx.stroke()
                } else {
                    ctx.fillStyle = '#000'
                    ctx.fillRect(-s / 2, -s / 2, s, s)
                    ctx.fillStyle = '#fff'
                    ctx.fillRect(-s / 2 + 4, -s / 2 + 4, s - 8, 3)
                }
                ctx.restore()
            }
            const cw = cartW()
            const cx = g.x * w
            const cy = h - 26
            ctx.fillStyle = '#000'
            ctx.fillRect(cx - cw / 2, cy, cw, 12)
            ctx.fillRect(cx - cw / 2, cy - 14, 4, 14)
            ctx.fillRect(cx + cw / 2 - 4, cy - 14, 4, 14)
            ctx.beginPath()
            ctx.arc(cx - cw / 2 + 10, cy + 16, 5, 0, Math.PI * 2)
            ctx.arc(cx + cw / 2 - 10, cy + 16, 5, 0, Math.PI * 2)
            ctx.fill()
        }

        const step = (now) => {
            raf = requestAnimationFrame(step)
            const dt = Math.min((now - last) / 1000, 0.05)
            last = now
            if (g.playing) {
                g.t += dt
                const speedKeys = 1.4 * dt
                if (g.keys.left) g.target = Math.max(0, g.target - speedKeys)
                if (g.keys.right) g.target = Math.min(1, g.target + speedKeys)
                g.x += (g.target - g.x) * Math.min(1, dt * 14)

                g.spawn -= dt
                if (g.spawn <= 0) {
                    const bad = Math.random() < 0.28
                    g.items.push({ x: 0.06 + Math.random() * 0.88, y: -20, v: 110 + g.t * 6 + Math.random() * 60, size: bad ? 18 : 16, bad, rot: Math.random(), spin: (Math.random() - 0.5) * 3 })
                    g.spawn = Math.max(0.32, 0.9 - g.t * 0.012)
                }

                const cw = cartW() / w
                const cy = h - 30
                for (let i = g.items.length - 1; i >= 0; i--) {
                    const it = g.items[i]
                    it.y += it.v * dt
                    it.rot += it.spin * dt
                    const caught = it.y >= cy - 6 && it.y <= cy + 10 && Math.abs(it.x - g.x) < cw / 2 + 0.01
                    if (caught) {
                        g.items.splice(i, 1)
                        if (it.bad) g.lives -= 1
                        else g.score += 1
                        sync()
                    } else if (it.y > h + 20) {
                        g.items.splice(i, 1)
                    }
                }
                if (g.lives <= 0) end()
            }
            if (g.playing || dirty) {
                draw()
                dirty = false
            }
        }

        const sync = () => setState((s) => ({ ...s, score: g.score, lives: g.lives }))

        const end = () => {
            g.playing = false
            g.items = []
            dirty = true
            setState((s) => {
                const best = Math.max(s.best, g.score)
                if (best > s.best) saveBest(best)
                return { ...s, playing: false, over: true, score: g.score, lives: 0, best }
            })
        }

        const onMove = (e) => {
            const r = el.getBoundingClientRect()
            g.target = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
        }
        const onKey = (down) => (e) => {
            const k = e.key.toLowerCase()
            if (k === 'arrowleft' || k === 'a') g.keys.left = down
            else if (k === 'arrowright' || k === 'd') g.keys.right = down
            else return
            e.preventDefault()
        }
        const kd = onKey(true)
        const ku = onKey(false)
        el.addEventListener('pointermove', onMove)
        el.addEventListener('keydown', kd)
        el.addEventListener('keyup', ku)
        raf = requestAnimationFrame(step)

        return () => {
            cancelAnimationFrame(raf)
            ro.disconnect()
            el.removeEventListener('pointermove', onMove)
            el.removeEventListener('keydown', kd)
            el.removeEventListener('keyup', ku)
        }
    }, [])

    const start = () => {
        const g = game.current
        Object.assign(g, { playing: true, items: [], spawn: 0.4, t: 0, score: 0, lives: 3 })
        setState((s) => ({ ...s, playing: true, over: false, score: 0, lives: 3 }))
        host.current.focus({ preventScroll: true })
    }

    return (
        <div className="wgame">
            <div className="wgame-bar">
                <span className="small">Mientras esperas: atrapa las piezas, esquiva los retazos.</span>
                <span className="wgame-score num">
                    {state.score} piezas
                    <span className="wgame-lives" aria-label={`${state.lives} vidas`}>
                        {Array.from({ length: 3 }, (_, i) => (
                            <i key={i} data-off={i >= state.lives} />
                        ))}
                    </span>
                </span>
            </div>
            <div ref={host} className="wgame-field" tabIndex={0} aria-label="Minijuego: mueve el carro con el mouse o las flechas">
                <canvas ref={canvas} />
                {!state.playing && (
                    <button type="button" className="wgame-start" onClick={start}>
                        <strong>{state.over ? `Atrapaste ${state.score} piezas` : label}</strong>
                        <span className="small">{state.over ? `Récord: ${state.best}. Clic para otra ronda.` : 'Mueve el carro con el mouse o con las flechas. Clic para empezar.'}</span>
                    </button>
                )}
            </div>
        </div>
    )
}
