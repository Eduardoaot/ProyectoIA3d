import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { addEntry, current, history, parseValue } from '../../context'
import { TOPICS, organizeText, entryLabel, displayEntry, readAttachment, downloadAttachment, downloadTemplate, parseTemplate } from '../../contextWorkspace'
import { api } from '../../api'
import { has } from '../../capabilities'
import useCaps from '../../useCaps'
import { CRITERIA, DEFAULT_WEIGHTS, normalizeWeights, validWeights } from '../../weights'
import { ask } from '../Dialog'
import References from '../References'
import FlowMark from '../../brand/FlowMark'
import WorkStudies from './WorkStudies'
import useWorkspaceBackend from './useWorkspaceBackend'
import { BackendTools, WorkInput, OperatorPanel, ReviewAssistance } from './BackendPanels'
import MasterReview, { JobStatus } from './MasterReview'
import WaitPanel from '../WaitPanel'
import { startWait } from '../wait'
import './context-workspace.css'

const EMPTY_WORKSPACE = { proposals: [], attachments: [], activities: [] }
const SOURCE_LABELS = { usuario: 'Proporcionado por una persona', medido: 'Medición', estimado: 'Estimación', supuesto: 'Supuesto' }
const emptyForm = () => ({ label: '', value: '', unit: '', source: 'usuario', confidence: 'media', owner: '', supersedes: null })
const rawValue = (value) => Array.isArray(value) ? value.join(' a ') : String(value ?? '')
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const SHARED_FIELDS = ['count', 'width', 'depth', 'x', 'z', 'operators', 'location', 'locked']
const conflictKey = (p) => p.entity_id && p.field ? [p.entity_id, p.field, p.target, p.scope, ...(SHARED_FIELDS.includes(p.field) ? [] : [p.id])].join('|') : `${p.topic}|${normalize(p.label)}`
const topicLabel = (id) => TOPICS.find((topic) => topic.id === id)?.label || id
const ready = (proposal) => !!proposal.label?.trim() && !!rawValue(proposal.value).trim()
const sizeLabel = (bytes) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

function Arrow({ diagonal = false }) {
    return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.8" /></svg>
}

function Check() {
    return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5" stroke="currentColor" strokeWidth="2.4" /></svg>
}

function Cross() {
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" stroke="currentColor" strokeWidth="2.4" /></svg>
}

function Proposal({ proposal, index = 0, onChange, onConfirm, onDiscard, onKeep }) {
    return (
        <motion.article layout="position" className={`cw-proposal${proposal.status === 'blocked' ? ' is-blocked' : ''}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.35, delay: Math.min(index, 16) * 0.035 } }} exit={{ opacity: 0, x: -32, transition: { duration: 0.25 } }}>
            <div className="cw-section-line"><span className="cw-badge cw-badge--pending">{proposal.status === "blocked" ? "Requiere aclaración" : "Por revisar"}</span>{proposal.status === 'blocked' && <p className="cw-muted">Hay otra propuesta con un valor distinto para este mismo dato. Elige cuál conservar.</p>}</div>
            <blockquote>«{proposal.excerpt}»{proposal.origin && <cite>{proposal.origin}</cite>}</blockquote>
            <div className="cw-proposal-body">
                <div className="cw-proposal-fields">
                    <label className="cw-field">Tema<select value={proposal.topic} onChange={(event) => onChange({ topic: event.target.value })}>{TOPICS.map((topic) => <option value={topic.id} key={topic.id}>{topic.label}</option>)}</select></label>
                    <label className="cw-field">Nombre del dato<input value={proposal.label || ''} onChange={(event) => onChange({ label: event.target.value })} /></label>
                    <label className="cw-field cw-field--value">Lo que entendimos<textarea rows="1" value={rawValue(proposal.value)} onChange={(event) => onChange({ value: event.target.value })} /></label>
                </div>
                <div className="cw-proposal-actions">
                    {proposal.status === 'blocked' ? <button type="button" className="cw-button cw-button--small" onClick={onKeep}><Check />Quedarme con este valor</button> : <button type="button" className="cw-button cw-button--small" onClick={onConfirm} disabled={!ready(proposal)}><Check />Confirmar</button>}
                    <button type="button" className="cw-button cw-button--small cw-button--outline" onClick={onDiscard}><Cross />Descartar</button>
                </div>
            </div>
        </motion.article>
    )
}

function Reviewed({ proposals, onRestore }) {
    const confirmedCount = proposals.filter((proposal) => proposal.status === 'confirmed').length
    return (
        <details className="cw-processed">
            <summary><span className="cw-processed-title">Propuestas revisadas</span><span className="cw-processed-counts"><span>{confirmedCount} confirmadas</span><span>{proposals.length - confirmedCount} descartadas</span></span><span className="cw-processed-toggle" aria-hidden="true" /></summary>
            <ul className="cw-processed-list">{proposals.map((proposal) => <li key={proposal.id} className={proposal.status === 'confirmed' ? '' : 'is-discarded'}>
                <span className={`cw-status ${proposal.status === 'confirmed' ? '' : 'cw-status--off'}`}>{proposal.status === 'confirmed' ? <><Check />Confirmada</> : <><Cross />Descartada</>}</span>
                <div><strong>{proposal.label}</strong><span className="cw-processed-topic">{topicLabel(proposal.topic)}</span><p title={proposal.excerpt}>«{proposal.excerpt}»</p></div>
                {proposal.status !== 'confirmed' ? <button type="button" className="cw-text-button" onClick={() => onRestore(proposal.id)}>Recuperar</button> : <span />}
            </li>)}</ul>
        </details>
    )
}

function ManualTopic({ topic, context, onContextChange, hasFiles, onAttach }) {
    const [form, setForm] = useState(emptyForm)
    const [editing, setEditing] = useState(false)
    const inputRef = useRef(null)
    const data = current(context).filter((entry) => entry.segment === topic.id)
    const set = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }))
    const start = (entry) => {
        setForm(entry ? { ...entry, label: entryLabel(entry), value: rawValue(entry.value), unit: entry.unit || '', owner: entry.owner || '', supersedes: entry.id } : emptyForm())
        setEditing(true)
        requestAnimationFrame(() => inputRef.current?.focus())
    }
    const save = (event) => {
        event.preventDefault()
        if (!form.label.trim() || !form.value.trim()) return
        const key = form.key || `${topic.id}.${form.label.trim()}`
        const previous = current(context).find((entry) => entry.key === key)
        onContextChange(addEntry(context, { segment: topic.id, key, value: parseValue(form.value), unit: form.unit.trim(), source: form.source, confidence: form.confidence, owner: form.owner.trim(), supersedes: form.supersedes || previous?.id }))
        setEditing(false)
        setForm(emptyForm())
    }
    return (
        <section className="cw-section">
            <div className="cw-section-line"><div><span className="cw-kicker">INFORMACIÓN VIGENTE</span><h2>Lo que sabemos <span className="cw-count">{data.length}</span></h2></div>{!editing && <button type="button" className="cw-button cw-button--outline" onClick={() => start()}>+ Agregar dato</button>}</div>
            {!data.length && !editing && <><button type="button" className="cw-empty cw-empty--action" onClick={() => start()}><span className="cw-empty-mark" aria-hidden="true">+</span><span className="cw-empty-title">Este tema empieza contigo.</span><span className="cw-empty-text">{topic.hint}</span><span className="cw-empty-text cw-example">Por ejemplo: {topic.example}</span><span className="cw-empty-cta">Agregar el primer dato <Arrow /></span></button>{!hasFiles && <p className="cw-empty-alt">¿Ya lo tienes en un documento o una hoja de cálculo? <button type="button" className="cw-text-button" onClick={onAttach}>Adjuntar archivo</button><span aria-hidden="true">·</span><button type="button" className="cw-text-button" onClick={() => downloadTemplate(topic)}>Descargar formato <Arrow /></button></p>}</>}
            {data.length > 0 && <div className="cw-data-list">{data.map((entry) => {
                const past = history(context, entry.id).slice(1)
                return <article className="cw-data" key={entry.id}><div className="cw-section-line"><h3>{entryLabel(entry)}</h3><button type="button" className="cw-text-button" onClick={() => start(entry)}>Corregir <Arrow diagonal /></button></div><p className="cw-data-value">{displayEntry(entry)}</p><div className="cw-meta"><span className="cw-badge">Dato confirmado</span><span>{SOURCE_LABELS[entry.source] || entry.source}</span><span>Confianza {entry.confidence}</span><span>{entry.date}</span>{entry.owner && <span>{entry.owner}</span>}</div>{past.length > 0 && <details className="cw-history"><summary>Ver {past.length} {past.length === 1 ? 'versión anterior' : 'versiones anteriores'}</summary>{past.map((version) => <p key={version.id}>Versión {version.version} · {version.date} · {displayEntry(version)} · {SOURCE_LABELS[version.source] || version.source} · confianza {version.confidence}</p>)}</details>}</article>
            })}</div>}
            {editing && <form className="cw-manual-form" onSubmit={save}><div className="cw-section-line"><h3>{form.supersedes ? 'Corregir este dato' : 'Un dato nuevo'}</h3><button type="button" className="cw-text-button" onClick={() => setEditing(false)}>Cancelar</button></div><p className="cw-muted">{form.supersedes ? 'La versión anterior quedará en el historial.' : 'Cuéntalo con tus palabras. Si conoces cantidad, unidad, quién lo observó y si es aproximado, inclúyelos en la descripción.'}</p><div className="cw-form-grid"><label className="cw-field cw-field--wide">¿De qué se trata?<input ref={inputRef} value={form.label} onChange={set('label')} placeholder="Ej. Tiempo de corte" required readOnly={!!form.supersedes} /></label><label className="cw-field cw-field--wide">Descripción<textarea rows="3" value={form.value} onChange={set('value')} placeholder={topic.example} required /></label></div><button type="submit" className="cw-button" disabled={!form.label.trim() || !form.value.trim()}>{form.supersedes ? 'Guardar corrección' : 'Agregar al contexto'} <Arrow /></button></form>}
        </section>
    )
}

function Priorities({ weights, onChange }) {
    const [draft, setDraft] = useState(() => ({ ...(weights || DEFAULT_WEIGHTS) }))
    const [saved, setSaved] = useState(false)
    const total = Math.round(CRITERIA.reduce((sum, criterion) => sum + (Number(draft[criterion.key]) || 0), 0) * 100)
    const change = (key, value) => { setDraft((previous) => ({ ...previous, [key]: Number(value) / 100 })); setSaved(false) }
    return <><div className="cw-page-head"><span className="cw-kicker">CRITERIOS PARA DECIDIR</span><h1>¿Qué pesa más<br />para ti?</h1><p>Una buena distribución depende de lo que tu planta necesita. Reparte la importancia de cada criterio para orientar las alternativas.</p></div><div className="cw-priorities"><div className="cw-weight-list">{CRITERIA.map((criterion, index) => <label className="cw-weight" key={criterion.key}><span className="cw-weight-number">0{index + 1}</span><span className="cw-weight-body"><span className="cw-section-line"><span><strong>{criterion.label}</strong><small>{criterion.hint}</small></span><span className="cw-percent-input"><input aria-label={`${criterion.label} en porcentaje`} type="number" min="0" max="100" step="1" value={Math.round((draft[criterion.key] || 0) * 100)} onChange={(event) => change(criterion.key, Math.max(0, Math.min(100, Number(event.target.value))))} /><span>%</span></span></span><input aria-label={`Ajustar ${criterion.label}`} type="range" min="0" max="100" value={Math.round((draft[criterion.key] || 0) * 100)} onChange={(event) => change(criterion.key, event.target.value)} /></span></label>)}</div><aside className="cw-side-card"><span className="cw-kicker">IMPORTANCIA TOTAL</span><div className="cw-big-number">{total}<span>%</span></div><p>{validWeights(draft) ? 'Lista para orientar tu siguiente recomendación.' : 'La suma debe ser 100 %. Puedes distribuir los valores conservando tus proporciones.'}</p><button type="button" className="cw-text-button" onClick={() => { setDraft(normalizeWeights(draft)); setSaved(false) }}>Distribuir al 100 % <Arrow /></button><hr /><span className="cw-kicker">PUNTO DE PARTIDA</span><p>Los valores iniciales son una propuesta. Ajústalos según los objetivos de tu planta.</p><button type="button" className="cw-text-button" onClick={() => { setDraft({ ...DEFAULT_WEIGHTS }); setSaved(false) }}>Restablecer valores iniciales</button></aside></div><div className="cw-actions"><button type="button" className="cw-button" disabled={!validWeights(draft)} onClick={() => { onChange({ ...draft }); setSaved(true) }}>Guardar prioridades <Arrow /></button>{saved && <span className="cw-muted" role="status">Prioridades guardadas.</span>}</div></>
}

function ProjectsPanel({ projects, activeId, project, finishing, onSave, onCreate, onSelect, onClear }) {
    const [name, setName] = useState('')
    const [title, setTitle] = useState(project.name || '')
    const saved = projects.find((item) => item.id === activeId)?.savedAt
    const [clearing, setClearing] = useState(false)
    const [notice, setNotice] = useState('')
    const create = (event) => {
        event.preventDefault()
        if (!name.trim()) return
        onCreate(name.trim())
        setName('')
        setNotice('Proyecto creado. Ya puedes agregarle su propio contexto.')
    }
    const save = (event) => {
        event.preventDefault()
        if (!title.trim()) return
        onSave(title.trim())
        setNotice(`«${title.trim()}» quedó guardado en Tus proyectos. Puedes volver a abrirlo cuando quieras.`)
    }
    const clear = async () => {
        if (!(await ask(`Se borrarán el texto, los datos, estudios, referencias, prioridades y archivos de «${project.name || 'este proyecto'}». El plano permanecerá.`, { title: '¿Borrar el contexto?', ok: 'Sí, borrar' }))) return
        setClearing(true)
        try {
            await onClear()
            setNotice('Se borró el contexto de este proyecto. Los demás proyectos siguen intactos.')
        } catch {
            setNotice('No se pudo borrar algún archivo. El contexto sigue disponible; inténtalo de nuevo.')
        } finally {
            setClearing(false)
        }
    }

    return <>
        <div className="cw-page-head"><span className="cw-kicker">ESPACIOS INDEPENDIENTES</span><h1>Tus proyectos.</h1><p>Cada proyecto guarda su propio plano, contexto, estudios, prioridades y resultados en este navegador.</p></div>
        {notice && <p className="cw-notice" role="status">{notice}</p>}
        <section className={`cw-section cw-project-save ${finishing ? 'is-finishing' : ''}`}><span className="cw-kicker">{finishing ? 'TERMINASTE TU PROYECTO' : 'PROYECTO ACTUAL'}</span><h2>{finishing ? 'Guárdalo con un nombre.' : 'Guardar este proyecto'}</h2><p className="cw-muted">El plano, el contexto, el análisis y el reporte quedan juntos en este navegador.{saved ? ` Guardado por última vez el ${new Date(saved).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}.` : ''}</p><form onSubmit={save} className="cw-project-save-form"><label className="cw-field">Nombre del proyecto<input value={title} maxLength="80" onChange={(event) => setTitle(event.target.value)} placeholder="Ej. Planta de tablas de surf" required /></label><button type="submit" className="cw-button" disabled={!title.trim()}><Check />Guardar proyecto</button></form></section>
        <section className="cw-section"><div className="cw-section-line"><h2>Proyectos guardados</h2><span className="cw-muted">{projects.length} {projects.length === 1 ? 'proyecto' : 'proyectos'}</span></div><div className="cw-project-list">{projects.map((item) => <article className="cw-project-row" key={item.id}><div><strong>{item.name}</strong><span className="cw-muted">{item.hasPlant ? 'Con plano' : 'Sin plano'} · {item.contextItems} datos de contexto{item.savedAt ? ` · guardado el ${new Date(item.savedAt).toLocaleDateString('es-MX', { dateStyle: 'medium' })}` : ''}</span></div>{item.id === activeId ? <span className="cw-badge">Proyecto actual</span> : <button type="button" className="cw-button cw-button--outline" onClick={() => { onSelect(item.id); setNotice(`Abriste «${item.name}».`) }}>Abrir proyecto</button>}</article>)}</div></section>
        <section className="cw-section cw-project-create"><h2>Iniciar otro proyecto</h2><p className="cw-muted">Empieza vacío. Los proyectos anteriores quedan guardados por separado.</p><form onSubmit={create} className="cw-project-create-form"><label className="cw-field">Nombre del nuevo proyecto<input value={name} maxLength="80" onChange={(event) => setName(event.target.value)} placeholder="Ej. Nueva línea de transformadores" required /></label><button type="submit" className="cw-button" disabled={!name.trim()}>Crear proyecto <Arrow /></button></form></section>
        <section className="cw-section cw-project-clear"><h2>Borrar el contexto actual</h2><p className="cw-muted">Borra el relato, datos por tema, propuestas, estudios, referencias, archivos y prioridades de «{project.name || 'este proyecto'}». Conserva su plano; el análisis anterior deberá actualizarse. No afecta otros proyectos.</p><button type="button" className="cw-button cw-button--outline" disabled={clearing} onClick={clear}>{clearing ? 'Borrando…' : 'Borrar contexto de este proyecto'}</button></section>
    </>
}

export default function ContextWorkspace({ project, onProjectChange, onPrioritiesToggle, projects, activeProjectId, onCreateProject, onSelectProject, onSaveProject, onNotify, onClearContext, plant, onTextChange, onContextChange, onWorkspaceChange, onWeightsChange, summary, confirmed, onConfirm, onClose, onGoToPlan, initialTopic = 'inicio' }) {
    const [active, setActive] = useState(initialTopic === 'guardar' ? 'proyectos' : initialTopic)
    const [message, setMessage] = useState('')
    const [uploading, setUploading] = useState(false)
    const [organizing, setOrganizing] = useState(false)
    const caps = useCaps()
    const remote = useWorkspaceBackend(project, activeProjectId, onProjectChange)
    const connected = has(caps, 'context_workspace')
    const dialogRef = useRef(null)
    const closeRef = useRef(null)
    const contentRef = useRef(null)
    const fileRef = useRef(null)
    const fileTopicRef = useRef('negocio')
    const closeCallbackRef = useRef(onClose)
    useEffect(() => { closeCallbackRef.current = onClose }, [onClose])
    const workspace = { ...EMPTY_WORKSPACE, ...(project.contextWorkspace || {}) }
    const context = project.context || { segments: {} }
    const data = current(context)
    const pending = workspace.proposals.filter((proposal) => ['pending', 'blocked'].includes(proposal.status))
    const activeTopic = TOPICS.find((topic) => topic.id === active)
    const countTopic = (id) => (id === 'estudios' ? workspace.activities.length : 0) + data.filter((entry) => entry.segment === id).length
    const filled = TOPICS.filter((topic) => countTopic(topic.id) > 0).length

    useEffect(() => {
        const previous = document.activeElement
        closeRef.current?.focus()
        const dialog = dialogRef.current
        const keydown = (event) => {
            // El minijuego usa Esc para pausar: si ya lo atendió, el panel no se cierra.
            if (event.key === 'Escape') { if (event.defaultPrevented) return; event.preventDefault(); closeCallbackRef.current(); return }
            if (event.key !== 'Tab') return
            const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]')].filter((element) => element.getClientRects().length)
            const first = controls[0]
            const last = controls.at(-1)
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
        dialog.addEventListener('keydown', keydown)
        return () => { dialog.removeEventListener('keydown', keydown); previous?.focus?.() }
    }, [])

    const go = (id) => { setActive(id); setMessage(''); contentRef.current?.scrollTo({ top: 0 }); requestAnimationFrame(() => contentRef.current?.focus()) }
    const updateProposal = (id, updates) => onWorkspaceChange((previous) => ({ proposals: (previous.proposals || []).map((proposal) => proposal.id === id ? { ...proposal, status: 'pending', conflict: null, ...updates } : proposal) }))
    const organize = async (text, origin) => {
        setOrganizing(true)
        setMessage('Organizando información…')
        try {
            const available = await api.getCapabilities()
            if (has(available, 'context_workspace')) {
                const done = startWait('context')
                setTimeout(() => contentRef.current?.querySelector('.cw-progress-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400)
                const result = await remote.interpret(text, 'context', workspace.attachments.find((file) => file.name === origin && file.storage === 'server')?.id)
                if (result) {
                    done()
                    // Al terminar se lleva a la persona a lo que tiene que revisar.
                    setTimeout(() => contentRef.current?.querySelector('.cw-proposals')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300)
                }
                if (!result) {
                    setMessage('La interpretación no se completó. Revisa la incidencia del proveedor. Tus datos anteriores permanecen guardados; puedes capturar datos manualmente o volver a intentar.')
                    return
                }
                setMessage('')
                setActive('inicio')
                return
            }
            let result = null
            let fallback = false
            if (has(caps, 'context_agents') && text.length <= 8000) {
                try { result = await api.organizeContext(text) } catch { fallback = true }
            } else fallback = true
            const proposed = (result?.proposals || organizeText(text)).map((proposal) => ({ ...proposal, id: `propuesta-${crypto.randomUUID()}`, ...(origin ? { origin } : {}) }))
            if (!proposed.length) { setMessage('No encontramos frases para organizar. Puedes agregar los datos directamente en cada tema.'); return }
            onWorkspaceChange((previous) => ({ proposals: [...(previous.proposals || []), ...proposed.filter((item) => !(previous.proposals || []).some((old) => old.excerpt === item.excerpt && old.topic === item.topic && old.status !== 'discarded'))], ...(result?.master ? { masterDraft: result.master } : {}) }))
            const partial = Object.keys(result?.errors || {}).length > 0
            setMessage(result ? `Los especialistas organizaron el contexto en un borrador JSON. Revisa cada propuesta antes de confirmarla.${partial ? ' Algunas secciones no pudieron procesarse.' : ''}` : `Organización local por palabras clave${fallback ? '; la IA no estuvo disponible para este envío' : ''}. Revisa cada propuesta.`)
            setActive('inicio')
        } catch (error) {
            setMessage(`No se pudo organizar la información${error instanceof Error ? `: ${error.message}` : '.'}`)
        } finally {
            setOrganizing(false)
        }
    }
    // Solo las listas para confirmar: las que están en conflicto o incompletas esperan su corrección.
    const confirmable = pending.filter((p) => p.status === 'pending' && ready(p))
    const confirmAll = () => {
        if (connected) return remote.confirm(confirmable.map((p) => p.id))
        let next = context
        for (const p of confirmable) {
            const key = `${p.topic}.${p.label.trim()}`
            const previous = current(next).find((e) => e.key === key)
            next = addEntry(next, { segment: p.topic, key, value: parseValue(rawValue(p.value)), unit: p.unit, source: 'usuario', confidence: p.confidence || 'baja', supersedes: previous?.id })
        }
        onContextChange(next)
        const ids = new Set(confirmable.map((p) => p.id))
        onWorkspaceChange({ proposals: workspace.proposals.map((p) => ids.has(p.id) ? { ...p, status: 'confirmed' } : p) })
    }
    // Conserva esta propuesta y descarta las demás del mismo dato: así deja de estar en conflicto.
    const discardAll = async () => {
        const ids = new Set(pending.map((proposal) => proposal.id))
        if (!ids.size || !(await ask(`Se descartarán ${ids.size} propuestas. El texto original se conserva y puedes recuperarlas desde «Propuestas revisadas».`, { title: '¿Descartar todas?', ok: 'Sí, descartar' }))) return
        onWorkspaceChange((previous) => ({ proposals: (previous.proposals || []).map((proposal) => ids.has(proposal.id) ? { ...proposal, status: 'discarded' } : proposal) }))
        setMessage(`${ids.size} propuestas descartadas. El texto original se conserva.`)
    }
    const keepProposal = (kept) => {
        const key = conflictKey(kept)
        onWorkspaceChange((previous) => ({ proposals: (previous.proposals || []).map((proposal) => proposal.id === kept.id ? { ...proposal, status: 'pending', conflict: null, conflict_kind: null } : ['pending', 'blocked'].includes(proposal.status) && conflictKey(proposal) === key ? { ...proposal, status: 'discarded' } : proposal) }))
        setMessage('Conservamos ese valor y descartamos las otras versiones del dato. Ya puedes confirmarlo.')
    }
    const confirmProposal = (proposal) => {
        if (connected) return remote.confirm([proposal.id])
        const key = `${proposal.topic}.${proposal.label.trim()}`
        const previous = data.find((entry) => entry.key === key)
        onContextChange(addEntry(context, { segment: proposal.topic, key, value: parseValue(rawValue(proposal.value)), unit: proposal.unit?.trim(), source: proposal.source || 'usuario', confidence: proposal.confidence || 'baja', owner: proposal.owner || proposal.origin || '', ...(previous ? { supersedes: previous.id } : {}) }))
        updateProposal(proposal.id, { status: 'confirmed' })
        setMessage('Dato confirmado. Ya esta disponible en su tema.')
    }
    const attach = (topic) => { fileTopicRef.current = topic; fileRef.current?.click() }
    const upload = async (event) => {
        const files = [...(event.target.files || [])]
        const topic = fileTopicRef.current
        event.target.value = ''
        if (!files.length) return
        setUploading(true)
        let results
        if (connected) {
            results = []
            for (const file of files) {
                try { results.push({ status: 'fulfilled', value: await remote.upload(file, topic) }) }
                catch (reason) { results.push({ status: 'rejected', reason }) }
            }
        } else results = await Promise.allSettled(files.map((file) => readAttachment(file, topic)))
        const attachments = results.filter((result) => result.status === 'fulfilled').map((result) => result.value)
        const failures = results.filter((result) => result.status === 'rejected')
        const templateRows = attachments.flatMap((file) => (file.text && parseTemplate(file.text) || []).map((row) => ({ ...row, id: `propuesta-${crypto.randomUUID()}`, topic, origin: file.name, status: 'pending' })))
        if (attachments.length) {
            const allFiles = [...workspace.attachments, ...attachments]
            onWorkspaceChange({ attachments: allFiles, proposals: [...workspace.proposals, ...templateRows] })
            if (connected) {
                try { await remote.save({ ...project, printed: false, contextWorkspace: { ...workspace, attachments: allFiles, proposals: [...workspace.proposals, ...templateRows] } }) }
                catch (reason) { failures.push({ status: 'rejected', reason }) }
            }
        }
        setMessage([attachments.length ? `${attachments.length} ${attachments.length === 1 ? 'archivo adjuntado' : 'archivos adjuntados'}. Consulta su estado de lectura.` : '', ...failures.map((result) => result.reason?.message || 'No se pudo guardar un archivo.')].filter(Boolean).join(' '))
        setUploading(false)
    }
    const attachments = (topic) => <section className="cw-section cw-attachments"><div className="cw-section-line"><div><span className="cw-kicker">EVIDENCIA Y DOCUMENTOS</span><h2>Archivos de este tema</h2></div><button type="button" className="cw-button cw-button--outline" disabled={uploading} onClick={() => attach(topic)}>{uploading ? 'Guardando…' : '+ Adjuntar archivo'}</button></div><p className="cw-muted">Hasta 10 MB por archivo. {connected ? 'Original conservado en la copia del proyecto.' : 'Guardado en este navegador.'} Un documento adjunto no confirma sus datos automáticamente.</p>{!workspace.attachments.some((file) => file.topic === topic) ? <button type="button" className="cw-upload" disabled={uploading} onClick={() => attach(topic)}><span aria-hidden="true">↥</span><strong>Agrega evidencia a la conversación</strong><span>Selecciona un documento · Texto legible: {connected ? 'TXT, MD, CSV, XLSX y PDF con texto' : 'TXT, MD y CSV'}</span><span>Otros formatos quedan pendientes de lectura.</span></button> : <div className="cw-file-list">{workspace.attachments.filter((file) => file.topic === topic).map((file) => <article className="cw-file" key={file.id}><div className="cw-section-line"><div><h3>{file.name}</h3><p className="cw-muted">{sizeLabel(file.size)} · {file.date?.slice(0, 10)} · Añadido por ti · {file.type || 'Tipo no indicado'}</p></div><button type="button" className="cw-text-button" onClick={async () => { try { if (file.storage === 'server') { const link = document.createElement('a'); link.href = `/api/workspaces/${remote.id}/documents/${file.id}`; link.click() } else await downloadAttachment(file.id) } catch (error) { setMessage(error.message || 'Este archivo no está disponible en el navegador.') } }}>Descargar ↓</button></div><span className={`cw-badge ${file.status === 'text_extracted' ? '' : 'cw-badge--pending'}`}>{file.status === 'text_extracted' ? 'Texto extraído · por revisar' : 'Adjunto · pendiente de lectura'}</span>{file.text && <details><summary>Revisar texto extraído</summary><pre>{file.text}</pre>{file.truncated && <p className="cw-muted">Vista de texto limitada; el documento completo permanece en el original. Descarga el archivo para consultar el documento completo.</p>}<button type="button" className="cw-text-button" onClick={() => connected && file.topic === 'estudios' ? remote.interpret(file.text, 'studies', file.id) : organize(file.text, file.name)}>Organizar texto del archivo <Arrow /></button><p className="cw-muted">{has(caps, 'context_agents') ? 'Interpretación asistida disponible' : 'Organización local por palabras clave'}</p></details>}</article>)}</div>}</section>

    // Avance de los agentes: el juego sigue jugable mientras el resto de la página queda en pausa.
    const progressArea = (remote.busy || remote.job || remote.notice) ? <div className="cw-progress-area">{remote.busy && <WaitPanel kind="context" title="Los agentes están organizando tu información…" game="Juega mientras se organiza tu información" className="cw-wait" />}<JobStatus remote={remote} /></div> : null

    return (
        <div className="context-workspace" role="dialog" aria-modal="true" aria-labelledby="cw-dialog-title" ref={dialogRef}>
            <header className="cw-topbar"><div className="cw-brand"><span className="cw-brand-mark" aria-hidden="true"><FlowMark size={30} color="#fff" stroke={6} hoverMorph title="" /></span><span id="cw-dialog-title">Contexto de la planta</span><span className="cw-local-label">EN TU PROYECTO</span></div><button type="button" className="cw-close" ref={closeRef} onClick={onClose}><span>Volver al proyecto</span><span className="cw-close-x" aria-hidden="true">×</span></button></header>
            <div className="cw-layout">
                <aside className="cw-sidebar"><div className="cw-project"><span className="cw-kicker">ESPACIO DE TRABAJO</span><strong>{project.name || plant?.name || 'Mi planta'}</strong><span className="cw-muted">La información detrás del plano.</span></div><nav aria-label="Temas del contexto"><button className={`cw-nav-item ${active === 'inicio' ? 'is-active' : ''}`} type="button" aria-current={active === 'inicio' ? 'page' : undefined} onClick={() => go('inicio')}><span className="cw-nav-symbol" aria-hidden="true">⌂</span><span>Cuéntanos tu planta</span>{pending.length > 0 && <span className="cw-nav-count">{pending.length}</span>}</button><span className="cw-nav-label">INFORMACIÓN POR TEMA</span>{TOPICS.map((topic, index) => <button type="button" className={`cw-nav-item ${active === topic.id ? 'is-active' : ''}`} aria-current={active === topic.id ? 'page' : undefined} key={topic.id} onClick={() => go(topic.id)}><span className="cw-nav-number">{String(index + 1).padStart(2, '0')}</span><span>{topic.label}</span><span className={`cw-nav-dot ${countTopic(topic.id) ? 'is-filled' : ''}`} aria-label={countTopic(topic.id) ? `${countTopic(topic.id)} datos` : 'Sin datos'} /></button>)}<div className="cw-nav-bottom"><button type="button" className={`cw-nav-item ${active === 'proyectos' ? 'is-active' : ''}`} aria-current={active === 'proyectos' ? 'page' : undefined} onClick={() => go('proyectos')}><span className="cw-nav-symbol" aria-hidden="true">▦</span><span>Mis proyectos</span></button><button type="button" className={`cw-nav-item ${active === 'prioridades' ? 'is-active' : ''}`} aria-current={active === 'prioridades' ? 'page' : undefined} onClick={() => go('prioridades')}><span className="cw-nav-symbol" aria-hidden="true">≡</span><span>Prioridades de decisión</span></button><button type="button" className={`cw-nav-item ${active === 'revision' ? 'is-active' : ''}`} aria-current={active === 'revision' ? 'page' : undefined} onClick={() => go('revision')}><span className="cw-nav-symbol" aria-hidden="true">✓</span><span>Así entendimos tu planta</span></button></div></nav><div className="cw-progress"><div><strong>{filled} de {TOPICS.length}</strong><span>temas con información</span></div><div className="cw-progress-track"><span style={{ width: `${filled / TOPICS.length * 100}%` }} /></div><p>No necesitas completarlo todo para empezar.</p></div></aside>
                <main className="cw-content" ref={contentRef} tabIndex="-1">
                    <div className={`cw-content-inner${remote.busy ? ' is-busy' : ''}`} inert={uploading ? true : undefined}>{active !== 'inicio' && progressArea}
                        {message && !remote.busy && <div className={`cw-notice${organizing ? ' cw-notice--organizing' : ''}`} role="status"><span>{message}</span>{organizing && <div className="cw-organize-progress" role="progressbar" aria-label="Organizando información" aria-valuetext="En curso"><span /></div>}<button type="button" aria-label="Cerrar aviso" disabled={organizing} onClick={() => setMessage('')}>×</button></div>}
                        {active === 'proyectos' && connected && <section className="cw-section cw-copies"><span className="cw-kicker">COPIAS Y RESPALDOS</span><h2>Copia del proyecto en el servidor</h2><p className="cw-muted">Guarda o recupera este proyecto con sus archivos, o expórtalo en un paquete para llevarlo a otra computadora.</p><BackendTools remote={remote} /></section>}{active === 'proyectos' && <ProjectsPanel projects={projects} activeId={activeProjectId} project={project} finishing={initialTopic === 'guardar'} onSave={(name) => { onSaveProject(name); onNotify?.('Proyecto guardado.') }} onCreate={onCreateProject} onSelect={onSelectProject} onClear={onClearContext} />}
                        {active === 'inicio' && <><div className="cw-page-head"><span className="cw-kicker">PRIMERO, EL CONTEXTO.</span><h1>Cuéntanos<br />sobre tu planta<span className="cw-title-period">.</span></h1><p>El plano cuenta una parte. Completa la historia con lo que produces, cómo trabajas y lo que quieres mejorar.</p></div><div className="cw-intro-grid"><section className="cw-story"><label htmlFor="cw-story" className="cw-story-label">Todo empieza con tus palabras.<span>Una descripción, tus notas o el resumen de una visita.</span></label><textarea id="cw-story" value={project.text || ''} onChange={(event) => onTextChange(event.target.value)} placeholder="Fabricamos… Nuestro proceso comienza en… Trabajamos con… Lo que más nos preocupa es…" rows="8" /><div className="cw-story-footer"><span>{(project.text || '').length.toLocaleString('es-MX')} caracteres · texto original conservado</span><button type="button" className="cw-button" disabled={!project.text?.trim() || organizing} onClick={() => organize(project.text)}>{organizing ? 'Organizando…' : 'Organizar información'} <Arrow /></button></div><p className="cw-method">{has(caps, 'context_master') ? 'Un intérprete coordina especialistas y dudas; un consolidador prepara el contexto maestro.' : has(caps, 'context_agents') ? 'Especialistas preparan propuestas para tu revisión.' : 'Organización local por palabras clave. Tú revisas y confirmas cada dato.'}</p></section><aside className="cw-side-card cw-guide"><span className="cw-kicker">PARA ORIENTARTE</span><h2>No hace falta<br />tenerlo todo.</h2><ol><li><strong>Cuenta lo que sabes.</strong><span>Productos, personas, tiempos y dificultades del día a día.</span></li><li><strong>Agrega lo que lo respalda.</strong><span>Documentos, estudios y fotos, en el tema que corresponda.</span></li><li><strong>Revisa antes de analizar.</strong><span>Corrige lo que entendimos y confirma tu planta.</span></li></ol><button type="button" className="cw-text-button" onClick={() => go('revision')}>Ver el resumen <Arrow /></button></aside></div>{progressArea}{pending.length > 0 && !remote.busy && <section className="cw-section cw-proposal-section"><div className="cw-section-line cw-proposal-head"><div><span className="cw-kicker">TU REVISIÓN HACE LA DIFERENCIA</span><h2>Datos propuestos <span className="cw-count">{pending.length}</span></h2><p className="cw-muted">Corrige el tema, el nombre o el valor si hace falta. Solo lo que confirmes pasa a tus datos.</p></div><div className="cw-proposal-bulk"><button type="button" className="cw-button cw-button--outline" disabled={remote.busy} onClick={discardAll}><Cross />Descartar todas</button><button type="button" className="cw-button" disabled={remote.busy || !confirmable.length} onClick={confirmAll}><Check />Confirmar todas las listas ({confirmable.length})</button></div></div><div className="cw-proposals"><AnimatePresence initial={true}>{pending.map((proposal, index) => <Proposal key={proposal.id} index={index} proposal={proposal} onChange={(updates) => updateProposal(proposal.id, updates)} onConfirm={() => confirmProposal(proposal)} onKeep={() => keepProposal(proposal)} onDiscard={() => { updateProposal(proposal.id, { status: 'discarded' }); setMessage('Propuesta descartada. El texto original se conserva.') }} />)}</AnimatePresence></div></section>}{!remote.busy && <MasterReview master={workspace.masterDraft} busy={false} job={remote.job} />}<section className="cw-section"><div className="cw-section-line"><div><span className="cw-kicker">TAMBIÉN PUEDES IR DIRECTO</span><h2>Una planta, diez temas.</h2><p className="cw-muted">{data.length} {data.length === 1 ? 'dato confirmado' : 'datos confirmados'} · {workspace.attachments.length} {workspace.attachments.length === 1 ? 'archivo' : 'archivos'}</p></div></div><div className="cw-topic-grid">{TOPICS.map((topic, index) => <button type="button" className="cw-topic-card" key={topic.id} onClick={() => go(topic.id)}><span className="cw-topic-card-top"><span>{String(index + 1).padStart(2, '0')}</span><Arrow diagonal /></span><strong>{topic.label}</strong><span className="cw-topic-hint">{topic.hint}</span>{countTopic(topic.id) > 0 && <span className="cw-topic-state">{countTopic(topic.id)} {topic.id === 'estudios' ? (countTopic(topic.id) === 1 ? 'actividad' : 'actividades') : (countTopic(topic.id) === 1 ? 'dato' : 'datos')}</span>}</button>)}</div></section>{workspace.proposals.some((proposal) => ['confirmed', 'discarded'].includes(proposal.status)) && <Reviewed proposals={workspace.proposals.filter((proposal) => ['confirmed', 'discarded'].includes(proposal.status))} onRestore={(id) => { updateProposal(id, { status: 'pending' }); setMessage('Propuesta recuperada. Vuelve a estar en Datos propuestos.') }} />}</>}
                        {activeTopic && <><div className="cw-page-head"><span className="cw-kicker">{String(TOPICS.indexOf(activeTopic) + 1).padStart(2, '0')} / INFORMACIÓN DE LA PLANTA</span><h1>{activeTopic.label}</h1><p>{activeTopic.hint}</p></div>{active === 'estudios' && connected && <><WorkInput inventory={workspace.study_inventory} text={workspace.study_text} onChange={(study_text) => onWorkspaceChange({ study_text })} remote={remote} />{workspace.activities.some((a) => a.status === 'pending') && <button type="button" className="cw-button cw-confirm-all" onClick={() => remote.confirm(workspace.activities.filter((a) => a.status === 'pending').map((a) => a.id), 'activities')}>Confirmar todas las actividades</button>}</>}{active === 'personal' && connected && <OperatorPanel workspace={workspace} onChange={onWorkspaceChange} remote={remote} />}{active === 'estudios' ? <WorkStudies plant={plant} activities={workspace.activities} attachments={workspace.attachments} notes={data.filter((entry) => entry.segment === 'estudios')} onChange={(activities) => onWorkspaceChange({ activities })} onAttach={() => attach('estudios')} /> : active === 'referencias' ? <>{connected && <section className="cw-section cw-source-policy"><label className="cw-field">Qué fuente describe mejor tu planta<select value={workspace.source_policy?.images || 'location_only'} onChange={(event) => onWorkspaceChange({ source_policy: { default: event.target.value === 'existing_equipment_and_positions' ? 'images' : 'text', images: event.target.value } })}><option value="location_only">Texto para los datos; imágenes para la ubicación</option><option value="existing_equipment_and_positions">Las imágenes son más fieles a lo que hay y dónde está</option></select><span className="cw-muted">Las imágenes requieren interpretación con visión o datos aportados por ti. Las diferencias sin resolver seguirán visibles.</span></label>{workspace.source_policy?.default === 'images' && <label className="cw-priority-toggle"><input type="checkbox" checked={!!workspace.source_policy.manual_image_review} onChange={(event) => onWorkspaceChange({ source_policy: { ...workspace.source_policy, manual_image_review: event.target.checked } })} />Revisé las imágenes y los datos que capturé coinciden con ellas.</label>}</section>}<section className="cw-reference-section"><References context={context} setContext={onContextChange} /></section></> : <ManualTopic key={active} topic={activeTopic} context={context} onContextChange={onContextChange} hasFiles={workspace.attachments.some((file) => file.topic === active)} onAttach={() => attach(active)} />}{attachments(active)}<div className="cw-topic-footer"><span className="cw-muted">Cada dato conserva su fuente. Cada corrección, su historia.</span><button type="button" className="cw-text-button" onClick={() => go('revision')}>Revisar lo que sabemos <Arrow /></button></div></>}
                        {active === 'prioridades' && <><label className="cw-priority-toggle"><input type="checkbox" checked={project.prioritiesEnabled !== false} onChange={(event) => onPrioritiesToggle(event.target.checked)} />Usar prioridades personalizadas</label>{project.prioritiesEnabled === false && <p className="cw-notice">Se utilizarán los pesos base del motor. Puedes activar tus prioridades para ajustarlos.</p>}<div inert={project.prioritiesEnabled === false ? true : undefined}><Priorities weights={project.weights} onChange={onWeightsChange} /></div></>}
                        {active === 'revision' && <>{connected && <ReviewAssistance remote={remote} onAnswer={(q, answer) => { onContextChange(addEntry(context, { segment: q.topic, key: `${q.topic}.respuesta-${q.id}`, value: answer, source: 'usuario', confidence: 'baja' })); onWorkspaceChange({ question_answers: { ...workspace.question_answers, [q.id]: answer } }) }} />}<div className="cw-page-head"><span className="cw-kicker">UNA PAUSA ANTES DE ANALIZAR</span><h1>Así entendimos<br />tu planta.</h1><p>Revisa los datos, sus fuentes y el plano. Lo que todavía no sabes también es parte del contexto.</p></div><div className="cw-review-status"><span className="cw-review-check" aria-hidden="true">{confirmed ? '✓' : '↗'}</span><div><strong>{confirmed ? 'Esta versión está confirmada.' : 'Tu revisión está pendiente.'}</strong><p>{confirmed ? 'Si modificas el contexto, las prioridades o el plano, habrá que revisarla de nuevo.' : 'Confirma esta versión cuando los datos y el plano representen tu planta.'}</p></div></div>{pending.length > 0 && <div className="cw-review-pending"><p><strong>{pending.length} propuestas pendientes.</strong> Solo los datos que confirmes se incorporan al contexto.</p><button type="button" className="cw-text-button" onClick={() => go('inicio')}>Revisar propuestas <Arrow /></button></div>}<section className="cw-section"><div className="cw-section-line"><h2>El contexto, por tema.</h2><span className="cw-muted">{filled} de {TOPICS.length} temas con datos</span></div><div className="cw-review-topics">{TOPICS.map((topic, index) => { const topicData = data.filter((entry) => entry.segment === topic.id); return <article className="cw-review-topic" key={topic.id}><span className="cw-nav-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{topic.label}</h3>{topic.id === 'estudios' && workspace.activities.length ? <p>{workspace.activities.length} actividades registradas para revisar.</p> : topicData.length ? <ul>{topicData.slice(0, 3).map((entry) => <li key={entry.id}><strong>{entryLabel(entry)}:</strong> {displayEntry(entry)}</li>)}{topicData.length > 3 && <li className="cw-muted">Y {topicData.length - 3} datos más.</li>}</ul> : <p className="cw-muted">Sin datos confirmados. Puedes completarlo cuando los tengas.</p>}</div><button type="button" className="cw-text-button" onClick={() => go(topic.id)}>{countTopic(topic.id) ? 'Revisar' : 'Agregar'} <Arrow diagonal /></button></article> })}</div></section><section className="cw-section"><div className="cw-section-line"><h2>El plano que vamos a analizar.</h2><button type="button" className="cw-text-button" onClick={onGoToPlan}>Ir al plano <Arrow diagonal /></button></div>{summary?.lines?.length ? <ul className="cw-plan-summary">{summary.lines.map((line, index) => <li key={index}>{line}</li>)}</ul> : <div className="cw-empty"><h3>Tu plano está por construir.</h3><p>Puedes seguir completando el contexto y crear el plano cuando estés listo.</p><button type="button" className="cw-button cw-button--outline" onClick={onGoToPlan}>Crear el plano <Arrow /></button></div>}{summary?.changes?.length > 0 && <details className="cw-history"><summary>Cambios desde el último análisis</summary><ul>{summary.changes.map((change, index) => <li key={index}>{change}</li>)}</ul></details>}</section><section className="cw-section"><div className="cw-section-line"><h2>Supuestos y datos por comprobar.</h2><span className="cw-muted">Conservamos la incertidumbre.</span></div>{data.some((entry) => entry.confidence === 'baja' || ['supuesto', 'estimado'].includes(entry.source)) ? <ul className="cw-assumption-list">{data.filter((entry) => entry.confidence === 'baja' || ['supuesto', 'estimado'].includes(entry.source)).map((entry) => <li key={entry.id}><strong>{entryLabel(entry)}:</strong> {displayEntry(entry)} <span>· {SOURCE_LABELS[entry.source] || entry.source} · confianza {entry.confidence}</span><button type="button" className="cw-text-button" onClick={() => go(entry.segment)}>Revisar</button></li>)}</ul> : <p className="cw-muted">No hay datos marcados como estimación, supuesto o confianza baja. Esto no sustituye la revisión de sus fuentes.</p>}</section><section className="cw-section cw-review-weights"><div className="cw-section-line"><h2>Tus prioridades de decisión.</h2><button type="button" className="cw-text-button" onClick={() => go('prioridades')}>Ajustar <Arrow diagonal /></button></div><div className="cw-weight-summary">{CRITERIA.map((criterion) => <div key={criterion.key}><strong>{Math.round((project.prioritiesEnabled === false ? DEFAULT_WEIGHTS : project.weights || DEFAULT_WEIGHTS)[criterion.key] * 100)}<small>%</small></strong><span>{criterion.label}</span></div>)}</div></section>{workspace.masterDraft && <details className="cw-history"><summary>Ver borrador JSON maestro de la IA</summary><p className="cw-muted">Es una interpretación pendiente de revisión; no modifica el plano automáticamente.</p><pre>{JSON.stringify(workspace.masterDraft, null, 2)}</pre></details>}<div className="cw-confirm-bar"><div><strong>{confirmed ? 'Contexto y plano confirmados.' : '¿Esto representa tu planta?'}</strong><p>Los datos que falten seguirán visibles como pendientes. {!summary?.lines?.length && "Para confirmar esta versión, primero crea o importa el plano. Puedes confirmar los datos por separado."}</p></div><button type="button" className="cw-button" disabled={!confirmed && !summary?.lines?.length} onClick={confirmed ? onGoToPlan : onConfirm}>{confirmed ? 'Continuar al plano' : 'Sí, confirmar esta versión'} <Arrow /></button></div></>}
                    </div>
                </main>
            </div>
            <input type="file" ref={fileRef} multiple hidden onChange={upload} />
        </div>
    )
}



