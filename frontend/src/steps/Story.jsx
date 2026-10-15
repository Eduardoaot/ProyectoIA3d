import { useEffect, useRef, useState } from 'react'
import { fmt } from '../api'
import PlanEditor from '../editor/PlanEditor'
import Btn from '../fx/Btn'
import { Appear, RevealTitle } from '../fx/Reveal'

function Timer() {
    const [seconds, setSeconds] = useState(0)

    useEffect(() => {
        const time = setInterval(() => setSeconds((v) => v + 1), 1000)
        return () => clearInterval(time)
    }, [])

    return <span className="small num">{seconds} s</span>
}

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
    const [clearedZeros, setClearedZeros] = useState({})
    const on = !!draft.use_assumptions
    const src = Object.fromEntries((info?.assumptions || []).map((a) => [a.key, a.source]))
    const setParam = (k, v) => setDraft({ ...draft, params: { ...draft.params, [k]: v } })
    const setSt = (id, patch) => setDraft({ ...draft, stations: draft.stations.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
    const people = draft.stations.reduce((a, s) => a + (Number(s.ops) || 0), 0)
    const clearZeroOnFocus = (key, e) => {
        if (e.currentTarget.value !== '' && Number(e.currentTarget.value) === 0) {
            setClearedZeros((current) => ({ ...current, [key]: true }))
        }
    }
    const restoreZeroOnBlur = (key) => {
        setClearedZeros((current) => {
            const next = { ...current }
            delete next[key]
            return next
        })
    }
    const showValue = (key, value) => clearedZeros[key] ? '' : value

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

                                <input id={`a-${assumption.key}`} type="number" step="any" min="0" value={showValue(`param-${assumption.key}`, draft.params?.[assumption.key] ?? assumption.value)} onFocus={(e) => clearZeroOnFocus(`param-${assumption.key}`, e)} onBlur={() => restoreZeroOnBlur(`param-${assumption.key}`)} onChange={(e) => {
                                    if (e.target.value === '') return
                                    setParam(assumption.key, Number(e.target.value))
                                    restoreZeroOnBlur(`param-${assumption.key}`)
                                }} />
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
                                            <input className="cell-input" type="number" min="0" step="0.1" value={showValue(`time-${station.id}`, station.t ?? 0)} onFocus={(e) => clearZeroOnFocus(`time-${station.id}`, e)} onBlur={() => restoreZeroOnBlur(`time-${station.id}`)} onChange={(e) => {
                                                if (e.target.value === '') return
                                                setSt(station.id, { t: Number(e.target.value), t_source: 'usuario' })
                                                restoreZeroOnBlur(`time-${station.id}`)
                                            }} aria-label={`Minutos por pieza en ${station.name}`} />
                                        </td>

                                        <td className="num">
                                            <input className="cell-input" type="number" min="0" step="1" value={showValue(`ops-${station.id}`, station.ops ?? 0)} onFocus={(e) => clearZeroOnFocus(`ops-${station.id}`, e)} onBlur={() => restoreZeroOnBlur(`ops-${station.id}`)} onChange={(e) => {
                                                if (e.target.value === '') return
                                                setSt(station.id, { ops: Math.max(0, Math.round(Number(e.target.value))) })
                                                restoreZeroOnBlur(`ops-${station.id}`)
                                            }} aria-label={`Operarios en ${station.name}`} />
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

export default function Story({ text, setText, info, draft, setDraft, catalog, reading, error, onRead, onBlank, onSave, saving }) {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0
    const [metrics, setMetrics] = useState(null)
    const editorRef = useRef(null)

    const scrollToEditor = () => setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)

    return (
        <section className="step">
            <header className="step-head">
                <span className="step-index">01 / Detalles y plano</span>
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
                            <div className="row">
                                <Btn
                                    onClick={async () => {
                                        if (await onRead()) scrollToEditor()
                                    }}
                                    disabled={reading || words < 6}
                                >
                                {reading ? 'Analizando…' : 'Analizar'}
                                </Btn>
                                <button type="button" className="btn btn--ghost btn--small" onClick={() => (onBlank(), scrollToEditor())}>
                                Dibujar desde cero
                                </button>
                            </div>
                        </div>
                    </div>

                    {error && <p className="small">{error}</p>}
                </Appear>

                <div className="stack">
                    {reading && (
                        <div className="block reading">
                            <div className="dots" aria-hidden="true">
                                <i />
                                <i data-off="true" />
                                <i data-off="true" />
                            </div>

                            <p>Interpretando el acomodo de tu planta…</p>

                            <Timer />
                            
                            <p className="small">Este proceso puede tardar uno o dos minutos.</p>
                        </div>
                    )}
                    
                    {!reading && !info && (
                        <div className="block">
                            <h3>Cómo funciona</h3>

                            <ul className="note-list" style={{ marginTop: 14 }}>
                                <li>La IA lee el contexto y devuelve solo datos: máquinas, rutas, zonas y cifras.</li>
                                <li>Se arma un primer plano. Tú lo corriges en el editor de abajo.</li>
                                <li>Los supuestos (tiempos, producción) son opcionales: sin estos, solo se analizan recorridos.</li>
                            </ul>
                        </div>
                    )}
                    {!reading && info && (
                        <Appear className="block">
                            <div className="chart-head" style={{ marginBottom: 12 }}>
                                <h3>Tu proceso</h3>
                                <span className="small">Según la interpretación de la IA</span>
                            </div>

                            {draft && (
                                <div className="chips">
                                    {draft.stations.map((station) => (
                                        <span key={station.id} className="chip">
                                            <i /> {station.name}
                                        </span>
                                    ))}
                                    {draft.zones.map((zone) => (
                                        <span key={zone.id} className="chip" data-kind="supuesto">
                                            <i /> {zone.name}
                                        </span>
                                    ))}
                                </div>
                            )}

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

                    <PlanEditor plant={draft} positions={draft.layout} onChange={(p, pos) => setDraft({ ...p, layout: pos })} catalog={catalog} mode="full" onMetrics={setMetrics} />

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