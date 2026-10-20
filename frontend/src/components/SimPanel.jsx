import { useState } from 'react'
import { api } from '../api'
import { has } from '../capabilities'
import { bandText, DOWNTIME, topUtilization } from '../simText'
import useCaps from '../useCaps'

/* Simulación (solo si el backend anuncia `simulate`): valida la opción elegida con
   variabilidad. Muestra rangos P10–P90 y «sin datos» para lo que no se puede calcular. */
export default function SimPanel({ plant, choice, name, positions }) {
    const caps = useCaps()
    const [state, setState] = useState({ busy: false, out: null, error: null, key: null })
    if (!has(caps, 'simulate')) return null

    const key = `${choice || 'hoy'}`
    const run = async () => {
        setState({ busy: true, out: null, error: null, key })
        try {
            const out = await api.simulate(plant, choice || 'hoy', choice ? positions : null)
            setState({ busy: false, out, error: null, key })
        } catch {
            setState({ busy: false, out: null, error: 'No se pudo simular.', key })
        }
    }
    const out = state.key === key ? state.out : null
    const k = out?.kpis
    const names = Object.fromEntries(plant.stations.map((s) => [s.id, s.name]))

    return (
        <div className="block sim">
            <h3>Simulación con variabilidad</h3>
            <p className="small">Recorre muchos días con tiempos que varían dentro de sus rangos para ver qué tan firme es el resultado de «{name || 'Hoy'}». Las fórmulas dan el número rápido; la simulación lo pone a prueba.</p>
            <div className="row">
                <button type="button" className="btn btn--small" onClick={run} disabled={state.busy}>
                    {state.busy ? 'Simulando…' : 'Simular 30 réplicas'}
                </button>
                {out && <span className="small">Semilla {out.seed} · {out.replicas} réplicas de {out.days} días · el mismo caso da el mismo resultado.</span>}
            </div>
            {state.error && <p className="small">{state.error}</p>}
            {out && !k?.piezas_dia && <p className="small">{(out.notes || []).join(' ')}</p>}
            {k?.piezas_dia && (
                <div className="sim-grid small">
                    <div>
                        <b>Piezas al día</b>
                        <span>{bandText(k.piezas_dia)}</span>
                    </div>
                    <div>
                        <b>Tiempo por pieza</b>
                        <span>{bandText(k.lead_time_min, 'h', 1, 1 / 60)}</span>
                    </div>
                    <div>
                        <b>Piezas en proceso (WIP)</b>
                        <span>{bandText(k.wip)}</span>
                    </div>
                    <div>
                        <b>Takt</b>
                        <span>{k.takt_min != null ? `${k.takt_min.toLocaleString('es-CO')} min por pieza` : 'sin datos'}</span>
                    </div>
                    <div>
                        <b>OEE</b>
                        <span>{bandText(k.oee, '%', 0, 100)}</span>
                    </div>
                    <div>
                        <b>Cuello de botella</b>
                        <span>{names[out.bottleneck] || 'sin datos'}</span>
                    </div>
                    <div className="sim-wide">
                        <b>Tiempo muerto (min al día)</b>
                        <ul>
                            {DOWNTIME.map((d) => (
                                <li key={d.key}>
                                    {d.label}: {bandText(k.tiempo_muerto?.[d.key], 'min', 0)}
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="sim-wide">
                        <b>Utilización</b>
                        <ul>
                            {topUtilization(k.utilizacion, names).map((u) => (
                                <li key={u.id}>
                                    {u.name}: {u.text}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    )
}
