import ConstructionReview from '../components/context/ConstructionReview'
import { useRef, useState } from 'react'
import { fmt } from '../api'
import WaitPanel from '../components/WaitPanel'
import PlanEditor from '../editor/PlanEditor'
import Btn from '../fx/Btn'
import { Appear, RevealTitle } from '../fx/Reveal'
import { ask } from '../components/Dialog'

/* Nombre editable en el mismo chip: clic para escribir, Enter o salir para guardar. */
function ChipName({ value, onCommit }) {
    const [editing, setEditing] = useState(false)
    const [v, setV] = useState(value)

    if (!editing)
        return (
            <button type="button" className="chip-name" title="Clic para renombrar" onClick={() => (setV(value), setEditing(true))}>
                {value}
            </button>
        )

    const done = () => {
        setEditing(false)
        const name = v.trim()
        if (name && name !== value) onCommit(name)
    }

    return (
        <input
            className="chip-input"
            autoFocus
            value={v}
            size={Math.max(4, v.length)}
            onChange={(e) => setV(e.target.value)}
            onBlur={done}
            onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                    setV(value)
                    setEditing(false)
                }
            }}
            aria-label="Nuevo nombre"
        />
    )
}

/* Si las rutas eran una cadena simple en el orden anterior, se rehacen en el nuevo orden. */
function rechain(stations, routes, nextStations) {
    const chain = stations.length > 1 && routes.length === stations.length - 1 && stations.slice(1).every((s, i) => routes.some((r) => r.from === stations[i].id && r.to === s.id))
    if (!chain) return routes

    return nextStations.slice(1).map((s, i) => {
        const old = routes[i]
        return { ...old, from: nextStations[i].id, to: s.id }
    })
}

function ProcessSummary({ draft, setDraft }) {
    const [dragId, setDragId] = useState(null)
    const [overId, setOverId] = useState(null)

    const rename = (list, id, name) => setDraft({ ...draft, [list]: draft[list].map((x) => (x.id === id ? { ...x, name } : x)) })

    const move = (fromId, toId) => {
        if (!fromId || fromId === toId) return
        const list = [...draft.stations]
        const from = list.findIndex((s) => s.id === fromId)
        const to = list.findIndex((s) => s.id === toId)
        const [item] = list.splice(from, 1)
        list.splice(to, 0, item)
        setDraft({ ...draft, stations: list, routes: rechain(draft.stations, draft.routes, list) })
    }

    const nudge = (id, dir) => {
        const i = draft.stations.findIndex((s) => s.id === id)
        const j = i + dir
        if (j < 0 || j >= draft.stations.length) return
        move(id, draft.stations[j].id)
    }

    return (
        <>
            <ol className="chips chips--flow">
                {draft.stations.map((station, i) => (
                    <li
                        key={station.id}
                        className="chip chip--edit"
                        draggable
                        data-drag={dragId === station.id}
                        data-over={overId === station.id && dragId !== station.id}
                        onDragStart={(e) => {
                            setDragId(station.id)
                            e.dataTransfer.effectAllowed = 'move'
                        }}
                        onDragOver={(e) => {
                            e.preventDefault()
                            setOverId(station.id)
                        }}
                        onDragEnd={() => (setDragId(null), setOverId(null))}
                        onDrop={(e) => {
                            e.preventDefault()
                            move(dragId, station.id)
                            setDragId(null)
                            setOverId(null)
                        }}
                        onKeyDown={(e) => {
                            if (!e.altKey) return
                            if (e.key === 'ArrowLeft') nudge(station.id, -1)
                            if (e.key === 'ArrowRight') nudge(station.id, 1)
                        }}
                    >
                        <span className="chip-grip" aria-hidden="true" title="Arrastra para cambiar el orden" />
                        <span className="chip-n num">{i + 1}</span>
                        <ChipName value={station.name} onCommit={(name) => rename('stations', station.id, name)} />
                    </li>
                ))}
            </ol>

            {draft.zones.length > 0 && (
                <div className="chips" style={{ marginTop: 10 }}>
                    {draft.zones.map((zone) => (
                        <span key={zone.id} className="chip chip--edit" data-kind="zona">
                            <i />
                            <ChipName value={zone.name} onCommit={(name) => rename('zones', zone.id, name)} />
                        </span>
                    ))}
                </div>
            )}

            <p className="small" style={{ marginTop: 10 }}>
                Arrastra para cambiar el orden del proceso (o Alt y flechas). Clic en un nombre para renombrarlo. Los cambios pasan al plano.
            </p>
        </>
    )
}

const AGENT_NAMES = { edificio: 'forma y portones', zonas: 'zonas', acomodo: 'lugar de cada máquina', paredes: 'paredes' }

/* Qué tanto del espacio se pudo analizar y con qué agentes. */
function SpatialNote({ spatial }) {
    const used = spatial.agents || []
    if (!used.length)
        return (
            <p className="small spatial-note">
                La descripción casi no menciona el espacio, por lo que solo se analizó el proceso. Con medidas, lados, ubicación de cada área o paredes, el análisis también genera la forma, las zonas y las paredes.
            </p>
        )
    return (
        <p className="small spatial-note">
            Análisis del espacio con {used.length} agentes ({used.map((k) => AGENT_NAMES[k] || k).join(', ')}){spatial.model ? `, modelo ${spatial.model}` : ''}. Se descarta lo que la descripción no confirma.
        </p>
    )
}

export default function Story({ needsContext, onVerify, constructionProgress, text, setText, info, draft, setDraft, catalog, reading, error, onRead, onBlank, onSave, saving, onOpenContext, context2, pending = 0 }) {
    const empty = !text.trim()
    const [metrics, setMetrics] = useState(null)
    const editorRef = useRef(null)

    const scrollToEditor = () => setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)

    const restartPlan = async () => {
        if (!(await ask('Se borrará todo el plano (máquinas, rutas, paredes y zonas) para empezar uno vacío.', { title: '¿Reiniciar el plano?', ok: 'Sí, reiniciar' }))) return
        onBlank()
    }

    return (
        <section className="step">
            <header className="step-head">
                <span className="step-index">
                    <b>Paso 1 de 6</b>
                    <span>Detalles y plano</span>
                </span>
                <RevealTitle text="Describe cómo es tu planta." />
                <p className="lede">Escribe tu planta y tu proceso con tus palabras: la IA arma un primer plano y luego lo corriges tú. Si además tienes documentos, estudios o datos por tema, inicia un proyecto avanzado.</p>
            </header>

            <div className="split">
                <Appear className="stack">
                    <div className="panel story-start">
                        <div className="story-sheet" style={{ border: 0 }}>
                            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Tengo mi planta productora…" aria-label="Descripción de tu planta" style={{ minHeight: 260 }} />
                        </div>
                        <div className="story-bar story-bar--main">
                            <Btn
                                wide
                                onClick={async () => {
                                    if (await onRead()) scrollToEditor()
                                }}
                                disabled={reading || empty}
                            >
                                {reading ? 'Analizando…' : needsContext ? 'Organizar el contexto primero' : 'Construir el plano desde mi contexto'}
                            </Btn>
                        </div>
                    </div>

                    {error && <p className="small">{error}</p>}

                    <div className="story-advanced">
                        <div>
                            <span className="context-eyebrow">OTRA FORMA DE EMPEZAR</span>
                            <p className="small">¿Tienes documentos, estudios del trabajo o datos por tema? Organízalos en el contexto de la planta.</p>
                        </div>
                        {pending > 0 && (
                            <p className="context-pending small">
                                <b>{pending} {pending === 1 ? 'dato propuesto' : 'datos propuestos'}</b> por revisar.{' '}
                                <button type="button" className="link-btn" onClick={() => onOpenContext('inicio')}>Revisarlos</button>
                            </p>
                        )}
                        <Btn variant="ghost" size="small" onClick={() => onOpenContext('inicio')}>
                            Iniciar proyecto avanzado
                        </Btn>
                    </div>
                </Appear>

                <div className="stack">
                    {reading && <><WaitPanel kind="story" title={constructionProgress ? 'Construyendo y comprobando tu planta por partes…' : 'Interpretando el acomodo de tu planta…'} game="Juega mientras se analiza tu planta" />{constructionProgress && <p role="status">{({ building: 'Preparando el espacio', entities: 'Colocando áreas y equipos', routes: 'Conectando los recorridos', verifying: 'Comprobando el conjunto', review: 'Plano listo para revisión' })[constructionProgress.stage] || 'Preparando la construcción'}{constructionProgress.total ? ` · ${constructionProgress.completed} de ${constructionProgress.total}` : ''}</p>}</>}

                    {!reading && !info && (
                        <div className="block">
                            <h3>Cómo funciona</h3>

                            <ul className="note-list" style={{ marginTop: 14 }}>
                                <li>La IA lee el contexto y devuelve solo datos: máquinas, rutas, zonas y cifras.</li>
                                <li>Se arma un primer plano. Tú lo corriges en el editor de abajo.</li>
                            </ul>

                            <p className="small" style={{ marginTop: 18 }}>
                                ¿Prefieres no usar la IA?{' '}
                                <button type="button" className="link-btn" onClick={() => (onBlank(), scrollToEditor())}>
                                    Dibuja el plano tú mismo
                                </button>
                            </p>
                        </div>
                    )}
                    {!reading && info && (
                        <Appear className="block">
                            <div className="chart-head" style={{ marginBottom: 12 }}>
                                <h3>Tu proceso</h3>
                                <span className="small">Resultado del análisis</span>
                            </div>

                            {draft && <ProcessSummary draft={draft} setDraft={setDraft} />}

                            {info.spatial && <SpatialNote spatial={info.spatial} />}

                            {info.notes?.length > 0 && (
                                <ul className="note-list" style={{ marginTop: 16 }}>
                                    {info.notes.map((note, idx) => (
                                        <li key={idx}>{note}</li>
                                    ))}
                                </ul>
                            )}
                        </Appear>
                    )}
                </div>
            </div>

            {!reading && constructionProgress?.stage === 'blocked' && <ConstructionReview report={constructionProgress.verification} title="La construcción se detuvo en este lote; tu plano anterior sigue guardado" />}
            {info?.verification && <ConstructionReview report={info.verification} stale={info.verificationDraftKey !== JSON.stringify(draft)} />}
            {draft && onVerify && <button className="btn btn--ghost btn--small" type="button" onClick={onVerify}>Comprobar el plano contra el contexto</button>}
            {draft && (
                <div ref={editorRef} style={{ marginTop: 48, scrollMarginTop: 24 }}>
                    <div className="chart-head" style={{ marginBottom: 16 }}>
                        <h2>Tu plano</h2>
                    </div>

                    <PlanEditor
                        plant={draft}
                        positions={draft.layout}
                        onChange={(p, pos) => setDraft({ ...p, layout: pos })}
                        catalog={catalog}
                        mode="full"
                        onMetrics={setMetrics}
                        actions={
                            <button type="button" className="btn btn--ghost btn--small" onClick={restartPlan} title="Borra todo el plano y empieza uno vacío">
                                Reiniciar plano
                            </button>
                        }
                    />

                    {context2 && (
                        <div className="context-review-card">
                            <div><h3>Así entendimos tu planta</h3><p className="small">{context2.confirmed ? 'Confirmaste esta versión del plano, contexto y prioridades.' : 'Revisa el plano junto con los datos y las prioridades antes de analizar.'}</p></div>
                            <Btn variant="ghost" size="small" onClick={() => onOpenContext('revision')}>
                                {context2.confirmed ? 'Ver revisión' : 'Revisar y confirmar'}
                            </Btn>
                        </div>
                    )}

                    <div className="row" style={{ marginTop: 32 }}>
                        <Btn onClick={onSave} disabled={saving || draft.stations.length === 0 || (context2 && !context2.confirmed)}>
                            {saving ? 'Analizando…' : 'Guardar y ver en 3D'}
                        </Btn>

                        {metrics && <span className="small num">Una pieza recorre {fmt(metrics.piece_m, 1)} m en este plano.</span>}
                        
                        {draft.stations.length === 0 && <span className="small">Agrega al menos una máquina.</span>}
                        {draft.stations.length > 0 && context2 && !context2.confirmed && <span className="small">Confirma «Así entendimos tu planta» para analizar.</span>}
                    </div>
                </div>
            )}
        </section>
    )
}
