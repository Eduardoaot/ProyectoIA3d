import { useEffect } from 'react'
import { fmt } from '../api'
import FlowPlan from '../charts/FlowPlan'
import LeadChart from '../charts/LeadChart'
import LoadChart from '../charts/LoadChart'
import RelChart from '../charts/RelChart'
import Btn from '../fx/Btn'
import { Appear, CountUp, RevealTitle, Tilt } from '../fx/Reveal'

function Kpi({ value, decimals = 0, unit, label, sub }) {
	return (
		<Tilt className="kpi" max={4}>
			<div className="kpi-value num">
				{value == null ? '—' : <CountUp value={value} decimals={decimals} />}
				<small>{unit}</small>
			</div>
			<div className="kpi-label">{label}</div>
			<div className="kpi-sub">{sub}</div>
		</Tilt>
	)
}

export default function Diagnosis({ plant, analysis, report, onNext }) {
	const cur = analysis.current
	const full = plant.use_assumptions && cur.daily_m != null
	const names = Object.fromEntries(plant.stations.map((s) => [s.id, s.name]))
	const bottleneck = cur.bottleneck && names[cur.bottleneck]

	useEffect(() => {
		if (full && report.state === 'idle') report.run()
	}, [full, report.state])

	const plan = (
		<FlowPlan
			plant={plant}
			positions={plant.layout}
			legs={cur.legs}
			title="Recorrido del material"
			total={full ? cur.daily_m : cur.piece_m}
			unit={full ? 'm al día' : 'm por pieza'}
			bottleneck={cur.bottleneck}
		/>
	)

	return (
		<section className="step">
			<header className="step-head">
				<span className="step-index"><b>Paso 3 de 6</b><span>Diagnóstico</span></span>

				{full && bottleneck ? <RevealTitle text={`El cuello de botella es ${bottleneck.toLowerCase()}.`} /> : <RevealTitle text="El flujo de tu material." />}

				<p className="lede">
					{full && bottleneck
						? `Trabaja al ${fmt(cur.bottleneck_util * 100)} % de lo que puede hacer y todo lo que viene después espera por ella.`
						: `Una pieza recorre ${fmt(cur.piece_m, 1)} m dentro de la planta. Sin supuestos solo analizo recorridos y cercanía entre áreas; activa los supuestos en el paso 1 para ver capacidad y tiempos.`}
				</p>
			</header>

			{full && (
				<Appear className="kpis">
					<Kpi value={cur.daily_m} unit="m" label="Camina el material al día" sub={`${fmt(cur.piece_m, 1)} m por pieza`} />
					<Kpi value={cur.capacity} decimals={1} unit="piezas" label="Capacidad al día" sub={`Producción: ${fmt(cur.demand, 1)} piezas`} />
					<Kpi value={cur.lead_h} decimals={1} unit="h" label="Tiempo por pieza" sub={`${fmt(cur.lead_parts.proceso)} min son trabajo real`} />
					<Kpi value={cur.loading_min} unit="min" label="Carga de camiones al día" sub={`${plant.params.trucks} salidas`} />
				</Appear>
			)}

			<div className="grid-2" style={{ marginTop: full ? 32 : 0 }}>
				<Appear className="block">{plan}</Appear>

				<Appear className="block" delay={0.1}>
					<RelChart relations={analysis.relations} />
				</Appear>
			</div>

			{full && (
				<>
					<div className="grid-2" style={{ marginTop: 24 }}>
						<Appear className="block">
							<LoadChart stations={cur.stations} bottleneck={cur.bottleneck} />
						</Appear>

						<Appear className="block" delay={0.1}>
							<LeadChart before={cur} />
						</Appear>
					</div>

					<Appear className="report" style={{ marginTop: 24 }}>
						<div className="chart-head" style={{ marginBottom: 16 }}>
							<h3>Informe redactado</h3>

							<Btn size="small" onClick={report.run} disabled={report.state === 'running'}>
								{report.state === 'running' ? 'Escribiendo…' : 'Escribirlo de nuevo'}
							</Btn>
						</div>
						<p className="report-text" aria-live="polite">
							{report.text}
							{report.state === 'running' && <span className="caret" />}
						</p>

						{report.state === 'error' && <p>Error al escribir el informe.</p>}
					</Appear>
				</>
			)}

			<Appear className="block" style={{ marginTop: 24 }}>
				<details className="how" open>
					<summary>Cómo se calculó</summary>
					<ul>
						<li>Recorrido: la ruta más corta por los pasillos, sin cruzar máquinas, paredes ni zonas, multiplicada por el % de piezas de cada ruta.</li>
						<li>Cercanía entre áreas: sale del flujo que dibujaste y de qué áreas ensucian (polvo, ruido, calor) o deben quedar limpias. No usa supuestos.</li>
						{full && <li>Carga: minutos de trabajo y de traslado frente a los minutos útiles del turno ({fmt(plant.params.shift_min * plant.params.efficiency)} por persona).</li>}
						{full && <li>Espera en cola: aproximación de Sakasegawa para varios servidores.</li>}
						<li>Con datos medidos el método es el mismo.</li>
					</ul>
				</details>
			</Appear>

			<div className="row" style={{ marginTop: 32 }}>
				<Btn onClick={onNext}>Ver el rediseño</Btn>
			</div>
		</section>
	)
}
