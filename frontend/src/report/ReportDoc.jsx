import { useState } from 'react'
import { fmt, pct } from '../api'
import FlowMark from '../brand/FlowMark'
import Wordmark from '../brand/Wordmark'
import FlowPlan from '../charts/FlowPlan'
import RelChart from '../charts/RelChart'

const Delta = ({ before, after, up }) => {
	const p = pct(before, after)
	if (before == null || after == null) return <td className="num">—</td>
	const good = up ? p > 0 : p < 0

	return (
		<td className="num" style={{ fontWeight: good ? 800 : 500 }}>
			{p > 0 ? '+' : p < 0 ? '−' : ''}
			{Math.abs(p)} %
		</td>
	)
}

export default function ReportDoc({ plant, analysis, chosen, notes = [], reportText, catalog }) {
	const cur = analysis.current
	const m = chosen?.metrics
	const full = plant.use_assumptions && cur.daily_m != null
	const names = Object.fromEntries(plant.stations.map((s) => [s.id, s.name]))
	const kindName = Object.fromEntries((catalog?.kinds || []).map((k) => [k.id, k.name]))
	const [today] = useState(() => new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }))
	const legNew = Object.fromEntries((m?.legs || []).map((l) => [l.id, l]))
	const legOld = Object.fromEntries((cur.legs || []).map((l) => [l.id, l]))

	const rows = [
		['Recorrido de una pieza', 'm', cur.piece_m, m?.piece_m, 1, false],
		...(full
		? [
			['Material que se mueve al día', 'm', cur.daily_m, m?.daily_m, 0, false],
			['Capacidad', 'piezas al día', cur.capacity, m?.capacity, 1, true],
			['Tiempo de fabricación', 'h por pieza', cur.lead_h, m?.lead_h, 1, false],
			['Carga de camiones', 'min al día', cur.loading_min, m?.loading_min, 0, false],
			]
		: []),
	]

	const after = chosen?.plant || plant
	const ids = new Set(plant.stations.map((s) => s.id))

	const moved = chosen
		? [...plant.stations, ...after.stations.filter((s) => !ids.has(s.id))].map((s) => {
			const a = plant.layout[s.id]
			const b = after.stations.some((q) => q.id === s.id) ? chosen.positions[s.id] : null
			const dist = a && b ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) : 0
			const turned = a && b && Math.round((a[2] || 0) - (b[2] || 0)) % 360 !== 0
			return { s, a, b, dist, turned }
		})
		: []

	const count = (k) => JSON.stringify(plant[k] || []) !== JSON.stringify(after[k] || [])
	const works = [count('walls') && 'paredes', count('zones') && 'zonas', (count('gates') || plant.receive_gate !== after.receive_gate || plant.dispatch_gate !== after.dispatch_gate) && 'portones'].filter(Boolean)

	return (
		<article className="doc">
			<header className="doc-head">
				<div className="doc-brand">
					<FlowMark size={54} state="u" color="#000" runner={false} />
					<Wordmark size="2.1rem" animate={false} />
				</div>

				<div className="doc-meta">
					<span>Reporte de distribución de planta</span>
					<span>{today}</span>
				</div>
			</header>

			<section className="doc-cover">
				<span className="doc-kicker">{plant.industry || 'Planta'}</span>

				<h1>{plant.name}</h1>
				<p>
					Bodega de {plant.size.w} × {plant.size.d} m · {plant.stations.length} estaciones · {plant.routes.length} rutas del material
					{chosen ? ` · Rediseño: ${chosen.name}` : ''}
				</p>
			</section>

			<section className="doc-section">
				<h2>Resumen</h2>

				<table className="doc-table">
					<thead>
						<tr>
							<th>Indicador</th>
							<th className="num">Hoy</th>
							<th className="num">{chosen ? chosen.name : 'Rediseño'}</th>
							<th className="num">Cambio</th>
						</tr>
					</thead>
					<tbody>
						{rows.map(([label, unit, a, b, d, up]) => (
							<tr key={label}>
								<td>{label} <span className="doc-unit">({unit})</span></td>
								<td className="num">{fmt(a, d)}</td>
								<td className="num">{fmt(b, d)}</td>
								<Delta before={a} after={b} up={up} />
							</tr>
						))}
					</tbody>
				</table>

				{!full && <p className="doc-note">Sin supuestos de tiempos ni producción: el análisis cubre recorridos y cercanía entre áreas.</p>}
			</section>

			<section className="doc-section doc-plans">
				<div>
					<h3>Hoy</h3>
					<FlowPlan plant={plant} positions={plant.layout} legs={cur.legs} bottleneck={cur.bottleneck} compact still />
				</div>

				{chosen && (
					<div>
						<h3>{chosen.name}</h3>
						<FlowPlan plant={after} positions={chosen.positions} legs={m?.legs} bottleneck={m?.bottleneck} compact still />
					</div>
				)}
			</section>

			{chosen && (
				<section className="doc-section doc-break">
					<h2>Qué se mueve</h2>
					{works.length > 0 && <p className="doc-note" style={{ marginBottom: 12 }}>El rediseño incluye obra: cambian {works.join(', ')}.</p>}

					<table className="doc-table">
						<thead>
							<tr>
								<th>Estación</th>
								<th>Tipo</th>
								<th className="num">Hoy (x, z)</th>
								<th className="num">Nuevo (x, z)</th>
								<th className="num">Se mueve</th>
							</tr>
						</thead>
						<tbody>
							{moved.map(({ s, a, b, dist, turned }) => (
								<tr key={s.id}>
									<td>{s.name}</td>
									<td>{kindName[s.kind] || s.kind}</td>
									<td className="num">{a ? `${fmt(a[0], 1)}, ${fmt(a[1], 1)}` : '—'}</td>
									<td className="num">{b ? `${fmt(b[0], 1)}, ${fmt(b[1], 1)}` : '—'}</td>
									<td className="num">
										{!a ? 'Nueva' : !b ? 'Se quita' : dist < 0.1 ? 'Se queda' : `${fmt(dist, 1)} m`}
										{turned ? ' y gira' : ''}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			)}

			<section className="doc-section">
				<h2>Rutas del material</h2>

				<table className="doc-table">
					<thead>
						<tr>
							<th>De</th>
							<th>A</th>
							<th className="num">% de piezas</th>
							<th className="num">Hoy (m)</th>
							{chosen && <th className="num">Rediseño (m)</th>}
						</tr>
					</thead>
					<tbody>
						{plant.routes.map((r) => (
							<tr key={r.id}>
								<td>{names[r.from]}</td>
								<td>{names[r.to]}</td>
								<td className="num">{Math.round((r.frac ?? 1) * 100)}</td>
								<td className="num">{fmt(legOld[r.id]?.dist, 1)}</td>
								{chosen && <td className="num">{fmt(legNew[r.id]?.dist, 1)}</td>}
							</tr>
						))}
					</tbody>
				</table>
			</section>

			<section className="doc-section doc-break">
				<h2>Cercanía entre áreas</h2>
				<RelChart relations={analysis.relations} title="" />
			</section>

			{full && (
				<section className="doc-section">
					<h2>Supuestos usados</h2>
					
					<table className="doc-table">
						<tbody>
							{(catalog?.assumptions || []).map((a) => (
								<tr key={a.key}>
									<td>{a.label}</td>
									<td className="num">
										{fmt(plant.params?.[a.key] ?? a.value, Number.isInteger(Number(plant.params?.[a.key] ?? a.value)) ? 0 : 2)} {a.unit}
									</td>
								</tr>
							))}

							{plant.stations.map((s) => (
								<tr key={s.id}>
									<td>{s.name}</td>
									<td className="num">
										{fmt(s.t, 1)} min por pieza · {s.ops} {s.ops === 1 ? 'operario' : 'operarios'}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			)}

			{(reportText || notes.length > 0) && (
				<section className="doc-section">
				<h2>Conclusiones del ingeniero</h2>

				{reportText && <p className="doc-text">{reportText}</p>}

				{notes.length > 0 && (
					<ul className="doc-list">
						{notes.map((n, i) => (
							<li key={i}>{n}</li>
						))}
					</ul>
				)}
				</section>
			)}

			<footer className="doc-foot">
				<span>Cauce · el recorrido de tu planta, en orden.</span>
				<span>Los números salen del plano y de los supuestos indicados; confírmalos con datos medidos.</span>
			</footer>
		</article>
	)
}