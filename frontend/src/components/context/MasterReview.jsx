import { TOPICS } from '../../contextWorkspace'

export const STAGES = { queued: 'En espera', interpreting: 'El intérprete está comprendiendo y delegando el encargo', specialists: 'Los especialistas preparan sus entregas', clarifying: 'El intérprete y los especialistas resuelven dudas', consolidating: 'El consolidador integra las entregas en el maestro', review: 'Interpretación disponible para revisar' }

export default function MasterReview({ master, busy, job }) {
    if (busy) return <section className="cw-section cw-master-review" role="status"><h2>{STAGES[job?.stage] || 'Preparando la lectura'}</h2><p>Los datos de la revisión anterior permanecen conservados. El resultado nuevo se publicará cuando termine la consolidación.</p>{job?.stage_progress && <p>{job.stage_progress.completed} de {job.stage_progress.total} entregas de esta etapa.</p>}</section>
    if (master?.schema_version !== 2) return null
    const questions = master.questions.filter((q) => q.status === 'unresolved')
    return <section className="cw-section cw-master-review">
        <span className="cw-kicker">CONTEXTO MAESTRO · PARA REVISAR</span><h2>Así interpretamos tu planta</h2>
        <p className="cw-muted">{master.entities.length} entidades · {master.facts.length} afirmaciones con evidencia · {questions.length} dudas pendientes. El borrador todavía necesita tu revisión y confirmación de datos.</p>
        {TOPICS.map((topic) => { const facts = master.facts.filter((fact) => fact.topic === topic.id); return facts.length > 0 && <details key={topic.id} open={topic.id === 'maquinas' || topic.id === 'flujo'}><summary>{topic.label} · {facts.length}</summary><ul>{facts.map((fact) => <li key={fact.id}><strong>{fact.entity} — {fact.label}:</strong> {fact.value}{fact.scope !== 'current' && <span className="cw-badge">{({ goal: 'Objetivo', proposal: 'Propuesta', uncertain: 'Incierto' })[fact.scope]}</span>}<details><summary>Consultar evidencia</summary><blockquote>{fact.excerpt}</blockquote></details></li>)}</ul></details> })}
        {questions.length > 0 && <><h3>Dudas que siguen abiertas</h3><ul>{questions.map((q) => <li key={q.id}>{q.question}</li>)}</ul></>}
        <details><summary>Recorrido de los agentes y tiempos</summary><ol>{master.trace.map((step, index) => <li key={index}>{step.agent} · {step.status === 'done' ? 'Entregado' : 'Con incidencia'} · {step.elapsed_s} s</li>)}</ol></details>
    </section>
}
