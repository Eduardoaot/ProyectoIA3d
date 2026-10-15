import { useEffect, useMemo, useRef } from 'react'

/* La marca de Cauce: la planta vista desde arriba, con dos portones abajo.
   Por dentro corre el recorrido del material: empieza enredado (el taller de hoy)
   y se ordena en una U de portón a portón (la planta rediseñada). */

export const FRAME = 'M16 60 H6 V6 H58 V60 H48 M26 60 H38'
export const TANGLED = 'M21 60 V46 C21 42 23 40 27 40 H46 C50 40 52 37 50 33 L42 20 C40 16 34 16 30 18 L14 27 C10 29 10 34 14 36 L36 46 C40 48 42 44 40 40 L30 14 C28 10 32 8 36 10 L50 18 C53 20 53 24 50 26 L34 34 C30 36 31 41 35 42 L43 44 V60'
export const U_PATH = 'M21 60 V26 C21 18 25 14 32 14 C39 14 43 18 43 26 V60'

const N = 120

function sample(d) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    svg.setAttribute('d', d)
    const len = svg.getTotalLength()
    const pts = []
    for (let i = 0; i < N; i++) {
        const p = svg.getPointAtLength((i / (N - 1)) * len)
        pts.push([p.x, p.y])
    }
    return pts
}

let cache = null
export function flowPoints() {
    if (!cache) cache = { tangled: sample(TANGLED), u: sample(U_PATH) }
    return cache
}

export function pathFrom(a, b, t) {
    let d = ''
    for (let i = 0; i < N; i++) {
        const x = a[i][0] + (b[i][0] - a[i][0]) * t
        const y = a[i][1] + (b[i][1] - a[i][1]) * t
        d += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2)
    }
    return d
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export default function FlowMark({ size = 56, state = 'u', color = 'currentColor', stroke = 5, hoverMorph = false, runner = true, duration = 1100, title = 'Cauce' }) {
    const pathRef = useRef(null)
    const dotRef = useRef(null)
    const tRef = useRef(state === 'u' ? 1 : 0)
    const animRef = useRef(0)
    const pts = useMemo(() => flowPoints(), [])

    const draw = (t) => {
        tRef.current = t
        if (pathRef.current) pathRef.current.setAttribute('d', pathFrom(pts.tangled, pts.u, ease(t)))
    }

    const morphTo = (target, ms = duration) => {
        cancelAnimationFrame(animRef.current)
        const from = tRef.current
        const start = performance.now()
        const tick = (now) => {
            const k = Math.min(1, (now - start) / ms)
            draw(from + (target - from) * k)
            if (k < 1) animRef.current = requestAnimationFrame(tick)
        }
        animRef.current = requestAnimationFrame(tick)
    } 

    useEffect(() => {
        morphTo(state === 'u' ? 1 : 0)
        return () => cancelAnimationFrame(animRef.current)
    }, [state])

    useEffect(() => {
        draw(tRef.current)
        if (!runner) return

        let raf
        const start = performance.now()
        const loop = (now) => {
            const el = pathRef.current
            const dot = dotRef.current
            
            if (el && dot) {
                const len = el.getTotalLength()
                const k = ((now - start) / 2600) % 1
                const p = el.getPointAtLength(ease(k) * len)
                dot.setAttribute('cx', p.x)
                dot.setAttribute('cy', p.y)
                dot.setAttribute('opacity', k > 0.94 ? (1 - k) / 0.06 : k < 0.04 ? k / 0.04 : 1)
            }
            raf = requestAnimationFrame(loop)
        }

        raf = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(raf)
    }, [runner])

    const onEnter = () => {
        if (!hoverMorph) return
        morphTo(0, 420)
        setTimeout(() => morphTo(1, 900), 430)
    }

    return (
        <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title} onMouseEnter={onEnter}>
            <path d={FRAME} fill="none" stroke={color} strokeWidth={stroke * 0.7} strokeLinecap="square" strokeLinejoin="miter" />
            <path ref={pathRef} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
            {runner && <circle ref={dotRef} r={stroke * 0.95} fill={color} />}
        </svg>
    )
}