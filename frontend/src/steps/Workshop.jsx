import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { api, pct } from '../api'
import { Appear, CountUp, RevealTitle } from '../fx/Reveal'

const LEVELS = [
    { at: 0, name: 'Taller desordenado' },
    { at: 150, name: 'Taller en marcha' },
    { at: 350, name: 'Flujo ordenado' },
    { at: 600, name: 'Maestro del flujo' },
]

const BADGE_ICONS = {
    plano: <path d="M10 54 V10 H54 V54 M10 54 H24 M40 54 H54" />,
    flujo: <path d="M18 54 V26 C18 14 24 10 32 10 C40 10 46 14 46 26 V54" />,
    cero: <path d="M12 32 A20 20 0 1 0 52 32 A20 20 0 1 0 12 32 M20 44 L44 20" />,
    despacho: <path d="M8 44 H44 V22 H28 M44 32 H56 V44 M16 44 a5 5 0 1 0 0.1 0 M44 44 a5 5 0 1 0 0.1 0" />,
    equipo: <path d="M32 12 L52 24 V42 L32 54 L12 42 V24 Z M32 12 V54 M12 24 L52 42" />,
    ruta: <path d="M10 50 L26 30 L36 40 L54 14 M44 14 H54 V24" />,
}

function Check({ on }) {
    return (
        <svg viewBox="0 0 18 18" aria-hidden="true">
            {on && <path d="M3 9.5 L7.5 14 L15 4" fill="none" stroke="currentColor" strokeWidth="2.6" />}
        </svg>
    )
}

export default function Workshop({ context, chosen, game, setGame, notify }) {
    const [loading, setLoading] = useState(false)
    const [source, setSource] = useState(null)
    const cur = context.analysis.current
    const saved = chosen?.metrics ? Math.max(0, -pct(cur.piece_m, chosen.metrics.piece_m)) : 0
    const missionPts = game.missions.filter((m) => game.done[m.titulo]).reduce((a, m) => a + (m.puntos || 0), 0)
    const points = missionPts + (chosen ? 150 : 0) + Math.round(saved * 5)
    const lvl = LEVELS.reduce((n, l, i) => (points >= l.at ? i : n), 0)
    const next = LEVELS[lvl + 1]
    const prevLevel = useRef(lvl)

    useEffect(() => {
        if (lvl > prevLevel.current) notify(`Subiste a «${LEVELS[lvl].name}»`)
        prevLevel.current = lvl
    }, [lvl, notify])

    useEffect(() => {
        if (game.missions.length) return
        
        let live = true
        setLoading(true)

        api
        .missions(context)
        .then((r) => {
            if (!live) return
            setSource(r.source)
            setGame((g) => ({ ...g, missions: r.missions }))
        })
        .catch(() => {})
        .finally(() => live && setLoading(false))

        return () => {
            live = false
        }
    }, [])

    const toggle = (m) => {
        const was = !!game.done[m.titulo]
        setGame((g) => ({ ...g, done: { ...g.done, [m.titulo]: !was } }))
        if (!was) notify(`+${m.puntos} puntos: ${m.titulo}`)
    }

    const shifts = useMemo(() => {
        const by = {}

        for (const m of game.missions) {
            const k = m.turno || 'Todo el día'
            by[k] ||= { total: 0, done: 0 }
            by[k].total += m.puntos || 0
            if (game.done[m.titulo]) by[k].done += m.puntos || 0
        }

        return Object.entries(by)
    }, [game])

    const done = game.missions.filter((m) => game.done[m.titulo]).length
    const badges = [
        { id: 'plano', name: 'Primer plano', on: true },
        { id: 'ruta', name: 'Recorrido corto', on: saved >= 25 },
        { id: 'flujo', name: 'Maestro del flujo', on: chosen?.id === 'propio' },
        { id: 'despacho', name: 'Equipo en marcha', on: done >= 2 },
        { id: 'cero', name: 'Cero desperdicios', on: game.missions.length > 0 && done === game.missions.length },
        { id: 'equipo', name: 'Equipo completo', on: points >= 600 },
    ]

    return (
        <section className="step">
            <header className="step-head">
                <span className="step-index"><b>Extra</b><span>Taller de mejora</span></span>
                <RevealTitle text="Que el equipo también juegue." />
                <p className="lede">La mejora continua funciona cuando llega al piso de planta. Elegir un rediseño, acortar el recorrido y cumplir misiones por equipo suma puntos.</p>
            </header>

            <Appear className="level">
                <div className="points num">
                    <CountUp value={points} />
                </div>

                <div>
                    <span className="small">
                        Nivel {lvl + 1} de {LEVELS.length}
                    </span>

                    <h2>{LEVELS[lvl].name}</h2>
                    <p className="small">{next ? `Te faltan ${next.at - points} puntos para «${next.name}».` : 'Llegaste al nivel más alto.'}</p>

                    <div className="ladder">
                        {LEVELS.map((l, i) => (
                        <div key={l.name} className="ladder-step" data-on={i <= lvl}>
                            <motion.span initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.7, delay: 0.2 + i * 0.12 }} />
                            {l.name}
                        </div>
                        ))}
                    </div>
                </div>
            </Appear>

            <div className="grid-2" style={{ marginTop: 32, alignItems: 'start' }}>
                <Appear className="stack">
                    <h3>Misiones de hoy</h3>
                    {loading && <p className="small">Preparando misiones…</p>}

                    <div className="missions">
                        {game.missions.map((m) => (
                            <div key={m.titulo} className="mission" data-done={!!game.done[m.titulo]}>
                                <button type="button" className="check" onClick={() => toggle(m)} aria-pressed={!!game.done[m.titulo]} aria-label={`Marcar «${m.titulo}»`}>
                                    <Check on={!!game.done[m.titulo]} />
                                </button>

                                <div>
                                    <h3>{m.titulo}</h3>
                                    <p className="small">{m.detalle}</p>
                                    {m.turno && <span className="small">Turno: {m.turno}</span>}
                                </div>

                                <b className="num">+{m.puntos}</b>
                            </div>
                        ))}
                    </div>

                    {source && <span className="small">{source === 'ia' ? 'Misiones propuestas por la IA.' : 'Misiones por reglas (la IA no respondió).'}</span>}
                </Appear>

                <Appear className="stack" delay={0.1}>
                    <h3>Tablero por turno</h3>
                    <p className="small">Compiten los equipos, no las personas.</p>

                    <div className="board">
                        {shifts.map(([name, v]) => (
                            <div key={name} className="board-row">
                                <span style={{ fontWeight: 650 }}>{name}</span>

                                <div className="board-bar">
                                    <motion.span initial={false} animate={{ width: `${v.total ? (v.done / v.total) * 100 : 0}%` }} transition={{ duration: 0.7 }} />
                                </div>

                                <span className="num">{v.done} / {v.total}</span>
                            </div>
                        ))}
                        {shifts.length === 0 && <span className="small">Aún no hay misiones.</span>}
                    </div>
                </Appear>
            </div>

            <Appear style={{ marginTop: 40 }}>
                <h3 style={{ marginBottom: 14 }}>Insignias</h3>
                
                <div className="badges">
                    {badges.map((b) => (
                        <div key={b.id} className="badge" data-on={b.on}>
                        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" strokeLinecap="square">
                            {BADGE_ICONS[b.id]}
                        </svg>
                        {b.name}
                        </div>
                    ))}
                </div>
            </Appear>
        </section>
    )
}