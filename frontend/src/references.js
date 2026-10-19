export const MAX_IMAGE_BYTES = 256 * 1024
export const MAX_REFERENCE_DATA = 700000
export const isImageReference = (value) => value?.type === 'image_reference'
export const referenceStatus = (vision) => vision === true
    ? 'Guardada como referencia; pendiente de interpretación.'
    : 'No interpretada: el proveedor actual no tiene visión'

export async function readImageReference(file) {
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Usa una imagen PNG, JPEG o WebP.')
    if (file.size > MAX_IMAGE_BYTES) throw new Error('La imagen supera 256 KB. Elige una versión más pequeña.')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    if (!(file.type === 'image/png' ? png : file.type === 'image/jpeg' ? jpeg : webp)) throw new Error('El archivo no contiene una imagen del tipo indicado.')
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.slice(i, i + 8192))
    return { type: 'image_reference', name: file.name, mime: file.type, data_url: `data:${file.type};base64,${btoa(binary)}`, notes: '', interpreted: false }
}

export function referenceForAPI(value, vision) {
    if (!isImageReference(value) || vision === true) return value
    const { data_url: _data, ...note } = value
    return { ...note, interpreted: false }
}
export function validateReferenceBudget(context, value) {
    const used = Object.values(context?.segments || {}).flat().reduce((n, e) => n + (isImageReference(e.value) ? e.value.data_url?.length || 0 : 0), 0)
    if (used + (value.data_url?.length || 0) > MAX_REFERENCE_DATA) throw new Error('Se alcanzó el espacio reservado para imágenes e historial. Usa una imagen más pequeña o conserva solo la nota.')
}
