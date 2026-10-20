import { useState } from 'react'
import { addEntry, CONFIDENCE, current, history, parseValue, SEGMENTS, showValue, SOURCES } from '../context'

const EMPTY_FORM = { segment: 'tiempos', key: '', value: '', unit: '', source: 'medido', confidence: 'alta', owner: '', supersedes: null }

/* Datos con procedencia (criterios §1.4 y §4): cada dato lleva fuente, fecha y confianza.
   Editar agrega una versión nueva; la anterior queda en el historial. */
export default function ContextPanel({ context, setContext }) {
    const [form, setForm] = useState(EMPTY_FORM)
    const [open, setOpen] = useState(null)
    const live = current(context)
    const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

    const save = () => {
        if (!form.key.trim() || !String(form.value).trim()) return
        setContext(addEntry(context, { ...form, key: form.key.trim(), value: parseValue(form.value), unit: form.unit.trim(), owner: form.owner.trim() }))
        setForm({ ...EMPTY_FORM, segment: form.segment })
    }

    const edit = (e) =>
        setForm({ segment: e.segment, key: e.key, value: Array.isArray(e.value) ? `${e.value[0]} a ${e.value[1]}` : String(e.value), unit: e.unit || '', source: e.source, confidence: e.confidence, owner: e.owner || '', supersedes: e.id })

    return (
        <div className="block context-panel">
            <h3>Datos de la planta</h3>
            <p className="small">Cada dato guarda de dónde sale, cuándo y qué tan confiable es. Al corregir uno, el anterior queda en el historial. Los de confianza baja se muestran como rango.</p>

            {SEGMENTS.filter((s) => live.some((e) => e.segment === s.id)).map((s) => (
                <div key={s.id} className="context-seg">
                    <strong className="small">{s.label}</strong>
                    <ul className="small">
                        {live
                            .filter((e) => e.segment === s.id)
                            .map((e) => {
                                const past = history(context, e.id).slice(1)
                                return (
                                    <li key={e.id} data-low={e.confidence === 'baja'}>
                                        <b>{e.key}</b>: {showValue(e)} {e.unit}{' '}
                                        <span className="context-meta">
                                            ({e.source}, confianza {e.confidence}, {e.date}
                                            {e.owner ? `, ${e.owner}` : ''})
                                        </span>{' '}
                                        <button type="button" className="link-btn" onClick={() => edit(e)}>
                                            Corregir
                                        </button>
                                        {past.length > 0 && (
                                            <button type="button" className="link-btn" onClick={() => setOpen(open === e.id ? null : e.id)}>
                                                Historial ({past.length})
                                            </button>
                                        )}
                                        {open === e.id && (
                                            <ul className="context-history">
                                                {past.map((h) => (
                                                    <li key={h.id}>
                                                        v{h.version}, {h.date}: {showValue(h)} {h.unit} ({h.source}, confianza {h.confidence})
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </li>
                                )
                            })}
                    </ul>
                </div>
            ))}

            <div className="context-form">
                {form.supersedes && <p className="small">Corrigiendo «{form.key}». El valor anterior queda en el historial.</p>}
                <div className="field-row">
                    <label className="field">
                        <span>Tema</span>
                        <select value={form.segment} onChange={set('segment')} disabled={!!form.supersedes}>
                            {SEGMENTS.filter((s) => s.id !== 'referencias').map((s) => (
                                <option key={s.id} value={s.id} title={s.hint}>
                                    {s.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span>Dato</span>
                        <input value={form.key} onChange={set('key')} placeholder="pulido.t_ciclo" disabled={!!form.supersedes} />
                    </label>
                </div>
                <div className="field-row">
                    <label className="field">
                        <span>Valor (número, rango «3,5 a 4,5» o texto)</span>
                        <input value={form.value} onChange={set('value')} />
                    </label>
                    <label className="field">
                        <span>Unidad</span>
                        <input value={form.unit} onChange={set('unit')} placeholder="min/pieza" />
                    </label>
                </div>
                <div className="field-row">
                    <label className="field">
                        <span>De dónde sale</span>
                        <select value={form.source} onChange={set('source')}>
                            {SOURCES.map((s) => (
                                <option key={s}>{s}</option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span>Confianza</span>
                        <select value={form.confidence} onChange={set('confidence')}>
                            {CONFIDENCE.map((s) => (
                                <option key={s}>{s}</option>
                            ))}
                        </select>
                    </label>
                </div>
                <label className="field">
                    <span>Quién lo dio (opcional)</span>
                    <input value={form.owner} onChange={set('owner')} placeholder="supervisor de pulido" />
                </label>
                <div className="row">
                    <button type="button" className="btn btn--small" onClick={save} disabled={!form.key.trim() || !String(form.value).trim()}>
                        {form.supersedes ? 'Guardar corrección' : 'Agregar dato'}
                    </button>
                    {form.supersedes && (
                        <button type="button" className="btn btn--ghost btn--small" onClick={() => setForm(EMPTY_FORM)}>
                            Cancelar
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
