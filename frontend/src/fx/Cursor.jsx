import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

export function setCursor(detail) {
  	window.dispatchEvent(new CustomEvent('cauce:cursor', { detail }))
}

export default function Cursor() {
	const dot = useRef(null)
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
		let raf

		const move = (e) => {
			pos.x = e.clientX
			pos.y = e.clientY
			const t = e.target
			if (!(t instanceof Element)) return
			if (t.closest('[data-cursor="drag"]')) setMode('drag')
			else if (t.closest('button, a, [role="button"], summary, label[for], select, [data-cursor="hover"]')) setMode('hover')
			else if (t.closest('textarea, input[type="text"], input:not([type])')) setMode('text')
			else setMode('idle')
		}

		const loop = () => {
			ringPos.x += (pos.x - ringPos.x) * 0.18
			ringPos.y += (pos.y - ringPos.y) * 0.18
			if (dot.current) dot.current.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`
			if (ring.current) ring.current.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0)`
			if (labelRef.current) labelRef.current.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0)`
			raf = requestAnimationFrame(loop)
		}

		const onLabel = (e) => setLabel(e.detail?.label ?? null)

		const leave = () => {
			if (dot.current) dot.current.style.opacity = 0
			if (ring.current) ring.current.style.opacity = 0
		}

		const enter = () => {
			if (dot.current) dot.current.style.opacity = 1
			if (ring.current) ring.current.style.opacity = 1
		}
		
		window.addEventListener('mousemove', move, { passive: true })
		window.addEventListener('cauce:cursor', onLabel)
		document.addEventListener('mouseleave', leave)
		document.addEventListener('mouseenter', enter)
		raf = requestAnimationFrame(loop)

		return () => {
			cancelAnimationFrame(raf)
			window.removeEventListener('mousemove', move)
			window.removeEventListener('cauce:cursor', onLabel)
			document.removeEventListener('mouseleave', leave)
			document.removeEventListener('mouseenter', enter)
			document.body.classList.remove('has-cursor')
		}
	}, [])

	if (!enabled) return null

	return (
		<>
			<div ref={ring} className="cursor-ring" data-mode={label ? 'hover' : mode} />
			<div ref={dot} className="cursor-dot" />

			<div ref={labelRef} style={{ position: 'fixed', left: 0, top: 0, zIndex: 1001, pointerEvents: 'none' }}>
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