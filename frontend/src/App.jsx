import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api } from './api'
import { has } from './capabilities'
import { upgradePlant } from './migrate'
import { isStale, samePlant } from './proposals'
import { contextPayload } from './context'
import { summarize } from './context2'
import { deleteAttachments, reviewSignature } from './contextWorkspace'
import { acceptedContext, constructWorkspace, workspaceRequest } from './workspaceApi'
import ContextWorkspace from './components/context/ContextWorkspace'
import './components/context/context-entry.css'
import FlowMark from './brand/FlowMark'
import DialogHost, { ask } from './components/Dialog'
import EngineerChat from './components/EngineerChat'
import useReport from './components/useReport'
import { startWait } from './components/wait'
import ClickSplash from './fx/ClickSplash'
import Cursor from './fx/Cursor'
import Intro from './fx/Intro'
import { blankPlant, chosen as chosenOf, useProject } from './project'
import Story from './steps/Story'
import useCaps from './useCaps'

// Los pasos con 3D, gráficas o informe se cargan al llegar a ellos: la página abre sin descargar three.js.
const Plant = lazy(() => import('./steps/Plant'))
const Diagnosis = lazy(() => import('./steps/Diagnosis'))
const Redesign = lazy(() => import('./steps/Redesign'))
const Report = lazy(() => import('./steps/Report'))
const Summary = lazy(() => import('./steps/Summary'))
// En cuanto la página queda libre se baja el paso 2, así «Guardar y ver en 3D» no espera la descarga.
const preload = () => import('./steps/Plant')

const OFFLINE = 'Conectando con el servidor… Si no se conecta, revisa que el backend esté encendido (puerto 8000).'

const STEPS = ['Proceso y plano', 'Tu planta en 3D', 'Diagnóstico', 'Rediseño', 'Reporte', 'Resumen']

/* Lo mínimo que necesita el ingeniero para hablar de la planta (sin trazos). */
function slim(project, ch, segmented = false, workspace = false) {
    const { plant, analysis } = project
    if (!plant) return null

    const pick = (m) => m && { piece_m: m.piece_m, daily_m: m.daily_m, capacity: m.capacity, lead_h: m.lead_h, loading_min: m.loading_min, bottleneck: m.bottleneck, bottleneck_util: m.bottleneck_util, avoid_hits: m.avoid_hits || [], lead_parts: m.lead_parts }

    return {
        plant: { ...plant, layout: undefined },
        analysis: analysis && {
            current: pick(analysis.current),
            alternatives: analysis.alternatives.map((a) => ({ id: a.id, name: a.name, metrics: { piece_m: a.metrics.piece_m, daily_m: a.metrics.daily_m, capacity: a.metrics.capacity, lead_h: a.metrics.lead_h } })),
            // La recomendada y su razón son del motor: el informe no la elige.
            recommended: analysis.recommended,
            recommended_reason: analysis.recommended_reason,
            recommended_tradeoffs: analysis.recommended_tradeoffs,
        },
        redesign: ch && ch.metrics ? { name: ch.name, metrics: pick(ch.metrics) } : null,
        // Texto si el backend no conoce el contexto segmentado; objeto si lo anuncia.
        context: workspace ? acceptedContext(project) : contextPayload(project.context, project.text, segmented),
    }
}

export default function App() {
    const [intro, setIntro] = useState(true)
    const [project, update, reset, library] = useProject()
    // Al recargar siempre se abre el paso 1; los pasos ya hechos siguen disponibles en la barra.
    const [step, setStep] = useState(0)
    const [catalog, setCatalog] = useState(null)
    const [reading, setReading] = useState(false)
    const [constructionProgress, setConstructionProgress] = useState(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)
    const [chat, setChat] = useState(false)
    const [contextTopic, setContextTopic] = useState(null)
    const [toast, setToast] = useState(null)
    const [ai, setAi] = useState(null)
    const caps = useCaps()
    const stage = useRef(null)
    const contextOpener = useRef(null)

    const { plant, analysis, draft, info } = project
    const ch = useMemo(() => chosenOf(project), [project])
    const segmented = has(caps, 'segmented_context')
    const workspaceEnabled = has(caps, 'context_workspace')
    const context = useMemo(() => slim(project, ch, segmented, workspaceEnabled), [project, ch, segmented, workspaceEnabled])
    const summary = useMemo(() => summarize(project.draft, project.plant), [project.draft, project.plant])
    const signature = useMemo(() => reviewSignature(project), [project])
    const confirmed = !!signature && project.context2Ok === signature
    const stale = isStale(project) || (!!analysis && project.analysisInputSignature !== signature)
    const version = `${library.activeId}-${signature}-${analysis?.current?.piece_m}-${ch?.id}-${ch?.metrics?.piece_m}`
    const report = useReport(stale ? null : context, version, has(caps, 'report_validation'))
    const openContext = (topic = 'inicio') => {
        contextOpener.current = document.activeElement
        setContextTopic(topic)
    }
    const closeContext = useCallback(() => {
        setContextTopic(null)
        requestAnimationFrame(() => {
            const opener = contextOpener.current
            if (opener?.isConnected) opener.focus()
            else document.querySelector('.context-open')?.focus()
        })
    }, [])

    useEffect(() => {
        if (window.requestIdleCallback) window.requestIdleCallback(preload)
        else setTimeout(preload, 2500)
        // El backend arranca en otra ventana y tarda unos segundos (o se reinicia con --reload):
        // se reintenta con espera creciente en vez de quedarse sin catálogo ni IA.
        let alive = true
        let timer
        const connect = async (attempt = 0) => {
            try {
                const [health, cat] = await Promise.all([api.health(), api.catalog()])
                if (!alive) return
                setAi(health)
                setCatalog(cat)
                setError((e) => (e === OFFLINE ? null : e))
            } catch {
                if (!alive) return
                if (attempt >= 2) setError(OFFLINE)
                timer = setTimeout(() => connect(attempt + 1), Math.min(10000, 1000 * 2 ** attempt))
            }
        }
        connect()
        return () => {
            alive = false
            clearTimeout(timer)
        }
    }, [])

    const notify = useCallback((msg) => setToast({ msg, id: Date.now() }), [])

    useEffect(() => {
        if (!toast) return
        const t = setTimeout(() => setToast(null), 2800)
        return () => clearTimeout(t)
    }, [toast])

    const go = useCallback(
        (i) => {
            setStep(i)
            update((p) => ({ maxStep: Math.max(p.maxStep || 0, i) }))
            stage.current?.scrollTo({ top: 0, behavior: 'instant' })
        }, [update],
    )

    const verifyDraft = async () => {
        try {
            const verification = await api.verifyMaster(project.draft, acceptedContext(project))
            update({ info: { ...project.info, verification, verificationDraftKey: JSON.stringify(project.draft) } })
        } catch (error) { setError(error.message) }
    }

    // El camino principal es la descripción directa: nunca obliga a pasar por el contexto.
    // Construir desde el contexto es otra opción, disponible cuando ya hay un maestro aceptado.
    const contextMaster = acceptedContext(project).master
    const contextReady = has(caps, 'construction_jobs') && contextMaster?.status === 'accepted' && !contextMaster.pending_manual_ids?.length && !contextMaster.pending_source_policy

    const read = async (fromContext = false) => {
        setReading(true)
        setConstructionProgress(null)
        setError(null)

        try {
            const done = startWait('story')
            const r = fromContext && contextReady
                ? await constructWorkspace(project, library.activeId, {
                    onProgress: (work) => {
                        setConstructionProgress({ stage: work.stage, ...work.stage_progress })
                        update({ constructionJob: { id: work.id, status: work.status } })
                    },
                    onSaved: (saved) => update({ serverWorkspaceId: saved.id, serverRevision: saved.revision }),
                })
                : await api.story(project.text)
            done()
            const built = upgradePlant(r.plant)
            update({ draft: built, info: { source: r.source, notes: r.notes, error: r.error, spatial: r.spatial, verification: r.verification, verificationDraftKey: JSON.stringify(built) } })
            setReading(false)

            return true
        } catch (error) {
            if (error.job?.verification) setConstructionProgress({ stage: 'blocked', verification: error.job.verification })
            setError(`Error al analizar el proceso: ${error instanceof Error ? error.message : 'Error desconocido.'}`)
            setReading(false)
            return false
        }
    }

    const blank = () => update({ draft: blankPlant(), info: { source: 'Plano vacío', notes: [] } })

    const save = async () => {
        setSaving(true)
        setError(null)

        try {
            const out = await api.analyze(draft, { reviewed: true, context: has(caps, 'context_workspace') ? acceptedContext(project) : contextPayload(project.context, project.text, segmented), ...(has(caps, 'weights') && project.weights && project.prioritiesEnabled !== false ? { weights: project.weights } : {}) })
            update((p) => ({
                plant: draft,
                analysis: out,
                analysisRev: p.draftRev || 0,
                analysisInputSignature: signature,
                // El rediseño hecho a mano no se borra al volver a analizar (H7) si es de la misma planta;
                // si el plano es otro (otra historia, otro tamaño u otras máquinas), se descarta.
                redesign: p.redesign?.custom && samePlant(p.redesign.custom.plant || p.plant, draft) ? { ...p.redesign, choice: p.redesign.choice === 'propio' ? 'propio' : null, metrics: null } : { choice: null, custom: null, metrics: null },
                printed: false,
            }))
            go(1)
        } catch {
            setError('Error al analizar el plano.')
        }
        setSaving(false)
    }

    const setRedesign = useCallback((patch) => update((p) => ({ redesign: { ...p.redesign, ...patch } })), [update])

    // Alternativas que se calculan a pedido (la compacta con IA) se suman al análisis guardado.
    const addAlternative = useCallback((alt) => update((p) => ({ analysis: { ...p.analysis, alternatives: [...p.analysis.alternatives.filter((a) => a.id !== alt.id), alt] } })), [update])

    const onPrinted = useCallback(() => {
        update({ printed: true })
        go(5)
    }, [update, go])

    const restart = async () => {
        if (!(await ask('Se borrará el plano, el rediseño y el reporte de este navegador.', { title: '¿Empezar otra planta?', ok: 'Sí, borrar todo' }))) return
        reset()
        setStep(0)
    }

    const createProject = (name) => {
        library.create(name)
        setContextTopic('proyectos')
        setStep(0)
        setChat(false)
        setError(null)
    }

    const selectProject = (id) => {
        if (id === library.activeId) return
        library.select(id)
        setContextTopic('proyectos')
        setStep(0)
        setChat(false)
        setError(null)
    }

    const clearContext = async () => {
        let saved
        if (project.serverWorkspaceId && project.serverRevision) saved = await workspaceRequest(`/${project.serverWorkspaceId}/clear-context`, { method: 'POST', body: { expected_revision: project.serverRevision } })
        const files = project.contextWorkspace?.attachments || []
        await deleteAttachments(files.map((file) => file.id))
        library.clearContext()
        if (saved) update({ serverRevision: saved.revision })
    }

    const ready = !!(plant && analysis)
    const enabled = (i) => i === 0 || (i <= 4 && ready) || (i === 5 && ready && project.printed)

    const view = (() => {
        if (step === 0 || !ready)
        return (
            <Story
            text={project.text}
            setText={(text) => update({ text, printed: false })}
            info={info}
            draft={draft}
            setDraft={(d) => update((p) => ({ draft: d, draftRev: (p.draftRev || 0) + 1 }))}
            catalog={catalog}
            reading={reading}
            error={error}
            onRead={() => read(false)}
            onReadContext={contextReady ? () => read(true) : undefined}
            constructionProgress={constructionProgress}
            onVerify={contextReady ? verifyDraft : undefined}
            onBlank={blank}
            onOpenContext={openContext}
            pending={(project.contextWorkspace?.proposals || []).filter((proposal) => proposal.status === 'pending').length}
            context2={{ confirmed }}
            onSave={save}
            saving={saving}
            />
        )
        if (step === 1) return <Plant plant={plant} analysis={analysis} notes={info?.notes || []} onNext={() => go(2)} onEdit={() => go(0)} />
        if (step === 2) return <Diagnosis plant={plant} analysis={analysis} onNext={() => go(3)} />
        if (step === 3) return <Redesign canOptimize={!stale} analysisContext={workspaceEnabled && confirmed ? context.context : null} plant={plant} analysis={analysis} weights={project.prioritiesEnabled === false ? undefined : project.weights} prioritiesEnabled={project.prioritiesEnabled !== false} onOpenContext={openContext} redesign={project.redesign} setRedesign={setRedesign} onAddAlternative={addAlternative} catalog={catalog} analysisRev={project.analysisRev || 0} notify={notify} onNext={() => go(4)} />
        if (step === 4) return <Report studyContext={workspaceEnabled ? context.context : null} plant={plant} analysis={analysis} chosen={ch} notes={info?.notes || []} report={report} catalog={catalog} onPrinted={onPrinted} onNext={() => go(5)} />
        return <Summary plant={plant} analysis={analysis} chosen={ch} context={context} onPrint={() => go(4)} onSave={() => openContext('guardar')} onRestart={restart} />
    })()

    const aiOk = ai?.extractor?.ready && ai?.engineer?.ready
    const aiTitle = ai ? `Extractor: ${ai.extractor.model}${ai.extractor.ready ? '' : ' (sin conexión)'} · Ingeniero: ${ai.engineer.model}${ai.engineer.ready ? '' : ' (sin conexión)'}` : 'Sin conexión con el servidor'

    return (
        <>
            <Cursor />
            <ClickSplash />

            {intro && <Intro onDone={() => setIntro(false)} />}
            <div className="app" inert={contextTopic !== null ? true : undefined}>
                <nav className="rail" aria-label="Pasos">
                    <button type="button" className="rail-logo" onClick={() => go(0)} aria-label="Volver al inicio">
                        <FlowMark size={44} state={step === 0 ? 'tangled' : 'u'} color="#fff" hoverMorph />
                    </button>

                    <div className="rail-steps">
                      <div className="rail-track">
                        <div className="rail-line" aria-hidden="true">
                            <motion.div className="rail-line-fill" animate={{ scaleY: Math.min(project.maxStep || 0, 5) / 5 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} />
                        </div>

                        {STEPS.map((name, i) => (
                            <button
                                key={name}
                                type="button"
                                className="rail-step"
                                data-state={i === step ? 'active' : i <= (project.maxStep || 0) ? 'done' : 'todo'}
                                disabled={!enabled(i)}
                                onClick={() => go(i)}
                                aria-label={name}
                                aria-current={i === step ? 'step' : undefined}
                            >
                                {i + 1}
                                <span className="rail-tip">{name}</span>
                            </button>
                        ))}
                      </div>
                    </div>

                    <div className="rail-ai" title={aiTitle}>
                        <span className="rail-ai-dot" data-on={!!aiOk} />
                        <span>{aiOk ? 'IA lista' : 'Sin IA'}</span>
                    </div>
                    
                    <button type="button" className="rail-chat" onClick={() => setChat(true)} aria-label="Preguntarle al ingeniero">
                        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M3 4 H19 V15 H10 L5 19 V15 H3 Z" />
                        </svg>
                    </button>
                </nav>

                <main className="stage" ref={stage}>
                    <div className="context-topbar">
                        <span className="context-topbar-label">CAUCE <span>/</span> {STEPS[ready ? step : 0]}</span>
                        <button type="button" className="context-open" onClick={() => openContext()}>
                            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 3h14v14H3zM7 3v14M10 7h4M10 10h4M10 13h2" /></svg>
                            Ver contexto de la planta <span aria-hidden="true">↗</span>
                        </button>
                    </div>
                    <AnimatePresence mode="wait">
                        <motion.div key={`${library.activeId}-${ready ? step : 0}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                          {ready && step > 0 && stale && (
                              <p className="stale-note small" role="status">
                                  <strong>Resultados pendientes de actualizar.</strong> Revisa el plano, el contexto y tus prioridades. Confirma «Así entendimos tu planta» y vuelve al paso 1 para recalcular.
                              </p>
                          )}
                          <Suspense fallback={<p className="small" style={{ padding: 48 }}>Cargando…</p>}>{view}</Suspense>
                        </motion.div>
                    </AnimatePresence>
                </main>
            </div>

            {contextTopic !== null && (
                <ContextWorkspace
                    key={library.activeId}
                    project={project}
                    projects={library.projects}
                    activeProjectId={library.activeId}
                    onCreateProject={createProject}
                    onSelectProject={selectProject}
                    onSaveProject={library.save}
                    onNotify={notify}
                    onClearContext={clearContext}
                    plant={draft || plant}
                    onTextChange={(text) => update({ text, printed: false })}
                    onContextChange={(context) => update({ context, printed: false })}
                    onWorkspaceChange={(patch) => update((p) => ({ contextWorkspace: { ...p.contextWorkspace, ...(typeof patch === 'function' ? patch(p.contextWorkspace || {}) : patch) }, printed: false }))}
                    onProjectChange={update}
                    onPrioritiesToggle={(prioritiesEnabled) => update({ prioritiesEnabled, printed: false })}
                    onWeightsChange={(weights) => update({ weights, printed: false })}
                    summary={summary}
                    confirmed={confirmed}
                    onConfirm={() => update({ context2Ok: signature })}
                    onClose={closeContext}
                    onGoToPlan={() => { closeContext(); go(0) }}
                    initialTopic={contextTopic}
                />
            )}

            <EngineerChat open={chat && contextTopic === null} onClose={() => setChat(false)} context={stale ? null : context} />
            <DialogHost />

            <AnimatePresence>
                {toast && (
                    <motion.div key={toast.id} className="toast" role="status" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
                        {toast.msg}
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    )
}
