import { fmt, pct } from '../api'
import Modal from './Modal'

/* Ventana para elegir entre los acomodos calculados: una fila corta por opción (cifras y «Aplicar»).
   La recomendada va primero. La descripción y la obra quedan en el título emergente del nombre. */
export default function OptionPicker({ open, onClose, cards, cur, choice, recommended, ideal, onPick }) {
    const sorted = [...cards].sort((a, b) => (b.id === recommended) - (a.id === recommended))
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
                {sorted.map((a) => {
                    const p = a.m ? pct(cur.piece_m, a.m.piece_m) : null
                    const on = a.id === choice
                    const tag = a.id === recommended ? 'Recomendada' : a.id === ideal ? 'Ideal' : null
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
                                    {on ? 'Aplicada' : 'Aplicar'}
                                </button>
                            </span>
                        </div>
                    )
                })}
            </div>
            <p className="small opt-foot">Pasa el mouse por el nombre para ver de qué se trata y qué obra pide.</p>
        </Modal>
    )
}
