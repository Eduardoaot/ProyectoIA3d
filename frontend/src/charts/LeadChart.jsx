import { motion } from 'motion/react'
import { fmt } from '../api'
import { useTip } from './Tip'

const PARTS = [
    { key: 'proceso', label: 'Trabajo en máquina', fill: '#000' },
    { key: 'cola', label: 'Espera en cola', fill: '#767676' },
    { key: 'lote', label: 'Espera de lote', fill: '#c2c2c2' },
    { key: 'transporte', label: 'Transporte', fill: '#eeeeee' },
]

export default function LeadChart({ before, after, title = 'En qué se va el tiempo de una pieza' }) {
    const { node, bind } = useTip()
    const rows = [
        { name: 'Hoy', m: before },
        ...(after ? [{ name: 'Propuesta', m: after }] : []),
    ]
    const total = (m) => PARTS.reduce((a, p) => a + m.lead_parts[p.key], 0)
    const max = Math.max(...rows.map((r) => total(r.m)))
    const W = 640
    const label = 90
    const right = 70
    const bw = W - label - right
    const H = rows.length * 62 + 6

    return (
        <div className="chart">
            <div className="chart-head">
                <h3>{title}</h3>
                <span className="small">minutos desde que entra la lámina hasta que sale la pieza</span>
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
                {rows.map((r, i) => {
                    const y = 6 + i * 62
                    let acc = 0
                    return (
                        <g key={r.name}>
                        <text x={0} y={y + 26} fontSize="15" fontWeight="700">
                            {r.name}
                        </text>
                        {PARTS.map((p, k) => {
                            const v = r.m.lead_parts[p.key]
                            const w = (v / max) * bw
                            const x = label + (acc / max) * bw
                            acc += v
                            return (
                            <motion.rect
                                    key={p.key}
                                    y={y + 6}
                                    height={32}
                                    fill={p.fill}
                                    stroke="#000"
                                    strokeWidth={1}
                                    initial={{ x: label, width: 0 }}
                                    animate={{ x, width: w }}
                                    transition={{ duration: 0.9, delay: i * 0.15 + k * 0.08, ease: [0.16, 1, 0.3, 1] }}
                                    {...bind(
                                <>
                                    <b>{p.label}</b>
                                    <br />
                                    {fmt(v)} min ({fmt((v / total(r.m)) * 100)} % del total)
                                </>,
                                )}
                            />
                            )
                        })}
                        <text x={label + (total(r.m) / max) * bw + 10} y={y + 28} fontSize="15" fontWeight="700" fontStretch="74%">
                            {fmt(r.m.lead_h, 1)} h
                        </text>
                        </g>
                    )
                })}
            </svg>

            <div className="row" style={{ gap: 18 }}>
                {PARTS.map((p) => (
                    <span key={p.key} className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <i style={{ width: 14, height: 14, background: p.fill, border: '1.5px solid #000', display: 'inline-block' }} />
                        {p.label}
                    </span>
                ))}
            </div>
            
            {node}
        </div>
    )
}