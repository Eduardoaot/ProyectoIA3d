import { useId, useState } from 'react'
import { displayEntry, entryLabel } from '../../contextWorkspace'
import './work-studies.css'

const TYPES = [
    { id: 'operacion', label: 'Operación', symbol: '○' },
    { id: 'transporte', label: 'Transporte', symbol: '→' },
    { id: 'inspeccion', label: 'Inspección', symbol: '□' },
    { id: 'espera', label: 'Espera', symbol: 'D' },
    { id: 'almacenamiento', label: 'Almacenamiento', symbol: '▽' },
]

const newId = () => globalThis.crypto?.randomUUID?.() || `actividad-${Date.now()}-${Math.random().toString(36).slice(2)}`
const optionalNumber = (value) => value === '' ? '' : Math.max(0, Number(value))

// Los proyectos anteriores pueden tener arcos sin id. Esta referencia local no
// modifica el plano y permanece estable al reordenar arcos de otras conexiones.
function studyRoutes(routes = []) {
    const occurrences = new Map()
    return routes.map((route) => {
        const connection = JSON.stringify([route.from, route.to, route.flow || 'material'])
        const ordinal = (occurrences.get(connection) || 0) + 1
        occurrences.set(connection, ordinal)
        return { ...route, id: String(route.id || `route:${connection}:${ordinal}`) }
    })
}

export default function WorkStudies({ plant, activities = [], attachments = [], notes = [], onChange, onAttach }) {
    const prefix = useId()
    const [expanded, setExpanded] = useState(null)
    const stations = plant?.stations || []
    const routes = studyRoutes(plant?.routes)
    const studies = attachments.filter((file) => file.topic === 'estudios')
    const stationName = (id) => stations.find((station) => station.id === id)?.name || id
    const sorted = [...activities].sort((a, b) => (a.sequence === '' ? Infinity : Number(a.sequence)) - (b.sequence === '' ? Infinity : Number(b.sequence)))
    const patch = (id, changes) => onChange(activities.map((activity) => activity.id === id ? { ...activity, ...changes } : activity))

    function addActivity() {
        const sequence = Math.max(0, ...activities.map((activity) => Number(activity.sequence) || 0)) + 1
        const id = newId()
        onChange([...activities, {
            id, sequence, type: 'operacion', description: '',
            time: '', timeUnit: 'min', distance: '', stationId: '', routeId: '', sourceId: '',
        }])
        setExpanded(id)
    }

    return (
        <section className="work-studies" aria-label="Actividades del estudio del trabajo">
            <div className="work-studies__intro">
                <div>
                    <h3>Del documento al proceso</h3>
                    <p>Reúne tus hojas de tiempos, cursogramas y métodos. Registra las actividades conocidas y relaciónalas con el plano.</p>
                </div>
                <button className="btn btn--small btn--ghost" type="button" onClick={onAttach}>Adjuntar estudio</button>
            </div>

            <div className="work-studies__note">
                <b>Borrador para revisión.</b> La captura es manual por ahora. Deja vacíos los tiempos y las distancias que no conozcas; adjuntar un estudio no confirma sus datos.
            </div>

            {studies.length > 0 && (
                <div className="work-studies__sources">
                    <span className="work-studies__eyebrow">Documentos disponibles como fuente</span>
                    {studies.map((file) => (
                        <div key={file.id} className="work-studies__source">
                            <strong>{file.name}</strong>
                            <span>{file.status === 'text_extracted' ? 'Texto extraído · sin validar' : 'Adjunto · pendiente de lectura'}</span>
                        </div>
                    ))}
                </div>
            )}

            {notes.length > 0 && <div className="work-studies__sources"><span className="work-studies__eyebrow">Información confirmada sobre estudios</span>{notes.map((entry) => <div className="work-studies__source" key={entry.id}><strong>{entryLabel(entry)}</strong><span>{displayEntry(entry)}</span></div>)}</div>}

            <div className="work-studies__heading">
                <div>
                    <h3>Actividades</h3>
                    <p className="small">{activities.length ? `${activities.length} registradas · cambios guardados en este navegador` : 'Empieza con una actividad y completa solo lo que sepas.'}</p>
                </div>
                <button className="btn btn--small" type="button" onClick={addActivity}>+ Agregar actividad</button>
            </div>

            {!activities.length && (
                <div className="work-studies__empty">
                    <div className="work-studies__symbols" aria-hidden="true">○ <span>→</span> □ <span>D</span> ▽</div>
                    <strong>Tu estudio empieza aquí</strong>
                    <p>Operación, transporte, inspección, espera o almacenamiento. Cada actividad conserva su fuente.</p>
                </div>
            )}

            <div className="work-studies__activities">
                {sorted.map((activity, index) => {
                    const id = `${prefix}-${activity.id}`
                    const type = TYPES.find((item) => item.id === activity.type) || TYPES[0]
                    const stationMissing = activity.stationId && !stations.some((station) => station.id === activity.stationId)
                    const routeMissing = activity.routeId && !routes.some((route) => route.id === activity.routeId)
                    const sourceMissing = activity.sourceId && !studies.some((file) => file.id === activity.sourceId)
                    return (
                        <article key={activity.id} className="work-studies__activity" aria-label={`Actividad ${index + 1}`}>
                            <button type="button" className="work-studies__activity-top" aria-expanded={expanded === activity.id} onClick={() => setExpanded(expanded === activity.id ? null : activity.id)}>
                                <span className="work-studies__step">{String(activity.sequence || index + 1).padStart(2, '0')}</span>
                                <span className="work-studies__activity-symbol" aria-hidden="true">{type.symbol}</span>
                                <strong>{activity.description || `Actividad ${index + 1}`}</strong>
                                <span className="work-studies__activity-kind">{type.label}</span>
                                {activity.time !== '' && activity.time != null && <span className="work-studies__activity-kind">{activity.time} {activity.timeUnit || 'min'}</span>}
                                <span className="work-studies__activity-expand" aria-hidden="true">{expanded === activity.id ? '−' : '+'}</span>
                            </button>
                            {expanded === activity.id && <div className="work-studies__fields">
                                <label htmlFor={`${id}-sequence`} className="work-studies__field work-studies__field--sequence">
                                    Secuencia
                                    <input id={`${id}-sequence`} type="number" min="1" step="1" value={activity.sequence ?? ''} onChange={(event) => patch(activity.id, { sequence: event.target.value === '' ? '' : Math.max(1, Math.round(Number(event.target.value))) })} />
                                </label>
                                <label htmlFor={`${id}-type`} className="work-studies__field work-studies__field--type">
                                    Tipo
                                    <select id={`${id}-type`} value={activity.type} onChange={(event) => patch(activity.id, { type: event.target.value })}>
                                        {TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                                    </select>
                                </label>
                                <label htmlFor={`${id}-description`} className="work-studies__field work-studies__field--description">
                                    Qué sucede
                                    <input id={`${id}-description`} type="text" placeholder="Ej. Revisar el acabado de la pieza" value={activity.description || ''} onChange={(event) => patch(activity.id, { description: event.target.value })} />
                                </label>
                                <div className="work-studies__time">
                                    <label htmlFor={`${id}-time`} className="work-studies__field">
                                        Tiempo
                                        <input id={`${id}-time`} type="number" min="0" step="any" placeholder="Sin dato" value={activity.time ?? ''} onChange={(event) => patch(activity.id, { time: optionalNumber(event.target.value) })} />
                                    </label>
                                    <label htmlFor={`${id}-timeUnit`} className="work-studies__field">
                                        Unidad
                                        <select id={`${id}-timeUnit`} value={activity.timeUnit || 'min'} onChange={(event) => patch(activity.id, { timeUnit: event.target.value })}>
                                            <option value="s">seg</option>
                                            <option value="min">min</option>
                                            <option value="h">h</option>
                                        </select>
                                    </label>
                                </div>
                                <label htmlFor={`${id}-distance`} className="work-studies__field work-studies__field--distance">
                                    Distancia (m)
                                    <input id={`${id}-distance`} type="number" min="0" step="any" placeholder="Sin dato" value={activity.distance ?? ''} onChange={(event) => patch(activity.id, { distance: optionalNumber(event.target.value) })} />
                                </label>
                                <label htmlFor={`${id}-station`} className="work-studies__field work-studies__field--link">
                                    Estación del plano
                                    <select id={`${id}-station`} value={activity.stationId || ''} onChange={(event) => patch(activity.id, { stationId: event.target.value })}>
                                        <option value="">Sin vincular</option>
                                        {stationMissing && <option value={activity.stationId}>Estación no disponible ({activity.stationId})</option>}
                                        {stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
                                    </select>
                                </label>
                                <label htmlFor={`${id}-route`} className="work-studies__field work-studies__field--link">
                                    Ruta del plano
                                    <select id={`${id}-route`} value={activity.routeId || ''} onChange={(event) => patch(activity.id, { routeId: event.target.value })}>
                                        <option value="">Sin vincular</option>
                                        {routeMissing && <option value={activity.routeId}>Ruta no disponible ({activity.routeId})</option>}
                                        {routes.map((route) => <option key={route.id} value={route.id}>{stationName(route.from)} → {stationName(route.to)}</option>)}
                                    </select>
                                </label>
                                <label htmlFor={`${id}-source`} className="work-studies__field work-studies__field--source">
                                    Fuente del dato
                                    <select id={`${id}-source`} value={activity.sourceId || ''} onChange={(event) => patch(activity.id, { sourceId: event.target.value })}>
                                        <option value="">Captura manual</option>
                                        {sourceMissing && <option value={activity.sourceId}>Documento no disponible</option>}
                                        {studies.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
                                    </select>
                                </label>
                            </div>}
                            {expanded === activity.id && <div className="work-studies__activity-actions"><button type="button" className="work-studies__remove" onClick={() => { onChange(activities.filter((item) => item.id !== activity.id)); setExpanded(null) }} aria-label={`Eliminar actividad ${index + 1}`}>Eliminar actividad</button></div>}
                            {(stationMissing || routeMissing || sourceMissing) && <p className="work-studies__missing" role="status">Una referencia ya no está disponible. Revísala antes de usar este estudio.</p>}
                        </article>
                    )
                })}
            </div>

            {activities.length > 0 && <p className="small">Las filas siguen el orden indicado. Este borrador requiere revisión y aún no representa ramas ni uniones del proceso.</p>}
        </section>
    )
}
