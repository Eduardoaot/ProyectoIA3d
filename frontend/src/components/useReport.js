import { useCallback, useEffect, useRef, useState } from 'react'
import { stream } from '../api'
import { splitValidation } from '../proposals'

/* withValidation: el backend anuncia report_validation y agrega al final qué afirmaciones descartó. */
export default function useReport(context, version, withValidation = false) {
    const [text, setText] = useState('')
    const [validation, setValidation] = useState(null)
    const [state, setState] = useState('idle') // idle | running | done | error
    const ctl = useRef(null)
    const ctx = useRef(context)
    const wv = useRef(withValidation)
    useEffect(() => {
        ctx.current = context
        wv.current = withValidation
    }, [context, withValidation])

    const run = useCallback(() => {
        if (!ctx.current?.plant) return
        ctl.current?.abort()
        const c = new AbortController()
        ctl.current = c
        let raw = ''
        setText('')
        setValidation(null)
        setState('running')
        const body = wv.current ? { ...ctx.current, with_validation: true } : ctx.current
        stream(
            '/api/report',
            body,
            (t) => {
                raw += t
                const out = splitValidation(raw)
                setText(out.text)
                if (out.validation) setValidation(out.validation)
            },
            c.signal,
        )
            .then(() => setState('done'))
            .catch((e) => {
                if (e.name !== 'AbortError') setState('error')
            })
    }, [])

    useEffect(() => () => ctl.current?.abort(), [])

    useEffect(() => {
        ctl.current?.abort()
        setText('')
        setValidation(null)
        setState('idle')
    }, [version])

    return { text, state, run, validation }
}
