import { useState } from 'react'
import { fmt } from '../api'
import { has } from '../capabilities'
import Criteria from '../components/Criteria'
import useCaps from '../useCaps'
import FlowPlan from '../charts/FlowPlan'
import RelChart from '../charts/RelChart'
import Btn from '../fx/Btn'
import { Appear, RevealTitle } from '../fx/Reveal'

export default function Diagnosis({ plant, analysis, weights, onReweigh, onNext }) {
	const cur = analysis.current
	const caps = useCaps()
	const [busy, setBusy] = useState(false)
	const reweigh = async (w) => {
		setBusy(true)
		await onReweigh(w)
		setBusy(false)
	}

	return (
		<section className="step">
			<header className="step-head">
				<span className="step-index"><b>Paso 3 de 6</b><span>Diagnóstico</span></span>
				<RevealTitle text="El flujo de tu material." />
				<p className="lede">Una pieza recorre {fmt(cur.piece_m, 1)} m dentro de la planta.</p>
			</header>

			<div className="grid-2">
				<Appear className="block">
					<FlowPlan plant={plant} positions={plant.layout} legs={cur.legs} title="Recorrido del material" total={cur.piece_m} unit="m por pieza" bottleneck={cur.bottleneck} />
				</Appear>

				<Appear className="block" delay={0.1}>
					<RelChart relations={analysis.relations} />
				</Appear>
			</div>

			<Appear className="block" style={{ marginTop: 24 }}>
				<Criteria key={analysis.plant_version + JSON.stringify(analysis.weights_used || {})} analysis={analysis} canWeigh={has(caps, 'weights') && !!onReweigh} weights={weights} onReweigh={reweigh} busy={busy} />
			</Appear>

			<Appear className="block" style={{ marginTop: 24 }}>
				<details className="how">
					<summary>Cómo se calculó</summary>
					<ul>
						<li>Recorrido: la ruta más corta por los pasillos, sin cruzar máquinas, paredes ni zonas, multiplicada por el % de piezas de cada ruta.</li>
						<li>Cercanía entre áreas: sale del flujo que dibujaste y de qué áreas ensucian (polvo, ruido, calor) o deben quedar limpias.</li>
						<li>Recomendación: cada alternativa recibe un puntaje de 0 a 100 por criterio y gana la de mayor total ponderado entre las que respetan lo fijo.</li>
					</ul>
				</details>
			</Appear>

			<div className="row" style={{ marginTop: 32 }}>
				<Btn onClick={onNext}>Ver el rediseño</Btn>
			</div>
		</section>
	)
}
