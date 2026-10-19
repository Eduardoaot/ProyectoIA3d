const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isId = (value) => typeof value === 'string' && value.trim().length > 0

function requireValue(condition, message) {
    if (!condition) throw new Error(message)
}

function uniqueIds(elements, label) {
    const ids = new Set()
    for (const element of elements) {
        requireValue(isObject(element) && isId(element.id), `${label}: cada elemento necesita un id.`)
        requireValue(!ids.has(element.id), `${label}: el id «${element.id}» está repetido.`)
        ids.add(element.id)
    }
    return ids
}

// Import a complete plant, or the working plant in a saved project. Never lay
// out machines here: missing coordinates require a correction in the source.
export function parsePlantJSON(text) {
    let data
    try {
        data = JSON.parse(text.replace(/^\uFEFF/, ''))
    } catch {
        throw new Error('El archivo no contiene JSON válido.')
    }
    requireValue(isObject(data), 'El JSON debe contener una planta o un proyecto.')
    const source = Array.isArray(data.stations) ? data : (data.draft ?? data.plant)
    requireValue(isObject(source), 'No se encontró una planta en el archivo.')

    const plant = { zones: [], walls: [], gates: [], routes: [], params: {}, ...source }
    requireValue(typeof plant.name === 'string' && plant.name.trim().length > 0, 'La planta necesita un nombre.')
    requireValue(isObject(plant.size) && isNumber(plant.size.w) && plant.size.w > 0 && isNumber(plant.size.d) && plant.size.d > 0, 'El ancho y el fondo de la planta deben ser números mayores que cero.')
    for (const key of ['stations', 'zones', 'walls', 'gates', 'routes']) {
        requireValue(Array.isArray(plant[key]), `El campo «${key}» debe ser una lista.`)
        uniqueIds(plant[key], key)
    }
    requireValue(isObject(plant.layout), 'Falta el acomodo de las estaciones (layout).')
    requireValue(isObject(plant.params), 'El campo «params» debe ser un objeto.')

    const stationIds = new Set(plant.stations.map((station) => station.id))
    for (const station of plant.stations) {
        requireValue(typeof station.name === 'string' && typeof station.kind === 'string', `La estación «${station.id}» necesita nombre y tipo.`)
        requireValue(isNumber(station.w) && station.w > 0 && isNumber(station.d) && station.d > 0, `La estación «${station.id}» necesita dimensiones positivas.`)
        const position = plant.layout[station.id]
        requireValue(Array.isArray(position) && position.length >= 2 && position.length <= 3 && position.every(isNumber), `Falta una posición válida para «${station.id}». No se reubicará automáticamente.`)
    }
    for (const route of plant.routes) {
        requireValue(stationIds.has(route.from) && stationIds.has(route.to), `La ruta «${route.id}» apunta a una estación que no existe.`)
        requireValue(route.frac == null || (isNumber(route.frac) && route.frac >= 0 && route.frac <= 1), `La fracción de la ruta «${route.id}» debe estar entre 0 y 1.`)
    }
    for (const zone of plant.zones) {
        requireValue(typeof zone.name === 'string' && typeof zone.kind === 'string' && ['x', 'z', 'w', 'd'].every((key) => isNumber(zone[key])) && zone.w > 0 && zone.d > 0, `La zona «${zone.id}» necesita nombre, tipo y dimensiones válidas.`)
    }
    for (const wall of plant.walls) {
        requireValue(['x1', 'z1', 'x2', 'z2'].every((key) => isNumber(wall[key])), `La pared «${wall.id}» necesita coordenadas válidas.`)
    }
    for (const gate of plant.gates) {
        requireValue(isNumber(gate.x), `El portón «${gate.id}» necesita una posición válida.`)
    }
    for (const key of ['receive_gate', 'dispatch_gate']) {
        requireValue(plant[key] == null || plant.gates.some((gate) => gate.id === plant[key]), `El campo «${key}» apunta a un portón que no existe.`)
    }
    return plant
}

export async function readPlantFile(file) {
    requireValue(file && typeof file.text === 'function', 'Selecciona un archivo JSON.')
    requireValue(file.size <= 5 * 1024 * 1024, 'El archivo supera el límite de 5 MB.')
    return parsePlantJSON(await file.text())
}
