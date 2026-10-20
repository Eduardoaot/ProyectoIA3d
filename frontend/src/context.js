/* Contexto segmentado (criterios §4, contrato §4.5). Las entradas son inmutables: editar un
   dato agrega una entrada nueva que reemplaza a la anterior (`supersedes`); nada se borra.
   Igual que backend/cauce/context.py: la vigente de cada key es la que nadie reemplazó. */

export const SEGMENTS = [
    { id: 'negocio', label: 'Negocio', hint: 'rubro, producto, demanda, clientes, temporadas' },
    { id: 'operaciones', label: 'Operaciones', hint: 'turnos, jornada, eficiencia, procesos' },
    { id: 'tiempos', label: 'Tiempos', hint: 'toma de tiempos: valores, muestras, método' },
    { id: 'maquinas', label: 'Máquinas', hint: 'equipos, estado, cantidad, medidas' },
    { id: 'flujo', label: 'Flujo', hint: 'rutas, frecuencias, lotes' },
    { id: 'personal', label: 'Personal', hint: 'operarios, turnos, habilidades' },
    { id: 'calidad', label: 'Calidad', hint: 'scrap, retrabajo, reclamos' },
    { id: 'restricciones', label: 'Restricciones', hint: 'fijos, seguridad, pasillos mínimos' },
    { id: 'estudios', label: 'Estudios del trabajo', hint: 'método, actividades y estudios aportados' },
    { id: 'referencias', label: 'Referencias', hint: 'imágenes de distribución y notas' },
]
export const SOURCES = ['medido', 'estimado', 'usuario']
export const CONFIDENCE = ['alta', 'media', 'baja']

export const EMPTY_CONTEXT = { segments: {} }

const today = () => new Date().toISOString().slice(0, 10)

export function entries(ctx) {
    return Object.entries(ctx?.segments || {}).flatMap(([seg, list]) => (Array.isArray(list) ? list.map((e) => ({ ...e, segment: e.segment || seg })) : []))
}

function nextId(ctx, segment) {
    const n = (ctx?.segments?.[segment] || []).length + 1
    return `${segment}-${String(n).padStart(4, '0')}`
}

/* Agrega una entrada. Si `supersedes` apunta a otra, esta la reemplaza (versión + 1). */
export function addEntry(ctx, entry, date = today()) {
    const segment = entry.segment
    const prev = entry.supersedes ? entries(ctx).find((e) => e.id === entry.supersedes) : null
    const e = {
        id: nextId(ctx, segment),
        segment,
        version: prev ? (prev.version || 1) + 1 : 1,
        date,
        key: entry.key,
        value: entry.value,
        ...(entry.unit ? { unit: entry.unit } : {}),
        source: entry.source || 'usuario',
        confidence: entry.confidence || 'media',
        ...(entry.owner ? { owner: entry.owner } : {}),
        ...(entry.image ? { image: entry.image } : {}),
        ...(entry.interpreted ? { interpreted: true } : {}),
        ...(prev ? { supersedes: prev.id } : {}),
    }
    const segs = { ...(ctx?.segments || {}) }
    segs[segment] = [...(segs[segment] || []), e]
    return { ...(ctx || {}), segments: segs }
}

export function current(ctx) {
    const all = entries(ctx)
    const replaced = new Set(all.map((e) => e.supersedes).filter(Boolean))
    const byKey = new Map()
    const loose = []
    for (const e of all) {
        if (replaced.has(e.id)) continue
        if (!e.key) loose.push(e)
        else if (!byKey.has(e.key) || (e.version || 0) >= (byKey.get(e.key).version || 0)) byKey.set(e.key, e)
    }
    return [...loose, ...byKey.values()]
}

/* Versiones de un dato, de la más nueva a la más vieja. */
export function history(ctx, id) {
    const all = entries(ctx)
    const out = []
    let e = all.find((x) => x.id === id)
    while (e) {
        out.push(e)
        e = e.supersedes ? all.find((x) => x.id === e.supersedes) : null
    }
    return out
}

/* "3,5 a 4,5" o "4" → [3.5, 4.5] o 4; cualquier otra cosa queda como texto. */
export function parseValue(raw) {
    const t = String(raw ?? '').trim()
    const m = t.match(/^(-?\d+(?:[.,]\d+)?)\s*(?:a|-|–)\s*(-?\d+(?:[.,]\d+)?)$/)
    if (m) return [Number(m[1].replace(',', '.')), Number(m[2].replace(',', '.'))]
    if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'))
    return t
}

/* Confianza baja: un número se muestra como rango (±20 %) para no aparentar precisión. */
export function showValue(e) {
    const v = e.value
    const r = (x) => (Math.round(x * 100) / 100).toLocaleString('es-CO')
    if (Array.isArray(v)) return `${r(v[0])} a ${r(v[1])}`
    if (typeof v === 'number' && e.confidence === 'baja') return `${r(v * 0.8)} a ${r(v * 1.2)} (aprox. ${r(v)})`
    return typeof v === 'number' ? r(v) : String(v)
}

export function toText(ctx, story = '') {
    const lines = current(ctx)
        .filter((e) => e.segment !== 'referencias' || e.value)
        .map((e) => `${e.key || e.id}: ${showValue(e)}${e.unit ? ` ${e.unit}` : ''} (${e.segment}, ${e.source}, confianza ${e.confidence})`)
    return [story.trim(), ...lines].filter(Boolean).join('\n')
}

/* Lo que viaja en `context`: objeto si el backend anuncia segmented_context, si no, texto.
   Las imágenes no viajan aquí: solo sus notas. */
export function contextPayload(ctx, story, segmented) {
    const hasEntries = entries(ctx).length > 0
    if (segmented && hasEntries) {
        const segments = Object.fromEntries(Object.entries(ctx.segments).map(([k, list]) => [k, list.map(({ image: _i, ...e }) => e)]))
        return story?.trim() ? { segments, story: story.trim().slice(0, 2000) } : { segments }
    }
    const text = toText(ctx, story || '')
    return text ? text.slice(0, 4000) : undefined
}

export const MAX_IMAGE_BYTES = 1_000_000 // el proyecto se guarda en el navegador: imágenes chicas

/* Estado de una referencia con imagen: interpretada por un modelo con visión, o solo nota. */
export function referenceStatus(entry, vision) {
    if (entry.interpreted) return 'Interpretada por un modelo con visión.'
    return vision ? 'Sin interpretar todavía.' : 'No interpretada: el proveedor actual no tiene visión.'
}
