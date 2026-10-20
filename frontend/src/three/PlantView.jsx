import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import PlantScene from './PlantScene'
import { setCursor } from '../fx/Cursor'

const HINTS = {
  '3d': 'Arrastra para girar, clic derecho o Shift para mover. Rueda para acercar. WASD o flechas mueven, Q y E giran, R y F inclinan.',
  top: 'Arrastra para mover la vista. Rueda para acercar. WASD o flechas también mueven.',
}

/* Mantener pulsado repite la acción (como mantener una tecla). */
function HoldBtn({ onStep, label, children }) {
  const timer = useRef(null)
  const stop = () => {
    clearInterval(timer.current)
    timer.current = null
  }
  useEffect(() => stop, [])
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        e.preventDefault()
        onStep()
        stop()
        timer.current = setInterval(onStep, 40)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onStep()}
    >
      {children}
    </button>
  )
}

const ICON = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 2 }

export default function PlantView({ ref, plant, positions, extras, buildKey, onSelect, tools, legend = true, hint }) {
  const host = useRef(null)
  const labels = useRef(null)
  const scene = useRef(null)
  const [view, setView] = useState('3d')
  const placed = useRef(false)
  const posRef = useRef(positions)
  posRef.current = positions

  useEffect(() => {
    const s = new PlantScene(host.current, labels.current, {
      onHover: (id, name) => setCursor({ label: name || null }),
      onSelect: (id) => onSelect?.(id),
    })
    scene.current = s
    placed.current = false
    return () => {
      setCursor({ label: null })
      s.dispose()
      scene.current = null
    }
  }, [])

  const extrasRef = useRef(extras)
  useEffect(() => {
    extrasRef.current = extras
  })

  useEffect(() => {
    if (!scene.current || !plant) return
    const run = () => {
      scene.current?.build(plant, posRef.current, extrasRef.current)
      // La cámara se coloca solo la primera vez: al reconstruir (por ejemplo al editar) se queda donde estaba.
      if (!placed.current) scene.current?.setView(view)
      placed.current = true
    }
    if (!placed.current) return run()
    // Al editar paredes o zonas la planta cambia con cada movimiento del mouse: se reconstruye al soltar.
    const t = setTimeout(run, 250)
    return () => clearTimeout(t)
  }, [plant, buildKey])

  useEffect(() => {
    if (scene.current?.plant) scene.current.applyExtras(extras)
  }, [extras])

  useImperativeHandle(ref, () => ({
    setLayout: (pos, opts) => scene.current?.setLayout(pos, opts),
    applyExtras: (opts) => scene.current?.applyExtras(opts),
    focus: (id) => scene.current?.focus(id),
    setView: (v) => {
      setView(v)
      scene.current?.setView(v)
    },
  }))

  const changeView = (v) => {
    setView(v)
    scene.current?.setView(v)
  }

  return (
    <div className="scene" onMouseLeave={() => setCursor({ label: null })}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div ref={labels} className="scene-labels" />
      <div className="scene-tools">
        <div className="seg" role="group" aria-label="Vista">
          <button aria-pressed={view === '3d'} onClick={() => changeView('3d')}>Vista 3D</button>
          <button aria-pressed={view === 'top'} onClick={() => changeView('top')}>Desde arriba</button>
        </div>
        {tools}
      </div>
      <div className="scene-cam" role="group" aria-label="Cámara">
        <HoldBtn label="Acercar" onStep={() => scene.current?.zoom(0.95)}>
          <svg {...ICON}><path d="M8 3 V13 M3 8 H13" /></svg>
        </HoldBtn>
        <HoldBtn label="Alejar" onStep={() => scene.current?.zoom(1.05)}>
          <svg {...ICON}><path d="M3 8 H13" /></svg>
        </HoldBtn>
        {view === '3d' && (
          <>
            <HoldBtn label="Girar a la izquierda" onStep={() => scene.current?.orbit(0.05)}>
              <svg {...ICON}><path d="M12 5 A5 5 0 1 0 13 9 M12 1 V5 H8" /></svg>
            </HoldBtn>
            <HoldBtn label="Girar a la derecha" onStep={() => scene.current?.orbit(-0.05)}>
              <svg {...ICON}><path d="M4 5 A5 5 0 1 1 3 9 M4 1 V5 H8" /></svg>
            </HoldBtn>
            <HoldBtn label="Inclinar hacia arriba" onStep={() => scene.current?.tilt(-0.035)}>
              <svg {...ICON}><path d="M3 10 L8 5 L13 10" /></svg>
            </HoldBtn>
            <HoldBtn label="Inclinar hacia abajo" onStep={() => scene.current?.tilt(0.035)}>
              <svg {...ICON}><path d="M3 6 L8 11 L13 6" /></svg>
            </HoldBtn>
          </>
        )}
        <button type="button" aria-label="Centrar la vista" title="Centrar la vista" onClick={() => scene.current?.setView(view)}>
          <svg {...ICON}><rect x="3" y="3" width="10" height="10" /><circle cx="8" cy="8" r="1.5" fill="currentColor" /></svg>
        </button>
      </div>
      {legend && (
        <div className="scene-legend" aria-hidden="true">
          <div className="legend-row"><span className="legend-swatch" />Recorrido del material</div>
          <div className="legend-row"><span className="legend-swatch legend-swatch--dash" />Solo una parte de las piezas</div>
          <div className="legend-row"><span className="legend-arrow" />Dirección del material</div>
          <div className="legend-row"><span className="legend-swatch--ring" />Cuello de botella</div>
        </div>
      )}
      <span className="scene-hint">{hint || HINTS[view]}</span>
    </div>
  )
}