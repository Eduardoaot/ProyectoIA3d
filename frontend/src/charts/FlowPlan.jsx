import { motion } from 'motion/react'
import { fmt } from '../api'
import { arrowPoints, midOf, pathD, rectOf, shortName, straight } from '../editor/geometry'
import { useTip } from './Tip'

export default function FlowPlan({ plant, positions, legs, title, total, unit = 'm por pieza', bottleneck, compact = false, still = false }) {
    const { node, bind } = useTip()
    const { w: W, d: D } = plant.size
    const names = Object.fromEntries(plant.stations.map((s) => [s.id, s.name]))
    const legBy = Object.fromEntries((legs || []).map((l) => [l.id, l]))
    const maxM = Math.max(1, ...(legs || []).map((l) => l.meters || 0))

    return (
        <div className="chart">
            {title && (
                <div className="chart-head">
                <h3>{title}</h3>
                {total != null && (
                    <span className="num" style={{ fontSize: 'var(--t-20)', fontWeight: 700 }}>
                    {fmt(total, unit.startsWith('m por') ? 1 : 0)} {unit}
                    </span>
                )}
                </div>
            )}
            
            <svg viewBox={`-1.5 -1.5 ${W + 3} ${D + 4.5}`} role="img" aria-label={title || 'Plano'}>
                <defs>
                <pattern id="fp-hatch" width="1" height="1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="1" height="1" fill="#fff" />
                    <rect width="0.35" height="1" fill="#000" />
                </pattern>
                </defs>
                <rect x={0} y={0} width={W} height={D} fill="#f6f6f6" stroke="#000" strokeWidth={0.3} />

                {plant.zones.map((z) => (
                    <g key={z.id}>
                        <rect x={z.x - z.w / 2} y={z.z - z.d / 2} width={z.w} height={z.d} fill={z.kind === 'bloqueado' ? 'url(#fp-hatch)' : '#fff'} fillOpacity={z.kind === 'bloqueado' ? 0.45 : 1} stroke="#c2c2c2" strokeWidth={0.2} strokeDasharray="0.6 0.4" />
                        {!compact && (
                        <text x={z.x} y={z.z + 0.35} textAnchor="middle" fontSize="0.95" fill="#767676">
                            {shortName(z.name, 16)}
                        </text>
                        )}
                    </g>
                ))}

                {plant.walls.map((w) => (
                    <line key={w.id} x1={w.x1} y1={w.z1} x2={w.x2} y2={w.z2} stroke="#000" strokeWidth={0.3} />
                ))}

                {plant.gates.map((g) => {
                    const on = g.id === plant.receive_gate || g.id === plant.dispatch_gate
                    const role = g.id === plant.receive_gate && g.id === plant.dispatch_gate ? ' entra y sale' : g.id === plant.receive_gate ? ' entra' : g.id === plant.dispatch_gate ? ' sale' : ''
                    return (
                        <g key={g.id}>
                        <rect x={g.x - 2.2} y={D - 0.25} width={4.4} height={0.9} fill={on ? '#000' : '#fff'} stroke="#000" strokeWidth={0.15} />
                        <text x={g.x} y={D + 2} textAnchor="middle" fontSize="1" fontWeight={on ? 800 : 400} fill={on ? '#000' : '#767676'}>
                            {g.id}
                            {role}
                        </text>
                        </g>
                    )
                })}
                {plant.stations.map((s) => {
                const p = positions[s.id]
                if (!p) return null
                const r = rectOf(s, p)
                const hot = s.id === bottleneck
                return (
                    <g key={s.id} {...bind(<b>{s.name}</b>)}>
                    <motion.rect initial={false} animate={{ x: r.x, y: r.z, width: r.w, height: r.d }} transition={{ type: 'spring', stiffness: 90, damping: 18 }} fill={hot ? '#000' : '#fff'} stroke="#000" strokeWidth={0.22} />
                    <motion.text initial={false} animate={{ x: p[0], y: p[1] + 0.35 }} transition={{ type: 'spring', stiffness: 90, damping: 18 }} textAnchor="middle" fontSize={compact ? 0.85 : 1} fontWeight="700" fill={hot ? '#fff' : '#000'}>
                        {shortName(s.name, Math.max(5, Math.floor(r.w * 1.8)))}
                    </motion.text>
                    </g>
                )
                })}

                {plant.routes.map((rt, i) => {
                    const a = positions[rt.from]
                    const b = positions[rt.to]
                    if (!a || !b) return null
                    const l = legBy[rt.id]
                    const pts = l?.path?.length > 1 ? l.path : straight(a, b)
                    const m = midOf(pts)
                    return (
                        <g
                            key={rt.id}
                            {...bind(
                                <>
                                <b>
                                    {names[rt.from]} → {names[rt.to]}
                                </b>
                                <br />
                                {l ? `${fmt(l.dist, 1)} m por viaje` : ''}
                                {l?.trips != null ? `, ${fmt(l.trips, 1)} viajes al día (${fmt(l.meters)} m)` : ''}
                                <br />
                                {Math.round((rt.frac ?? 1) * 100)} % de las piezas
                                </>,
                            )}
                        >
                        <motion.path
                            d={pathD(pts)}
                            fill="none"
                            stroke="#000"
                            strokeOpacity={0.6}
                            strokeLinejoin="round"
                            strokeDasharray={(rt.frac ?? 1) < 1 ? '0.6 0.4' : undefined}
                            strokeWidth={0.16 + ((l?.meters || 0) / maxM) * 0.75}
                            initial={still ? false : { pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 0.9, delay: 0.15 + i * 0.06 }}
                        />
                            <polygon points={arrowPoints(m, 0.8)} fill="#000" />
                        </g>
                    )
                })}
            </svg>

            {node}
        </div>
    )
}