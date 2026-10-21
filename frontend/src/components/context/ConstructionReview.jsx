export default function ConstructionReview({ report, stale = false }) {
    if (!report) return null
    const labels = { met: 'Cumplido', unmet: 'No cumplido', unverifiable: 'Falta verificar', not_geometric: 'Dato de contexto' }
    return <section className="block cw-construction-review">
        <h3>Comprobación del plano contra tu contexto</h3>
        <p className="small">{stale ? 'El plano cambió después de esta comprobación. Vuelve a comprobarlo.' : report.status === 'verified' ? 'Se cumplen los requisitos comprobables de esta revisión.' : 'Este plano requiere revisión: consulta los requisitos pendientes y las posiciones provisionales.'}</p>
        <p className="small">{report.totals.met} cumplidos · {report.totals.unmet} no cumplidos · {report.totals.unverifiable} sin datos para verificar.</p>
        <details><summary>Revisar cada requisito</summary><ul>{report.requirements.map((row) => <li key={row.fact_id}><strong>{labels[row.status]} — {row.entity}:</strong> {row.requirement}<p className="small">{row.reason}</p></li>)}</ul></details>
        {report.assumptions.length > 0 && <details open><summary>Supuestos del dibujo que debes revisar</summary><ul>{report.assumptions.map((text) => <li key={text}>{text}</li>)}</ul></details>}
    </section>
}
