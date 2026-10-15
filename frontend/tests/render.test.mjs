import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { fixture } from './helpers.mjs'

let server
let Story
let ReportDoc
let chosen
before(async () => {
    server = await createServer({
        server: { middlewareMode: true }, appType: 'custom', logLevel: 'error',
        plugins: [{
            name: 'test-browser-logo',
            enforce: 'pre',
            // FlowMark samples SVG lengths through document during render.
            // Only the decorative logo is stubbed; report/plan code stays real.
            load(id) {
                if (id.replaceAll('\\', '/').endsWith('/src/brand/FlowMark.jsx')) {
                    return 'export default function FlowMark() { return null }'
                }
            },
        }],
    })
    Story = (await server.ssrLoadModule('/src/steps/Story.jsx')).default
    ReportDoc = (await server.ssrLoadModule('/src/report/ReportDoc.jsx')).default
    chosen = (await server.ssrLoadModule('/src/project.js')).chosen
})
after(async () => { await server?.close() })

for (const version of ['v2', 'v3']) {
    test(`the editor renders every station and the JSON import button with ${version}`, async () => {
        const plant = await fixture(`transformadores-${version}`)
        const html = renderToStaticMarkup(createElement(Story, {
            text: '', draft: plant, info: { source: 'Archivo JSON', notes: [] },
            catalog: { kinds: [], assumptions: [] },
        }))
        assert.match(html, /Importar proyecto \(JSON\)/)
        assert.match(html, /Importado desde JSON/)
        assert.match(html, /Archivo de proyecto JSON/)
        for (const station of plant.stations) assert.ok(html.includes(station.name), station.name)
        assert.doesNotMatch(html, /Según la interpretación de la IA/)
    })

    test(`the printable report supports ${version} analysis and legacy saved projects`, async () => {
        const plant = await fixture(`transformadores-${version}`)
        const analysis = await fixture(`analyze-${version}`)
        const project = { plant, analysis, redesign: { choice: analysis.recommended } }
        const selection = chosen(project)
        assert.equal(selection.id, analysis.recommended)
        const html = renderToStaticMarkup(createElement(ReportDoc, {
            plant, analysis, chosen: selection, reportText: (await fixture('report-v2')).body,
        }))
        assert.ok(html.includes(plant.name))
        assert.ok(html.includes(selection.name))
        assert.match(html, /Reporte de distribución de planta/)
        assert.doesNotMatch(html, /NaN|undefined/)
    })
}
