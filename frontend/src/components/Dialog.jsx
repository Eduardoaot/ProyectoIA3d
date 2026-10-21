import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

/* Confirmaciones con el estilo de la app (en lugar de window.confirm).
   ask() devuelve una promesa: true si el usuario acepta. DialogHost va una sola vez en App. */
let show = null

export function ask(message, { title = '¿Seguro?', ok = 'Sí, seguir', cancel = 'Cancelar' } = {}) {
    return new Promise((resolve) => (show ? show({ message, title, ok, cancel, resolve }) : resolve(false)))
}

export default function DialogHost() {
    const [dlg, setDlg] = useState(null)
    const okRef = useRef(null)

    useEffect(() => {
        show = setDlg
        return () => {
            show = null
        }
    }, [])

    useEffect(() => {
        if (!dlg) return
        okRef.current?.focus()
        const onKey = (e) => {
            if (e.key === 'Escape') close(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    })

    const close = (value) => {
        dlg?.resolve(value)
        setDlg(null)
    }

    return (
        <AnimatePresence>
            {dlg && (
                <motion.div className="dialog-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(e) => e.target === e.currentTarget && close(false)}>
                    <motion.div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" initial={{ y: 16, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 8, opacity: 0 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
                        <h3 id="dialog-title">{dlg.title}</h3>
                        <p>{dlg.message}</p>
                        <div className="dialog-actions">
                            <button type="button" className="btn btn--ghost btn--small" onClick={() => close(false)}>
                                {dlg.cancel}
                            </button>
                            <button ref={okRef} type="button" className="btn btn--small" onClick={() => close(true)}>
                                {dlg.ok}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
