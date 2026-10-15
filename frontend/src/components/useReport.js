import { useCallback, useEffect, useRef, useState } from 'react'
import { stream } from '../api'

export default function useReport(context, version) {
    const [text, setText] = useState('')
    const [state, setState] = useState('idle') // idle | running | done | error
    const ctl = useRef(null)
    const ctx = useRef(context)
    useEffect(() => {
        ctx.current = context
    }, [context])

    const run = useCallback(() => {
        if (!ctx.current?.plant) return
        ctl.current?.abort()
        const c = new AbortController()
        ctl.current = c
        setText('')
        setState('running')
        stream('/api/report', ctx.current, (t) => setText((p) => p + t), c.signal)
        .then(() => setState('done'))
        .catch((e) => {
            if (e.name !== 'AbortError') setState('error')
        })
    }, [])

    useEffect(() => () => ctl.current?.abort(), [])
    
    useEffect(() => {
        ctl.current?.abort()
        setText('')
        setState('idle')
    }, [version])

    return { text, state, run }
}