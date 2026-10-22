import { useEffect, useState } from 'react'

const name = (p) => p.provider === 'gemini' ? 'Gemini API' : p.provider === 'ollama' ? 'Ollama (local)' : p.provider

export default function ContextProviderStatus() {
    const [provider, setProvider] = useState(null)
    useEffect(() => {
        if (!document.cookie.split('; ').some((c) => c.startsWith('cauce_ai_session='))) {
            document.cookie = `cauce_ai_session=${crypto.randomUUID()}; Path=/; SameSite=Strict`
        }
        const controller = new AbortController()
        let timer
        const refresh = async () => {
            try {
                const response = await fetch('/api/context/provider', { cache: 'no-store', signal: controller.signal })
                if (!response.ok) throw new Error('No disponible')
                setProvider(await response.json())
            } catch (error) {
                if (error.name !== 'AbortError') setProvider({ unavailable: true })
            } finally {
                if (!controller.signal.aborted) timer = setTimeout(refresh, 1000)
            }
        }
        refresh()
        return () => { controller.abort(); clearTimeout(timer) }
    }, [])
    const calls = provider?.calls || []
    const running = calls.filter((c) => c.state === 'running')
    const latest = [...calls].sort((a, b) => b.updated - a.updated)[0]
    const visible = running.length ? running : latest ? [latest] : []
    return <div className="context-provider-summary" role="status" aria-live="polite">
        <strong>IA del contexto: </strong>
        {!provider ? 'Consultando…' : provider.unavailable ? 'Sin conexión con el backend' : `Configurado: ${name(provider)} · ${provider.model}`}
        {visible.map((call) => <div key={call.id}>
            <strong>{call.state === 'running' ? 'Procesando con' : call.state === 'failed' ? 'Falló la llamada a' : 'Última llamada completada con'} {name(call)} · {call.model}</strong>
            <span> · {call.role}{call.detail ? `: ${call.detail}` : ''}</span>
        </div>)}
        {!visible.length && <small>Todavía no se ha registrado una llamada de IA en este navegador.</small>}
        {latest?.state === 'completed' && !running.length && <small>La llamada terminó; la revisión y construcción del plano pueden continuar.</small>}
    </div>
}
