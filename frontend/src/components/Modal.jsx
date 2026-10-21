import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'

/* Ventana emergente con el estilo de la app: título, cerrar con ×, Esc o clic afuera. */
export default function Modal({ open, title, onClose, wide = false, children }) {
    useEffect(() => {
        if (!open) return
        const onKey = (e) => e.key === 'Escape' && onClose()
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open, onClose])

    return (
        <AnimatePresence>
            {open && (
                <motion.div className="dialog-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
                    <motion.div className={`dialog dialog--panel${wide ? ' dialog--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} initial={{ y: 16, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 8, opacity: 0 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
                        <div className="picker-head">
                            <h3>{title}</h3>
                            <button type="button" className="picker-close" onClick={onClose} aria-label="Cerrar">
                                ×
                            </button>
                        </div>
                        <div className="dialog-body">{children}</div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
