import { useRef, useState } from 'react'
import { appendEntry, currentEntries } from '../context'
import { isImageReference, readImageReference, referenceStatus, validateReferenceBudget } from '../references'

export default function ReferencePanel({ context, onChange, vision }) {
    const [image, setImage] = useState(null), [notes, setNotes] = useState(''), [key, setKey] = useState(null)
    const [error, setError] = useState(''), [reading, setReading] = useState(false)
    const selection = useRef(0)
    const choose = async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        const version = ++selection.current
        setReading(true); setError(''); setImage(null); setKey(null)
        try {
            const data = await readImageReference(file)
            const preview = new Image(); preview.src = data.data_url; await preview.decode()
            if (version === selection.current) setImage(data)
        } catch (failure) { if (version === selection.current) setError(failure.message || 'No se pudo abrir la imagen.') }
        finally { if (version === selection.current) setReading(false) }
    }
    const save = () => {
        try {
            const value = image ? { ...image, notes, interpreted: false } : notes
            if (image) validateReferenceBudget(context, value)
            onChange(appendEntry(context, { segment: 'referencias', key: key || `referencia-${crypto.randomUUID()}`, value, source: 'usuario', confidence: 'baja', owner: 'usuario' }))
            setImage(null); setNotes(''); setKey(null); setError('')
        } catch (failure) { setError(failure.message) }
    }
    return <section className="reference-panel">
        <h3>Referencias con imagen</h3>
        <p className="small">PNG, JPEG o WebP de hasta 256 KB. Se guardan con el proyecto en este navegador.</p>
        <label className="field">Imagen de referencia<input type="file" accept="image/png,image/jpeg,image/webp" onChange={choose} /></label>
        {image && <img src={image.data_url} alt={`Referencia: ${image.name}`} />}
        <label className="field">Notas de la referencia<textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <p role="status">{referenceStatus(vision)}</p>
        {error && <p role="alert">{error}</p>}
        <button type="button" className="btn btn--small" disabled={reading || (!image && !notes.trim())} onClick={save}>{reading ? 'Leyendo imagen…' : 'Guardar referencia'}</button>
        {image && <button type="button" className="btn btn--ghost btn--small" onClick={() => setImage(null)}>Conservar solo la nota</button>}
        <div className="reference-gallery">{currentEntries(context).filter((e) => e.segment === 'referencias' && isImageReference(e.value)).map((e) => <figure key={e.id}>
            {e.value.data_url && <img src={e.value.data_url} alt={e.value.notes || e.value.name} />}
            <figcaption>{e.value.name} · {e.value.notes}<p className="small">{referenceStatus(vision)}</p></figcaption>
            <button type="button" className="link-btn" onClick={() => { setImage(e.value); setNotes(e.value.notes); setKey(e.key) }}>Corregir notas</button>
        </figure>)}</div>
    </section>
}
