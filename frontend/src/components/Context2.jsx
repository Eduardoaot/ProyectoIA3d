/* Contexto 2: lo que el sistema entendió del plano (sin IA). El análisis espera a que el
   usuario lo confirme; cualquier edición del plano pide confirmarlo de nuevo. */
export default function Context2({ summary, confirmed, onConfirm }) {
    if (!summary?.lines?.length) return null
    return (
        <div className="block context2" data-ok={confirmed}>
            <h3>Antes de analizar: ¿así es tu planta?</h3>
            <ul className="small">
                {summary.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                ))}
            </ul>
            {summary.changes.length > 0 && (
                <>
                    <strong className="small">Desde el último análisis</strong>
                    <ul className="small">
                        {summary.changes.map((l, i) => (
                            <li key={i}>{l}</li>
                        ))}
                    </ul>
                </>
            )}
            <div className="row">
                {confirmed ? (
                    <span className="small">
                        <b>Confirmado.</b> Si cambias el plano, se vuelve a pedir.
                    </span>
                ) : (
                    <button type="button" className="btn btn--small" onClick={onConfirm}>
                        Sí, así es
                    </button>
                )}
            </div>
        </div>
    )
}
