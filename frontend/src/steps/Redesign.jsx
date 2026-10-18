import { useEffect, useMemo, useRef, useState } from 'react'
import { api, fmt, pct } from '../api'
import FlowPlan from '../charts/FlowPlan'
import LeadChart from '../charts/LeadChart'
import WaitPanel from '../components/WaitPanel'
import { startWait } from '../components/wait'
import PlanEditor from '../editor/PlanEditor'
import Btn from '../fx/Btn'
import { Appear, RevealTitle } from '../fx/Reveal'
import Criteria from '../components/Criteria'
import FlowsPanel from '../components/FlowsPanel'
import { has } from '../capabilities'
import { protectLocked } from '../proposals'
import useCaps from '../useCaps'
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

function Dots({ n }) {
	return (
		<span className="dots" aria-label={`${n} operarios`}>
		{n === 0 ? <i data-off="true" /> : Array.from({ length: n }, (_, i) => <i key={i} />)}
		</span>
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

export default function Redesign({ plant, analysis, redesign, setRedesign, onAddAlternative, catalog, analysisRev = 0, notify = () => {}, weights, onReweigh, onNext }) {
	const caps = useCaps()
	const [reweighing, setReweighing] = useState(false)
	const reweigh = async (w) => {
		setReweighing(true)
		await onReweigh(w)
		setReweighing(false)
	}
	const cur = analysis.current
	const alts = analysis.alternatives
	const full = plant.use_assumptions && cur.daily_m != null

	const view = useRef(null)

	const [showOriginal, setShowOriginal] = useState(!redesign.choice)
	const choice = redesign.choice

	const alt = alts.find((a) => a.id === choice)
	const custom = redesign.custom ? (redesign.custom.positions ? redesign.custom : { plant, positions: redesign.custom }) : null

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
			ops: plant.use_assumptions ? (showing || !metrics ? Object.fromEntries(plant.stations.map((s) => [s.id, s.ops || 0])) : m.ops || {}) : {},
			bottleneck: m.bottleneck,
			bottleneckUtil: m.bottleneck_util,
			legs: m.legs,
		}
	}, [showing, metrics, cur, plant])

	const moves = useMemo(() => {
		if (!full || !metrics?.ops) return []
		return plant.stations.map((s) => ({ id: s.id, name: s.name, before: s.ops || 0, after: metrics.ops[s.id] ?? 0 })).filter((x) => x.before !== x.after)
	}, [full, metrics, plant])

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
				<p className="lede">Tres acomodos calculados para tu flujo y uno que la IA busca para ocupar el menor espacio, siempre respetando tu planta. Selecciona una opción para ver cómo se mueven las máquinas.</p>
			</header>

			<Appear className="alts" style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }}>
				{cards.map((a) => {
					const p = a.m ? pct(cur.piece_m, a.m.piece_m) : null

					if (a.pending)
						return (
							<div key={a.id} className="alt alt--ask">
								<span className="alt-best">IA</span>
								<h3>{a.name}</h3>
								<Btn size="small" onClick={askCompact} disabled={compact.loading}>
									{compact.loading ? 'Pensando…' : 'Calcular con IA'}
								</Btn>
								{compact.loading && <p className="small">Mira el avance abajo.</p>}
								{compact.error && <p className="small">{compact.error}</p>}
							</div>
						)

					return (
						<div key={a.id} className="alt" data-on={a.id === choice && !showOriginal} onClick={() => pick(a.id)}>
							{a.id === analysis.recommended && <span className="alt-best">RECOMENDADA</span>}
							{a.id === analysis.ideal && a.id !== analysis.recommended && <span className="alt-best">IDEAL</span>}
							{a.kind === 'ideal' && <span className="small">No respeta lo fijo o no cabe: solo como referencia.</span>}
							{a.id === 'propio' && <span className="alt-best">TUYA</span>}
							{a.id === 'ia' && <span className="alt-best">{a.source === 'ia' ? 'IA' : 'SIN IA: ORDEN DEL FLUJO'}</span>}

							<h3>{a.name}</h3>

							<div className="alt-figure num">
								{a.m ? fmt(a.m.piece_m, 1) : '…'}
								<small style={{ fontSize: '0.35em', marginLeft: 6 }}>m por pieza</small>
							</div>

							{p != null && <span className="small num">{p > 0 ? `+${p}` : p} % frente a hoy</span>}
							{a.m?.footprint_m2 != null && (
								<span className="small num">
									Ocupa {fmt(a.m.footprint_m2)} m²{cur.footprint_m2 ? ` (hoy ${fmt(cur.footprint_m2)} m²)` : ''}
								</span>
							)}
							<p className="small">{a.summary}</p>
							<p className="small">Obra: {a.works}</p>
							<div className="alt-actions">
								<button type="button" className="alt-act" aria-pressed={a.id === choice && !showOriginal} onClick={(e) => (e.stopPropagation(), pick(a.id))}>
									Ver
								</button>
								{a.id !== 'propio' && a.m?.legs && (
									<button type="button" className="alt-act" onClick={(e) => (e.stopPropagation(), apply(alts.find((x) => x.id === a.id)))} title="Copia esta propuesta a «Tu rediseño» para ajustarla. Se puede deshacer.">
										Aplicar
									</button>
								)}
							</div>
						</div>
					)
				})}
			</Appear>

			{analysis.recommended_reason && (
				<div className="why small">
					<strong>Por qué se recomienda.</strong> {analysis.recommended_reason}
					{analysis.main_metric && <> Métrica principal: {analysis.main_metric.label.toLowerCase()}.</>}
					{analysis.recommended_tradeoffs?.length > 0 && (
						<>
							{' '}A cambio, empeora:
							<ul>
								{analysis.recommended_tradeoffs.map((t) => (
									<li key={t.metric}>{t.note}</li>
								))}
							</ul>
						</>
					)}
				</div>
			)}

			<Criteria key={analysis.plant_version + JSON.stringify(analysis.weights_used || {})} analysis={analysis} canWeigh={has(caps, 'weights') && !!onReweigh} weights={weights} onReweigh={reweigh} busy={reweighing} />

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

			{/* La explicación de la opción con IA va aparte, para que su tarjeta mida lo mismo que las demás. */}
			<div className="alt-note small">
				<strong>Compacta con IA.</strong> Se analizan las estaciones, el flujo y las zonas para decidir qué conviene juntar y desde qué esquina empezar. Después las máquinas se acomodan en el menor espacio sin alargar el recorrido.
				{aiAlt?.reasons?.length > 0 && (
					<>
						{' '}Criterio aplicado:
						<ul className="alt-reasons">
							{aiAlt.reasons.map((r, i) => (
								<li key={i}>{r}</li>
							))}
						</ul>
					</>
				)}
			</div>

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

					<Appear className="kpis" style={{ marginTop: 32, gridTemplateColumns: `repeat(${full ? 4 : 1}, minmax(0, 1fr))` }}>
						{metrics ? (
							full ? (
								<>
									<Delta label="Camina el material" unit="m al día" before={cur.daily_m} after={metrics.daily_m} />
									<Delta label="Capacidad" unit="piezas al día" before={cur.capacity} after={metrics.capacity} decimals={1} goodWhenUp />
									<Delta label="Tiempo por pieza" unit="h" before={cur.lead_h} after={metrics.lead_h} decimals={1} />
									<Delta label="Carga de camiones" unit="min al día" before={cur.loading_min} after={metrics.loading_min} />
								</>
							) : (
								<Delta label="Recorrido de una pieza" unit="m" before={cur.piece_m} after={metrics.piece_m} decimals={1} />
							)
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

					{full && metrics?.lead_parts && (
						<div className="grid-2" style={{ marginTop: 24 }}>
							<Appear className="block">
								<LeadChart before={cur} after={metrics} />
							</Appear>

							<Appear className="block" delay={0.1}>
								<h3>Cambios de operarios</h3>

								<p className="small" style={{ margin: '6px 0 14px' }}>
									Las mismas personas, mejor repartidas.
									{metrics.bottleneck && ` Nuevo cuello de botella: ${plant.stations.find((s) => s.id === metrics.bottleneck)?.name.toLowerCase()} al ${fmt(metrics.bottleneck_util * 100)} %.`}
								</p>

								<div className="moves">
									{moves.length === 0 && <p className="small" style={{ padding: '12px 0' }}>Nadie cambia de puesto.</p>}

									{moves.map((x) => (
										<div key={x.id} className="move">
											<span style={{ fontWeight: 650 }}>{x.name}</span>
											<span className="move-arrow">
												<Dots n={x.before} />→<Dots n={x.after} />
											</span>
										</div>
									))}
								</div>
							</Appear>
						</div>
					)}

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