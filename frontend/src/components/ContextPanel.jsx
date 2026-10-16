import { useState } from 'react'
import { appendEntry, currentEntries, displayValue, SEGMENTS, segmented } from '../context'

export default function ContextPanel({ context, onChange, children }) {
    const [segment, setSegment] = useState('negocio')
    const [key, setKey] = useState('')
    const [value, setValue] = useState('')
    const [unit, setUnit] = useState('')
    const [source, setSource] = useState('usuario')
    const [confidence, setConfidence] = useState('baja')
    const [owner, setOwner] = useState('usuario')
    const [error, setError] = useState('')
    const entries = currentEntries(context)
    const edit = (entry) => {
        setSegment(entry.segment); setKey(entry.key); setValue(typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value)); setUnit(entry.unit); setSource(entry.source); setConfidence(entry.confidence); setOwner(entry.owner)
    }
    const save = (event) => {
        event.preventDefault()
        try {
            let parsed = value
            try { parsed = JSON.parse(value) } catch { /* Free text is valid. */ }
            onChange(appendEntry(context, { segment, key: key.trim(), value: parsed, unit, source, confidence, owner }))
            setValue(''); setKey(''); setError('')
        } catch (failure) { setError(failure.message) }
    }
    return <details className="block context-panel">
        <summary>Contexto por segmentos e historial</summary>
        <form onSubmit={save} className="context-form">
            <label className="field">Segmento<select value={segment} onChange={(e) => setSegment(e.target.value)}>{SEGMENTS.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="field">Dato / clave<input required value={key} onChange={(e) => setKey(e.target.value)} placeholder="Ej.: demanda diaria" /></label>
            <label className="field">Valor o rango<textarea required value={value} onChange={(e) => setValue(e.target.value)} placeholder="Texto, número o [mínimo, máximo]" /></label>
            <label className="field">Unidad<input value={unit} onChange={(e) => setUnit(e.target.value)} /></label>
            <label className="field">Fuente<select value={source} onChange={(e) => setSource(e.target.value)}>{['medido', 'estimado', 'supuesto', 'usuario'].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="field">Confianza<select value={confidence} onChange={(e) => setConfidence(e.target.value)}><option>alta</option><option>baja</option></select></label>
            <label className="field">Responsable<input required value={owner} onChange={(e) => setOwner(e.target.value)} /></label>
            <button className="btn btn--small" type="submit">Guardar nueva entrada</button>
        </form>
        {error && <p role="alert">{error}</p>}
        <p className="small">Para corregir un dato usa la misma clave: se conserva su versión anterior. Los tiempos del plano se corrigen en el inspector de la estación.</p>
        <ul className="context-entries">{entries.map((e) => <li key={e.id} data-confidence={e.confidence}>
            <strong>{e.segment} · {e.key}</strong>: {displayValue(e.value)} {e.unit}
            {e.confidence === 'baja' && <span> · Confianza baja{Array.isArray(e.value) ? ' · rango' : ' · rango no indicado'}</span>}
            <small> · {e.source} · {e.owner} · {e.date || 'sin fecha'}</small>
            <button type="button" className="link-btn" onClick={() => edit(e)}>Corregir</button>
        </li>)}</ul>
        {children}
        <details><summary>Historial de entradas</summary><ul>{Object.values(segmented(context).segments).flat().map((e) => <li key={e.id}>{e.key} · v{e.version}: {displayValue(e.value)} {e.unit} · {e.date || 'sin fecha'} · {e.source} · {e.confidence} · {e.owner}{e.supersedes && ` · reemplaza ${e.supersedes}`}</li>)}</ul></details>
    </details>
}
