import { useState } from 'react'
import { api } from '../api'
import { has } from '../capabilities'
import { describeAll } from '../opText'
import { applyOps } from '../ops'
import useCaps from '../useCaps'

/* Asistente del editor (criterios §8.8): el usuario escribe qué quiere, el backend propone
   operaciones y aquí se ven, con lo rechazado y su motivo, ANTES de aplicarlas.
   Aplicar es un solo lote con applyOps y un solo paso de deshacer.
   Solo aparece si el backend anuncia plan_ops. */
export default function Assistant({ plant, positions, onApply }) {
    const caps = useCaps()
    const [text, setText] = useState('')
    const [state, setState] = useState({ busy: false, out: null, error: null })

    if (!has(caps, 'plan_ops')) return null

    const ask = async () => {
        if (!text.trim()) return
        setState({ busy: true, out: null, error: null })
        try {
            const out = await api.planOps(text.trim(), { ...plant, layout: positions })
            setState({ busy: false, out, error: null })
        } catch {
            setState({ busy: false, out: null, error: 'El asistente no respondió. Intenta de nuevo.' })
        }
    }

    const apply = () => {
        const res = applyOps({ ...plant, layout: positions }, state.out.ops)
        const { layout, ...rest } = res.plant
        onApply('layout' in plant ? { ...rest, layout: plant.layout } : rest, layout)
        setState({ busy: false, out: res.rejected.length ? { ops: [], rejected: res.rejected, notes: 'Se aplicó el resto. Estas no se pudieron aplicar:' } : null, error: null })
        if (!res.rejected.length) setText('')
    }

    const out = state.out
    const lines = out ? describeAll(out.ops, plant) : []

    return (
        <div className="assistant">
            <label className="field">
                <span>Asistente del plano</span>
                <textarea
                    rows={2}
                    value={text}
                    placeholder="Agrega una pulidora junto a pintura y no muevas la columna"
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ask()
                    }}
                />
            </label>
            <div className="row">
                <button type="button" className="btn btn--small" onClick={ask} disabled={state.busy || !text.trim()}>
                    {state.busy ? 'Pensando…' : 'Proponer cambios'}
                </button>
            </div>
            {state.error && <p className="small">{state.error}</p>}
            {out && (
                <div className="assistant-out small">
                    {out.notes && <p>{out.notes}</p>}
                    {lines.length > 0 && (
                        <ol>
                            {lines.map((l, i) => (
                                <li key={i}>
                                    {l}
                                    {out.ops[i].reason && <span className="assistant-why"> — {out.ops[i].reason}</span>}
                                </li>
                            ))}
                        </ol>
                    )}
                    {out.rejected?.length > 0 && (
                        <>
                            <strong>No se aplicará:</strong>
                            <ul>
                                {out.rejected.map((r, i) => (
                                    <li key={i}>
                                        <s>{r.op?.op} {r.op?.id || r.op?.name || ''}</s> — {r.reason}
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                    {lines.length === 0 && !out.rejected?.length && !out.notes && <p>No se propuso ningún cambio.</p>}
                    <div className="row">
                        {lines.length > 0 && (
                            <button type="button" className="btn btn--small" onClick={apply}>
                                Aplicar {lines.length} {lines.length === 1 ? 'cambio' : 'cambios'}
                            </button>
                        )}
                        <button type="button" className="btn btn--ghost btn--small" onClick={() => setState({ busy: false, out: null, error: null })}>
                            Descartar
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
