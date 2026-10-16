import { useState } from 'react'
import { FLOWS } from './selection'

export default function GroupInspector({ selection, full, remove, onRoutes, flowsEnabled = true }) {
    const [flow, setFlow] = useState('material')
    const [percent, setPercent] = useState('100')
    if (selection.length < 2) return null
    const routes = selection.filter((s) => s.type === 'route')
    return <aside className="inspector">
        <h3>{selection.length} elementos seleccionados</h3>
        <p className="small">Arrastra un elemento para mover el grupo. Los elementos bloqueados impiden mover o cortar el grupo.</p>
        {full && routes.length > 0 && <>
            <p>{routes.length} rutas seleccionadas</p>
            {flowsEnabled && <><label className="field">Flujo<select value={flow} onChange={(e) => setFlow(e.target.value)}>{FLOWS.map((f) => <option key={f}>{f}</option>)}</select></label>
            <button type="button" className="btn btn--small" onClick={() => onRoutes({ flow })}>Aplicar flujo a las rutas</button></>}
            <label className="field">Piezas que pasan (%)<input type="number" min="0" max="100" value={percent} onChange={(e) => setPercent(e.target.value)} /></label>
            <button type="button" className="btn btn--small" disabled={percent.trim() === ''} onClick={() => onRoutes({ frac: Number(percent) / 100 })}>Aplicar porcentaje</button>
        </>}
        {full && <button type="button" className="btn btn--ghost btn--small" onClick={remove}>Quitar selección</button>}
    </aside>
}
