import { TOPICS } from '../../contextWorkspace'

const STAGES = { queued: 'En espera', interpreting: 'El intérprete está comprendiendo y delegando el encargo', specialists: 'Los especialistas preparan sus entregas', clarifying: 'El intérprete y los especialistas resuelven dudas', consolidating: 'El consolidador integra las entregas en el maestro', review: 'Interpretación disponible para revisar' }

const STEPS = [['interpreting', 'Leer y repartir'], ['specialists', 'Especialistas'], ['clarifying', 'Aclarar dudas'], ['consolidating', 'Consolidar']]
const AGENTS = { interprete: 'Intérprete', consolidador: 'Consolidador' }
const agentName = (agent = '') => AGENTS[agent] || agent.replace(/^especialista:(revision:)?/, 'Especialista de ').replace('interprete:aclaracion', 'Aclaraciones')

export function JobStatus({ remote }) {
    const final = { error: 'La interpretación no se completó', conflict: 'El expediente cambió; el resultado necesita revisión', cancelled: 'Interpretación cancelada', interrupted: 'Interpretación interrumpida', partial: 'Organizada con incidencias en algunas partes', done: 'Interpretación lista para revisar' }
    const job = remote.job
    if (remote.busy && job) {
        const current = Math.max(0, STEPS.findIndex(([id]) => id === job.stage))
        const progress = job.stage_progress?.total ? job.stage_progress.completed / job.stage_progress.total : 0
        return <div className="cw-job cw-job--running" role="status">
            <ol className="cw-job-steps">{STEPS.map(([id, label], index) => <li key={id} className={index < current ? 'is-done' : index === current ? 'is-current' : ''}><span aria-hidden="true">{index < current ? '✓' : index + 1}</span>{label}</li>)}</ol>
            <div className="cw-job-row"><strong>{STAGES[job.stage] || 'Preparando la lectura'}</strong>{job.stage_progress?.total > 0 && <span className="num">{job.stage_progress.completed} de {job.stage_progress.total}</span>}<button className="cw-text-button" type="button" onClick={remote.cancel}>Cancelar</button></div>
            <div className="cw-job-bar" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></div>
            <p className="cw-muted">Lo que ya tenías sigue guardado. El resultado nuevo aparece al terminar.</p>
        </div>
    }
    if (!remote.notice && !job) return null
    const problems = job?.errors || []
    return <div className="cw-job" role="status">
        <div className="cw-job-row"><strong>{remote.notice || final[job.status] || job.status}</strong>{!remote.busy && job && ['partial', 'interrupted', 'error', 'conflict'].includes(job.status) && <button type="button" className="cw-button cw-button--outline cw-button--small" onClick={remote.retry}>Reintentar</button>}</div>
        {problems.length > 0 && <details className="cw-job-problems"><summary>Ver {problems.length} {problems.length === 1 ? 'parte que no se pudo leer' : 'partes que no se pudieron leer'}</summary><ul>{problems.map((problem, index) => <li key={index}><strong>{agentName(problem.agent) || `Bloque ${(problem.block ?? index) + 1}`}:</strong> {typeof problem.detail === 'string' ? problem.detail : JSON.stringify(problem.detail)}</li>)}</ul></details>}
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
