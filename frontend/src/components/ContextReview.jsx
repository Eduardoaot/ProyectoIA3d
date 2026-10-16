import { summarizePlant } from '../context'

export default function ContextReview({ plant, baseline, confirmed, onConfirm }) {
    const summary = summarizePlant(plant, baseline)
    return <section className="block context-review" aria-label="Contexto 2">
        <h3>Contexto 2 · Revisa lo que describe tu plano</h3>
        <p>{summary.stations.join('; ') || 'Sin estaciones'}</p>
        <p>Fijos: {summary.fixed.join('; ') || 'ninguno'}.</p>
        <p>Rutas: {Object.entries(summary.flows).map(([flow, n]) => `${flow}: ${n}`).join('; ') || 'ninguna'}. Bandas: {summary.conveyors}.</p>
        <p>Cambios desde el último análisis: {baseline ? summary.changed.join(', ') || 'ninguno' : 'primer análisis pendiente'}.</p>
        <button type="button" className="btn btn--small" onClick={onConfirm} disabled={confirmed}>{confirmed ? 'Contexto 2 confirmado' : 'Confirmar Contexto 2'}</button>
        <p className="small">Cualquier edición exige una nueva confirmación antes de analizar.</p>
    </section>
}
