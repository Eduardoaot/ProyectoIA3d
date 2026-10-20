import { useState } from 'react'
import { fmt } from '../api'
import { CRITERIA, DEFAULT_WEIGHTS, normalizeWeights, sensitiveCriteria, sumOf, validWeights } from '../weights'

/* Decisión multicriterio: puntajes del motor (si vienen) y pesos editables (si el backend
   anuncia `weights`). Cambiar pesos no recalcula solo: el usuario pulsa «Recalcular». */
export default function Criteria({ analysis, canWeigh, weights, onReweigh, busy }) {
    const [draft, setDraft] = useState(() => ({ ...(weights || analysis.weights_used || DEFAULT_WEIGHTS) }))
    const alts = analysis.alternatives.filter((a) => a.scores)
    const hasScores = alts.length > 0
    if (!hasScores && !canWeigh) return null

    const sum = sumOf(draft)
    const ok = validWeights(draft)
    const used = analysis.weights_used
    const sens = sensitiveCriteria(alts[0]?.sensitivity)
    const cell = (v) => (v == null ? '—' : fmt(v * 100))

    return (
        <div className="criteria">
            {hasScores && (
                <>
                    <h3>Cómo se comparan</h3>
                    <p className="small">
                        Puntaje de 0 a 100 por criterio (100 es lo mejor entre hoy y las alternativas). El total usa los pesos de abajo.
                        {analysis.ideal && analysis.ideal !== analysis.recommended && (
                            <> La mejor técnica sin contar obra ni elementos fijos sería «{analysis.alternatives.find((a) => a.id === analysis.ideal)?.name}» (ideal); la recomendada es la mejor viable.</>
                        )}
                    </p>
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
                                            {a.kind === 'ideal' && <span className="tag">ideal</span>}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {CRITERIA.map((c) => (
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
                    <p className="small">
                        {sens.length ? `La recomendación cambia si se pesa distinto: ${sens.map((c) => c.label.toLowerCase()).join(', ')}.` : 'La recomendación es la misma aunque cada peso se reduzca a la mitad o se duplique.'}
                        {analysis.weights_note && ` ${analysis.weights_note}`}
                    </p>
                </>
            )}

            {canWeigh && (
                <div className="weights">
                    <h3>Qué pesa más para ti</h3>
                    <div className="weights-grid">
                        {CRITERIA.map((c) => (
                            <label key={c.key} className="field">
                                <span>{c.label}</span>
                                <input type="number" min="0" max="1" step="0.05" value={draft[c.key] ?? 0} onChange={(e) => setDraft({ ...draft, [c.key]: Math.max(0, Number(e.target.value) || 0) })} />
                            </label>
                        ))}
                    </div>
                    <div className="row">
                        <span className={`small num${ok ? '' : ' warn'}`}>Suman {fmt(sum, 2)}{ok ? '' : ' (deben sumar 1)'}</span>
                        {!ok && (
                            <button type="button" className="btn btn--ghost btn--small" onClick={() => setDraft(normalizeWeights(draft))}>
                                Ajustar para que sumen 1
                            </button>
                        )}
                        <button type="button" className="btn btn--ghost btn--small" onClick={() => setDraft({ ...DEFAULT_WEIGHTS })}>
                            Pesos por defecto
                        </button>
                        <button type="button" className="btn btn--small" disabled={!ok || busy} onClick={() => onReweigh(draft)}>
                            {busy ? 'Recalculando…' : 'Recalcular con estos pesos'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
