import { useEffect, useMemo, useRef, useState } from 'react'
import { api, fmt, pct } from '../api'
import FlowPlan from '../charts/FlowPlan'
import WaitPanel from '../components/WaitPanel'
import { startWait } from '../components/wait'
import PlanEditor from '../editor/PlanEditor'
import Btn from '../fx/Btn'
import { Appear, RevealTitle } from '../fx/Reveal'
import OptionPicker from '../components/OptionPicker'
import FlowsPanel from '../components/FlowsPanel'
import { protectLocked, samePlant } from '../proposals'
import PlantView from '../three/PlantView'

export function Delta({ label, unit, before, after, decimals = 0, goodWhenUp }) {
	const p = pct(before, after)
	const good = goodWhenUp ? p > 0 : p < 0
	const max = Math.max(before || 0, after || 0) || 1

	return (
		<div className="kpi">
			<div className="kpi-value num">
				{p > 0 ? '+' : p < 0 ? '−' : ''}
				{Math.abs(p)}
				<small>%</small>
			</div>

			<div className="kpi-label">{label}</div>

			<div className="kpi-sub">
				{fmt(before, decimals)} → {fmt(after, decimals)} {unit}
			</div>

			<div className="kpi-bars" aria-hidden="true">
				<span style={{ width: `${((before || 0) / max) * 100}%`, background: '#c2c2c2' }} />
				<span style={{ width: `${((after || 0) / max) * 100}%`, background: good ? '#000' : '#767676' }} />
			</div>
		</div>
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

export default function Redesign({ plant, analysis, redesign, setRedesign, onAddAlternative, catalog, analysisRev = 0, notify = () => {}, onNext }) {
	const [picking, setPicking] = useState(false)
	const cur = analysis.current
	const alts = analysis.alternatives

	const view = useRef(null)

	const [showOriginal, setShowOriginal] = useState(!redesign.choice)
	const choice = redesign.choice

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

	useEffect(() => {
		if (choice !== 'propio' || !custom) return

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
	}, [choice, redesign.custom])

	const [compact, setCompact] = useState({ loading: false, error: null })

	// La quinta opción se pide a la IA solo cuando el usuario la quiere (tarda uno o dos minutos).
	const askCompact = async () => {
		setCompact({ loading: true, error: null })
		try {
			const done = startWait('compact')
			const alt = await api.compact(plant)
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

	// Aplicar copia la propuesta a «Tu rediseño» en un solo paso que se puede deshacer.
	// Lo fijo conserva su lugar aunque la propuesta lo haya movido (funciona con cualquier backend).
	const apply = (a) => {
		const { positions: pos, moved } = protectLocked(plant, plant.layout, a.positions)
		const prev = { choice: redesign.choice ?? null, custom: redesign.custom ?? null, metrics: redesign.metrics ?? null, basedOnRev: redesign.basedOnRev }
		setRedesign({ choice: 'propio', custom: { plant, positions: pos }, metrics: null, basedOnRev: analysisRev, undoApply: [...(redesign.undoApply || []), prev].slice(-20) })
		setShowOriginal(false)
		view.current?.setLayout(pos, { legs: moved.length ? undefined : a.metrics.legs })
		notify(moved.length ? `Se aplicó «${a.name}». ${moved.join(', ')} ${moved.length > 1 ? 'están fijos y se quedaron' : 'está fijo y se quedó'} en su lugar.` : `Se aplicó «${a.name}» a tu rediseño. Puedes deshacerlo.`)
	}

	const undoApply = () => {
		const stack = redesign.undoApply || []
		const prev = stack[stack.length - 1]
		if (!prev) return
		setRedesign({ ...prev, undoApply: stack.slice(0, -1) })
		const pos = prev.choice === 'propio' ? (prev.custom?.positions || prev.custom) : alts.find((x) => x.id === prev.choice)?.positions
		if (pos) view.current?.setLayout(pos, {})
		else setShowOriginal(true)
		notify('Se deshizo la última propuesta aplicada.')
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
	const cards = [
		...alts.filter((a) => a.id !== 'ia').map((a) => ({ id: a.id, name: a.name, summary: a.summary, works: a.works, m: a.metrics })),
		aiAlt
			? { id: 'ia', name: aiAlt.name, summary: aiAlt.summary, works: aiAlt.works, m: aiAlt.metrics, reasons: aiAlt.reasons, source: aiAlt.source, model: aiAlt.model }
			: { id: 'ia', name: 'Compacta con IA', pending: true },
		...(custom ? [{ id: 'propio', name: 'Tu rediseño', summary: 'Tu versión, ajustada a mano en el editor de abajo.', works: works ? `${works} cambios de obra (paredes, zonas, portones o máquinas).` : 'Solo mover máquinas.', m: redesign.metrics }] : []),
	]

	return (
		<section className="step">
			<header className="step-head">
				<span className="step-index"><b>Paso 4 de 6</b><span>Rediseño</span></span>
				<RevealTitle text="Elige cómo ordenar la planta." />
				<p className="lede">Cuatro acomodos calculados para tu flujo y uno que la IA busca para ocupar el menor espacio, siempre respetando tu planta y lo que fijaste. Selecciona una opción para ver cómo se mueven las máquinas.</p>
			</header>

			{(() => {
				const cardOf = cards.find((c) => c.id === choice && !c.pending)
				const shown = showOriginal ? null : cardOf
				const best = cards.find((c) => c.id === analysis.recommended)
				const p = shown?.m ? pct(cur.piece_m, shown.m.piece_m) : null
				return (
					<Appear className="choice-box">
						<div className="choice-main">
							<span className="inspector-kicker">{shown ? 'Opción que estás viendo' : 'Estado de hoy'}</span>
							<h3>
								{shown ? shown.name : 'Sin rediseño elegido'}
								{shown?.id === analysis.recommended && <span className="picker-tag">Recomendada</span>}
								{shown?.id === 'propio' && <span className="picker-tag">Tuya</span>}
							</h3>
							<p className="choice-figure num">
								{fmt(shown?.m ? shown.m.piece_m : cur.piece_m, 1)}
								<small> m por pieza</small>
								{p != null && <small className="choice-delta">{p > 0 ? `+${p}` : p} % frente a hoy</small>}
							</p>
							<p className="small">
								{shown ? shown.summary : best ? `La recomendada es «${best.name}» (${fmt(best.m?.piece_m, 1)} m por pieza). ${analysis.recommended_reason || ''}` : 'Elige un acomodo para ver cómo se mueven las máquinas.'}
							</p>
						</div>
						<div className="choice-actions">
							<Btn size="small" onClick={() => setPicking(true)}>
								{shown ? 'Cambiar opción' : 'Elegir opción'}
							</Btn>
							{shown && shown.id !== 'propio' && shown.m?.legs && (
								<button type="button" className="btn btn--ghost btn--small" onClick={() => apply(alts.find((x) => x.id === shown.id))} title="Copia esta propuesta a «Tu rediseño» para ajustarla. Se puede deshacer.">
									Aplicar a tu rediseño
								</button>
							)}
							<span className="small">{cards.filter((c) => !c.pending).length} opciones calculadas</span>
						</div>
					</Appear>
				)
			})()}

			<OptionPicker
				open={picking}
				onClose={() => setPicking(false)}
				cards={cards}
				cur={cur}
				choice={showOriginal ? null : choice}
				recommended={analysis.recommended}
				ideal={analysis.ideal}
				onPick={(id) => (pick(id), setPicking(false))}
				onApply={(id) => (apply(alts.find((x) => x.id === id)), setPicking(false))}
				compact={compact}
				onAskCompact={() => (setPicking(false), askCompact())}
			/>

			{(redesign.undoApply?.length > 0 || (custom && redesign.basedOnRev != null && redesign.basedOnRev !== analysisRev)) && (
				<div className="row small" style={{ marginTop: 12 }}>
					{custom && redesign.basedOnRev != null && redesign.basedOnRev !== analysisRev && <span>«Tu rediseño» se hizo sobre una versión anterior del plano: se conservó tal cual, revísalo.</span>}
					{redesign.undoApply?.length > 0 && (
						<button type="button" className="btn btn--ghost btn--small" onClick={undoApply}>
							Deshacer lo aplicado
						</button>
					)}
				</div>
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
					<div className="chart-head" style={{ margin: '40px 0 16px' }}>
						<div>
							<h2>Ajusta el rediseño</h2>
							<p className="small">Cambia lo que quieras: máquinas, rutas, paredes, zonas y portones.</p>
						</div>
					</div>

					<PlanEditor plant={selPlant} positions={positions} onChange={onEdit} catalog={catalog} mode="full" onMetrics={onLive} title="Editor del rediseño" />

					<Appear className="kpis" style={{ marginTop: 32, gridTemplateColumns: 'minmax(0, 1fr)' }}>
						{metrics ? (
							<Delta label="Recorrido de una pieza" unit="m" before={cur.piece_m} after={metrics.piece_m} decimals={1} />
						) : (
							<div className="kpi">
								<p className="small">Calculando…</p>
							</div>
						)}
					</Appear>

					<div className="grid-2" style={{ marginTop: 32 }}>
						<Appear className="block">
							<FlowPlan plant={plant} positions={plant.layout} legs={cur.legs} title="Hoy" total={cur.piece_m} bottleneck={cur.bottleneck} compact />
						</Appear>

						<Appear className="block" delay={0.1}>
							<FlowPlan plant={selPlant} positions={positions} legs={metrics?.legs} title={name} total={metrics?.piece_m} bottleneck={metrics?.bottleneck} compact />
						</Appear>
					</div>

					{cur.flows && (
						<div style={{ marginTop: 24 }}>
							<FlowsPanel plant={plant} current={cur} metrics={metrics} name={name} />
						</div>
					)}

					{metrics?.avoid_hits?.length > 0 && (
						<p className="small" style={{ marginTop: 16 }}>
						Aviso: {metrics.avoid_hits.map((h) => h.text).join('; ')}.
						</p>
					)}

					<div className="row" style={{ marginTop: 32 }}>
						<Btn onClick={onNext}>Generar el reporte</Btn>
						<span className="small">Se usará «{name}».</span>
					</div>
				</>
			)}
		</section>
	)
}