import { shortName } from '../editor/geometry'
import { useTip } from './Tip'

const STYLE = {
    A: { fill: '#000', ink: '#fff', word: 'Absolutamente necesaria' },
    E: { fill: '#3b3b3b', ink: '#fff', word: 'Especialmente importante' },
    I: { fill: '#767676', ink: '#fff', word: 'Importante' },
    O: { fill: '#c2c2c2', ink: '#000', word: 'Ordinaria' },
    U: { fill: '#fff', ink: '#c2c2c2', word: 'Sin importancia' },
    X: { fill: '#fff', ink: '#000', word: 'No deben estar juntas' },
}

const short = (n) => shortName(n.replace(/\s*\(.*\)\s*/, ''), 14)

export default function RelChart({ relations, title = 'Qué tan cerca debe estar cada área de otra' }) {
    const { node, bind } = useTip()
    const { ids, names, cells } = relations
    const n = ids.length
    const cell = 46
    const left = 108
    const W = left + n * cell
    const top = 96
    const H = (n - 1) * cell + top + 6
    const by = new Map(cells.map((c) => [`${c.a}|${c.b}`, c]))

    return (
        <div className="chart">
            <div className="chart-head">
                <h3>{title}</h3>
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
                {ids.slice(0, -1).map((a, i) => (
                    <g key={a} transform={`translate(0 ${i * cell + top})`}>
                        <text x={left - 10} y={cell / 2 + 5} textAnchor="end" fontSize="13" fontWeight="600">
                        {short(names[a])}
                        </text>
                        {ids.slice(i + 1).map((b, k) => {
                        const j = i + 1 + k
                        const c = by.get(`${a}|${b}`) || by.get(`${b}|${a}`)
                        if (!c) return null
                        const s = STYLE[c.r]
                        return (
                            <g
                            key={b}
                            transform={`translate(${left + j * cell - cell} 0)`}
                            {...bind(
                                <>
                                <b>
                                    {short(names[a])} y {short(names[b])}
                                </b>
                                <br />
                                {c.r}: {s.word}
                                <br />
                                {c.why}
                                </>,
                            )}
                            >
                            <rect width={cell - 3} height={cell - 3} fill={s.fill} stroke="#000" strokeWidth={c.r === 'U' ? 0.5 : 1.5} />
                            {c.r === 'X' && <path d={`M6 6 L${cell - 9} ${cell - 9} M${cell - 9} 6 L6 ${cell - 9}`} stroke="#000" strokeWidth={2} />}
                            {c.r !== 'X' && (
                                <text x={(cell - 3) / 2} y={cell / 2 + 6} textAnchor="middle" fontSize="18" fontWeight="800" fill={s.ink} fontStretch="125%">
                                {c.r}
                                </text>
                            )}
                            </g>
                        )
                        })}
                    </g>
                ))}
                {ids.slice(1).map((b, j) => (
                    <text key={b} transform={`translate(${left + j * cell + cell / 2 - 4} ${top - 8}) rotate(-50)`} fontSize="13" fontWeight="600">
                        {short(names[b])}
                    </text>
                ))}
            </svg>
            <div className="row" style={{ gap: 14 }}>
                {Object.entries(STYLE).map(([k, s]) => (
                    <span key={k} className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <b style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, background: s.fill, color: s.ink, border: '1.5px solid #000', fontSize: 12 }}>{k === 'X' ? '×' : k}</b>
                        {s.word}
                    </span>
                ))}
            </div>
            
            {node}
        </div>
    )
}
