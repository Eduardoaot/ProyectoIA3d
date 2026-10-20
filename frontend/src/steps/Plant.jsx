import { useMemo, useRef } from 'react'
import { fmt } from '../api'
import Btn from '../fx/Btn'
import { Appear, RevealTitle } from '../fx/Reveal'
import PlantView from '../three/PlantView'

export default function Plant({ plant, analysis, notes, onNext, onEdit }) {
    const view = useRef(null)
    const cur = analysis.current

    const extras = useMemo(
        () => ({
            trucks: 2,
            ops: {},
            bottleneck: cur.bottleneck,
            bottleneckUtil: cur.bottleneck_util,
            legs: cur.legs,
        }),
        [plant, cur],
    )

    return (
        <section className="step">
            <header className="step-head">
                <span className="step-index"><b>Paso 2 de 6</b><span>Tu planta hoy</span></span>
                <RevealTitle text="Así quedó tu planta." />
                <p className="lede">El plano que guardaste, en 3D. Las flechas marcan hacia dónde va el material. Para cambiar algo, vuelve al paso 1.</p>
            </header>

            <Appear>
                <PlantView
                    ref={view}
                    plant={plant}
                    positions={plant.layout}
                    extras={extras}
                    buildKey="hoy"
                    onSelect={(id) => view.current?.focus(id)}
                    tools={
                        <Btn size="small" variant="ghost" onClick={onEdit}>
                            Editar plano
                        </Btn>
                    }
                />
            </Appear>

            <div style={{ marginTop: 32 }}>
                <Appear className="block">
                    <h3>Sobre tu planta</h3>
                    
                    <ul className="note-list" style={{ marginTop: 14 }}>
                        <li>
                            Bodega de {plant.size.w} × {plant.size.d} m con {plant.stations.length} estaciones, {plant.routes.length} rutas y {plant.zones.length} zonas sin paso.
                        </li>

                        <li>Una pieza recorre {fmt(cur.piece_m, 1)} m de principio a fin.</li>

                        {cur.blocked_legs > 0 && <li>{cur.blocked_legs} rutas no tienen paso libre; se cuentan en línea recta.</li>}
                        
                        {cur.avoid_hits.map((h, i) => (
                            <li key={i}>{h.text}: el polvo, ruido o calor le llega.</li>
                        ))}

                        {notes.map((note, idx) => (
                            <li key={`n${idx}`}>{note}</li>
                        ))}

                    </ul>
                </Appear>
            </div>

            <div className="row" style={{ marginTop: 32 }}>
                <Btn onClick={onNext}>Ver el diagnóstico</Btn>
            </div>
        </section>
    )
}