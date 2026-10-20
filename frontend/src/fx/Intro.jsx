import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import FlowMark from '../brand/FlowMark'
import Wordmark from '../brand/Wordmark'

const EASE = [0.83, 0, 0.17, 1]

export default function Intro({ onDone }) {
    const [phase, setPhase] = useState('tangled')

    useEffect(() => {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const t = reduced
        ? [setTimeout(() => setPhase('open'), 300)]
        : [setTimeout(() => setPhase('u'), 900), setTimeout(() => setPhase('open'), 3000)]
        return () => t.forEach(clearTimeout)
    }, [])

    useEffect(() => {
        if (phase !== 'open') return
        const t = setTimeout(onDone, 1150)

        return () => clearTimeout(t)
    }, [phase, onDone])

    const open = phase === 'open'

    return (
        <div className="intro" onClick={() => setPhase('open')} role="presentation" style={{ pointerEvents: open ? 'none' : 'auto' }}>
            <motion.div className="intro-door intro-door--l" animate={{ x: open ? '-101%' : 0 }} transition={{ duration: 1.05, ease: EASE }} />
            <motion.div className="intro-door intro-door--r" animate={{ x: open ? '101%' : 0 }} transition={{ duration: 1.05, ease: EASE }} />
            
            <motion.div className="intro-core" animate={{ opacity: open ? 0 : 1, scale: open ? 1.08 : 1 }} transition={{ duration: 0.5 }}>
                <motion.div initial={{ opacity: 0, scale: 0.7, rotate: -8 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}>
                    <FlowMark size={150} state={phase === 'tangled' ? 'tangled' : 'u'} color="#fff" duration={1300} />
                </motion.div>

                <Wordmark size="clamp(3.5rem, 11vw, 8.5rem)" delay={0.9} />
                
                <motion.p className="intro-tag" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.8, duration: 0.7 }}>
                    El recorrido de tu planta, en orden.
                </motion.p>
            </motion.div>

            {!open && (
                <motion.span className="intro-skip" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }}>
                    Clic para entrar
                </motion.span>
            )}
        </div>
    )
}