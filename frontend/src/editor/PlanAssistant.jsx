import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { contextSignature } from '../context'
import { previewOperations } from './assistant'

export default function PlanAssistant({ plant, onApply }) {
    const [instruction, setInstruction] = useState('')
    const [proposal, setProposal] = useState(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const controller = useRef(null)
    useEffect(() => () => controller.current?.abort(), [])
    const request = async () => {
        if (busy || !instruction.trim()) return
        const snapshot = structuredClone(plant)
        const c = new AbortController(); controller.current = c
        setBusy(true); setError(''); setProposal(null)
        try {
            const response = await api.planOps(instruction, snapshot, c.signal)
            if (!c.signal.aborted) setProposal({ ...previewOperations(snapshot, response), signature: contextSignature(snapshot) })
        } catch (failure) { if (!c.signal.aborted) setError(failure.message) }
        finally { if (!c.signal.aborted) setBusy(false) }
    }
    const stale = proposal && proposal.signature !== contextSignature(plant)
    return <section className="block plan-assistant">
        <h3>Asistente del editor</h3>
        <label className="field">Qué quieres cambiar<textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Agrega una pulidora junto a corte y conserva el horno fijo" /></label>
        <button type="button" className="btn btn--small" disabled={busy || !instruction.trim()} onClick={request}>{busy ? 'Preparando propuesta…' : 'Pedir propuesta'}</button>
        {error && <p role="alert">{error}</p>}
        {proposal && <>
            <p>{proposal.notes}</p>
            <ol>{proposal.ops.map((op, i) => <li key={i}><code>{JSON.stringify(op)}</code></li>)}</ol>
            {proposal.rejected.length > 0 && <><h4>Operaciones rechazadas</h4><ul>{proposal.rejected.map((r, i) => <li key={i}>{JSON.stringify(r.op)}: {r.reason}</li>)}</ul></>}
            {stale && <p role="status">El plano cambió. Pide una nueva propuesta.</p>}
            <button type="button" className="btn btn--small" disabled={stale || !proposal.ops.length} onClick={() => { if (onApply(proposal.ops)) setProposal(null) }}>Aplicar operaciones</button>
        </>}
    </section>
}
