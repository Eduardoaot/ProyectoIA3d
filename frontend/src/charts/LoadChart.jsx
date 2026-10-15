import { motion } from 'motion/react'
import { fmt } from '../api'
import { useTip } from './Tip'

export default function LoadChart({ stations, bottleneck, title = 'Carga frente a capacidad', note }) {
	const { node, bind } = useTip()
	const rows = [...stations].sort((a, b) => b.util - a.util)
	const max = Math.max(1.15, ...rows.map((s) => s.util))
	const W = 640
	const label = 150
	const right = 110
	const bw = W - label - right
	const rowH = 38
	const H = rows.length * rowH + 34
	const x = (u) => label + (u / max) * bw

	return (
		<div className="chart">
			<div className="chart-head">
				<h3>{title}</h3>
				{note && <span className="small">{note}</span>}
			</div>
			
			<svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
				{[0, 0.5, 1].map((t) => (
					<g key={t}>
						<line x1={x(t)} x2={x(t)} y1={22} y2={H} stroke={t === 1 ? '#000' : '#dedede'} strokeWidth={t === 1 ? 2 : 1} strokeDasharray={t === 1 ? '4 4' : undefined} />
						<text x={x(t)} y={12} textAnchor="middle" fontSize="12" fill="#767676" fontStretch="74%">
						{t * 100} %
						</text>
					</g>
				))}
				{rows.map((s, i) => {
					const y = 28 + i * rowH
					const hot = s.id === bottleneck
					const over = s.util > 1
					return (
						<g
						key={s.id}
						{...bind(
							<>
							<b>{s.name}</b>
							<br />
							Carga {fmt(s.util * 100)} % de lo que puede hacer
							<br />
							{fmt(s.load_min)} min de trabajo al día, {s.ops} {s.ops === 1 ? 'operario' : 'operarios'}
							<br />
							Se necesitan {fmt(s.required, 1)}
							</>,
						)}
						>
						<rect x={0} y={y - 4} width={W} height={rowH - 2} fill="transparent" />
						{hot && <rect x={0} y={y - 4} width={W} height={rowH - 2} fill="#eeeeee" />}
						<text x={0} y={y + 14} fontSize="14" fontWeight={hot ? 800 : 500} fill="#000">
							{s.name.replace('Almacén de láminas', 'Láminas').replace('Mesa de ', '').replace('Recepción de láminas', 'Recepción')}
						</text>
						<motion.rect
							x={label}
							y={y}
							height={20}
							fill={hot ? '#000' : '#767676'}
							initial={{ width: 0 }}
							animate={{ width: Math.max(2, x(Math.min(s.util, max)) - label) }}
							transition={{ duration: 0.9, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
						/>
						<text x={x(Math.min(s.util, max)) + 8} y={y + 15} fontSize="14" fontWeight="700" fill={over ? '#000' : '#3b3b3b'} fontStretch="74%">
							{fmt(s.util * 100)} %
						</text>
						<text x={W} y={y + 15} textAnchor="end" fontSize="12" fill="#767676" fontStretch="74%">
							{s.ops} / {fmt(s.required, 1)}
						</text>
						{hot && (
							<text x={0} y={y + 29} fontSize="10" fontWeight="800" fill="#000" letterSpacing="1.5">
							CUELLO
							</text>
						)}
						</g>
					)
				})}

				<text x={W} y={H - 0} textAnchor="end" fontSize="11" fill="#767676">
					operarios asignados / necesarios
				</text>
			</svg>
			{node}
		</div>
	)
}