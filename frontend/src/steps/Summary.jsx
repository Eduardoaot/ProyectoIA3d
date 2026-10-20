import { fmt, pct } from '../api'
import FlowMark from '../brand/FlowMark'
import EngineerChat from '../components/EngineerChat'
import Btn from '../fx/Btn'
import { Appear, CountUp, RevealTitle } from '../fx/Reveal'

export default function Summary({ plant, analysis, chosen, context, onPrint, onWorkshop, onRestart }) {
    const cur = analysis.current
    const m = chosen?.metrics
    const full = plant.use_assumptions && cur.daily_m != null
    const saved = m ? -pct(cur.piece_m, m.piece_m) : 0

    const moved = chosen ? plant.stations.filter((s) => {
        const a = plant.layout[s.id]
        const b = chosen.positions[s.id]
        return a && b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 0.1
    }).length : 0

    return (
        <section className="step">
            <header className="step-head">
                <span className="step-index"><b>Paso 6 de 6</b><span>Resumen</span></span>
                <RevealTitle text="Listo. Este es tu nuevo cauce." />
                <p className="lede">Reporte generado. Resuelve tus dudas con "El ingeniero".</p>
            </header>

            <div className="summary">
                <Appear className="summary-hero">
                    <FlowMark size={88} state="u" color="#fff" />

                    <div>
                        <div className="points num">
                            {saved > 0 ? '−' : ''}

                            <CountUp value={Math.abs(saved)} />
                            
                            <small style={{ fontSize: '0.4em' }}> %</small>
                        </div>

                        <p>de recorrido por pieza con «{chosen?.name || 'sin rediseño'}»</p>
                    </div>
                </Appear>

                <Appear className="block stack">
                    <h3>Lo que cambia</h3>

                    <ul className="note-list">
                        <li>
                        Una pieza pasa de recorrer {fmt(cur.piece_m, 1)} m a {fmt(m?.piece_m, 1)} m.
                        </li>

                        <li>
                        Se mueven {moved} de {plant.stations.length} estaciones.
                        </li>

                        {full && m && (
                            <>
                                <li>
                                Capacidad: {fmt(cur.capacity, 1)} → {fmt(m.capacity, 1)} piezas al día.
                                </li>
                                <li>
                                Tiempo por pieza: {fmt(cur.lead_h, 1)} → {fmt(m.lead_h, 1)} h.
                                </li>
                                <li>
                                Carga de camiones: {fmt(cur.loading_min)} → {fmt(m.loading_min)} min al día.
                                </li>
                            </>
                        )}

                        {!full && <li>Sin supuestos: para ver capacidad y tiempos, actívalos en el paso 1.</li>}
                    </ul>
                    
                    <div className="row">
                        <Btn size="small" onClick={onPrint}>
                            Ver el reporte otra vez
                        </Btn>

                        <button type="button" className="btn btn--ghost btn--small" onClick={onWorkshop}>
                            Taller de mejora (extra)
                        </button>
                        
                        <button type="button" className="btn btn--ghost btn--small" onClick={onRestart}>
                            Empezar otra planta
                        </button>
                    </div>
                </Appear>
            </div>

            <Appear style={{ marginTop: 32 }}>
                <EngineerChat inline context={context} />
            </Appear>

            <p className="fin">FIN</p>
        </section>
    )
}