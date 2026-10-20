import { useState } from 'react'
import { has } from '../capabilities'
import { FLOWS } from '../flows'
import { routesAmong } from '../groups'
import useCaps from '../useCaps'

/* Panel de la selección múltiple: lo que se hace a todas a la vez (un paso de deshacer). */
export default function GroupPanel({ plant, ids, onClear, onDelete, onLock, onRoutes }) {
    const caps = useCaps()
    const [frac, setFrac] = useState('')
    const names = plant.stations.filter((s) => ids.includes(s.id)).map((s) => s.name)
    const routes = routesAmong(plant, ids)
    const locked = plant.stations.filter((s) => ids.includes(s.id) && s.locked).length
    return (
        <aside className="inspector">
            <span className="inspector-kicker">{ids.length} máquinas seleccionadas</span>
            <p className="small">{names.join(', ')}.</p>
            <p className="small">Arrástralas juntas o usa las flechas. Ctrl+C, Ctrl+X y Ctrl+V copian, cortan y pegan con las rutas entre ellas.{locked ? ` ${locked} fija(s): no se mueven.` : ''}</p>
            <div className="row">
                <button type="button" className="btn btn--small" onClick={() => onLock(true)}>
                    Fijar todas
                </button>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => onLock(false)}>
                    Liberar todas
                </button>
            </div>
            <div className="row">
                <button type="button" className="btn btn--ghost btn--small" onClick={onDelete}>
                    Quitar
                </button>
                <button type="button" className="btn btn--ghost btn--small" onClick={onClear}>
                    Quitar selección (Esc)
                </button>
            </div>
            <div className="units-box">
                <span className="inspector-kicker">Rutas entre ellas ({routes.length})</span>
                {routes.length === 0 ? (
                    <p className="small">No hay rutas que unan dos de las seleccionadas.</p>
                ) : (
                    <>
                        {has(caps, 'flows') && (
                            <label className="field">
                                <span>Qué se mueve en todas</span>
                                <select value="" onChange={(e) => e.target.value && onRoutes({ flow: e.target.value })}>
                                    <option value="">Elegir…</option>
                                    {FLOWS.map((f) => (
                                        <option key={f.id} value={f.id}>
                                            {f.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        <label className="field">
                            <span>Piezas que pasan por todas (%)</span>
                            <span className="field-input">
                                <input type="number" min="1" max="100" step="5" value={frac} onChange={(e) => setFrac(e.target.value)} />
                            </span>
                        </label>
                        <button
                            type="button"
                            className="btn btn--small"
                            disabled={!(Number(frac) > 0 && Number(frac) <= 100)}
                            onClick={() => {
                                onRoutes({ frac: Number(frac) / 100 })
                                setFrac('')
                            }}
                        >
                            Aplicar a {routes.length} rutas
                        </button>
                    </>
                )}
            </div>
        </aside>
    )
}
