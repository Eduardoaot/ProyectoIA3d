import { animate, motion, useInView, useMotionValue, useTransform } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

const EASE = [0.16, 1, 0.3, 1]

export function RevealTitle({ as: Tag = 'h1', text, delay = 0, className }) {
    const words = text.split(' ')
    return (
        <Tag className={className} aria-label={text}>
            <span className="reveal-line" aria-hidden="true">
                {words.map((w, i) => (
                    <span key={i} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.1em', marginBottom: '-0.1em' }}>
                        <motion.span
                        className="reveal-word"
                        initial={{ y: '110%', rotate: 4 }}
                        animate={{ y: 0, rotate: 0 }}
                        transition={{ duration: 0.9, delay: delay + i * 0.055, ease: EASE }}
                        >
                            {w}
                        {i < words.length - 1 ? ' ' : ''}
                        </motion.span>
                    </span>
                ))}
            </span>
        </Tag>
    )
}

export function Appear({ children, delay = 0, y = 28, className, style, as = 'div' }) {
    const M = motion[as]

    return (
        <M
            className={className}
            style={style}
            initial={{ opacity: 0, y }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: 0.8, delay, ease: EASE }}
        >
            {children}
        </M>
    )
}

export function CountUp({ value, decimals = 0, duration = 1.4, prefix = '', suffix = '', className }) {
    const ref = useRef(null)
    const inView = useInView(ref, { once: true })
    const mv = useMotionValue(0)

    const fmt = (v) =>
        prefix +
        Number(v).toLocaleString('es-CO', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) +
        suffix

    const text = useTransform(mv, fmt)
    const prev = useRef(0)

    useEffect(() => {
        if (!inView) return

        const c = animate(mv, value, { duration, ease: EASE, from: prev.current })
        prev.current = value

        return () => c.stop()
    }, [inView, value, duration, mv])

    return (
        <motion.span ref={ref} className={className}>
            {text}
        </motion.span>
    )
}

export function Tilt({ children, className, max = 7, ...rest }) {
    const ref = useRef(null)
    const [t, setT] = useState({ rx: 0, ry: 0 })
    const onMove = (e) => {
        const r = ref.current.getBoundingClientRect()
        const px = (e.clientX - r.left) / r.width - 0.5
        const py = (e.clientY - r.top) / r.height - 0.5
        setT({ rx: -py * max, ry: px * max })
    }
    return (
        <motion.div
            ref={ref}
            className={className}
            onMouseMove={onMove}
            onMouseLeave={() => setT({ rx: 0, ry: 0 })}
            animate={{ rotateX: t.rx, rotateY: t.ry }}
            transition={{ type: 'spring', stiffness: 200, damping: 18 }}
            style={{ transformPerspective: 800 }}
            {...rest}
        >
            {children}
        </motion.div>
    )
}