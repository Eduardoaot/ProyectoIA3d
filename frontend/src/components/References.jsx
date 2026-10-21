import { useRef, useState } from 'react'
import { api } from '../api'
import { addEntry, current, MAX_IMAGE_BYTES, referenceStatus } from '../context'
import useCaps from '../useCaps'

const asDataUrl = (file) => new Promise((ok, fail) => {
    const r = new FileReader()
    r.onload = () => ok(r.result)
    r.onerror = fail
    r.readAsDataURL(file)
})

/* Las fotos del celular pasan de 1 MB: se reducen a 1600 px y JPEG hasta que quepan,
   en vez de rechazarlas. Devuelve null si ni así caben. */
async function shrink(file) {
    const url = URL.createObjectURL(file)
    try {
        const img = await new Promise((ok, fail) => {
            const i = new Image()
            i.onload = () => ok(i)
            i.onerror = fail
            i.src = url
        })
        const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.naturalWidth * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        const g = canvas.getContext('2d')
        g.fillStyle = '#fff'
        g.fillRect(0, 0, canvas.width, canvas.height)
        g.drawImage(img, 0, 0, canvas.width, canvas.height)
        for (const quality of [0.85, 0.7, 0.55, 0.4]) {
            const data = canvas.toDataURL('image/jpeg', quality)
            if (data.length * 0.75 <= MAX_IMAGE_BYTES) return data
        }
        return null
    } finally {
        URL.revokeObjectURL(url)
    }
}

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
        if (!f.type.startsWith('image/')) return setMsg('Ese archivo no es una imagen. Usa JPG, PNG o WebP.')
        let image
        try {
            image = f.size <= MAX_IMAGE_BYTES ? await asDataUrl(f) : await shrink(f)
        } catch {
            return setMsg('No se pudo leer la imagen. Prueba con otra en JPG o PNG.')
        }
        if (!image) return setMsg('La imagen es demasiado grande aun reducida. Prueba con una captura más pequeña.')
        const n = (context.segments?.referencias || []).length + 1
        setContext(addEntry(context, { segment: 'referencias', key: `referencia-${n}`, value: note.trim() || f.name, image, source: 'usuario', confidence: 'media' }))
        setNote('')
        setMsg(f.size > MAX_IMAGE_BYTES ? 'Imagen agregada. La redujimos para que quepa en este navegador.' : null)
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
