import { current } from './context.js'

export async function workspaceRequest(path, { method = 'GET', body, signal, binary = false } = {}) {
    const response = await fetch(`/api/workspaces${path}`, {
        method, signal,
        ...(body === undefined ? {} : { headers: binary ? {} : { 'Content-Type': 'application/json' }, body: binary ? body : JSON.stringify(body) }),
    })
    if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        const error = new Error(typeof result.detail === 'string' ? result.detail : `La operación respondió ${response.status}`)
        error.status = response.status
        throw error
    }
    return response.json()
}

export function acceptedContext(project, segmented = true) {
    const original = project.context || { segments: {} }
    const context = typeof original === 'string' ? { story: original, segments: {} } : original
    const clean = Object.fromEntries(Object.entries(context.segments || {}).map(([topic, list]) => [topic, list.map(({ image: _image, ...item }) => item)]))
    if (!segmented) return undefined
    return { segments: clean, master: acceptedMaster(project), original_text: project.text || '',
        activities: (project.contextWorkspace?.activities || []).filter((a) => a.status === 'confirmed'),
        operators: (project.contextWorkspace?.operators || []).filter((o) => o.status === 'confirmed'),
    }
}

export function acceptedMaster(project) {
    const draft = project.contextWorkspace?.masterDraft
    if (draft?.schema_version !== 2) return null
    const accepted = new Map(current(project.context).map((entry) => [entry.evidence?.proposal_id, entry]))
    const facts = draft.facts.filter((fact) => accepted.has(fact.id)).map((fact) => {
        const entry = accepted.get(fact.id)
        const changed = String(entry.value) !== String(fact.value)
        return { ...fact, value: entry.value, topic: entry.segment || fact.topic, status: 'confirmed', ...(changed ? { scope: 'uncertain', needs_reinterpretation: true } : {}) }
    })
    return { ...draft, facts, status: facts.length ? 'accepted' : 'unaccepted', draft_revision: draft.revision }
}
