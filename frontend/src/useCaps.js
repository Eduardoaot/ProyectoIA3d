import { useEffect, useState } from 'react'
import { loadCapabilities, NO_CAPS } from './capabilities'

/* Funciones que anuncia el backend. Una sola consulta por sesión (capabilities.js la guarda).
   Si el backend todavía no contesta, se vuelve a preguntar cada pocos segundos. */
export default function useCaps() {
    const [caps, setCaps] = useState(NO_CAPS)
    useEffect(() => {
        let alive = true
        let timer
        const load = (attempt) =>
            loadCapabilities().then((c) => {
                if (!alive) return
                setCaps(c)
                if (c === NO_CAPS && attempt < 40) timer = setTimeout(() => load(attempt + 1), 3000)
            })
        load(0)
        return () => {
            alive = false
            clearTimeout(timer)
        }
    }, [])
    return caps
}
