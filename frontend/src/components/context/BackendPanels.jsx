import { useState } from 'react'

export function BackendTools({ remote }) {
    return <section className="cw-backend-tools" aria-label="Copia del proyecto">
        <button type="button" disabled={remote.busy} onClick={remote.saveCopy}>Guardar copia del proyecto</button>
        <button type="button" disabled={remote.busy} onClick={() => { if (window.confirm('¿Recuperar la copia guardada? Sustituye los datos locales de este proyecto.')) remote.restore() }}>Recuperar copia</button>
        <button type="button" disabled={remote.busy} onClick={remote.exportProject}>Exportar con archivos</button>
        <label>Restaurar paquete<input type="file" accept=".zip" disabled={remote.busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file && window.confirm('¿Restaurar este paquete en el proyecto actual?')) remote.importProject(file) }} /></label>
    </section>
}

export function WorkInput({ text, onChange, remote, inventory = [] }) {
    const labels = { cursograma_analitico: 'Cursograma analítico', hoja_tiempos: 'Hoja de tiempos', mapa_proceso: 'Mapa de proceso', desconocido: 'Tipo sin determinar' }
    return <section className="cw-section cw-study-input">
        <h2>Tu proceso completo, de una vez.</h2>
        <p className="cw-muted">Pega la descripción, tus observaciones o más de cien actividades. Después podrás revisar cada fila. Los tiempos que no menciones quedarán sin dato.</p>
        <label className="cw-field">Descripción del estudio<textarea rows="7" value={text || ''} onChange={(event) => onChange(event.target.value)} placeholder={'1. Recibir el material en recepción.\n2. Transportar a corte: 8 metros.\n3. Cortar la pieza: 12 minutos, observado por Laura.\nDespués del corte hay dos rutas: ensamble y acabado…'} /></label>
        <button className="cw-button" type="button" disabled={remote.busy || !text?.trim()} onClick={() => remote.interpret(text, 'studies')}>Organizar actividades del estudio →</button>
        {inventory.length > 0 && <p className="cw-muted">Tipos identificados para revisar: {[...new Set(inventory.map((item) => labels[item.type] || item.type))].join(' · ')}.</p>}
    </section>
}

export function OperatorPanel({ workspace, onChange, remote }) {
    const [selected, setSelected] = useState('')
    const files = (workspace.attachments || []).filter((f) => f.topic === 'personal' && /\.(csv|xlsx)$/i.test(f.name) && f.storage === 'server')
    const operators = workspace.operators || []
    const pending = operators.filter((o) => o.status !== 'confirmed' && o.status !== 'discarded')
    const patch = (id, changes) => onChange({ operators: operators.map((o) => o.id === id ? { ...o, ...changes, status: 'pending' } : o) })
    return <section className="cw-section">
        <h2>Operadores y asignaciones</h2><p className="cw-muted">Adjunta abajo una base CSV o XLSX. Columnas: nombre, estación o área, máquina, turno, eficiencia, valoración de ritmo y período. Un identificador de operador ayuda a distinguir nombres iguales.</p>
        <div className="cw-actions"><label className="cw-field">Base de operadores<select value={selected || files[0]?.id || ''} onChange={(event) => setSelected(event.target.value)}><option value="">Seleccionar archivo</option>{files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><button className="cw-button" type="button" disabled={remote.busy || !(selected || files[0]?.id)} onClick={() => remote.importOperators(selected || files[0].id)}>Leer base de operadores</button>{pending.length > 0 && <button className="cw-button cw-button--outline" type="button" disabled={remote.busy} onClick={() => remote.confirm(pending.map((o) => o.id), 'operators')}>Confirmar {pending.length} operadores</button>}</div>
        <p className="cw-method">Los porcentajes importados no son una eficiencia calculada. Se conserva su escala y fuente; no modifican la eficiencia global de la planta.</p>
        {workspace.operator_import?.errors?.length > 0 && <ul className="cw-muted">{workspace.operator_import.errors.map((e, i) => <li key={i}>Fila {e.row}: {e.error}</li>)}</ul>}
        {operators.length > 0 && <div className="cw-table-wrap"><table className="cw-result-table"><thead><tr><th>Operador</th><th>Estación / área</th><th>Máquina</th><th>Turno</th><th>Eficiencia aportada</th><th>Ritmo aportado</th><th>Estado</th></tr></thead><tbody>{operators.map((o) => <tr key={o.id}><td><input aria-label={`Nombre ${o.name}`} value={o.name} onChange={(event) => patch(o.id, { name: event.target.value })} /></td><td><input aria-label={`Área ${o.name}`} value={o.station || ''} onChange={(event) => patch(o.id, { station: event.target.value })} /></td><td>{o.machine || 'Sin dato'}</td><td>{o.shift || 'Sin dato'}</td><td>{o.efficiency_reported?.raw || 'Sin dato'}</td><td>{o.pace_rating?.raw || 'Sin dato'}</td><td>{o.status === 'confirmed' ? 'Confirmado' : 'Por revisar'}</td></tr>)}</tbody></table></div>}
    </section>
}

export function ReviewAssistance({ remote, onAnswer }) {
    const [answers, setAnswers] = useState({})
    return <section className="cw-section">
        <div className="cw-section-line"><h2>Lo que falta por entender</h2><button className="cw-button cw-button--outline" type="button" disabled={remote.busy} onClick={remote.review}>Actualizar revisión y estudios</button></div>
        <p className="cw-muted">Preguntas para completar lo necesario. Puedes responder con tus palabras o indicar que todavía no lo sabes.</p>
        {remote.questions.map((q) => <form key={q.id} className="cw-question" onSubmit={async (event) => { event.preventDefault(); const answer = answers[q.id]?.trim(); if (answer) { onAnswer(q, answer) } }}><label className="cw-field"><strong>{q.question}</strong><span className="cw-muted">{q.reason}</span><textarea rows="2" value={answers[q.id] || ''} onChange={(event) => setAnswers({ ...answers, [q.id]: event.target.value })} placeholder="Cuenta lo que sabes; se conservará como información aportada por ti." /></label><div className="cw-actions"><button type="submit" className="cw-button cw-button--outline" disabled={!answers[q.id]?.trim()}>Guardar respuesta</button><button type="button" className="cw-text-button" onClick={() => onAnswer(q, 'No lo sé todavía')}>No lo sé todavía</button></div></form>)}
        {remote.deliverables && <StudyDeliverables result={remote.deliverables} />}
    </section>
}

export function StudyDeliverables({ result }) {
    const status = { draft: 'Borrador', partial: 'Parcial', missing_data: 'Faltan datos' }
    return <section className="cw-section"><h2>Estudios que podemos entregar</h2><div className="cw-study-inventory">{result.studies.map((s) => <div key={s.type}><strong>{s.label}</strong><span className="cw-badge">{status[s.status] || s.status}</span>{s.reason && <p className="cw-muted">{s.reason}</p>}</div>)}</div><p className="cw-muted">{result.note}</p><p className="cw-muted">{result.totals.activities} actividades · {result.totals.known_time_rows} con tiempo conocido · {result.totals.missing_time_rows} sin tiempo.</p><div className="cw-table-wrap"><table className="cw-result-table"><thead><tr><th>Actividad</th><th>Tipo</th><th>Tiempo (min)</th><th>Distancia (m)</th><th>Origen</th></tr></thead><tbody>{result.rows.map((row) => <tr key={row.id}><td>{row.description}</td><td>{row.type}</td><td>{row.time_min ?? 'Sin dato'}</td><td>{row.distance_m ?? 'Sin dato'}</td><td>{row.source_id || row.origin}</td></tr>)}</tbody></table></div>{result.proposed_rows?.length > 0 && <><h3>Borrador del estudio propuesto</h3><p className="cw-muted">Operaciones conservadas del estudio de origen; distancias de transporte calculadas por el motor. Sus tiempos requieren validación.</p><div className="cw-table-wrap"><table className="cw-result-table"><thead><tr><th>Actividad</th><th>Tiempo (min)</th><th>Distancia (m)</th><th>Origen</th></tr></thead><tbody>{result.proposed_rows.map((row) => <tr key={row.id}><td>{row.description}</td><td>{row.time_min ?? "Sin dato"}</td><td>{row.distance_m ?? "Sin dato"}</td><td>{row.origin === "redesign_route" ? "Ruta del rediseño" : "Estudio de origen"}</td></tr>)}</tbody></table></div></>}{result.warnings.map((warning, i) => <p className="cw-muted" key={i}>{warning}</p>)}</section>
}
