import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { stream } from '../api'

const suggestions = (ctx) => {
	const a = ctx?.analysis
	const bn = a?.current?.bottleneck && ctx.plant.stations.find((s) => s.id === a.current.bottleneck)?.name

	return [
		bn ? `¿Por qué ${bn.toLowerCase()} es el cuello de botella?` : '¿Qué ruta conviene acortar primero?',
		'¿Qué hago esta semana sin inversión?',
		'¿Qué datos reales debería medir?',
	]
}

	export default function EngineerChat({ open = true, onClose, context, inline = false }) {
	const [msgs, setMsgs] = useState([])
	const [input, setInput] = useState('')
	const [busy, setBusy] = useState(false)
	const log = useRef(null)
	const ctl = useRef(null)

	useEffect(() => {
		log.current?.scrollTo({ top: log.current.scrollHeight })
	}, [msgs])

	useEffect(() => () => ctl.current?.abort(), [])

	useEffect(() => {
		if (inline || !open) return
		const k = (e) => e.key === 'Escape' && onClose?.()
		window.addEventListener('keydown', k)
		return () => window.removeEventListener('keydown', k)
	}, [open, onClose, inline])

	const send = async (text) => {
		const q = text.trim()
		if (!q || busy) return
		const history = [...msgs, { role: 'user', content: q }]
		setMsgs([...history, { role: 'assistant', content: '' }])
		setInput('')
		setBusy(true)
		ctl.current = new AbortController()
		try {
			await stream('/api/chat', { messages: history, context: context?.plant ? context : null }, (t) => setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, content: x.content + t } : x))), ctl.current.signal)
		} catch (e) {
			if (e.name !== 'AbortError') setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, content: 'No pude conectarme con el servidor.' } : x)))
		}
		setBusy(false)
	}

	const body = (
		<>
			<div className="chat-head">
				<div>
					<h3>El ingeniero</h3>
					<span className="small">Responde con los datos de tu planta</span>
				</div>

				{!inline && (
					<button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
						<svg width="16" height="16" viewBox="0 0 16 16">
						<path d="M2 2 L14 14 M14 2 L2 14" stroke="currentColor" strokeWidth="2.4" />
						</svg>
					</button>
				)}
			</div>

			<div className="chat-log" ref={log}>
				{msgs.length === 0 && (
					<div className="stack">
						<p className="small">{context?.plant ? 'Pregúntame lo que quieras sobre tu planta.' : 'Primero arma tu plano en el paso 1; luego te respondo con sus datos.'}</p>
						<div className="chat-suggest">
							{suggestions(context).map((s) => (
								<button key={s} type="button" onClick={() => send(s)}>
									{s}
								</button>
							))}
						</div>
					</div>
				)}

				{msgs.map((m, i) => (
					<div key={i} className={`msg msg--${m.role === 'user' ? 'user' : 'ai'}`}>
						{m.content || <span className="caret" />}
					</div>
				))}
			</div>

			<form
				className="chat-form"
				onSubmit={(e) => {
					e.preventDefault()
					send(input)
				}}
			>
				<input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribe tu pregunta" aria-label="Pregunta" autoFocus={!inline} />
				<button type="submit" className="btn" disabled={busy || !input.trim()}>
					Enviar
				</button>
			</form>
		</>
	)

	if (inline) return <div className="chat chat--inline">{body}</div>

	return (
		<AnimatePresence>
			{open && (
				<>
					<motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
					<motion.aside className="chat" role="dialog" aria-label="Pregúntale al ingeniero" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
						{body}
					</motion.aside>
				</>
			)}
		</AnimatePresence>
	)
}