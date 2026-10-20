import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

export function setCursor(detail) {
	window.dispatchEvent(new CustomEvent('cauce:cursor', { detail }))
}

/* Donde se trabaja con precisión (el plano 2D con sus manijas y los campos) queda el cursor del sistema. */
const NATIVE = '.editor-canvas, input, textarea, select'
// En la vista 3D y en el juego la flecha sigue; al arrastrar muestra el anillo punteado.
const DRAGGABLE = '.scene, .wgame-field'

/* Cursor propio: una flecha que se inclina con el movimiento, se encoge al hacer clic y
   marca los botones con un anillo que la sigue con un poco de retraso. */
export default function Cursor() {
	const arrow = useRef(null)
	const ring = useRef(null)
	const labelRef = useRef(null)
	const [mode, setMode] = useState('idle')
	const [label, setLabel] = useState(null)
	const [enabled, setEnabled] = useState(false)

	useEffect(() => {
		const fine = window.matchMedia('(pointer: fine)').matches
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
		if (!fine || reduced) return

		setEnabled(true)
		document.body.classList.add('has-cursor')
		const pos = { x: innerWidth / 2, y: innerHeight / 2 }
		const ringPos = { ...pos }
		let tilt = 0
		let lastX = pos.x
		let down = false
		let dragging = false
		let visible = true
		let raf

		const move = (e) => {
			pos.x = e.clientX
			pos.y = e.clientY
			const t = e.target
			if (!(t instanceof Element)) return
			if (t.closest(NATIVE)) setMode('off')
			else if (dragging || t.closest('[data-cursor="drag"]')) setMode('drag')
			// La escena 3D marca con 'pointer' la máquina que está debajo.
			else if (t.tagName === 'CANVAS' && t.style.cursor === 'pointer') setMode('hover')
			else if (t.closest('button, a, [role="button"], summary, label[for], [data-cursor="hover"]')) setMode('hover')
			else setMode('idle')
		}

		const loop = () => {
			ringPos.x += (pos.x - ringPos.x) * 0.2
			ringPos.y += (pos.y - ringPos.y) * 0.2
			// La flecha se inclina hacia donde va y vuelve sola a su lugar.
			const vx = pos.x - lastX
			lastX = pos.x
			tilt += (Math.max(-16, Math.min(16, vx * 1.4)) - tilt) * 0.18
			const s = down ? 0.82 : 1
			if (arrow.current) arrow.current.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) rotate(${tilt.toFixed(2)}deg) scale(${s})`
			if (ring.current) ring.current.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0) scale(${down ? 0.8 : 1})`
			if (labelRef.current) labelRef.current.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0)`
			raf = requestAnimationFrame(loop)
		}

		const onLabel = (e) => setLabel(e.detail?.label ?? null)
		const show = (v) => {
			visible = v
			document.body.classList.toggle('cursor-out', !visible)
		}
		const onDown = (e) => {
			down = true
			dragging = e.target instanceof Element && !!e.target.closest(DRAGGABLE)
			if (dragging) setMode('drag')
		}
		const onUp = () => {
			down = false
			if (dragging) setMode('idle')
			dragging = false
		}

		window.addEventListener('mousemove', move, { passive: true })
		window.addEventListener('mousedown', onDown)
		window.addEventListener('mouseup', onUp)
		window.addEventListener('cauce:cursor', onLabel)
		document.addEventListener('mouseleave', () => show(false))
		document.addEventListener('mouseenter', () => show(true))
		raf = requestAnimationFrame(loop)

		return () => {
			cancelAnimationFrame(raf)
			window.removeEventListener('mousemove', move)
			window.removeEventListener('mousedown', onDown)
			window.removeEventListener('mouseup', onUp)
			window.removeEventListener('cauce:cursor', onLabel)
			document.body.classList.remove('has-cursor', 'cursor-out')
		}
	}, [])

	if (!enabled) return null
	const m = label ? 'hover' : mode

	return (
		<>
			<div ref={ring} className="cursor-ring" data-mode={m} />
			<div ref={arrow} className="cursor-arrow" data-mode={m}>
				<svg width="26" height="30" viewBox="0 0 26 30" aria-hidden="true">
					<path className="cursor-arrow-body" d="M3 2.5 L3 24 L8.6 18.8 L12.6 27.2 L16.4 25.4 L12.5 17.2 L20.2 17.2 Z" />
				</svg>
			</div>

			<div ref={labelRef} style={{ position: 'fixed', left: 0, top: 0, zIndex: 2001, pointerEvents: 'none' }}>
				<AnimatePresence>
					{label && (
						<motion.div
							key={label}
							className="cursor-label"
							style={{ position: 'absolute' }}
							initial={{ opacity: 0, scale: 0.6, y: 6 }}
							animate={{ opacity: 1, scale: 1, y: 0 }}
							exit={{ opacity: 0, scale: 0.8 }}
							transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
						>
							{label}
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</>
	)
}
