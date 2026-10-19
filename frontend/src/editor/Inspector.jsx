import { useState } from 'react'
import { fmt } from '../api'
import { has } from '../capabilities'
import { FLOWS } from '../flows'
import { ARRANGEMENTS, countOf, resize } from '../units'
import useCaps from '../useCaps'
import { bboxOf, centerOf, PART_KINDS, partLabel, shapePreset } from './geometry'

const T_SOURCES = [
  { id: 'medido', label: 'Medido' },
  { id: 'estimado', label: 'Estimado' },
  { id: 'supuesto', label: 'Supuesto' },
  { id: 'usuario', label: 'Lo indica el usuario' },
]

/* Fijar o liberar: lo fijo no se mueve en el editor ni en ninguna alternativa. */
function LockBox({ item, lock, full }) {
  const [reason, setReason] = useState('')
  if (!full || !lock) return null
  if (item.locked)
    return (
      <div className="lock-box">
        <span className="small">
          <b>Fijo.</b> {item.lock_reason || 'Sin motivo anotado.'} No se mueve ni cambia de tamaño.
        </span>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => lock(item.id, false)}>
          Liberar
        </button>
      </div>
    )
  return (
    <div className="lock-box">
      <label className="field">
        <span>Motivo para fijar (opcional)</span>
        <input value={reason} placeholder="Columna, anclado al piso, instalación de gas…" onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="button" className="btn btn--ghost btn--small" onClick={() => lock(item.id, true, reason.trim())}>
        Fijar en su lugar
      </button>
    </div>
  )
}

/* Rango de tiempo: un número o [mínimo, máximo]. */
const rangeOf = (v) => (Array.isArray(v) ? v : v != null ? [v, v] : [null, null])
const toRange = (a, b) => (a == null && b == null ? undefined : a == null || b == null || a === b ? (a ?? b) : [Math.min(a, b), Math.max(a, b)])

function Units({ s, setStation }) {
  const n = countOf(s)
  const [tmin, tmax] = rangeOf(s.t_cycle_min)
  const perUnit = n ? (Number(s.ops) || 0) / n : 0
  const set = (patch) => setStation(s.id, resize(s, patch))
  const setRaw = (patch) => setStation(s.id, patch)
  return (
    <div className="units-box">
      <span className="inspector-kicker">Máquinas y tiempos</span>
      <div className="field-row">
        <Field label="Máquinas iguales" type="number" step="1" min={1} value={n} suffix="×" onCommit={(v) => set({ count: Math.max(1, Math.round(v)) })} />
        <Field label="Operarios por máquina" type="number" step="0.5" min={0} value={Math.round(perUnit * 100) / 100} onCommit={(v) => setRaw({ ops: Math.round(v * n) })} />
      </div>
      {n > 1 && (
        <>
          <div className="field-row">
            <Field label="Ancho de cada una" type="number" step="0.1" min={0.2} value={s.unit_w ?? s.w} suffix="m" onCommit={(v) => set({ unit_w: v })} />
            <Field label="Fondo de cada una" type="number" step="0.1" min={0.2} value={s.unit_d ?? s.d} suffix="m" onCommit={(v) => set({ unit_d: v })} />
          </div>
          <label className="field">
            <span>Acomodo de las {n}</span>
            <select value={s.arrangement || 'fila'} onChange={(e) => set({ arrangement: e.target.value })}>
              {ARRANGEMENTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <div className="field-row">
        <Field label="Ciclo mínimo" type="number" step="0.5" min={0} value={tmin ?? ''} suffix="min" onCommit={(v) => setRaw({ t_cycle_min: toRange(v, tmax) })} />
        <Field label="Ciclo máximo" type="number" step="0.5" min={0} value={tmax ?? ''} suffix="min" onCommit={(v) => setRaw({ t_cycle_min: toRange(tmin, v) })} />
      </div>
      <label className="field">
        <span>De dónde sale el tiempo</span>
        <select value={s.t_source || 'supuesto'} onChange={(e) => setRaw({ t_source: e.target.value })}>
          {T_SOURCES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <div className="field-row">
        <Field label="Lote (piezas)" type="number" step="1" min={0} value={s.batch?.size ?? ''} onCommit={(v) => setRaw({ batch: v >= 1 ? { size: Math.round(v), t_min: s.batch?.t_min || s.t || 1 } : undefined })} />
        <Field label="Minutos por lote" type="number" step="5" min={0} value={s.batch?.t_min ?? ''} suffix="min" onCommit={(v) => setRaw({ batch: v > 0 ? { size: s.batch?.size || 1, t_min: v } : undefined })} />
      </div>
      <p className="small">Horno o secado: la pieza espera a que se junte el lote; el motor lo cuenta aparte del tiempo de máquina.</p>
    </div>
  )
}

function ShapeIcon({ id }) {
  const pts = id === 'poly' ? [[2, 12], [6, 1], [14, 4], [19, 0], [17, 13]] : id === 'rect' ? [[0, 0], [20, 0], [20, 14], [0, 14]] : id === 'cuadrado' ? [[3, 0], [17, 0], [17, 14], [3, 14]] : shapePreset(id, 20, 14)
  return (
    <svg viewBox="-1 -1 22 16" width="30" height="22" aria-hidden="true">
      <path d={'M' + pts.map((p) => p.join(' ')).join(' L') + ' Z'} fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/* Campo que confirma al salir o con Enter (así cada letra no es un paso de deshacer).
   La key reinicia el campo cuando el valor cambia desde fuera (deshacer, otra selección). */
function Field(props) {
  return <FieldInner key={String(props.value)} {...props} />
}

function FieldInner({ label, value, onCommit, type = 'text', step, min, suffix }) {
  const [v, setV] = useState(value)
  const done = () => {
    if (String(v) === String(value)) return
    if (type === 'number') {
      const n = Number(v)
      if (!Number.isFinite(n) || (min != null && n < min)) return setV(value)
      onCommit(n)
    } else onCommit(v)
  }
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field-input">
        <input type={type} value={v} step={step} min={min} onChange={(e) => setV(e.target.value)} onBlur={done} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        {suffix && <i>{suffix}</i>}
      </span>
    </label>
  )
}

/* Avisos de la suma de piezas que no se pueden representar con un solo contorno. */
function PartWarnings({ comp }) {
  if (!comp || (!comp.islands && !comp.inner)) return null
  return (
    <ul className="note-list">
      {comp.islands > 0 && <li>Hay piezas que no tocan al resto: solo cuenta la parte más grande. Júntalas para que formen un solo edificio.</li>}
      {comp.inner > 0 && <li>Un hueco encerrado (patio interior) no se puede representar: llévalo hasta un borde para recortar el edificio.</li>}
    </ul>
  )
}

const partSize = (p) => {
  if (p.kind !== 'poly') return { w: p.w, d: p.d, x: p.x, z: p.z }
  const b = bboxOf(p.pts)
  const [x, z] = centerOf(p.pts)
  return { w: Math.round((b.x1 - b.x0) * 100) / 100, d: Math.round((b.z1 - b.z0) * 100) / 100, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 }
}

/* Sólido suma al edificio; hueco le recorta un pedazo. */
function SolidHole({ hole, onChange }) {
  return (
    <div className="seg seg--inline" role="group" aria-label="Sólido o hueco">
      <button type="button" aria-pressed={!hole} onClick={() => onChange(false)}>
        Sólido (suma)
      </button>
      <button type="button" aria-pressed={hole} onClick={() => onChange(true)}>
        Hueco (recorta)
      </button>
    </div>
  )
}

export default function Inspector({ plant, positions, sel, setSel, commit, rotate, remove, catalog, full, live, duplicate, ops, outside = 0, tool, parts = [], comp, shape, lock, group, selectFamily }) {
  const caps = useCaps()
  const names = Object.fromEntries(plant.stations.map((s) => [s.id, s.name]))
  const setStation = (id, patch) => commit({ ...plant, stations: plant.stations.map((s) => (s.id === id ? { ...s, ...patch } : s)) }, positions)
  const setZone = (id, patch) => commit({ ...plant, zones: plant.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) }, positions)
  const setConveyor = (id, patch) => commit({ ...plant, conveyors: (plant.conveyors || []).map((c) => (c.id === id ? { ...c, ...patch } : c)) }, positions)
  const setRoute = (id, patch) => commit({ ...plant, routes: plant.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)) }, positions)
  const setGate = (id, patch) => commit({ ...plant, gates: plant.gates.map((g) => (g.id === id ? { ...g, ...patch } : g)) }, positions)

  const del = full && (
    <button type="button" className="btn btn--ghost btn--small" onClick={remove}>
      Quitar
    </button>
  )

  const dup = full && (
    <button type="button" className="btn btn--ghost btn--small" onClick={duplicate} title="Ctrl+C y Ctrl+V copian y pegan; Ctrl+D duplica">
      Duplicar
    </button>
  )

  /* ---------- Una pieza del edificio ---------- */
  if ((sel?.type === 'part' || sel?.type === 'pvertex') && full) {
    const p = parts.find((q) => q.id === sel.id)
    if (!p) return <aside className="inspector" />
    const m = partSize(p)
    const vq = sel.type === 'pvertex' ? p.pts?.[sel.i] : null
    return (
      <aside className="inspector">
        <span className="inspector-kicker">{p.hole ? 'Hueco · recorta el edificio' : 'Pieza del edificio'}</span>
        <h3>{partLabel(p)}</h3>
        <SolidHole hole={!!p.hole} onChange={(h) => h !== !!p.hole && ops.toggleHole(p.id)} />
        <div className="field-row">
          <Field label="Ancho" type="number" step="0.1" min={0.5} value={m.w} suffix="m" onCommit={(v) => ops.sizePart(p.id, v, p.kind === 'cuadrado' ? v : m.d)} />
          <Field label="Fondo" type="number" step="0.1" min={0.5} value={m.d} suffix="m" onCommit={(v) => ops.sizePart(p.id, p.kind === 'cuadrado' ? v : m.w, v)} />
        </div>
        <div className="field-row">
          <Field label="Centro X" type="number" step="0.1" value={m.x} suffix="m" onCommit={(v) => ops.centerPart(p.id, v, m.z)} />
          <Field label="Centro Z" type="number" step="0.1" value={m.z} suffix="m" onCommit={(v) => ops.centerPart(p.id, m.x, v)} />
        </div>
        {p.kind !== 'poly' && <Field label="Giro" type="number" step="1" value={p.rot || 0} suffix="°" onCommit={(v) => ops.setPart(p.id, { rot: ((v % 360) + 360) % 360 })} />}
        {vq && (
          <>
            <span className="small">Esquina seleccionada</span>
            <div className="field-row">
              <Field label="X" type="number" step="0.1" value={vq[0]} suffix="m" onCommit={(v) => ops.movePVertex(p.id, sel.i, v, vq[1])} />
              <Field label="Z" type="number" step="0.1" value={vq[1]} suffix="m" onCommit={(v) => ops.movePVertex(p.id, sel.i, vq[0], v)} />
            </div>
          </>
        )}
        <div className="row">
          <button type="button" className="btn btn--small" onClick={() => ops.rotatePart(p.id, 90)}>
            Girar 90° (R)
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => ops.duplicatePart(p.id)} title="Ctrl+D">
            Duplicar
          </button>
          {vq ? (
            <button type="button" className="btn btn--ghost btn--small" onClick={() => ops.removePVertex(p.id, sel.i)} disabled={p.pts.length <= 3}>
              Quitar esquina
            </button>
          ) : (
            <button type="button" className="btn btn--ghost btn--small" onClick={() => ops.removePart(p.id)} title="Supr">
              Quitar pieza
            </button>
          )}
        </div>
        <p className="small">
          Arrástrala para moverla; las manijas cambian el tamaño y el círculo de arriba la gira. Las flechas la mueven un paso de la precisión elegida.
          {p.kind === 'poly' && ' Arrastra sus esquinas; doble clic en un lado agrega una, doble clic en una esquina la quita.'}
        </p>
        <PartWarnings comp={comp} />
      </aside>
    )
  }

  /* ---------- Forma: agregar piezas (como en TinkerCAD) ---------- */
  if (tool === 'shape' && full) {
    return (
      <aside className="inspector">
        <span className="inspector-kicker">Forma del edificio</span>
        <p className="small">El edificio es la suma de sus piezas. Elige una forma y haz clic en el plano para colocarla: se agrega a lo que ya hay, sin reiniciar nada. Un hueco recorta una sección.</p>
        <SolidHole hole={shape.addHole} onChange={shape.setHole} />
        <div className="shape-grid">
          {PART_KINDS.map((k) => (
            <button key={k.id} type="button" className="shape-btn" aria-pressed={shape.arm?.kind === k.id} onClick={() => (shape.cancel(), shape.setArm({ kind: k.id, hole: shape.addHole }))} title={`${k.label}: clic aquí y luego en el plano`}>
              <ShapeIcon id={k.id} />
              <span>{k.label}</span>
            </button>
          ))}
          <button type="button" className="shape-btn" aria-pressed={!!shape.pen} onClick={() => shape.startPen(shape.addHole)} title="Dibuja una pieza esquina por esquina">
            <ShapeIcon id="poly" />
            <span>A mano</span>
          </button>
        </div>
        <div className="inspector-list">
          <span className="small">Piezas ({parts.length})</span>
          {parts.map((p, i) => {
            const m = partSize(p)
            return (
              <button key={p.id} type="button" className="link-btn" onClick={() => setSel({ type: 'part', id: p.id })}>
                {i + 1}. {p.hole ? 'Hueco' : partLabel(p)} · {fmt(m.w, 1)} × {fmt(m.d, 1)} m
              </button>
            )
          })}
        </div>
        <PartWarnings comp={comp} />
      </aside>
    )
  }

  if (sel?.type === 'station') {
    const s = plant.stations.find((q) => q.id === sel.id)
    if (!s) return <aside className="inspector" />
    const kind = catalog?.kinds.find((k) => k.id === s.kind)
    const ins = plant.routes.filter((r) => r.to === s.id)
    const outs = plant.routes.filter((r) => r.from === s.id)
    return (
      <aside className="inspector">
        <span className="inspector-kicker">Máquina o área</span>
        {full ? <Field label="Nombre" value={s.name} onCommit={(v) => setStation(s.id, { name: v.trim() || s.name })} /> : <h3>{s.name}</h3>}
        {full && (
          <label className="field">
            <span>Tipo (maqueta 3D)</span>
            <select
              value={s.kind}
              onChange={(e) => {
                const k = catalog.kinds.find((q) => q.id === e.target.value)
                const wasDefault = kind && s.name.startsWith(kind.name)
                setStation(s.id, { kind: k.id, ...(wasDefault ? { name: k.name } : {}) })
              }}
            >
              {catalog?.kinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {full && !s.locked && (
          <div className="field-row">
            <Field label="Ancho" type="number" step="0.5" min={0.5} value={s.w} suffix="m" onCommit={(v) => setStation(s.id, { w: v })} />
            <Field label="Fondo" type="number" step="0.5" min={0.5} value={s.d} suffix="m" onCommit={(v) => setStation(s.id, { d: v })} />
          </div>
        )}
        {full && !s.locked && positions[s.id] && (
          <div className="field-row">
            <Field label="Centro X" type="number" step="0.1" value={positions[s.id][0]} suffix="m" onCommit={(v) => ops.moveStation(s.id, v, positions[s.id][1])} />
            <Field label="Centro Z" type="number" step="0.1" value={positions[s.id][1]} suffix="m" onCommit={(v) => ops.moveStation(s.id, positions[s.id][0], v)} />
          </div>
        )}
        <div className="row">
          {!s.locked && (
            <button type="button" className="btn btn--small" onClick={() => rotate(s.id)}>
              Girar 90° (R)
            </button>
          )}
          {dup}
          {!s.locked && del}
        </div>
        {countOf(s) > 1 && group && (
          <button type="button" className="link-btn small" onClick={() => group.toggle(s)}>
            {group.isCollapsed(s) ? `Ver las ${countOf(s)} máquinas` : `Ver como un bloque ×${countOf(s)}`}
          </button>
        )}
        {s.family && (
          <p className="small">
            Rama {s.lane} de {plant.stations.filter((q) => q.family === s.family).length} de <b>{s.family_name || 'su familia'}</b>.{' '}
            {selectFamily && (
              <button type="button" className="link-btn small" onClick={() => selectFamily(s.family)}>
                Seleccionar todas
              </button>
            )}
          </p>
        )}
        <LockBox item={s} lock={lock} full={full} />
        {full && has(caps, 'count') && !s.locked && <Units s={s} setStation={setStation} />}
        {full && (
          <div className="inspector-list">
            <span className="small">Le llega de</span>
            {ins.length ? ins.map((r) => <button key={r.id} type="button" className="link-btn" onClick={() => setSel({ type: 'route', id: r.id })}>{names[r.from]}</button>) : <span className="small">nadie (es un inicio)</span>}
            <span className="small">Pasa a</span>
            {outs.length ? outs.map((r) => <button key={r.id} type="button" className="link-btn" onClick={() => setSel({ type: 'route', id: r.id })}>{names[r.to]}</button>) : <span className="small">nadie (es un final)</span>}
          </div>
        )}
      </aside>
    )
  }

  if (sel?.type === 'route') {
    const r = plant.routes.find((q) => q.id === sel.id)
    if (!r) return <aside className="inspector" />
    const leg = live.legs?.find((l) => l.id === r.id)
    return (
      <aside className="inspector">
        <span className="inspector-kicker">Ruta del material</span>
        <label className="field">
          <span>Sale de</span>
          <select value={r.from} onChange={(e) => setRoute(r.id, { from: e.target.value })}>
            {plant.stations.map((s) => (
              <option key={s.id} value={s.id} disabled={s.id === r.to}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Llega a</span>
          <select value={r.to} onChange={(e) => setRoute(r.id, { to: e.target.value })}>
            {plant.stations.map((s) => (
              <option key={s.id} value={s.id} disabled={s.id === r.from}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <Field label="Piezas que pasan por aquí" type="number" step="5" min={1} value={Math.round((r.frac ?? 1) * 100)} suffix="%" onCommit={(v) => setRoute(r.id, { frac: Math.min(100, v) / 100 })} />
        {has(caps, 'flows') && (
          <>
            <label className="field">
              <span>Qué se mueve</span>
              <select value={r.flow || 'material'} onChange={(e) => setRoute(r.id, { flow: e.target.value })}>
                {FLOWS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--check">
              <input type="checkbox" checked={!!r.is_return} onChange={(e) => setRoute(r.id, { is_return: e.target.checked })} />
              <span>Es un retorno (regresa a una estación anterior: retrabajo, otra prueba)</span>
            </label>
            <label className="field field--check">
              <input type="checkbox" checked={!!r.component} onChange={(e) => setRoute(r.id, { component: e.target.checked })} />
              <span>Es un componente que se junta (ensamble: el núcleo que entra al armado no suma piezas)</span>
            </label>
          </>
        )}
        {has(caps, 'conveyors') && (plant.conveyors || []).length > 0 && (
          <label className="field">
            <span>Va en banda</span>
            <select value={r.conveyor || ''} onChange={(e) => setRoute(r.id, { conveyor: e.target.value || null })}>
              <option value="">No, se lleva a mano</option>
              {plant.conveyors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.id}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="row">
          <button type="button" className="btn btn--small" onClick={() => setRoute(r.id, { from: r.to, to: r.from })}>
            Invertir dirección
          </button>
          {del}
        </div>
        {leg && (
          <p className="small">
            {leg.ok ? `${fmt(leg.dist, 1)} m por viaje, por los pasillos.` : 'No hay paso libre entre estas dos: revisa paredes y zonas. Se cuenta en línea recta.'}
          </p>
        )}
      </aside>
    )
  }

  if (sel?.type === 'conveyor') {
    const c = (plant.conveyors || []).find((q) => q.id === sel.id)
    if (!c) return <aside className="inspector" />
    const len = (c.points || []).slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - c.points[i][0], p[1] - c.points[i][1]), 0)
    const used = plant.routes.filter((r) => r.conveyor === c.id)
    return (
      <aside className="inspector">
        <span className="inspector-kicker">Banda transportadora</span>
        <Field label="Nombre" value={c.name || ''} onCommit={(v) => setConveyor(c.id, { name: v.trim() || c.name })} />
        <p className="small num">Largo: {fmt(len, 1)} m.</p>
        <div className="field-row">
          <Field label="Capacidad" type="number" step="0.5" min={0} value={c.capacity_ppm ?? ''} suffix="pzs/min" onCommit={(v) => setConveyor(c.id, { capacity_ppm: v })} />
          <Field label="Velocidad" type="number" step="0.5" min={0.1} value={c.speed_mpm ?? ''} suffix="m/min" onCommit={(v) => setConveyor(c.id, { speed_mpm: v })} />
        </div>
        {['from', 'to'].map((end) => (
          <label key={end} className="field">
            <span>{end === 'from' ? 'Recibe de' : 'Entrega a'}</span>
            <select value={c[end] || ''} onChange={(e) => setConveyor(c.id, { [end]: e.target.value || null })}>
              <option value="">Ninguna</option>
              {plant.stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <p className="small">{used.length ? `La usan ${used.length} ${used.length === 1 ? 'ruta' : 'rutas'}.` : 'Ninguna ruta va en esta banda: elige «Va en banda» en una ruta.'} Capacidad y velocidad iniciales son supuestos; cámbialos por los de la banda real.</p>
        <div className="row">{!c.locked && del}</div>
        <LockBox item={c} lock={lock} full={full} />
      </aside>
    )
  }

  if (sel?.type === 'zone') {
    const z = plant.zones.find((q) => q.id === sel.id)
    if (!z) return <aside className="inspector" />
    return (
      <aside className="inspector">
        <span className="inspector-kicker">Zona sin paso de material</span>
        <Field label="Nombre" value={z.name} onCommit={(v) => setZone(z.id, { name: v.trim() || z.name })} />
        <label className="field">
          <span>Tipo</span>
          <select value={z.kind} onChange={(e) => setZone(z.id, { kind: e.target.value })}>
            {catalog?.zones.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        {!z.locked && (
          <>
            <div className="field-row">
              <Field label="Ancho" type="number" step="0.5" min={1} value={z.w} suffix="m" onCommit={(v) => setZone(z.id, { w: v })} />
              <Field label="Fondo" type="number" step="0.5" min={1} value={z.d} suffix="m" onCommit={(v) => setZone(z.id, { d: v })} />
            </div>
            <div className="field-row">
              <Field label="Centro X" type="number" step="0.1" value={z.x} suffix="m" onCommit={(v) => setZone(z.id, { x: v })} />
              <Field label="Centro Z" type="number" step="0.1" value={z.z} suffix="m" onCommit={(v) => setZone(z.id, { z: v })} />
            </div>
          </>
        )}
        {!z.locked && <p className="small">Arrastra una esquina para cambiar el tamaño.</p>}
        <div className="row">
          {dup}
          {!z.locked && del}
        </div>
        <LockBox item={z} lock={lock} full />
      </aside>
    )
  }

  if (sel?.type === 'wall') {
    const w = plant.walls.find((q) => q.id === sel.id)
    if (!w) return <aside className="inspector" />
    const len = Math.round(Math.hypot(w.x2 - w.x1, w.z2 - w.z1) * 100) / 100
    return (
      <aside className="inspector">
        <span className="inspector-kicker">Pared interior</span>
        <Field label="Largo (se mueve el extremo final)" type="number" step="0.1" min={0.3} value={len} suffix="m" onCommit={(v) => ops.setWallLength(w.id, v)} />
        <span className="small">Inicio</span>
        <div className="field-row">
          <Field label="X" type="number" step="0.1" value={w.x1} suffix="m" onCommit={(v) => ops.setWall(w.id, { x1: v })} />
          <Field label="Z" type="number" step="0.1" value={w.z1} suffix="m" onCommit={(v) => ops.setWall(w.id, { z1: v })} />
        </div>
        <span className="small">Final</span>
        <div className="field-row">
          <Field label="X" type="number" step="0.1" value={w.x2} suffix="m" onCommit={(v) => ops.setWall(w.id, { x2: v })} />
          <Field label="Z" type="number" step="0.1" value={w.z2} suffix="m" onCommit={(v) => ops.setWall(w.id, { z2: v })} />
        </div>
        <p className="small">El material no la cruza. Arrastra sus extremos para alargarla o girarla; se pegan a esquinas y muros cercanos.</p>
        <div className="row">
          <button type="button" className="btn btn--small" onClick={() => ops.splitWall(w.id)} title="La parte en dos tramos para poder borrar solo uno">
            Dividir en dos
          </button>
          {dup}
          {del}
        </div>
      </aside>
    )
  }

  if (sel?.type === 'gate') {
    const g = plant.gates.find((q) => q.id === sel.id)
    if (!g) return <aside className="inspector" />
    return (
      <aside className="inspector">
        <span className="inspector-kicker">Portón</span>
        <Field label="Nombre" value={g.label} onCommit={(v) => setGate(g.id, { label: v })} />
        {!g.locked && <p className="small">Arrástralo por cualquier muro exterior. En 3D la calle aparece frente a cada lado con portón.</p>}
        <div className="row">
          <button type="button" className="btn btn--small" aria-pressed={plant.receive_gate === g.id} onClick={() => commit({ ...plant, receive_gate: g.id }, positions)}>
            {plant.receive_gate === g.id ? 'Entra por aquí' : 'Que entre por aquí'}
          </button>
          <button type="button" className="btn btn--small" aria-pressed={plant.dispatch_gate === g.id} onClick={() => commit({ ...plant, dispatch_gate: g.id }, positions)}>
            {plant.dispatch_gate === g.id ? 'Sale por aquí' : 'Que salga por aquí'}
          </button>
        </div>
        <div className="row">{plant.gates.length > 1 && !g.locked && del}</div>
        <LockBox item={g} lock={lock} full={full} />
      </aside>
    )
  }

  return (
    <aside className="inspector">
      <span className="inspector-kicker">{full ? 'Bodega' : 'Rediseño'}</span>
      {full && (
        <>
          <Field label="Nombre de la planta" value={plant.name} onCommit={(v) => commit({ ...plant, name: v })} />
          <p className="small num">
            Bodega de {fmt(plant.size.w, 1)} × {fmt(plant.size.d, 1)} m, armada con {parts.length} {parts.length === 1 ? 'pieza' : 'piezas'}. Para cambiar la forma usa la herramienta Forma (F).
          </p>
        </>
      )}
      <ul className="note-list">
        <li>
          {plant.stations.length} máquinas, {plant.routes.length} rutas, {plant.zones.length} zonas y {plant.walls.length} paredes.
        </li>
        {outside > 0 && <li>{outside === 1 ? 'Una máquina quedó' : `${outside} máquinas quedaron`} fuera del contorno: muévelas adentro.</li>}
        {live.blocked_legs > 0 && <li>{live.blocked_legs} rutas no encuentran paso libre (líneas punteadas finas).</li>}
        {live.avoid_hits?.map((h, i) => (
          <li key={i}>{h.text}: el polvo, ruido o calor afecta esa área.</li>
        ))}
      </ul>
      <p className="small">
        {full
          ? `Selecciona algo para editarlo. Supr borra, R gira, Ctrl+C y Ctrl+V copian y pegan, Ctrl+Z deshace. Las rutas se calculan por los pasillos, sin cruzar máquinas, paredes ni zonas.`
          : 'Arrastra las máquinas y gíralas con R. Los cambios se guardan como tu rediseño.'}
      </p>
    </aside>
  )
}
