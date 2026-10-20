import { useRef, useState } from 'react'
import { api } from '../api'
import { addEntry, current, MAX_IMAGE_BYTES, referenceStatus } from '../context'
import useCaps from '../useCaps'

/* Referencias con imagen (criterios §4.1 y §7.3). Sin un proveedor con visión la imagen se
   guarda como nota y se dice que no fue interpretada: nada se finge. */
export default function References({ context, setContext }) {
    const caps = useCaps()
    const file = useRef(null)
    const [note, setNote] = useState('')
    const [msg, setMsg] = useState(null)
    const [busy, setBusy] = useState(null)
    const refs = current(context).filter((e) => e.segment === 'referencias')

    const add = async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        if (f.size > MAX_IMAGE_BYTES) return setMsg('La imagen pesa más de 1 MB: redúcela antes de subirla.')
        const image = await new Promise((ok, fail) => {
            const r = new FileReader()
            r.onload = () => ok(r.result)
            r.onerror = fail
            r.readAsDataURL(f)
        })
        const n = (context.segments?.referencias || []).length + 1
        setContext(addEntry(context, { segment: 'referencias', key: `referencia-${n}`, value: note.trim() || f.name, image, source: 'usuario', confidence: 'media' }))
        setNote('')
        setMsg(null)
    }

    const interpret = async (e) => {
        setBusy(e.id)
        try {
            const out = await api.readReference(e.image, e.value)
            setContext(addEntry(context, { ...e, value: `${e.value} — Lectura: ${out.text}`, supersedes: e.id, interpreted: true }))
        } catch (err) {
            setMsg(err.message || 'No se pudo interpretar la imagen.')
        }
        setBusy(null)
    }

    return (
        <div className="block references">
            <h3>Referencias con imagen</h3>
            <p className="small">Fotos o planos de distribuciones que te gustan, con una nota. {caps.vision ? 'El proveedor actual puede leerlas.' : 'El proveedor actual no tiene visión: se guardan como nota.'}</p>
            {refs.length > 0 && (
                <ul className="ref-list">
                    {refs.map((e) => (
                        <li key={e.id}>
                            {e.image && <img src={e.image} alt={e.value} />}
                            <div className="small">
                                <b>{e.value}</b>
                                <span className="context-meta">{referenceStatus(e, caps.vision)}</span>
                                {caps.vision && !e.interpreted && e.image && (
                                    <button type="button" className="link-btn" disabled={busy === e.id} onClick={() => interpret(e)}>
                                        {busy === e.id ? 'Leyendo…' : 'Interpretar'}
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <div className="row">
                <input className="ref-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota: qué te gusta de esta distribución" />
                <button type="button" className="btn btn--ghost btn--small" onClick={() => file.current?.click()}>
                    Subir imagen
                </button>
                <input ref={file} type="file" accept="image/*" hidden onChange={add} />
            </div>
            {msg && <p className="small">{msg}</p>}
        </div>
    )
}
