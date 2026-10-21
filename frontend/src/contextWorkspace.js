/* Borrador de interfaz: no cambia el contrato de la planta ni la API. */
export const TOPICS = [
    { id: 'negocio', label: 'Negocio', hint: 'Qué produces, para quién y cuánto necesitas entregar.', example: 'Vendemos unos 80 transformadores por mes; es un estimado de Ana, responsable de ventas.' },
    { id: 'operaciones', label: 'Operaciones', hint: 'Procesos, productos y la forma de trabajar.', example: 'Primero cortamos lámina y luego ensamblamos; lo describió Luis, supervisor del turno matutino.' },
    { id: 'tiempos', label: 'Tiempos', hint: 'Ciclos, turnos, esperas y tiempos de cambio.', example: 'El corte tarda aproximadamente 12 minutos por pieza; Laura lo midió la semana pasada.' },
    { id: 'maquinas', label: 'Máquinas y espacio', hint: 'Equipos, cantidades, dimensiones y distribución.', example: 'Tenemos tres cortadoras junto a recepción; lo confirmó Marta, jefa de planta.' },
    { id: 'flujo', label: 'Flujo de materiales', hint: 'Recorridos, transportes, regresos y almacenamiento.', example: 'Cada lote de 20 piezas va del corte al ensamble; lo observó Pedro en el turno de mañana.' },
    { id: 'personal', label: 'Personal', hint: 'Personas, roles, horarios y organización.', example: 'Trabajan seis personas en el turno de 8 horas; dato proporcionado por Recursos Humanos.' },
    { id: 'calidad', label: 'Calidad', hint: 'Inspecciones, defectos y retrabajos.', example: 'Revisamos cada pieza antes del empaque; según el registro de calidad, unas 2 de cada 100 se retrabajan.' },
    { id: 'restricciones', label: 'Restricciones', hint: 'Lo que debe permanecer fijo y los límites del cambio.', example: 'El horno no puede moverse por la conexión de gas; lo confirmó el responsable de mantenimiento.' },
    { id: 'estudios', label: 'Estudios del trabajo', hint: 'Actividades observadas y documentos del proceso.', example: 'En el estudio de Laura, transportar cada lote al horno tomó unos 4 minutos; fue medido el lunes.' },
    { id: 'referencias', label: 'Imágenes y layouts', hint: 'Fotos, planos y ejemplos con sus notas.', example: 'Este plano lo entregó mantenimiento en mayo; las medidas están en metros y faltan por comprobar.' },
]

// Huella local para detectar cambios, no es una firma de seguridad.
function fingerprint(text) {
    let a = 2166136261, b = 5381
    for (let i = 0; i < text.length; i++) {
        a = Math.imul(a ^ text.charCodeAt(i), 16777619)
        b = Math.imul(b, 33) ^ text.charCodeAt(i)
    }
    return `${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}-${text.length}`
}

export function reviewSignature(project) {
    if (!project.draft) return ''
    return fingerprint(JSON.stringify({
        plant: project.draft,
        text: project.text || '',
        context: project.context || { segments: {} },
        weights: project.weights || null,
        workspace: project.contextWorkspace || {},
    }))
}

const RULES = [
    ['restricciones', /no (?:se )?(?:puede|mover)|fij[oa]|restricci|presupuesto|prohibid/],
    ['calidad', /calidad|defecto|inspecci|rechazo|retrabajo/],
    ['personal', /operari|persona|emplead|supervisor|trabajador/],
    ['tiempos', /minuto|segundo|hora|ciclo|espera|turno|tarda/],
    ['flujo', /transport|montacarga|recorrido|almacen|flujo|porton|entrada|salida/],
    ['maquinas', /maquina|horno|equipo|cortadora|superficie|metro|espacio/],
    ['negocio', /cliente|pedido|demanda|venta|fabricamos|negocio/],
]

export function organizeText(text) {
    const fragments = [...new Set(String(text).split(/\n+|(?<=[.!?;])\s+/).map((s) => s.trim()).filter(Boolean))]
    return fragments.map((excerpt) => {
        const normalized = excerpt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        const topic = RULES.find(([, re]) => re.test(normalized))?.[0] || 'operaciones'
        return { id: `propuesta-${fingerprint(excerpt)}`, topic, label: excerpt.length > 65 ? `${excerpt.slice(0, 62)}…` : excerpt, value: excerpt, unit: '', excerpt, confidence: 'baja', status: 'pending' }
    })
}

const LABELS = { t_ciclo: 'Tiempo de ciclo', t_cycle_min: 'Tiempo de ciclo', demanda: 'Demanda', turnos: 'Turnos', operarios: 'Operarios', produccion: 'Producción', presupuesto: 'Presupuesto', count: 'Cantidad', t_setup: 'Tiempo de preparación', scrap: 'Rechazo', distancia: 'Distancia' }
export function entryLabel(entry) {
    const key = String(entry.key || 'Nota')
    const parts = key.split('.')
    if (TOPICS.some((topic) => topic.id === parts[0]) && parts.length > 1) return parts.slice(1).join('.')
    const last = parts.at(-1)
    const label = LABELS[last] || last.replaceAll('_', ' ')
    const prefix = parts.length > 1 ? `${parts.slice(0, -1).join(' · ')} · ` : ''
    return `${prefix}${label.charAt(0).toUpperCase()}${label.slice(1)}`
}

export function displayEntry(entry) {
    const value = Array.isArray(entry.value) ? entry.value.join(' – ') : String(entry.value ?? 'Sin dato')
    return `${value}${entry.unit ? ` ${entry.unit}` : ''}`
}

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_TEXT_CHARS = 100000
async function attachmentStore(mode, operation) {
    if (!globalThis.indexedDB) throw new Error('El navegador no permite guardar archivos localmente.')
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('cauce-contexto-archivos', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' })
        request.onerror = () => reject(new Error('No se pudo abrir el almacenamiento de archivos.'))
        request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('files', mode)
            const result = operation(tx.objectStore('files'))
            tx.oncomplete = () => { db.close(); resolve(result.result) }
            tx.onabort = tx.onerror = () => { db.close(); reject(new Error('No se pudo guardar o leer el archivo. Revisa el espacio del navegador.')) }
        }
    })
}

export async function readAttachment(file, topic) {
    if (file.size > MAX_FILE_BYTES) throw new Error('Cada documento puede pesar hasta 10 MB en esta vista previa.')
    const id = `archivo-${crypto.randomUUID()}`
    const readable = /\.(txt|md|csv)$/i.test(file.name)
    const extracted = readable ? await file.text() : ''
    const isText = readable && !extracted.includes('\0')
    const attachment = {
        id, topic, name: file.name, type: file.type, size: file.size,
        date: new Date().toISOString(), origin: 'usuario', status: isText ? 'text_extracted' : 'pending',
        ...(isText ? { text: extracted.slice(0, MAX_TEXT_CHARS), truncated: extracted.length > MAX_TEXT_CHARS } : {}),
    }
    await attachmentStore('readwrite', (store) => store.put({ id, file, name: file.name }))
    return attachment
}

export async function downloadAttachment(id) {
    const record = await attachmentStore('readonly', (store) => store.get(id))
    if (!record?.file) throw new Error('El original no está en este navegador. Vuelve a adjuntarlo.')
    const url = URL.createObjectURL(record.file)
    const link = document.createElement('a')
    link.href = url
    link.download = record.name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function deleteAttachments(ids) {
    if (!ids.length) return
    await attachmentStore('readwrite', (store) => {
        let request
        for (const id of ids) request = store.delete(id)
        return request
    })
}

// Formato por tema: una hoja con columnas fijas que se puede llenar en Excel y adjuntar.
// Al adjuntarla, cada fila se vuelve un dato propuesto; nada se confirma solo.
export const TEMPLATE_COLUMNS = ['dato', 'valor', 'unidad', 'fuente', 'confianza', 'responsable']
const SOURCES = ['usuario', 'medido', 'estimado', 'supuesto']
const CONFIDENCES = ['alta', 'media', 'baja']
const csvCell = (value) => /[",;\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value

export function templateCsv(topic) {
    const example = ['Ejemplo (borra esta fila)', topic.example, '', 'usuario', 'media', '']
    return `﻿${[TEMPLATE_COLUMNS, example].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

function csvRows(text) {
    const firstLine = text.split(/\r?\n/, 1)[0]
    const separator = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ','
    const rows = [[]]
    let cell = '', quoted = false
    for (let i = 0; i < text.length; i++) {
        const char = text[i]
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') { cell += '"'; i++ }
            else if (char === '"') quoted = false
            else cell += char
        } else if (char === '"') quoted = true
        else if (char === separator) { rows.at(-1).push(cell); cell = '' }
        else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[i + 1] === '\n') i++
            rows.at(-1).push(cell); cell = ''; rows.push([])
        } else cell += char
    }
    rows.at(-1).push(cell)
    return rows.map((row) => row.map((value) => value.trim())).filter((row) => row.some(Boolean))
}

// Devuelve las filas del formato, o null si el texto no sigue el formato.
export function parseTemplate(text) {
    const rows = csvRows(String(text || '').replace(/^﻿/, ''))
    const header = rows[0]?.map((name) => name.toLowerCase())
    if (!header || !['dato', 'valor'].every((name) => header.includes(name))) return null
    const column = (row, name) => row[header.indexOf(name)] ?? ''
    return rows.slice(1)
        .map((row) => ({ label: column(row, 'dato'), value: column(row, 'valor'), unit: column(row, 'unidad'), source: column(row, 'fuente').toLowerCase(), confidence: column(row, 'confianza').toLowerCase(), owner: column(row, 'responsable'), excerpt: row.filter(Boolean).join(' · ') }))
        .filter((row) => row.label && row.value && !/^ejemplo \(borra esta fila\)$/i.test(row.label))
        .map((row) => ({ ...row, source: SOURCES.includes(row.source) ? row.source : 'usuario', confidence: CONFIDENCES.includes(row.confidence) ? row.confidence : 'media' }))
}

export function downloadTemplate(topic) {
    const url = URL.createObjectURL(new Blob([templateCsv(topic)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `formato-${topic.id}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}
