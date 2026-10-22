import { TOPICS } from '../../contextWorkspace'

const STAGES = { queued: 'En espera', interpreting: 'El intérprete está comprendiendo y delegando el encargo', specialists: 'Los especialistas preparan sus entregas', clarifying: 'El intérprete y los especialistas resuelven dudas', consolidating: 'El consolidador integra las entregas en el maestro', review: 'Interpretación disponible para revisar' }

export function JobStatus({ remote }) {
    const final = { error: 'La interpretación no se completó', conflict: 'El expediente cambió; el resultado necesita revisión', cancelled: 'Interpretación cancelada', interrupted: 'Interpretación interrumpida', partial: 'Organizada con incidencias en algunas partes', done: 'Interpretación disponible para revisar' }
    return <div className="cw-job-status" role="status">
        {remote.notice && <p className="cw-notice">{remote.notice}</p>}
        {remote.job && <>{(remote.busy || !remote.notice) && <p>{remote.busy ? STAGES[remote.job.stage] || remote.job.status : final[remote.job.status] || remote.job.status}</p>}{remote.busy && <p>Los datos que ya estaban visibles pertenecen a la revisión anterior. El resultado nuevo aparecerá al terminar la consolidación.</p>}{remote.busy && remote.job.stage_progress && <p>{remote.job.stage_progress.completed} de {remote.job.stage_progress.total} entregas de esta etapa.</p>}
            {remote.busy && <button className="cw-button cw-button--outline" type="button" onClick={remote.cancel}>Cancelar interpretación</button>}
            {!remote.busy && ['partial', 'interrupted', 'error', 'conflict'].includes(remote.job.status) && <button type="button" className="cw-button cw-button--outline" onClick={remote.retry}>Reintentar interpretación</button>}
            {remote.job.errors?.length > 0 && <details><summary>Ver incidencias de lectura ({remote.job.errors.length})</summary><pre>{JSON.stringify(remote.job.errors, null, 2)}</pre></details>}</>}
    </div>
}

export default function MasterReview({ master, busy, job }) {
    if (busy) return <section className="cw-section cw-master-review" role="status"><h2>{STAGES[job?.stage] || 'Preparando la lectura'}</h2><p>Los datos de la revisión anterior permanecen conservados. El resultado nuevo se publicará cuando termine la consolidación.</p>{job?.stage_progress && <p>{job.stage_progress.completed} de {job.stage_progress.total} entregas de esta etapa.</p>}</section>
    if (master?.schema_version !== 2) return null
    const questions = [...new Map(master.questions.filter((q) => q.status === 'unresolved').map((q) => [q.id, q])).values()]
    // Plegado: es el detalle de cómo leyeron los agentes; lo que se confirma está en «Datos propuestos».
    return <details className="cw-section cw-master-review">
        <summary><span className="cw-kicker">LECTURA DE LOS AGENTES</span><span className="cw-master-title">Así interpretamos tu planta</span><span className="cw-muted">{master.entities.length} entidades · {master.facts.length} afirmaciones con evidencia · {questions.length} dudas pendientes</span></summary>
        {TOPICS.map((topic) => { const facts = master.facts.filter((fact) => fact.topic === topic.id); return facts.length > 0 && <details key={topic.id} open={topic.id === 'maquinas' || topic.id === 'flujo'}><summary>{topic.label} · {facts.length}</summary><ul>{facts.map((fact) => <li key={fact.id}><strong>{fact.entity} — {fact.label}:</strong> {fact.value}{fact.scope !== 'current' && <span className="cw-badge">{({ goal: 'Objetivo', proposal: 'Propuesta', uncertain: 'Incierto' })[fact.scope]}</span>}<details><summary>Consultar evidencia</summary><blockquote>{fact.excerpt}</blockquote></details></li>)}</ul></details> })}
        {questions.length > 0 && <><h3>Dudas que siguen abiertas</h3><ul>{questions.map((q) => <li key={q.id}>{q.question}</li>)}</ul></>}
        <details><summary>Recorrido de los agentes y tiempos</summary><ol>{master.trace.map((step, index) => <li key={index}>{step.agent} · {step.status === 'done' ? 'Entregado' : 'Con incidencia'} · {step.elapsed_s} s</li>)}</ol></details>
    </details>
}
