import { useId } from 'react'
import { rectOf } from './geometry'
import { labelFor, unitGrid } from './display'

export default function StationGlyph({ station: s, position: p, index, selected = false, expanded = false }) {
    const clip = useId()
    const r = rectOf(s, p)
    const { count, columns, rows } = unitGrid(s)
    const font = Math.min(0.9, r.d * 0.28, r.w / 2)
    return <g pointerEvents="none">
        <title>{`${index + 1}. ${s.name} ×${count}${s.locked ? ` · Fijo: ${s.lock_reason}` : ''}`}</title>
        <defs><clipPath id={clip}><rect x={r.x + 0.08} y={r.z + 0.08} width={Math.max(0, r.w - 0.16)} height={Math.max(0, r.d - 0.16)} /></clipPath></defs>
        <rect x={r.x} y={r.z} width={r.w} height={r.d} fill={selected ? '#000' : '#fff'} stroke="#000" strokeWidth={selected ? 0.3 : 0.18} strokeDasharray={s.locked ? '0.4 0.25' : undefined} />
        <g clipPath={`url(#${clip})`}>
            {expanded && count > 1 && <g transform={`translate(${p[0]} ${p[1]}) rotate(${p[2] || 0})`}>
                {Array.from({ length: count }, (_, i) => <rect key={i} data-unit={i + 1}
                    x={-s.w / 2 + (i % columns) * s.w / columns + 0.08} y={-s.d / 2 + Math.floor(i / columns) * s.d / rows + 0.08}
                    width={Math.max(0, s.w / columns - 0.16)} height={Math.max(0, s.d / rows - 0.16)} fill="none" stroke={selected ? '#aaa' : '#bbb'} strokeWidth={0.08} />)}
            </g>}
            <text x={p[0]} y={p[1]} dominantBaseline="central" textAnchor="middle" fontSize={font} fontWeight="700" fill={selected ? '#fff' : '#000'}>{labelFor(s, index, r.w, font)}</text>
            {s.locked && r.d > 1.5 && <text x={r.x + 0.12} y={r.z + 0.65} fontSize="0.55">🔒</text>}
        </g>
    </g>
}
