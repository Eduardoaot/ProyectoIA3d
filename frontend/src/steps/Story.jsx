import { useRef, useState } from 'react'
import { fmt } from '../api'
import WaitPanel from '../components/WaitPanel'
import PlanEditor from '../editor/PlanEditor'
import Btn from '../fx/Btn'
import { Appear, RevealTitle } from '../fx/Reveal'

const EXAMPLE_STORY = `Mi padre tenía un taller de vidrios para sala y comedor. Era una transformadora de vidrio: recibía una lámina y tenía una mesa donde cortaban, una pulidora, sandblasting, una lavadora, la oficina y un pulpo para mover las láminas. Trabajaban unas 12 personas y salían unas 80 piezas al día en 3 camiones. Todo estaba en una bodega con portones sobre la calle. Ahí mismo se hacían las ventas, los pagos y la nómina.

No tengo los detalles porque fue hace mucho tiempo. Lo que sí recuerdo es que lo terminado se amontonaba en despacho y que uno de los portones siempre estaba tapado con retazos.`

function Switch({ on, onChange, children }) {
    return (
        <button type="button" className="switch" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
            <span className="switch-track">
                <span className="switch-knob" />
            </span>
            {children}
        </button>
    )
}

function Assumptions({ draft, setDraft, catalog, info }) {
    const on = !!draft.use_assumptions
    const src = Object.fromEntries((info?.assumptions || []).map((a) => [a.key, a.source]))
    const setParam = (k, v) => setDraft({ ...draft, params: { ...draft.params, [k]: v } })
    const setSt = (id, patch) => setDraft({ ...draft, stations: draft.stations.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
    const people = draft.stations.reduce((a, s) => a + (Number(s.ops) || 0), 0)

    return (
        <div className="block stack">
            <div className="chart-head">
                <div>
                    <h3>Supuestos para calcular</h3>
                    <p className="small">Sin supuestos solo veo recorridos y qué tan cerca debe estar cada área. Con ellos calculo capacidad, cuello de botella y tiempos.</p>
                </div>

                <Switch on={on} onChange={(v) => setDraft({ ...draft, use_assumptions: v })}>
                    {on ? 'Usar supuestos' : 'Sin supuestos'}
                </Switch>
            </div>

            {on && (
                <>
                    {info?.ai_assumptions?.length > 0 && (
                        <details className="how">
                            <summary>Lo que supuso la IA al leer tu historia</summary>
                            <ul>
                                {info.ai_assumptions.map((assumption, idx) => (
                                    <li key={idx}>{assumption}</li>
                                ))}
                            </ul>
                        </details>
                    )}

                    <div className="assume assume--grid">
                        {catalog?.assumptions.map((assumption) => (
                            <div key={assumption.key} className="assume-row" data-src={src[assumption.key] || 'supuesto'}>
                                <div>
                                    <label htmlFor={`a-${assumption.key}`}>{assumption.label}</label>
                                    <span className="small">
                                        {assumption.why} ({assumption.unit})
                                    </span>
                                </div>

                                <input id={`a-${assumption.key}`} type="number" step="any" min="0" value={draft.params?.[assumption.key] ?? assumption.value} onChange={(e) => setParam(assumption.key, Number(e.target.value))} />
                            </div>
                        ))}
                    </div>

                    <div>
                        <div className="chart-head">
                            <h3>Tiempos y personas por estación</h3>
                            <span className="small num">{people} personas en planta</span>
                        </div>

                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Estación</th>
                                    <th className="num">Minutos por pieza</th>
                                    <th className="num">Operarios</th>
                                </tr>
                            </thead>
                            <tbody>
                                {draft.stations.map((station) => (
                                    <tr key={station.id}>
                                        <td>
                                            {station.name}
                                            {station.t_source === 'ia' && <span className="small"> (estimado por la IA)</span>}
                                        </td>

                                        <td className="num">
                                            <input className="cell-input" type="number" min="0" step="0.1" value={station.t ?? 0} onChange={(e) => setSt(station.id, { t: Number(e.target.value), t_source: 'usuario' })} aria-label={`Minutos por pieza en ${station.name}`} />
                                        </td>

                                        <td className="num">
                                            <input className="cell-input" type="number" min="0" step="1" value={station.ops ?? 0} onChange={(e) => setSt(station.id, { ops: Math.max(0, Math.round(Number(e.target.value))) })} aria-label={`Operarios en ${station.name}`} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <p className="small" style={{ marginTop: 8 }}>
                            Con 0 operarios y minutos mayores a 0, la estación se toma como máquina automática.
                        </p>
                    </div>
                </>
            )}
        </div>
    )
}

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
                        <span key={zone.id} className="chip chip--edit" data-kind="supuesto">
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

/* Qué tanto del espacio pudo leer la IA y con qué agentes. */
function SpatialNote({ spatial }) {
    const used = spatial.agents || []
    if (!used.length)
        return (
            <p className="small spatial-note">
                Tu historia casi no describe el espacio, así que solo leí el proceso. Si cuentas medidas, lados, dónde está cada área o qué paredes hay, la IA también arma la forma, las zonas y las paredes.
            </p>
        )
    return (
        <p className="small spatial-note">
            Lectura del espacio con {used.length} agentes ({used.map((k) => AGENT_NAMES[k] || k).join(', ')}){spatial.model ? ` usando ${spatial.model}` : ''}. Lo que tu historia no confirma se descarta.
        </p>
    )
}

export default function Story({ text, setText, info, draft, setDraft, catalog, reading, error, onRead, onBlank, onSave, saving }) {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0
    const [metrics, setMetrics] = useState(null)
    const editorRef = useRef(null)

    const scrollToEditor = () => setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)

    const restartPlan = () => {
        if (!window.confirm('Se borrará todo el plano (máquinas, rutas, paredes y zonas) para empezar uno vacío. ¿Seguir?')) return
        onBlank()
    }

    return (
        <section className="step">
            <header className="step-head">
                <span className="step-index">
                    <b>Paso 1 de 6</b>
                    <span>Detalles y plano</span>
                </span>
                <RevealTitle text="Cuéntame cómo es tu planta." />
                <p className="lede">Describe tu planta y proceso. La IA arma un primer plano. Luego lo corriges tú: mueve máquinas, dibuja rutas, paredes y zonas hasta que quede como realmente es tu espacio.</p>
            </header>

            <div className="split">
                <Appear className="stack">
                    <div className="panel">
                        <div className="story-sheet" style={{ border: 0 }}>
                            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Tengo mi planta productora…" aria-label="Detalles de tu planta" style={{ minHeight: 260 }} />
                        </div>
                        <div className="story-bar">
                            <span className="small num">{words < 6 ? `${words} palabras. Escribe al menos 6.` : `${words} palabras`}</span>
                            <Btn
                                onClick={async () => {
                                    if (await onRead()) scrollToEditor()
                                }}
                                disabled={reading || words < 6}
                            >
                                {reading ? 'Leyendo…' : 'Leer con IA'}
                            </Btn>
                        </div>
                    </div>

                    <div className="story-alt">
                        <button type="button" className="link-btn" onClick={() => setText(EXAMPLE_STORY)} disabled={reading}>
                            Usar la historia de ejemplo
                        </button>
                        <span className="small">Llena el cuadro con un taller de vidrio. Luego pulsa «Leer con IA».</span>
                    </div>

                    {error && <p className="small">{error}</p>}
                </Appear>

                <div className="stack">
                    {reading && <WaitPanel kind="story" title="Interpretando el acomodo de tu planta…" game="Juega mientras la IA lee" />}

                    {!reading && !info && (
                        <div className="block">
                            <h3>Cómo funciona</h3>

                            <ul className="note-list" style={{ marginTop: 14 }}>
                                <li>La IA lee el contexto y devuelve solo datos: máquinas, rutas, zonas y cifras.</li>
                                <li>Se arma un primer plano. Tú lo corriges en el editor de abajo.</li>
                                <li>Los supuestos (tiempos, producción) son opcionales: sin estos, solo se analizan recorridos.</li>
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
                                <span className="small">Según la interpretación de la IA</span>
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

                    <div style={{ marginTop: 24 }}>
                        <Assumptions draft={draft} setDraft={setDraft} catalog={catalog} info={info} />
                    </div>

                    <div className="row" style={{ marginTop: 32 }}>
                        <Btn onClick={onSave} disabled={saving || draft.stations.length === 0}>
                            {saving ? 'Analizando…' : 'Guardar y ver en 3D'}
                        </Btn>

                        {metrics && <span className="small num">Una pieza recorre {fmt(metrics.piece_m, 1)} m en este plano.</span>}
                        
                        {draft.stations.length === 0 && <span className="small">Agrega al menos una máquina.</span>}
                    </div>
                </div>
            )}
        </section>
    )
}