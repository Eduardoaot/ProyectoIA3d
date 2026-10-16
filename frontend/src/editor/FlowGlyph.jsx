import { pathD } from './geometry'

import { FLOW_STYLES } from './flows'

export function ConveyorGlyph({ conveyor, selected = false, onPointerDown }) {
    if (!conveyor.points?.length) return null
    return <g onPointerDown={onPointerDown}><title>{conveyor.id} · {conveyor.capacity_ppm ?? 'sin datos'} piezas/min · {conveyor.speed_mpm ?? 'sin datos'} m/min</title>
        <path d={pathD(conveyor.points)} fill="none" stroke={selected ? '#000' : '#555'} strokeWidth={selected ? 1.1 : 0.85} />
        <path d={pathD(conveyor.points)} fill="none" stroke="#ddd" strokeWidth={0.5} strokeDasharray="0.2 0.15" pointerEvents="none" />
        {conveyor.locked && <text x={conveyor.points[0][0]} y={conveyor.points[0][1]} fontSize="0.7">🔒</text>}
    </g>
}
export function FlowLegend() {
    return <p className="flow-legend">{Object.entries(FLOW_STYLES).map(([flow, style]) => <span key={flow} style={{ color: style.color }}>{flow} · </span>)} Retorno: trazo curvo · Banda: doble trazo</p>
}
