// Read-only capture: print JSON to stdout; never alter the backend or fixtures.
// Run against the reference backend, with Ollama unavailable for a reproducible
// capture of its own fallback report (see docs/editor.md).
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const base = process.argv[2] || 'http://127.0.0.1:8017'
const raw = await readFile(new URL('../../pruebas/transformadores.json', import.meta.url))
const plant = JSON.parse(raw.toString('utf8'))
const request = async (path, body) => {
    const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) throw new Error(`${path}: ${response.status}`)
    return response
}
const analysis = await (await request('/api/analyze', { plant })).json()
const selected = analysis.alternatives.find((alternative) => alternative.id === analysis.recommended)
const reportContext = { plant, analysis, redesign: { name: selected.name, metrics: selected.metrics } }
const response = await request('/api/report', reportContext)
const report = { status: response.status, content_type: response.headers.get('content-type'), body: await response.text() }
const capabilities = await fetch(`${base}/api/capabilities`, { signal: AbortSignal.timeout(5000) })
console.log(JSON.stringify({
    plant,
    analysis,
    report,
    metadata: {
        backend_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        source: 'pruebas/transformadores.json',
        source_sha256: createHash('sha256').update(raw).digest('hex'),
        capabilities_status: capabilities.status,
        report_redesign: selected.id,
    },
}))
