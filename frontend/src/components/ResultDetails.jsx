import { displayValue } from '../context'

export function MetricValues({ values }) {
    if (values == null) return <span>sin datos</span>
    if (typeof values !== 'object' || Array.isArray(values)) return <span>{displayValue(values)}</span>
    return <dl className="metric-values">{Object.entries(values).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd><MetricValues values={value} /></dd></div>)}</dl>
}
export default function ResultDetails({ analysis, alternative }) {
    if (alternative) return <div className="result-details">
        {alternative.kind && <p>Tipo: {alternative.kind}</p>}
        {alternative.method && <p>Método: {alternative.method}</p>}
        {alternative.assumptions?.length > 0 && <ul>{alternative.assumptions.map((text, i) => <li key={i}>{text}</li>)}</ul>}
        {alternative.scores && <details><summary>Puntajes por criterio</summary><MetricValues values={alternative.scores} /></details>}
        {alternative.flows && <details><summary>Métricas por flujo</summary><MetricValues values={alternative.flows} /></details>}
        {alternative.sensitivity && <details><summary>Sensibilidad de la recomendación</summary><MetricValues values={alternative.sensitivity} /></details>}
    </div>
    return <div className="result-details">
        {analysis.main_metric && <p>Métrica principal: {analysis.main_metric.label} ({analysis.main_metric.direction === 'min' ? 'menor es mejor' : 'mayor es mejor'})</p>}
        {analysis.recommended_reason && <p>{analysis.recommended_reason}</p>}
        {analysis.recommended_tradeoffs?.length > 0 && <><h3>Compromisos de la recomendación</h3><ul>{analysis.recommended_tradeoffs.map((t, i) => <li key={i}>{t.metric}: {t.delta_pct == null ? 'sin datos' : `${t.delta_pct}%`} · {t.note}</li>)}</ul></>}
        {analysis.weights_used && <details><summary>Pesos utilizados</summary><MetricValues values={analysis.weights_used} /></details>}
    </div>
}
export function DiscardedClaims({ validation }) {
    if (!validation?.discarded?.length) return null
    return <section className="discarded-claims"><h3>Afirmaciones descartadas</h3><ul>{validation.discarded.map((d, i) => <li key={i}><q>{d.text}</q> · {d.reason}</li>)}</ul></section>
}
