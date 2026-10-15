import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api } from './api'
import FlowMark from './brand/FlowMark'
import EngineerChat from './components/EngineerChat'
import useReport from './components/useReport'
import { startWait } from './components/wait'
import ClickSplash from './fx/ClickSplash'
import Cursor from './fx/Cursor'
import Intro from './fx/Intro'
import { blankPlant, chosen as chosenOf, EMPTY_GAME, useProject } from './project'
import Story from './steps/Story'

// Los pasos con 3D, gráficas o informe se cargan al llegar a ellos: la página abre sin descargar three.js.
const Plant = lazy(() => import('./steps/Plant'))
const Diagnosis = lazy(() => import('./steps/Diagnosis'))
const Redesign = lazy(() => import('./steps/Redesign'))
const Report = lazy(() => import('./steps/Report'))
const Summary = lazy(() => import('./steps/Summary'))
const Workshop = lazy(() => import('./steps/Workshop'))
// En cuanto la página queda libre se baja el paso 2, así «Guardar y ver en 3D» no espera la descarga.
const preload = () => import('./steps/Plant')

const STEPS = ['Proceso y plano', 'Tu planta en 3D', 'Diagnóstico', 'Rediseño', 'Reporte', 'Resumen', 'Taller de mejora (extra)']

/* Lo mínimo que necesita el ingeniero para hablar de la planta (sin trazos). */
function slim(project, ch) {
    const { plant, analysis } = project
    if (!plant) return null

    const pick = (m) => m && { piece_m: m.piece_m, daily_m: m.daily_m, capacity: m.capacity, lead_h: m.lead_h, loading_min: m.loading_min, bottleneck: m.bottleneck, bottleneck_util: m.bottleneck_util, avoid_hits: m.avoid_hits || [], lead_parts: m.lead_parts }

    return {
        plant: { ...plant, layout: undefined },
        analysis: analysis && { current: pick(analysis.current), alternatives: analysis.alternatives.map((a) => ({ id: a.id, name: a.name, metrics: { piece_m: a.metrics.piece_m } })) },
        redesign: ch && ch.metrics ? { name: ch.name, metrics: pick(ch.metrics) } : null,
    }
}

export default function App() {
    const [intro, setIntro] = useState(true)
    const [project, update, reset] = useProject()
    const [step, setStep] = useState(() => (project.plant ? 1 : 0))
    const [catalog, setCatalog] = useState(null)
    const [reading, setReading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)
    const [chat, setChat] = useState(false)
    const [toast, setToast] = useState(null)
    const [ai, setAi] = useState(null)
    const stage = useRef(null)

    const { plant, analysis, draft, info } = project
    const ch = useMemo(() => chosenOf(project), [project])
    const context = useMemo(() => slim(project, ch), [project, ch])
    const version = `${analysis?.current?.piece_m}-${ch?.id}-${ch?.metrics?.piece_m}`
    const report = useReport(context, version)

    useEffect(() => {
        if (window.requestIdleCallback) window.requestIdleCallback(preload)
        else setTimeout(preload, 2500)
        api.health().then(setAi).catch(() => setAi(null))
        api.catalog().then(setCatalog).catch(() => setError('Error conectando con el servidor.'))
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
        }, [],
    )

    const defaultParams = () => Object.fromEntries((catalog?.assumptions || []).map((a) => [a.key, a.value]))

    const read = async () => {
        setReading(true)
        setError(null)

        try {
            const done = startWait('story')
            const r = await api.story(project.text)
            done()
            update({ draft: r.plant, info: { source: r.source, notes: r.notes, ai_assumptions: r.ai_assumptions, assumptions: r.assumptions, error: r.error, spatial: r.spatial } })
            setReading(false)

            return true
        } catch {
            setError('Error al analizar el proceso.')
            setReading(false)
            return false
        }
    }

    const blank = () => update({ draft: blankPlant(defaultParams()), info: { source: 'Plano vacío', notes: [] } })

    const save = async () => {
        setSaving(true)
        setError(null)

        try {
            const out = await api.analyze(draft)
            update({ plant: draft, analysis: out, redesign: { choice: null, custom: null, metrics: null }, printed: false, game: EMPTY_GAME })
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

    const restart = () => {
        if (!window.confirm('Se borrará el plano, el rediseño y el reporte de este navegador. ¿Seguir?')) return
        reset()
        setStep(0)
    }

    const ready = !!(plant && analysis)
    const enabled = (i) => i === 0 || (i <= 4 && ready) || (i === 5 && ready && project.printed) || (i === 6 && ready)

    const view = (() => {
        if (step === 0 || !ready)
        return (
            <Story
            text={project.text}
            setText={(t) => update((p) => ({ text: typeof t === 'function' ? t(p.text) : t }))}
            info={info}
            draft={draft}
            setDraft={(d) => update({ draft: d })}
            catalog={catalog}
            reading={reading}
            error={error}
            onRead={read}
            onBlank={blank}
            onSave={save}
            saving={saving}
            />
        )
        if (step === 1) return <Plant plant={plant} analysis={analysis} notes={info?.notes || []} onNext={() => go(2)} onEdit={() => go(0)} />
        if (step === 2) return <Diagnosis plant={plant} analysis={analysis} report={report} onNext={() => go(3)} />
        if (step === 3) return <Redesign plant={plant} analysis={analysis} redesign={project.redesign} setRedesign={setRedesign} onAddAlternative={addAlternative} catalog={catalog} onNext={() => go(4)} />
        if (step === 4) return <Report plant={plant} analysis={analysis} chosen={ch} notes={info?.notes || []} report={report} catalog={catalog} onPrinted={onPrinted} onNext={() => go(5)} />
        if (step === 5) return <Summary plant={plant} analysis={analysis} chosen={ch} context={context} onPrint={() => go(4)} onWorkshop={() => go(6)} onRestart={restart} />

        return <Workshop context={context} chosen={ch} game={project.game} setGame={(f) => update((p) => ({ game: typeof f === 'function' ? f(p.game) : f }))} notify={notify} />
    })()

    const aiOk = ai?.extractor?.ready && ai?.engineer?.ready
    const aiTitle = ai ? `Extractor: ${ai.extractor.model}${ai.extractor.ready ? '' : ' (sin conexión)'} · Ingeniero: ${ai.engineer.model}${ai.engineer.ready ? '' : ' (sin conexión)'}` : 'Sin conexión con el servidor'

    return (
        <>
            <Cursor />
            <ClickSplash />

            {intro && <Intro onDone={() => setIntro(false)} />}
            <div className="app">
                <nav className="rail" aria-label="Pasos">
                    <button type="button" className="rail-logo" onClick={() => go(0)} aria-label="Volver al inicio">
                        <FlowMark size={44} state={step === 0 ? 'tangled' : 'u'} color="#fff" hoverMorph />
                    </button>

                    <div className="rail-steps">
                        <div className="rail-line" aria-hidden="true">
                            <motion.div className="rail-line-fill" animate={{ scaleY: Math.min(project.maxStep || 0, 5) / 5 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} />
                        </div>

                        {STEPS.map((name, i) => (
                            <button
                                key={name}
                                type="button"
                                className={`rail-step${i === 6 ? ' rail-step--extra' : ''}`}
                                data-state={i === step ? 'active' : i <= (project.maxStep || 0) ? 'done' : 'todo'}
                                disabled={!enabled(i)}
                                onClick={() => go(i)}
                                aria-label={name}
                                aria-current={i === step ? 'step' : undefined}
                            >
                                {i === 6 ? '+' : i + 1}
                                <span className="rail-tip">{name}</span>
                            </button>
                        ))}
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
                    <AnimatePresence mode="wait">
                        <motion.div key={ready ? step : 0} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                          <Suspense fallback={<p className="small" style={{ padding: 48 }}>Cargando…</p>}>{view}</Suspense>
                        </motion.div>
                    </AnimatePresence>
                </main>
            </div>

            <EngineerChat open={chat} onClose={() => setChat(false)} context={context} />

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
