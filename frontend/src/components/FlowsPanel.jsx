import { fmt } from '../api'
import { FLOWS } from '../flows'

/* Métricas por flujo, bandas y ciclos (solo si el motor las manda). */
export default function FlowsPanel({ plant, current, metrics, name }) {
    if (!current?.flows) return null
    const names = Object.fromEntries(plant.stations.map((s) => [s.id, s.name]))
    const rows = FLOWS.filter((f) => current.flows[f.id] || metrics?.flows?.[f.id])
    const daily = rows.some((f) => current.flows[f.id]?.daily_m != null)
    return (
        <div className="block">
            <h3>Por flujo</h3>
            <p className="small">Cada flujo se mide aparte. Los metros de siempre (recorrido de una pieza, metros al día) son solo del material.</p>
            <div className="table-wrap">
                <table className="flows-table small">
                    <thead>
                        <tr>
                            <th>Flujo</th>
                            <th>Hoy (m por pieza)</th>
                            {metrics?.flows && <th>{name} (m por pieza)</th>}
                            {daily && <th>Hoy (m al día)</th>}
                            {daily && metrics?.flows && <th>{name} (m al día)</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((f) => (
                            <tr key={f.id}>
                                <td>{f.label}</td>
                                <td className="num">{fmt(current.flows[f.id]?.piece_m, 1)}</td>
                                {metrics?.flows && <td className="num">{fmt(metrics.flows[f.id]?.piece_m, 1)}</td>}
                                {daily && <td className="num">{fmt(current.flows[f.id]?.daily_m)}</td>}
                                {daily && metrics?.flows && <td className="num">{fmt(metrics.flows[f.id]?.daily_m)}</td>}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {current.cycles?.length > 0 && (
                <p className="small">
                    Ciclos del proceso (retornos incluidos): {current.cycles.map((c) => c.map((id) => names[id] || id).join(' ⇄ ')).join('; ')}.
                </p>
            )}
            {(metrics || current).conveyor_load?.map((b) => (
                <p key={b.id} className="small">
                    {b.name}: {fmt(b.ppm, 2)} piezas por minuto{b.capacity_ppm ? ` de ${fmt(b.capacity_ppm, 1)} que admite (${fmt((b.util || 0) * 100)} %)` : ''}.
                    {b.util > 1 && ' La banda no alcanza.'}
                </p>
            ))}
        </div>
    )
}
