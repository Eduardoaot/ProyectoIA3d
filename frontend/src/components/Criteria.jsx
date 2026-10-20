import { useState } from 'react'
import { fmt } from '../api'
import { CRITERIA, DEFAULT_WEIGHTS, normalizeWeights, sensitiveCriteria, sumOf, validWeights } from '../weights'
import Modal from './Modal'

/* Decisión multicriterio en corto: un ranking con barras. La tabla por criterio y los pesos
   van en ventanas aparte. Cambiar pesos no recalcula solo: el usuario pulsa «Recalcular». */
export default function Criteria({ analysis, canWeigh, weights, onReweigh, busy }) {
    const alts = analysis.alternatives.filter((a) => a.scores)
    const hasScores = alts.length > 0
    // Solo los criterios que el motor puede puntuar (sin tiempos ni producción no hay tiempo por pieza ni capacidad).
    const shown = hasScores ? CRITERIA.filter((c) => [analysis.current_scores, ...alts.map((a) => a.scores)].some((sc) => sc?.[c.key] != null)) : CRITERIA
    const keep = (w) => normalizeWeights(Object.fromEntries(CRITERIA.map((c) => [c.key, shown.includes(c) ? Number(w?.[c.key]) || 0 : 0])))
    const [draft, setDraft] = useState(() => keep(weights || analysis.weights_used || DEFAULT_WEIGHTS))
    const [open, setOpen] = useState(null)
    if (!hasScores && !canWeigh) return null

    const sum = sumOf(draft)
    const ok = validWeights(draft)
    const used = analysis.weights_used && keep(analysis.weights_used)
    const sens = sensitiveCriteria(alts[0]?.sensitivity)
    const cell = (v) => (v == null ? '—' : fmt(v * 100))
    const best = analysis.alternatives.find((a) => a.id === analysis.recommended)
    const rows = [
        ...(analysis.current_score_total != null ? [{ id: 'hoy', name: 'Hoy', total: analysis.current_score_total }] : []),
        ...alts.map((a) => ({ id: a.id, name: a.name, total: a.score_total, ideal: a.kind === 'ideal' })),
    ].sort((a, b) => (b.total ?? 0) - (a.total ?? 0))

    return (
        <div className="rank">
            <div className="rank-head">
                <div>
                    <h3>Cómo se comparan</h3>
                    {best && (
                        <p className="small">
                            Recomendada: <b>{best.name}</b>
                        </p>
                    )}
                </div>
                <div className="rank-links">
                    {hasScores && (
                        <button type="button" className="opt-btn" onClick={() => setOpen('detail')}>
                            Ver detalle
                        </button>
                    )}
                    {canWeigh && (
                        <button type="button" className="opt-btn" onClick={() => setOpen('weights')}>
                            Ajustar pesos
                        </button>
                    )}
                </div>
            </div>

            {hasScores && (
                <ul className="rank-list">
                    {rows.map((r) => (
                        <li key={r.id} data-best={r.id === analysis.recommended} data-today={r.id === 'hoy'}>
                            <span className="rank-name">
                                {r.name}
                                {r.ideal && <i className="rank-ideal">ideal</i>}
                            </span>
                            <span className="rank-bar">
                                <span style={{ width: `${Math.max(2, (r.total ?? 0) * 100)}%` }} />
                            </span>
                            <span className="rank-score num">{cell(r.total)}</span>
                        </li>
                    ))}
                </ul>
            )}

            <Modal open={open === 'detail'} title="Puntaje por criterio" onClose={() => setOpen(null)} wide>
                {analysis.recommended_reason && <p className="small">{analysis.recommended_reason}</p>}
                <div className="table-wrap">
                    <table className="criteria-table small">
                        <thead>
                            <tr>
                                <th>Criterio</th>
                                <th className="num">Peso</th>
                                {analysis.current_scores && <th className="num">Hoy</th>}
                                {alts.map((a) => (
                                    <th key={a.id} className="num">
                                        {a.name}
                                        {a.id === analysis.recommended && ' ★'}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {shown.map((c) => (
                                <tr key={c.key}>
                                    <td title={c.hint}>{c.label}</td>
                                    <td className="num">{used ? fmt((used[c.key] || 0) * 100) : '—'}</td>
                                    {analysis.current_scores && <td className="num">{cell(analysis.current_scores[c.key])}</td>}
                                    {alts.map((a) => (
                                        <td key={a.id} className="num">
                                            {cell(a.scores[c.key])}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                            <tr className="criteria-total">
                                <td>Total</td>
                                <td />
                                {analysis.current_scores && <td className="num">{cell(analysis.current_score_total)}</td>}
                                {alts.map((a) => (
                                    <td key={a.id} className="num">
                                        {cell(a.score_total)}
                                    </td>
                                ))}
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p className="small">0 a 100 por criterio; 100 es lo mejor entre hoy y las alternativas.{sens.length ? ` Cambia la recomendación si pesas distinto: ${sens.map((c) => c.label.toLowerCase()).join(', ')}.` : ''}</p>
            </Modal>

            <Modal open={open === 'weights'} title="Qué pesa más para ti" onClose={() => setOpen(null)}>
                <div className="weights-list">
                    {shown.map((c) => (
                        <label key={c.key} className="weight-row">
                            <span title={c.hint}>{c.label}</span>
                            <input type="range" min="0" max="1" step="0.05" value={draft[c.key] ?? 0} onChange={(e) => setDraft({ ...draft, [c.key]: Number(e.target.value) })} />
                            <b className="num">{fmt((draft[c.key] ?? 0) * 100)}</b>
                        </label>
                    ))}
                </div>
                <p className={`small num${ok ? '' : ' warn'}`}>
                    Suman {fmt(sum * 100)} %{ok ? '' : ' (deben sumar 100 %)'}
                </p>
                <div className="dialog-actions">
                    <button type="button" className="opt-btn" onClick={() => setDraft(keep(DEFAULT_WEIGHTS))}>
                        Por defecto
                    </button>
                    {!ok && (
                        <button type="button" className="opt-btn" onClick={() => setDraft(normalizeWeights(draft))}>
                            Que sumen 100 %
                        </button>
                    )}
                    <button type="button" className="opt-btn opt-btn--solid" disabled={!ok || busy} onClick={async () => (await onReweigh(draft), setOpen(null))}>
                        {busy ? 'Recalculando…' : 'Recalcular'}
                    </button>
                </div>
            </Modal>
        </div>
    )
}
