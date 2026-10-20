import { fmt, pct } from '../api'
import Modal from './Modal'

/* Ventana para elegir entre los acomodos: una fila corta por opción (cifras y dos acciones).
   La descripción y la obra quedan en el título emergente del nombre. */
export default function OptionPicker({ open, onClose, cards, cur, choice, recommended, ideal, onPick, onApply, compact, onAskCompact }) {
    return (
        <Modal open={open} title="Elige un acomodo" onClose={onClose} wide>
            <div className="opt-table" role="table">
                <div className="opt-row opt-row--head" role="row">
                    <span>Opción</span>
                    <span className="num">m por pieza</span>
                    <span className="num">vs hoy</span>
                    <span className="num">Ocupa</span>
                    <span />
                </div>
                {cards.map((a) => {
                    if (a.pending)
                        return (
                            <div key={a.id} className="opt-row" role="row">
                                <span className="opt-name" title="Junta las máquinas en el menor espacio sin alargar el recorrido. Tarda uno o dos minutos.">
                                    {a.name} <i className="picker-tag">IA</i>
                                </span>
                                <span className="num opt-muted">—</span>
                                <span className="num opt-muted">—</span>
                                <span className="num opt-muted">—</span>
                                <span className="opt-acts">
                                    <button type="button" className="opt-btn opt-btn--solid" onClick={onAskCompact} disabled={compact.loading}>
                                        {compact.loading ? 'Pensando…' : 'Calcular'}
                                    </button>
                                </span>
                            </div>
                        )
                    const p = a.m ? pct(cur.piece_m, a.m.piece_m) : null
                    const on = a.id === choice
                    const tag = a.id === recommended ? 'Recomendada' : a.id === ideal ? 'Ideal' : a.id === 'propio' ? 'Tuya' : null
                    return (
                        <div key={a.id} className="opt-row" role="row" data-on={on}>
                            <span className="opt-name" title={[a.summary, a.works && `Obra: ${a.works}`].filter(Boolean).join('\n')}>
                                {a.name}
                                {tag && <i className="picker-tag">{tag}</i>}
                            </span>
                            <span className="num opt-fig">{a.m ? fmt(a.m.piece_m, 1) : '…'}</span>
                            <span className="num" data-good={p != null && p < 0}>
                                {p == null ? '—' : `${p > 0 ? '+' : ''}${p} %`}
                            </span>
                            <span className="num opt-muted">{a.m?.footprint_m2 != null ? `${fmt(a.m.footprint_m2)} m²` : '—'}</span>
                            <span className="opt-acts">
                                <button type="button" className="opt-btn opt-btn--solid" onClick={() => onPick(a.id)} aria-pressed={on} disabled={on}>
                                    {on ? 'Viendo' : 'Ver'}
                                </button>
                                {a.id !== 'propio' && a.m?.legs && (
                                    <button type="button" className="opt-btn" onClick={() => onApply(a.id)} title="Copia esta propuesta a «Tu rediseño» para ajustarla. Se puede deshacer.">
                                        Aplicar
                                    </button>
                                )}
                            </span>
                        </div>
                    )
                })}
            </div>
            <p className="small opt-foot">Pasa el mouse por el nombre para ver de qué se trata y qué obra pide.</p>
        </Modal>
    )
}
