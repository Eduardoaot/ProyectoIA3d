// Optional real-browser smoke. Uses an isolated Chrome profile, an existing Vite
// preview at CAUCE_PREVIEW_URL, and API fixtures; no browser packages are needed.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const previewUrl = process.env.CAUCE_PREVIEW_URL || 'http://127.0.0.1:5173'
const browserPath = process.env.CAUCE_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = await mkdtemp(join(tmpdir(), 'cauce-context-browser-'))
const txtFile = join(profile, 'tiempos-medidos.txt')
const pdfFile = join(profile, 'estudio-pendiente.pdf')
await writeFile(txtFile, 'El tiempo de corte observado es de 12 minutos por pieza.\nFuente: medición de prueba.')
await writeFile(pdfFile, '%PDF-1.4\nDocumento de prueba sin extracción de texto.\n%%EOF')
const fixture = JSON.parse(await readFile(new URL('../../pruebas/transformadores-v3.json', import.meta.url), 'utf8'))
const capabilities = JSON.parse(await readFile(new URL('./fixtures/capabilities-full.json', import.meta.url), 'utf8'))
const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,1100', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
let socket
try {
    let port
    for (let i = 0; i < 150; i++) {
        try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break } catch { await pause(100) }
    }
    assert.ok(port, 'Browser debugging port is ready')
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    socket = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    let id = 0
    const pending = new Map(), exceptions = []
    socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data)
        if (message.id && pending.has(message.id)) {
            const p = pending.get(message.id); pending.delete(message.id); clearTimeout(p.timer)
            if (message.error) p.reject(Error(message.error.message))
            else p.resolve(message.result)
        }
        if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text + ': ' + (message.params.exceptionDetails.exception?.description || ''))
    })
    const call = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(Error(`Timeout: ${method}`)) }, 20000); pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params })) })
    const evaluate = async (expression) => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value }
    const until = async (expression) => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await pause(100) } throw Error(`Condition not met: ${expression}`) }
    const click = async (label, scope = 'document') => {
        const selector = `[...${scope}.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)}))`
        await until(`!!(${selector})`)
        assert.equal(await evaluate(`${selector}.disabled`), false, `${label} must be enabled`)
        await evaluate(`${selector}.click()`); await pause(120)
    }
    const fill = async (selector, value) => {
        await evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing input: '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`)
        await pause(100)
    }
    const attach = async (selector, files) => {
        const documentNode = await call('DOM.getDocument')
        const input = await call('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector })
        assert.ok(input.nodeId, `File input exists: ${selector}`)
        await call('DOM.setFileInputFiles', { nodeId: input.nodeId, files })
        await pause(450)
    }
    const stored = (path) => evaluate(`JSON.parse(localStorage.getItem('cauce-proyecto-v3'))${path}`)
    const go = async (topic) => {
        await evaluate(`[...document.querySelectorAll('.cw-nav-item')].find(b=>b.textContent.includes(${JSON.stringify(topic)})).click()`)
        await pause(160)
    }
    const screenshot = async (name) => {
        const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        const path = join(profile, name)
        await writeFile(path, Buffer.from(result.data, 'base64'))
        console.log(`Screenshot: ${path}`)
    }
    await call('Runtime.enable'); await call('Page.enable'); await call('DOM.enable')
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `
        window.__calls = [];
        if (!localStorage.getItem('cauce-smoke-initialized')) {
            localStorage.clear();
            localStorage.setItem('cauce-proyecto-v3', JSON.stringify({draft:${JSON.stringify(fixture)},info:{source:'Archivo JSON',notes:[]}}));
            localStorage.setItem('cauce-smoke-initialized', 'true');
        }
        const nativeFetch = window.fetch;
        window.fetch = async (path, options) => {
            if (!String(path).startsWith('/api/')) return nativeFetch(path, options);
            window.__calls.push({path,body:options?.body});
            if(path==='/api/capabilities') return Response.json(${JSON.stringify(capabilities)});
            if(path==='/api/health') return Response.json({extractor:{model:'smoke',ready:false},engineer:{model:'smoke',ready:false}});
            if(path==='/api/catalog') return Response.json({kinds:[],zones:[],assumptions:[]});
            if(path==='/api/routes') return Response.json({legs:[],piece_m:0,blocked_legs:0,avoid_hits:[]});
            return Response.json({});
        };
    ` })
    await call('Page.navigate', { url: previewUrl })
    await until("!!document.querySelector('.context-open') && !document.querySelector('.intro')")
    await evaluate("document.querySelector('.context-open').focus();document.querySelector('.context-open').click()")
    await pause(400)
    await screenshot('context-desktop.png')
    if (process.env.CAUCE_SMOKE_INSPECT) {
        console.log(await evaluate("JSON.stringify({buttons:[...document.querySelectorAll('[role=dialog] button')].map(b=>({text:b.textContent.trim(),label:b.getAttribute('aria-label')})),inputs:[...document.querySelectorAll('[role=dialog] input,[role=dialog] textarea,[role=dialog] select')].map(x=>({id:x.id,name:x.name,tag:x.tagName,type:x.type,label:x.getAttribute('aria-label'),placeholder:x.placeholder})),text:document.querySelector('[role=dialog]')?.innerText},null,2)"))
    } else {
        assert.ok(await evaluate("document.activeElement.matches('.cw-close')"), 'Dialog receives keyboard focus')
        const story = 'Fabricamos transformadores para clientes industriales. El corte tarda 12 minutos por pieza. Trabajan seis personas en producción.'
        await fill('#cw-story', story)
        await click('Organizar información')
        await until("document.querySelectorAll('.cw-proposal').length === 3")
        await pause(350)
        assert.equal(await stored('.text'), story, 'Original text is preserved')
        assert.equal(await stored('.context?.segments && Object.values(JSON.parse(localStorage.getItem(\'cauce-proyecto-v3\')).context.segments).flat().length || 0'), 0, 'Proposals are not automatically confirmed facts')
        await click('Confirmar dato', "document.querySelector('.cw-proposal')")
        await click('Descartar', "document.querySelector('.cw-proposal')")
        await pause(350)
        const discardedId = await stored(".contextWorkspace.proposals.find(p=>p.status==='discarded').id")
        await click('Organizar información')
        await pause(350)
        const proposals = await stored('.contextWorkspace.proposals')
        assert.equal(new Set(proposals.map(p => p.id)).size, proposals.length, 'Reorganizing discarded text preserves unique proposal IDs')
        assert.equal(proposals.find(p => p.id === discardedId).status, 'discarded', 'Discard history remains intact')
        console.log('Passed: editable proposals require confirmation, preserve original text, and can be proposed again after discard.')

        await go('Tiempos')
        await click('+ Agregar dato')
        assert.equal(await evaluate("document.querySelectorAll('.cw-manual-form .cw-field').length"), 2, 'Manual entry asks only for title and description')
        await fill('.cw-manual-form input', 'Tiempo de corte observado')
        await fill('.cw-manual-form textarea', '12 min/pieza, medido por Laura durante la última semana')
        await click('Agregar al contexto')
        await until("document.querySelector('.cw-data-value')?.textContent?.includes('12 min/pieza')")
        await click('Corregir', "document.querySelector('.cw-data')")
        await fill('.cw-manual-form textarea', '14 min/pieza, medido por Laura durante la última semana')
        await click('Guardar corrección')
        await pause(350)
        assert.equal(await stored('.context.segments.tiempos.length'), 2)
        assert.ok(await evaluate("document.querySelector('.cw-history').textContent.includes('12 min/pieza')"), 'Correction preserves old description in history')
        assert.ok(await evaluate("document.querySelector('.cw-data-value').textContent.includes('14 min/pieza')"))
        await click('+ Adjuntar archivo')
        await attach('.context-workspace > input[type=file]', [txtFile, pdfFile])
        await until("document.querySelectorAll('.cw-file').length === 2")
        await pause(350)
        const attached = await stored('.contextWorkspace.attachments')
        assert.equal(attached.find(f => f.name.endsWith('.txt')).status, 'text_extracted')
        assert.equal(attached.find(f => f.name.endsWith('.pdf')).status, 'pending')
        assert.ok(attached.find(f => f.name.endsWith('.txt')).text.includes('12 minutos'))
        assert.equal(attached.find(f => f.name.endsWith('.pdf')).text, undefined)
        assert.ok(await evaluate("document.querySelector('.cw-file-list').textContent.includes('pendiente de lectura')"))
        console.log('Passed: manual facts, correction history, real TXT extraction, and pending PDF status.')

        await go('Estudios del trabajo')
        await click('Adjuntar estudio')
        await attach('.context-workspace > input[type=file]', [pdfFile])
        await until("document.querySelector('.work-studies__sources') != null")
        await click('+ Agregar actividad')
        assert.equal(await evaluate("document.querySelector('.work-studies__activity-top').getAttribute('aria-expanded')"), 'true')
        await fill('.work-studies input[id$="-description"]', 'Inspeccionar acabado')
        await fill('.work-studies select[id$="-type"]', 'inspeccion')
        await fill('.work-studies select[id$="-station"]', fixture.stations[1].id)
        const sourceId = await evaluate("document.querySelector('.work-studies select[id$=\"-source\"]').options[1].value")
        await fill('.work-studies select[id$="-source"]', sourceId)
        await pause(350)
        const activity = await stored('.contextWorkspace.activities[0]')
        assert.equal(activity.time, '')
        assert.equal(activity.distance, '')
        assert.equal(activity.stationId, fixture.stations[1].id)
        assert.equal(activity.sourceId, sourceId)
        assert.equal(activity.type, 'inspeccion')
        await click('01', "document.querySelector('.work-studies__activity')")
        assert.equal(await evaluate("document.querySelector('.work-studies__activity-top').getAttribute('aria-expanded')"), 'false')
        console.log('Passed: study activities retain blank unknown measurements and link to actual stations and documents.')

        await go('Prioridades de decisión')
        await fill('.cw-weight input[type=number]', '50')
        assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Guardar prioridades')).disabled"), true)
        await click('Distribuir al 100 %')
        await click('Guardar prioridades')
        await pause(350)
        const weights = await stored('.weights')
        assert.ok(Math.abs(Object.values(weights).reduce((s, w) => s + w, 0) - 1) < 0.005)
        await go('Así entendimos tu planta')
        await click('Sí, confirmar esta versión')
        await until("document.querySelector('.cw-review-status').textContent.includes('Esta versión está confirmada')")
        await pause(350)
        const firstConfirmation = await stored('.context2Ok')
        assert.ok(firstConfirmation)
        await screenshot('context-review-desktop.png')
        await go('Cuéntanos tu planta')
        await fill('#cw-story', `${story} El horno debe permanecer fijo.`)
        await go('Así entendimos tu planta')
        assert.ok(await evaluate("document.querySelector('.cw-review-status').textContent.includes('Tu revisión está pendiente')"), 'Editing context invalidates confirmation')
        assert.equal(await evaluate("window.__calls.filter(c=>c.path==='/api/analyze').length"), 0, 'No automatic calculation from context edits')
        await click('Sí, confirmar esta versión')
        await pause(350)
        assert.notEqual(await stored('.context2Ok'), firstConfirmation)
        console.log('Passed: normalized priorities, explicit review, confirmation invalidation, and no automatic analysis.')

        await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await until("!document.querySelector('.context-workspace')")
        await until("document.activeElement.matches('.context-open')")
        assert.ok(await evaluate("document.activeElement.matches('.context-open')"), 'Escape restores focus to the opening control')
        const reloaded = new Promise((resolve, reject) => {
            const timer = setTimeout(() => { socket.removeEventListener('message', listener); reject(Error('Reload timed out')) }, 20000)
            const listener = (event) => {
                if (JSON.parse(event.data).method === 'Page.loadEventFired') {
                    clearTimeout(timer)
                    socket.removeEventListener('message', listener)
                    resolve()
                }
            }
            socket.addEventListener('message', listener)
        })
        await call('Page.reload')
        await reloaded
        await until("!!document.querySelector('.context-open') && !document.querySelector('.intro')")
        await evaluate("document.querySelector('.context-open').focus();document.querySelector('.context-open').click()")
        await until("!!document.querySelector('#cw-story')")
        assert.equal(await evaluate("document.querySelector('#cw-story').value"), `${story} El horno debe permanecer fijo.`)
        await go('Así entendimos tu planta')
        assert.ok(await evaluate("document.querySelector('.cw-review-status').textContent.includes('Esta versión está confirmada')"), 'Confirmation survives reload')
        assert.equal(await stored('.contextWorkspace.attachments.length'), 3)
        assert.equal(await stored('.contextWorkspace.activities.length'), 1)
        await go('Tiempos')
        assert.ok(await evaluate("document.querySelector('.cw-data-value').textContent.includes('14 min/pieza')"))
        assert.equal(await evaluate("document.querySelectorAll('.cw-file').length"), 2)
        // Exercise IndexedDB retrieval through the actual download helper after reload.
        await click('Descargar', "document.querySelector('.cw-file')")
        assert.ok(!await evaluate("document.querySelector('.cw-notice')?.textContent.includes('no está')"))
        console.log('Passed: keyboard close/focus restoration, project persistence, and stored original attachment retrieval.')

        await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
        for (const topic of ['Cuéntanos tu planta', 'Tiempos', 'Estudios del trabajo', 'Prioridades de decisión', 'Así entendimos tu planta', 'Imágenes y layouts']) {
            await go(topic)
            const sizes = await evaluate("(() => {const d=document.querySelector('.context-workspace'),c=document.querySelector('.cw-content');return {dialog:d.scrollWidth,width:d.clientWidth,content:c.scrollWidth,contentWidth:c.clientWidth,body:document.documentElement.scrollWidth,viewport:innerWidth}})()")
            assert.equal(sizes.width, 390, `Dialog fits the physical mobile viewport: ${topic} ${JSON.stringify(sizes)}`)
            assert.ok(sizes.dialog <= sizes.width + 1 && sizes.content <= sizes.contentWidth + 1 && sizes.body <= sizes.viewport + 1, `No horizontal content overflow at 390px: ${topic} ${JSON.stringify(sizes)}`)
        }
        await go('Cuéntanos tu planta')
        await screenshot('context-mobile.png')
        await go('Estudios del trabajo')
        await screenshot('context-study-mobile.png')
        console.log('Passed: six mobile views fit 390px; horizontal topic navigation remains scrollable.')
        assert.deepEqual(exceptions, [], 'No uncaught browser errors')
        console.log('Context workspace browser smoke passed.')
    }
} finally {
    socket?.close()
    browser.kill()
}
