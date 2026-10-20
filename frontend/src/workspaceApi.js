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
    return { segments: clean,
        activities: (project.contextWorkspace?.activities || []).filter((a) => a.status === 'confirmed'),
        operators: (project.contextWorkspace?.operators || []).filter((o) => o.status === 'confirmed'),
    }
}
