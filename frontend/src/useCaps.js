import { useEffect, useState } from 'react'
import { loadCapabilities, NO_CAPS } from './capabilities'

/* Funciones que anuncia el backend. Una sola consulta por sesión (capabilities.js la guarda). */
export default function useCaps() {
    const [caps, setCaps] = useState(NO_CAPS)
    useEffect(() => {
        let alive = true
        loadCapabilities().then((c) => alive && setCaps(c))
        return () => {
            alive = false
        }
    }, [])
    return caps
}
