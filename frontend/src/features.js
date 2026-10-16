export const DEFAULT_WEIGHTS = { manejo: 0.25, lead_time: 0.2, capacidad: 0.15, obra: 0.15, seguridad: 0.15, flexibilidad: 0.1 }
export const hasFeature = (capabilities, feature) => !!capabilities?.features?.includes(feature)
export function validWeights(weights) {
    return !!weights && Object.keys(DEFAULT_WEIGHTS).every((k) => typeof weights[k] === 'number' && Number.isFinite(weights[k]) && weights[k] >= 0 && weights[k] <= 1) && Math.abs(Object.values(weights).reduce((a, n) => a + n, 0) - 1) < 1e-8
}
