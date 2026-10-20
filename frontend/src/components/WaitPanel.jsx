import { useEffect, useState } from 'react'
import LoadingGame from './LoadingGame'
import { expected } from './wait'

const clock = (s) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`)

/* Barra que llega al 90 % en el tiempo esperado y luego avanza cada vez más lento:
   nunca se llena antes de que la respuesta llegue. */
function progress(elapsed, est) {
    if (elapsed <= est) return (0.9 * elapsed) / est
    return 0.9 + 0.08 * (1 - Math.exp(-(elapsed - est) / est))
}

export default function WaitPanel({ kind, title, game = 'Juega mientras la IA trabaja', className = '' }) {
    const [elapsed, setElapsed] = useState(0)
    const [est] = useState(() => expected(kind))

    useEffect(() => {
        const t0 = Date.now()
        const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250)
        return () => clearInterval(id)
    }, [])

    const p = progress(elapsed, est)
    const left = est - elapsed

    return (
        <div className={`block reading ${game ? '' : 'reading--bare'} ${className}`} aria-label={title}>
            <div className="reading-head">
                <div className="dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                </div>
                <p>{title}</p>
                <span className="wait-clock num" aria-label={`Van ${elapsed} segundos`}>
                    {clock(elapsed)}
                </span>
            </div>

            <div className="wait-meter">
                <div className="wait-bar" aria-hidden="true">
                    <span style={{ transform: `scaleX(${p})` }} />
                </div>
                <div className="wait-info small num">
                    <span>Avance estimado: {Math.round(p * 100)} %</span>
                    <span>{left > 0 ? `Faltan unos ${clock(Math.max(1, Math.round(left)))} (suele tardar ${clock(est)})` : `Tarda más de lo normal (suele tardar ${clock(est)}). Ya casi.`}</span>
                </div>
            </div>

            {game && <LoadingGame label={game} />}
        </div>
    )
}
