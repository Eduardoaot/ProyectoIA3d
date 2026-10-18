import { motion } from 'motion/react'
import { fmt } from '../api'
import { countOf, fitLabel } from '../units'
import { arrowPoints, bboxOf, GATE_HALF, gateInfo, midOf, outlineOf, pathD, polyD, rectOf, shortName, straight } from '../editor/geometry'
import { useTip } from './Tip'

/* Plano desde arriba con cada recorrido del material y su dirección.
   El grosor de la línea es proporcional a los metros que suma esa ruta. */
export default function FlowPlan({ plant, positions, legs, title, total, unit = 'm por pieza', bottleneck, compact = false, still = false }) {
  const { node, bind } = useTip()
  const { w: W, d: D } = plant.size
  const names = Object.fromEntries(plant.stations.map((s) => [s.id, s.name]))
  // Nombres que no caben en su máquina: número en el plano y nombre completo en la leyenda (H9).
  const legend = plant.stations
    .map((s, i) => {
      const p = positions[s.id]
      if (!p) return null
      const n = countOf(s)
      const lab = fitLabel(n > 1 ? `${s.name} ×${n}` : s.name, rectOf(s, p).w, i, 1.8)
      return lab.numbered ? { n: lab.text, name: n > 1 ? `${s.name} (×${n})` : s.name } : null
    })
    .filter(Boolean)
  const legBy = Object.fromEntries((legs || []).map((l) => [l.id, l]))
  const maxM = Math.max(1, ...(legs || []).map((l) => l.meters || 0))
  const outline = outlineOf(plant)
  const bb = bboxOf([...outline, [0, 0], [W, D]])
  const sides = plant.gates.map((g) => gateInfo(plant, g))
  // Margen extra solo del lado donde hay portones (sus etiquetas quedan afuera).
  const pad = (fn) => (sides.some(fn) ? 3.6 : 1.5)
  const x0 = bb.x0 - pad((gi) => gi.n[0] < -0.5)
  const z0 = bb.z0 - pad((gi) => gi.n[1] < -0.5)
  const x1 = bb.x1 + pad((gi) => gi.n[0] > 0.5)
  const z1 = bb.z1 + pad((gi) => gi.n[1] > 0.5)

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
      <svg viewBox={`${x0} ${z0} ${x1 - x0} ${z1 - z0}`} role="img" aria-label={title || 'Plano'}>
        <defs>
          <pattern id="fp-hatch" width="1" height="1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="1" height="1" fill="#fff" />
            <rect width="0.35" height="1" fill="#000" />
          </pattern>
        </defs>
        <path d={polyD(outline)} fill="#f6f6f6" stroke="#000" strokeWidth={0.3} />
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
        {plant.gates.map((g, i) => {
          const on = g.id === plant.receive_gate || g.id === plant.dispatch_gate
          const role = g.id === plant.receive_gate && g.id === plant.dispatch_gate ? ' entra y sale' : g.id === plant.receive_gate ? ' entra' : g.id === plant.dispatch_gate ? ' sale' : ''
          const gi = sides[i]
          const lift = 1.8 + Math.abs(gi.n[0]) * 2.2
          return (
            <g key={g.id}>
              <rect x={-GATE_HALF} y={-0.25} width={GATE_HALF * 2} height={0.9} transform={`translate(${gi.x} ${gi.z}) rotate(${gi.deg})`} fill={on ? '#000' : '#fff'} stroke="#000" strokeWidth={0.15} />
              <text x={gi.x + gi.n[0] * lift} y={gi.z + gi.n[1] * lift + 0.35} textAnchor="middle" fontSize="1" fontWeight={on ? 800 : 400} fill={on ? '#000' : '#767676'}>
                {g.id}
                {role}
              </text>
            </g>
          )
        })}
        {/* Las rutas van primero: pasan por detrás de las máquinas. */}
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
        {plant.stations.map((s, i) => {
          const p = positions[s.id]
          if (!p) return null
          const r = rectOf(s, p)
          const hot = s.id === bottleneck
          const n = countOf(s)
          const lab = fitLabel(n > 1 ? `${s.name} ×${n}` : s.name, r.w, i, 1.8)
          return (
            <g key={s.id} {...bind(<b>{s.name}</b>)}>
              <motion.rect initial={false} animate={{ x: r.x, y: r.z, width: r.w, height: r.d }} transition={{ type: 'spring', stiffness: 90, damping: 18 }} fill={hot ? '#000' : '#fff'} stroke="#000" strokeWidth={0.22} />
              <motion.text initial={false} animate={{ x: p[0], y: p[1] + 0.35 }} transition={{ type: 'spring', stiffness: 90, damping: 18 }} textAnchor="middle" fontSize={compact ? 0.85 : 1} fontWeight="700" fill={hot ? '#fff' : '#000'}>
                {lab.text}
              </motion.text>
            </g>
          )
        })}
      </svg>
      {legend.length > 0 && (
        <p className="editor-legend small">
          {legend.map(({ n, name }) => (
            <span key={n}>
              <b>{n}</b> {name}
            </span>
          ))}
        </p>
      )}
      {node}
    </div>
  )
}
