import { useState } from 'react'
import { fmt } from '../api'
import { bboxOf, outlineOf, scaleOutline, shapePreset } from './geometry'

const SHAPES = [
  { id: 'rect', label: 'Rectángulo' },
  { id: 'cuadrado', label: 'Cuadrado' },
  { id: 'L', label: 'En L' },
  { id: 'U', label: 'En U' },
  { id: 'T', label: 'En T' },
  { id: 'triangulo', label: 'Triángulo' },
  { id: 'circulo', label: 'Círculo' },
]

/* Forma de la planta (un solo piso): formas base, expandir o encoger desde el centro y medidas. */
function ShapeControls({ plant, reshape }) {
  const { w: W, d: D } = plant.size
  const outline = outlineOf(plant)
  const pick = (id) => {
    if (id === 'rect') return reshape(null)
    if (id === 'cuadrado') {
      const side = Math.max(W, D)
      return reshape(null, { w: side, d: side })
    }
    reshape(shapePreset(id, W, D))
  }
  // Cambiar ancho o fondo estira la forma actual en esa dirección.
  const resize = (w, d) => {
    if (!plant.outline) return reshape(null, { w, d })
    const b = bboxOf(outline)
    const kx = w / (b.x1 - b.x0 || 1)
    const kz = d / (b.z1 - b.z0 || 1)
    reshape(outline.map(([x, z]) => [Math.round((b.x0 + (x - b.x0) * kx) * 100) / 100, Math.round((b.z0 + (z - b.z0) * kz) * 100) / 100]))
  }
  return (
    <div className="shape-tools">
      <span className="small">Forma de la planta (un solo piso)</span>
      <div className="shape-grid">
        {SHAPES.map((x) => (
          <button key={x.id} type="button" className="shape-btn" onClick={() => pick(x.id)} title={x.label}>
            <ShapeIcon id={x.id} />
            <span>{x.label}</span>
          </button>
        ))}
      </div>
      <div className="row">
        <button type="button" className="btn btn--ghost btn--small" onClick={() => reshape(scaleOutline(outline, 1 / 1.1))}>
          Encoger 10 %
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => reshape(scaleOutline(outline, 1.1))}>
          Expandir 10 %
        </button>
      </div>
      <div className="field-row">
        <Field label="Ancho" type="number" step="1" min={8} value={W} suffix="m" onCommit={(v) => resize(v, D)} />
        <Field label="Fondo" type="number" step="1" min={6} value={D} suffix="m" onCommit={(v) => resize(W, v)} />
      </div>
      <p className="small">Con la herramienta Forma (F) arrastras esquinas y lados, o creas esquinas nuevas.</p>
    </div>
  )
}

function ShapeIcon({ id }) {
  const pts = id === 'rect' ? [[0, 0], [20, 0], [20, 14], [0, 14]] : id === 'cuadrado' ? [[3, 0], [17, 0], [17, 14], [3, 14]] : shapePreset(id, 20, 14)
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

export default function Inspector({ plant, positions, sel, setSel, commit, rotate, remove, catalog, full, live, duplicate, reshape, removeVertex }) {
  const names = Object.fromEntries(plant.stations.map((s) => [s.id, s.name]))
  const setStation = (id, patch) => commit({ ...plant, stations: plant.stations.map((s) => (s.id === id ? { ...s, ...patch } : s)) }, positions)
  const setZone = (id, patch) => commit({ ...plant, zones: plant.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) }, positions)
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

  if (sel?.type === 'vertex' && full) {
    const q = outlineOf(plant)[sel.i]
    if (!q) return <aside className="inspector" />
    return (
      <aside className="inspector">
        <span className="inspector-kicker">Esquina de la planta</span>
        <p className="small num">
          En {fmt(q[0], 1)} m, {fmt(q[1], 1)} m.
        </p>
        <div className="row">
          <button type="button" className="btn btn--ghost btn--small" onClick={() => removeVertex(sel.i)} disabled={outlineOf(plant).length <= 3}>
            Quitar esquina
          </button>
        </div>
        <ShapeControls plant={plant} reshape={reshape} />
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
        {full && (
          <div className="field-row">
            <Field label="Ancho" type="number" step="0.5" min={0.5} value={s.w} suffix="m" onCommit={(v) => setStation(s.id, { w: v })} />
            <Field label="Fondo" type="number" step="0.5" min={0.5} value={s.d} suffix="m" onCommit={(v) => setStation(s.id, { d: v })} />
          </div>
        )}
        <div className="row">
          <button type="button" className="btn btn--small" onClick={() => rotate(s.id)}>
            Girar 90° (R)
          </button>
          {dup}
          {del}
        </div>
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
        <div className="field-row">
          <Field label="Ancho" type="number" step="0.5" min={1} value={z.w} suffix="m" onCommit={(v) => setZone(z.id, { w: v })} />
          <Field label="Fondo" type="number" step="0.5" min={1} value={z.d} suffix="m" onCommit={(v) => setZone(z.id, { d: v })} />
        </div>
        <div className="row">
          {dup}
          {del}
        </div>
      </aside>
    )
  }

  if (sel?.type === 'wall') {
    const w = plant.walls.find((q) => q.id === sel.id)
    if (!w) return <aside className="inspector" />
    return (
      <aside className="inspector">
        <span className="inspector-kicker">Pared</span>
        <p>{fmt(Math.hypot(w.x2 - w.x1, w.z2 - w.z1), 1)} m de largo. El material no la cruza.</p>
        <div className="row">
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
        <p className="small">Arrástralo por cualquier muro exterior. En 3D la calle aparece frente a cada lado con portón.</p>
        <div className="row">
          <button type="button" className="btn btn--small" aria-pressed={plant.receive_gate === g.id} onClick={() => commit({ ...plant, receive_gate: g.id }, positions)}>
            {plant.receive_gate === g.id ? 'Entra por aquí' : 'Que entre por aquí'}
          </button>
          <button type="button" className="btn btn--small" aria-pressed={plant.dispatch_gate === g.id} onClick={() => commit({ ...plant, dispatch_gate: g.id }, positions)}>
            {plant.dispatch_gate === g.id ? 'Sale por aquí' : 'Que salga por aquí'}
          </button>
        </div>
        <div className="row">{plant.gates.length > 1 && del}</div>
      </aside>
    )
  }

  return (
    <aside className="inspector">
      <span className="inspector-kicker">{full ? 'Bodega' : 'Rediseño'}</span>
      {full && (
        <>
          <Field label="Nombre de la planta" value={plant.name} onCommit={(v) => commit({ ...plant, name: v })} />
          <ShapeControls plant={plant} reshape={reshape} />
        </>
      )}
      <ul className="note-list">
        <li>
          {plant.stations.length} máquinas, {plant.routes.length} rutas, {plant.zones.length} zonas y {plant.walls.length} paredes.
        </li>
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
