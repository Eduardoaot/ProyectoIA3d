/* Las alternativas son propuestas: se ven y, si el usuario quiere, se aplican.
   Nada de aquí calcula métricas; solo decide qué posiciones se conservan. */

/* Elementos fijos de la planta (estaciones con locked). Las zonas no se mueven nunca. */
export const lockedIds = (plant) => (plant?.stations || []).filter((s) => s.locked).map((s) => s.id)

const samePlace = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1] && (a[2] || 0) === (b[2] || 0)

/* Al aplicar una alternativa, los fijos conservan su lugar aunque la respuesta los haya movido.
   Funciona igual con un backend que no conoce locked. */
export function protectLocked(plant, base, proposed) {
    const positions = { ...proposed }
    const moved = []
    for (const id of lockedIds(plant)) {
        if (!base?.[id]) continue
        if (!samePlace(proposed?.[id], base[id])) moved.push(plant.stations.find((s) => s.id === id)?.name || id)
        positions[id] = [...base[id]]
    }
    return { positions, moved }
}

/* El resultado se calculó con otra revisión del plano: hay que avisarlo, no recalcular solo. */
export const isStale = (project) => !!project?.analysis && (project.draftRev || 0) !== (project.analysisRev || 0)

/* Lee el resumen de validación que el backend agrega al final del informe (validate.TRAILER). */
export const TRAILER = '\u001e'

export function splitValidation(text) {
    const i = text.indexOf(TRAILER)
    if (i < 0) return { text, validation: null }
    let validation = null
    try {
        validation = JSON.parse(text.slice(i + 1)).validation || null
    } catch {
        validation = null
    }
    return { text: text.slice(0, i).replace(/\n$/, ''), validation }
}
