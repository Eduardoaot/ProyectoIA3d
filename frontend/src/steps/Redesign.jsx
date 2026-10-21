import { useEffect, useMemo, useRef, useState } from 'react'
import { api, fmt, pct } from '../api'
import FlowPlan from '../charts/FlowPlan'
import Criteria from '../components/Criteria'
import WaitPanel from '../components/WaitPanel'
import { startWait } from '../components/wait'
import PlanEditor from '../editor/PlanEditor'
import Btn from '../fx/Btn'
import { Appear, RevealTitle } from '../fx/Reveal'
import OptionPicker from '../components/OptionPicker'
import { samePlant } from '../proposals'
import PlantView from '../three/PlantView'

/* Lo que gana (o pierde) la opción aplicada frente a hoy, dicho en una frase y con cifras grandes. */
function Outcome({ plant, cur, m, name, after, positions }) {
	const before = cur.piece_m
	const now = m.piece_m
	const p = pct(before, now)
	const diff = (now || 0) - (before || 0)
	const max = Math.max(before || 0, now || 0) || 1
	const good = p < 0
	const names = Object.fromEntries(after.stations.map((s) => [s.id, s.name]))
	const moved = plant.stations.filter((s) => {
		const a = plant.layout[s.id]
		const b = positions?.[s.id]
		return a && b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 0.1
	}).length

	const stats = [
		{ label: 'Máquinas que se mueven', value: `${moved} de ${plant.stations.length}` },
		cur.daily_m != null && m.daily_m != null && { label: 'Metros al día', value: `${fmt(cur.daily_m)} → ${fmt(m.daily_m)} m` },
		cur.lead_h != null && m.lead_h != null && { label: 'Tiempo de entrega', value: `${fmt(cur.lead_h, 1)} → ${fmt(m.lead_h, 1)} h` },
		m.bottleneck && { label: 'Cuello de botella', value: names[m.bottleneck] || m.bottleneck },
	].filter(Boolean)

	return (
		<div className="outcome">
			<div className="outcome-big num" data-good={good}>
				{p > 0 ? '+' : p < 0 ? '−' : ''}
				{Math.abs(p)}
				<small>%</small>
			</div>

			<div className="outcome-text">
				<span className="inspector-kicker">Recorrido de una pieza</span>
				<h3>
					{Math.abs(diff) < 0.05
						? `Con «${name}» cada pieza recorre lo mismo que hoy.`
						: `Con «${name}» cada pieza recorre ${fmt(Math.abs(diff), 1)} m ${diff < 0 ? 'menos' : 'más'} que hoy.`}
				</h3>
				<p className="small">
					{good
						? 'Menos metros por pieza es menos tiempo moviendo material, menos montacargas y menos manipulación.'
						: p > 0
							? 'Este acomodo alarga el recorrido. Puede convenir por otros criterios (espacio, obra, cercanía entre áreas): revisa «Cómo se comparan» abajo.'
							: 'El recorrido queda igual; la diferencia está en otros criterios.'}
				</p>
			</div>

			<div className="outcome-bars" aria-hidden="true">
				<span>Hoy</span>
				<i>
					<b style={{ width: `${((before || 0) / max) * 100}%` }} />
				</i>
				<span className="num">{fmt(before, 1)} m</span>

				<span>{name}</span>
				<i data-new data-good={good}>
					<b style={{ width: `${((now || 0) / max) * 100}%` }} />
				</i>
				<span className="num">{fmt(now, 1)} m</span>
			</div>

			<dl className="outcome-stats">
				{stats.map((s) => (
					<div key={s.label}>
						<dt>{s.label}</dt>
						<dd className="num">{s.value}</dd>
					</div>
				))}
			</dl>
		</div>
	)
}

/* Opción fuera de la ventana de acomodos (la de IA y la tuya): mismo formato que «Opción aplicada». */
function AltCard({ kicker, title, m, empty, cur, on, text, note, action }) {
	const p = m ? pct(cur.piece_m, m.piece_m) : null
	return (
		<Appear className={`choice-box choice-box--alt${on ? ' is-on' : ''}`}>
			<div className="choice-main">
				<span className="inspector-kicker">{kicker}</span>
				<h3>
					{title}
					{on && <span className="picker-tag">Aplicada</span>}
				</h3>
				{m ? (
					<p className="choice-figure num">
						{fmt(m.piece_m, 1)}
						<small> m por pieza</small>
						{p != null && <small className="choice-delta">{p > 0 ? `+${p}` : p} % frente a hoy</small>}
					</p>
				) : (
					<p className="choice-status">{empty}</p>
				)}
				<p className="small">{text}</p>
				{note && <p className="small warn">{note}</p>}
			</div>
			{!on && action && <div className="choice-actions">{action}</div>}
		</Appear>
	)
}

function worksDiff(base, other) {
	if (!other || other === base) return 0

	const key = (list) => new Set(list.map((x) => JSON.stringify(x)))
	let n = 0

	for (const k of ['walls', 'zones', 'gates']) {
		const A = key(base[k] || [])
		const B = key(other[k] || [])
		n += [...A].filter((x) => !B.has(x)).length + [...B].filter((x) => !A.has(x)).length
	}

	const ids = (p) => new Set(p.stations.map((s) => s.id))
	const sa = ids(base)
	const sb = ids(other)

	n += [...sa].filter((x) => !sb.has(x)).length + [...sb].filter((x) => !sa.has(x)).length
	if (base.receive_gate !== other.receive_gate || base.dispatch_gate !== other.dispatch_gate) n += 1
	if (JSON.stringify(base.outline || null) !== JSON.stringify(other.outline || null)) n += 1

	return n
}

export default function Redesign({ analysisContext, canOptimize = true, plant, analysis, weights, prioritiesEnabled = true, onOpenContext, redesign, setRedesign, onAddAlternative, catalog, analysisRev = 0, onNext }) {
	const [picking, setPicking] = useState(false)
	const cur = analysis.current
	const alts = analysis.alternatives

	const view = useRef(null)
	const editorRef = useRef(null)

	// Sin elección guardada se aplica la recomendada: el paso abre con una propuesta, no vacío.
	const fallback = alts.some((a) => a.id === analysis.recommended) ? analysis.recommended : alts.find((a) => a.id !== 'ia')?.id
	const choice = redesign.choice ?? fallback ?? null
	const [showOriginal, setShowOriginal] = useState(!choice)

	useEffect(() => {
		if (!redesign.choice && fallback) setRedesign({ choice: fallback })
	}, [redesign.choice, fallback, setRedesign])

	const alt = alts.find((a) => a.id === choice)
	const savedCustom = redesign.custom ? (redesign.custom.positions ? redesign.custom : { plant, positions: redesign.custom }) : null
	// Un rediseño guardado de otra planta no se dibuja sobre esta (otro edificio, otras paredes).
	const custom = savedCustom && samePlant(savedCustom.plant, plant) ? savedCustom : null

	const sel = choice === 'propio' ? custom : alt ? { plant, positions: alt.positions } : null
	const positions = sel?.positions
	const selPlant = sel?.plant || plant

	const metrics = choice === 'propio' ? redesign.metrics : alt?.metrics
	const name = choice === 'propio' ? 'Tu rediseño' : alt?.name

	const showing = showOriginal || !sel
	const shownPlant = showing ? plant : selPlant
	const shownPositions = showing ? plant.layout : positions

	const works = worksDiff(plant, custom?.plant)

	// Las cifras de «Tu rediseño» se calculan aunque no esté aplicado: su cuadro las muestra.
	useEffect(() => {
		if (!custom) return

		const c = new AbortController()
		const t = setTimeout(() => {
			api
				.evaluate(custom.plant, custom.positions, true, c.signal)
				.then((m) => setRedesign({ metrics: m }))
				.catch(() => {})
		}, 400)

		return () => {
			clearTimeout(t)
			c.abort()
		}
	}, [redesign.custom])

	const [compact, setCompact] = useState({ loading: false, error: null })

	// La opción con IA se pide solo cuando el usuario la quiere (tarda uno o dos minutos).
	const askCompact = async () => {
		if (!canOptimize) { setCompact({ loading: false, error: 'Revisa y confirma el plano y el contexto antes de optimizar.' }); return }
		setCompact({ loading: true, error: null })
		try {
			const done = startWait('compact')
			const alt = await api.compact(plant, analysisContext, canOptimize)
			done()
			onAddAlternative(alt)
			setCompact({ loading: false, error: null })
			setRedesign({ choice: alt.id })
			setShowOriginal(false)
			view.current?.setLayout(alt.positions, { legs: alt.metrics.legs })
		} catch {
			setCompact({ loading: false, error: 'No se pudo calcular. Intenta de nuevo.' })
		}
	}

	// Aplicar una opción es elegirla: se ve en el 3D, se edita abajo y es la que va al reporte.
	const pick = (id) => {
		const a = alts.find((x) => x.id === id)
		const pos = id === 'propio' ? custom.positions : a.positions
		const legs = id === 'propio' ? redesign.metrics?.legs : a.metrics.legs

		setRedesign({ choice: id })
		setShowOriginal(false)

		view.current?.setLayout(pos, { legs })
	}

	const toggleOriginal = () => {
		if (showOriginal && positions) {
			setShowOriginal(false)
			view.current?.setLayout(positions, { legs: metrics?.legs })
		} else {
			setShowOriginal(true)
			view.current?.setLayout(plant.layout, { legs: cur.legs })
		}
	}

	const onEdit = (np, pos) => {
		setRedesign({ choice: 'propio', custom: { plant: np, positions: pos }, metrics: choice === 'propio' ? redesign.metrics : null, basedOnRev: analysisRev })
		setShowOriginal(false)
	}

	const onLive = (live) => {
		if (choice === 'propio' && custom && !showOriginal) view.current?.setLayout(custom.positions, { animate: false, legs: live.legs })
	}

	const extras = useMemo(() => {
		const m = showing || !metrics ? cur : metrics

		return {
			trucks: 2,
			ops: {},
			bottleneck: m.bottleneck,
			bottleneckUtil: m.bottleneck_util,
			legs: m.legs,
		}
	}, [showing, metrics, cur, plant])

	const aiAlt = alts.find((a) => a.id === 'ia')
	// La ventana solo trae los acomodos calculados; la de IA y la tuya van en el cuadro principal.
	const cards = alts.filter((a) => a.id !== 'ia').map((a) => ({ id: a.id, name: a.name, summary: a.summary, works: a.works, m: a.metrics }))
	const extra = [
		aiAlt && { id: 'ia', name: aiAlt.name, summary: aiAlt.summary, m: aiAlt.metrics },
		custom && { id: 'propio', name: 'Tu rediseño', summary: `Tu versión, ajustada a mano en el editor de abajo. ${works ? `${works} cambios de obra (paredes, zonas, portones o máquinas).` : 'Solo mover máquinas.'}`, m: redesign.metrics },
	].filter(Boolean)

	const shown = showOriginal ? null : [...cards, ...extra].find((c) => c.id === choice)
	const p = shown?.m ? pct(cur.piece_m, shown.m.piece_m) : null
	const tag = shown && (shown.id === analysis.recommended ? 'Recomendada' : shown.id === 'propio' ? 'Tuya' : shown.id === 'ia' ? 'IA' : null)

	return (
		<section className="step">
			<header className="step-head">
				<span className="step-index"><b>Paso 4 de 6</b><span>Rediseño</span></span>
				<RevealTitle text="Elige cómo ordenar la planta." />
				<p className="lede">Ya aplicamos el acomodo recomendado. Puedes cambiarlo por otro de los calculados para tu flujo, pedirle a la IA uno que ocupe el menor espacio o ajustarlo a mano, siempre respetando tu planta y lo que fijaste.</p>
			</header>

			<Appear className="choice-box">
				<div className="choice-main">
					<span className="inspector-kicker">{shown ? 'Opción aplicada' : 'Estado de hoy'}</span>
					<h3>
						{shown ? shown.name : 'Sin rediseño aplicado'}
						{tag && <span className="picker-tag">{tag}</span>}
					</h3>
					<p className="choice-figure num">
						{fmt(shown?.m ? shown.m.piece_m : cur.piece_m, 1)}
						<small> m por pieza</small>
						{p != null && <small className="choice-delta">{p > 0 ? `+${p}` : p} % frente a hoy</small>}
					</p>
					<p className="small">{shown ? shown.summary : 'Así está la planta hoy. Aplica un acomodo para ver cómo se mueven las máquinas.'}</p>
				</div>
				<div className="choice-actions">
					<Btn size="small" onClick={() => setPicking(true)}>
						Cambiar opción
					</Btn>
					<span className="small">{cards.length} acomodos calculados</span>
				</div>
			</Appear>

			<div className="choice-alts">
				<AltCard
					kicker="Opción con IA"
					title={aiAlt?.name || 'Compacta con IA'}
					m={aiAlt?.metrics}
					empty={compact.loading ? 'Calculando…' : 'Sin calcular todavía'}
					cur={cur}
					on={choice === 'ia' && !showOriginal}
					text={aiAlt ? aiAlt.summary : 'Junta las máquinas en el menor espacio sin alargar el recorrido. La IA tarda uno o dos minutos en pensarla.'}
					note={compact.error}
					action={
						aiAlt ? (
							<Btn size="small" variant="ghost" onClick={() => pick('ia')}>
								Aplicar
							</Btn>
						) : (
							<Btn size="small" onClick={askCompact} disabled={compact.loading || !canOptimize}>
								{compact.loading ? 'Calculando…' : 'Calcular con IA'}
							</Btn>
						)
					}
				/>
				<AltCard
					kicker="Hecha por ti"
					title="Tu rediseño"
					m={custom ? redesign.metrics : null}
					empty={custom ? 'Calculando…' : 'Aún sin cambios'}
					cur={cur}
					on={choice === 'propio' && !showOriginal}
					text={custom ? (extra.find((c) => c.id === 'propio')?.summary) : 'Todavía no lo tienes: se crea solo en cuanto cambias algo en el editor de abajo.'}
					action={
						custom ? (
							<Btn size="small" variant="ghost" onClick={() => pick('propio')}>
								Aplicar
							</Btn>
						) : (
							positions && (
								<Btn size="small" variant="ghost" onClick={() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
									Ir al editor
								</Btn>
							)
						)
					}
				/>
			</div>

			<OptionPicker
				open={picking}
				onClose={() => setPicking(false)}
				cards={cards}
				cur={cur}
				choice={showOriginal ? null : choice}
				recommended={analysis.recommended}
				ideal={analysis.ideal}
				onPick={(id) => (pick(id), setPicking(false))}
			/>

			{custom && redesign.basedOnRev != null && redesign.basedOnRev !== analysisRev && (
				<p className="small" style={{ marginTop: 12 }}>
					«Tu rediseño» se hizo sobre una versión anterior del plano: se conservó tal cual, revísalo.
				</p>
			)}

			{compact.loading && <WaitPanel kind="compact" className="reading--wide" title="Buscando el acomodo más compacto…" game={null} />}

			<Appear style={{ marginTop: 32 }}>
				<PlantView
					ref={view}
					plant={shownPlant}
					positions={shownPositions}
					extras={extras}
					buildKey="rediseno"
					onSelect={(id) => view.current?.focus(id)}
					tools={
						<Btn size="small" variant={showOriginal ? undefined : 'ghost'} onClick={toggleOriginal} disabled={!positions}>
							{showOriginal ? (positions ? `Ver ${name?.toLowerCase()}` : 'Estado original') : 'Estado original'}
						</Btn>
					}
				/>
			</Appear>

			{positions && (
				<>
					<Appear style={{ marginTop: 32 }}>
						{metrics ? (
							<Outcome plant={plant} cur={cur} m={metrics} name={name} after={selPlant} positions={positions} />
						) : (
							<div className="outcome">
								<p className="small">Calculando…</p>
							</div>
						)}
					</Appear>

					<div className="chart-head" ref={editorRef} style={{ margin: '40px 0 16px', scrollMarginTop: 24 }}>
						<div>
							<h2>Ajusta el rediseño</h2>
							<p className="small">Cambia lo que quieras: máquinas, rutas, paredes, zonas y portones.</p>
						</div>
					</div>

					<PlanEditor plant={selPlant} positions={positions} onChange={onEdit} catalog={catalog} mode="full" onMetrics={onLive} title="Editor del rediseño" />

					<div className="grid-2" style={{ marginTop: 32 }}>
						<Appear className="block">
							<FlowPlan plant={plant} positions={plant.layout} legs={cur.legs} title="Hoy" total={cur.piece_m} bottleneck={cur.bottleneck} compact />
						</Appear>

						<Appear className="block" delay={0.1}>
							<FlowPlan plant={selPlant} positions={positions} legs={metrics?.legs} title={name} total={metrics?.piece_m} bottleneck={metrics?.bottleneck} compact />
						</Appear>
					</div>

					{metrics?.avoid_hits?.length > 0 && (
						<p className="small" style={{ marginTop: 16 }}>
						Aviso: {metrics.avoid_hits.map((h) => h.text).join('; ')}.
						</p>
					)}
				</>
			)}

			<Appear className="block" style={{ marginTop: 32 }}>
				<div className="context-review-card">
					<div><h3>Tus prioridades</h3><p className="small">{prioritiesEnabled ? 'Los pesos se revisan junto con el contexto y el plano antes de recalcular.' : 'Prioridades desactivadas: se usan los pesos base del motor.'}</p></div>
					<button type="button" className="btn btn--ghost btn--small" onClick={() => onOpenContext('prioridades')}>Editar en contexto ↗</button>
				</div>
				<Criteria key={analysis.plant_version + JSON.stringify(analysis.weights_used || {})} analysis={analysis} canWeigh={false} weights={weights} />
			</Appear>

			{positions && (
				<div className="row" style={{ marginTop: 32 }}>
					<Btn onClick={onNext}>Generar el reporte</Btn>
					<span className="small">Se usará «{name}».</span>
				</div>
			)}
		</section>
	)
}
