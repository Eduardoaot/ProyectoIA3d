import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { contextSignature } from '../context'

export function SimulationValues({ values }) {
    if (values == null) return <span>sin datos</span>
    if (typeof values !== 'object') return <span>{String(values)}</span>
    if (['p10', 'p50', 'p90'].some((key) => Object.hasOwn(values, key))) return <table><thead><tr><th>P10</th><th>Mediana</th><th>P90</th></tr></thead><tbody><tr>{['p10', 'p50', 'p90'].map((key) => <td key={key}>{values[key] ?? 'sin datos'}</td>)}</tr></tbody></table>
    return <dl className="metric-values">{Object.entries(values).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd><SimulationValues values={value} /></dd></div>)}</dl>
}
export default function SimulationPanel({ plant, alternative, confirmed }) {
    const [replicas, setReplicas] = useState(30), [seed, setSeed] = useState(42)
    const [result, setResult] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
    const controller = useRef(null)
    useEffect(() => () => controller.current?.abort(), [])
    const signature = contextSignature({ plant, alternative, replicas, seed })
    const run = async () => {
        if (busy || !confirmed) return
        const c = new AbortController(); controller.current = c
        setBusy(true); setError(''); setResult(null)
        try {
            const data = await api.simulate(plant, alternative, replicas, seed, c.signal)
            if (!c.signal.aborted) setResult({ data, signature })
        } catch (failure) { if (!c.signal.aborted) setError(failure.message) }
        finally { if (!c.signal.aborted) setBusy(false) }
    }
    const valid = Number.isInteger(replicas) && replicas > 0 && Number.isInteger(seed) && seed >= 0
    return <section className="block simulation-panel"><h3>Simulación</h3>
        <div className="field-row"><label className="field">Réplicas<input type="number" min="1" step="1" value={replicas} onChange={(e) => setReplicas(e.target.value === '' ? '' : Number(e.target.value))} /></label>
            <label className="field">Semilla<input type="number" min="0" step="1" value={seed} onChange={(e) => setSeed(e.target.value === '' ? '' : Number(e.target.value))} /></label></div>
        <button type="button" className="btn btn--small" disabled={!confirmed || !valid || busy} onClick={run}>{busy ? 'Simulando…' : 'Simular alternativa'}</button>
        {!confirmed && <p>Confirma el Contexto 2 para simular.</p>}
        {error && <p role="alert">{error}</p>}
        {result && (result.signature === signature ? <><p>Semilla: {result.data.seed} · Réplicas: {result.data.replicas}</p><SimulationValues values={result.data.kpis} /></> : <p>Simulación desactualizada: cambió el plano o la configuración.</p>)}
    </section>
}
