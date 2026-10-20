import { useRef } from 'react'
import { motion, useMotionValue, useSpring } from 'motion/react'

// Cuánto puede desplazarse el botón hacia el cursor: poco, para no tapar el texto de al lado.
const REACH = 4
const clamp = (v) => Math.max(-REACH, Math.min(REACH, v))

export default function Btn({ children, variant, size, wide, glyph = true, strength = 0.08, className = '', ...rest }) {
    const ref = useRef(null)
    const x = useMotionValue(0)
    const y = useMotionValue(0)
    const sx = useSpring(x, { stiffness: 260, damping: 18, mass: 0.6 })
    const sy = useSpring(y, { stiffness: 260, damping: 18, mass: 0.6 })

    const onMove = (e) => {
        if (rest.disabled) return
        const r = ref.current.getBoundingClientRect()
        x.set(clamp((e.clientX - (r.left + r.width / 2)) * strength))
        y.set(clamp((e.clientY - (r.top + r.height / 2)) * strength))
    }
    const onLeave = () => {
        x.set(0)
        y.set(0)
    }

    const cls = ['btn', variant && `btn--${variant}`, size && `btn--${size}`, wide && 'btn--wide', className].filter(Boolean).join(' ')

    return (
        <motion.button ref={ref} className={cls} style={{ x: sx, y: sy }} onMouseMove={onMove} onMouseLeave={onLeave} {...rest}>
            <span className="btn-label-swap">
                <span>{children}</span>
                <span aria-hidden="true">{children}</span>
            </span>
            {glyph && (
                <svg className="btn-glyph" viewBox="0 0 18 18" aria-hidden="true">
                <path d="M9 2 V16 M2 9 H16" stroke="currentColor" strokeWidth="2.4" />
                </svg>
            )}
        </motion.button>
    )
}