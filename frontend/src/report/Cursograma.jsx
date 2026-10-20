import { fmt } from '../api'

/* Cursograma analítico (diagrama de proceso de la ASME): cada paso del material con su
   símbolo, en el orden del flujo. Los traslados llevan la distancia por los pasillos de hoy
   y, si hay rediseño, la de la propuesta. */

export const ACTS = [
    { id: 'op', label: 'Operación' },
    { id: 'tr', label: 'Transporte' },
    { id: 'in', label: 'Inspección' },
    { id: 'es', label: 'Espera' },
    { id: 'al', label: 'Almacenamiento' },
]

const STORE = new Set(['almacen', 'almacen_piso', 'recepcion', 'despacho'])

export function actOf(station) {
    if (STORE.has(station.kind)) return 'al'
    if (station.kind === 'inspeccion') return 'in'
    return 'op'
}

export function Symbol({ act, on = true, size = 18 }) {
    const s = size
    const stroke = on ? '#000' : '#c2c2c2'
    const fill = on ? '#000' : 'none'
    const sw = 1.6
    return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden="true">
            {act === 'op' && <circle cx="10" cy="10" r="7.5" fill={fill} stroke={stroke} strokeWidth={sw} />}
            {act === 'tr' && <path d="M2 10 H14 M10 5 L16 10 L10 15" fill="none" stroke={stroke} strokeWidth={on ? 3 : sw} strokeLinejoin="round" />}
            {act === 'in' && <rect x="3" y="3" width="14" height="14" fill={fill} stroke={stroke} strokeWidth={sw} />}
            {act === 'es' && <path d="M4 3 H10 A7 7 0 0 1 10 17 H4 Z" fill={fill} stroke={stroke} strokeWidth={sw} />}
            {act === 'al' && <path d="M2.5 3.5 H17.5 L10 17 Z" fill={fill} stroke={stroke} strokeWidth={sw} />}
        </svg>
    )
}

/* Orden del proceso: topológico sobre las rutas de material (los retornos no ordenan). */
function flowOrder(plant) {
    const ids = plant.stations.map((s) => s.id)
    const routes = (plant.routes || []).filter((r) => (r.flow || 'material') === 'material' && !r.is_return && ids.includes(r.from) && ids.includes(r.to))
    const indeg = Object.fromEntries(ids.map((k) => [k, 0]))
    for (const r of routes) indeg[r.to] += 1
    const out = []
    const queue = ids.filter((k) => indeg[k] === 0)
    while (queue.length) {
        const k = queue.shift()
        out.push(k)
        for (const r of routes.filter((q) => q.from === k)) if (--indeg[r.to] === 0) queue.push(r.to)
    }
    return [...out, ...ids.filter((k) => !out.includes(k))]
}

export function cursograma(plant, legsNow = [], legsNew = null) {
    const st = Object.fromEntries(plant.stations.map((s) => [s.id, s]))
    const now = Object.fromEntries(legsNow.map((l) => [l.id, l]))
    const nxt = legsNew ? Object.fromEntries(legsNew.map((l) => [l.id, l])) : null
    const material = (plant.routes || []).filter((r) => (r.flow || 'material') === 'material')
    const rows = []
    for (const id of flowOrder(plant)) {
        const s = st[id]
        // Primero los traslados que llegan a la estación, luego lo que se hace en ella.
        for (const r of material.filter((q) => q.to === id)) {
            const frac = r.frac ?? 1
            rows.push({
                act: 'tr',
                text: `De ${st[r.from]?.name || r.from} a ${s.name}`,
                d: now[r.id]?.dist,
                dNew: nxt ? nxt[r.id]?.dist : undefined,
                note: [frac < 1 ? `${Math.round(frac * 100)} % de las piezas` : '', r.is_return ? 'Retorno' : '', r.conveyor ? 'En banda' : ''].filter(Boolean).join(' · '),
            })
        }
        if (s.batch?.size > 1) rows.push({ act: 'es', text: `Espera a juntar el lote en ${s.name}`, note: `Lote de ${s.batch.size} piezas` })
        rows.push({ act: actOf(s), text: s.name, note: [s.count > 1 ? `${s.count} máquinas iguales` : '', s.locked ? 'Fija' : ''].filter(Boolean).join(' · ') })
    }
    const count = Object.fromEntries(ACTS.map((a) => [a.id, rows.filter((r) => r.act === a.id).length]))
    const total = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)
    return { rows, count, dist: total('d'), distNew: legsNew ? total('dNew') : null }
}

export default function Cursograma({ plant, legsNow, legsNew, nameNew }) {
    const c = cursograma(plant, legsNow, legsNew)
    const withNew = c.distNew != null
    return (
        <div className="cursograma">
            <table className="doc-table curso-sum">
                <thead>
                    <tr>
                        <th>Resumen</th>
                        {ACTS.map((a) => (
                            <th key={a.id} className="num">
                                <span className="curso-head">
                                    <Symbol act={a.id} size={14} />
                                    {a.label}
                                </span>
                            </th>
                        ))}
                        <th className="num">Distancia hoy</th>
                        {withNew && <th className="num">{nameNew || 'Propuesta'}</th>}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Cantidad</td>
                        {ACTS.map((a) => (
                            <td key={a.id} className="num">
                                {c.count[a.id]}
                            </td>
                        ))}
                        <td className="num">{fmt(c.dist, 1)} m</td>
                        {withNew && <td className="num">{fmt(c.distNew, 1)} m</td>}
                    </tr>
                </tbody>
            </table>

            <table className="doc-table curso-table">
                <thead>
                    <tr>
                        <th className="num">N.º</th>
                        <th>Descripción</th>
                        {ACTS.map((a) => (
                            <th key={a.id} className="curso-sym" title={a.label}>
                                <Symbol act={a.id} size={14} on={false} />
                            </th>
                        ))}
                        <th className="num">Distancia hoy (m)</th>
                        {withNew && <th className="num">{nameNew || 'Propuesta'} (m)</th>}
                        <th>Observaciones</th>
                    </tr>
                </thead>
                <tbody>
                    {c.rows.map((r, i) => (
                        <tr key={i}>
                            <td className="num">{i + 1}</td>
                            <td>{r.text}</td>
                            {ACTS.map((a) => (
                                <td key={a.id} className="curso-sym">
                                    {r.act === a.id && <Symbol act={a.id} size={16} />}
                                </td>
                            ))}
                            <td className="num">{r.d != null ? fmt(r.d, 1) : ''}</td>
                            {withNew && <td className="num">{r.dNew != null ? fmt(r.dNew, 1) : ''}</td>}
                            <td className="curso-note">{r.note}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
