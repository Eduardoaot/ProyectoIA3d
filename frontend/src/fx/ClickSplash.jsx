import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

export default function ClickSplash() {
    const [drops, setDrops] = useState([])

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        let id = 0
        const onDown = (e) => {
            const drop = { id: ++id, x: e.clientX, y: e.clientY }
            setDrops((d) => [...d.slice(-6), drop])
            setTimeout(() => setDrops((d) => d.filter((x) => x.id !== drop.id)), 900)
        }
        window.addEventListener('pointerdown', onDown)
        return () => window.removeEventListener('pointerdown', onDown)
    }, [])

    return (
        <AnimatePresence>
            {drops.map((d) =>
                [0, 1].map((k) => (
                <motion.span
                    key={`${d.id}-${k}`}
                    className="splash-ring"
                    style={{ left: d.x, top: d.y, width: 12, height: 12, marginLeft: -6, marginTop: -6 }}
                    initial={{ scale: 0.2, opacity: 0.9 }}
                    animate={{ scale: k ? 9 : 5.5, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: k ? 0.85 : 0.6, delay: k * 0.08, ease: [0.16, 1, 0.3, 1] }}
                />
                )),
            )}
        </AnimatePresence>
    )
}