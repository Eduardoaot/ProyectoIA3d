// Optional real-browser smoke. Uses an isolated Chrome profile, an existing Vite
// preview at CAUCE_PREVIEW_URL, and API fixtures; no browser packages are needed.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const previewUrl = process.env.CAUCE_PREVIEW_URL || 'http://127.0.0.1:5187'
const browserPath = process.env.CAUCE_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = await mkdtemp(join(tmpdir(), 'cauce-context-browser-'))
const fixture = JSON.parse(await readFile(new URL('../../pruebas/transformadores-v3.json', import.meta.url), 'utf8'))
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
    const until = async (expression) => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await pause(100) } console.error({ exceptions, page: await evaluate('document.body.innerText.slice(0,2500)') }); throw Error(`Condition not met: ${expression}`) }
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
        if(!localStorage.getItem('data-smoke')) {
            localStorage.clear();
            localStorage.setItem('cauce-proyecto-v3',JSON.stringify({draft:${JSON.stringify(fixture)},info:{source:'Fixture de prueba',notes:[]}}));
            localStorage.setItem('data-smoke','true');
        }
    ` })
    await call('Page.navigate',{url:previewUrl})
    await until("!!document.querySelector('.context-open') && !document.querySelector('.intro')")
    await evaluate("document.querySelector('.context-open').click()")
    await until("!!document.querySelector('.cw-backend-tools')")
    await fill('#cw-story','Fabricamos transformadores. El horno no se puede mover. Trabajan seis personas.')
    await click('Organizar información')
    await until("document.querySelectorAll('.cw-proposal').length > 0 && !document.querySelector('.cw-content-inner[inert]')")
    await click('Confirmar todos los datos')
    await until("!document.querySelector('.cw-proposal') && !document.querySelector('.cw-content-inner[inert]')")
    await until("!!JSON.parse(localStorage.getItem('cauce-proyecto-v3')).serverRevision")
    assert.ok(await stored('.serverRevision'))
    console.log('Passed: real HTTP context jobs, persistence and batch acceptance (provider simulated).')
    await go('Estudios del trabajo')
    const text=Array.from({length:120},(_,i)=>`${i+1}. Cortar y revisar pieza ${i+1}`).join('\n')
    await fill('.cw-study-input textarea',text)
    await click('Organizar actividades del estudio')
    await until("document.querySelectorAll('.work-studies__activity').length === 120 && !document.querySelector('.cw-content-inner[inert]')")
    await click('Confirmar todas las actividades')
    await until("!document.querySelector('.cw-content-inner[inert]')")
    const activities=await stored('.contextWorkspace.activities')
    assert.equal(activities.length,120)
    assert.ok(activities.every(a=>a.status==='confirmed' && a.time===null && a.distance===null))
    console.log('Passed: 120 activities through the actual API; unknown values remain null.')
    await go('Personal')
    const csv=join(profile,'operadores.csv')
    await writeFile(csv,'nombre;maquina;turno;eficiencia;valoración de ritmo\nAna;Corte;Mañana;85%;110\nLuis;Horno;Noche;;\n')
    await click('+ Adjuntar archivo')
    await attach('.context-workspace > input[type=file]',[csv])
    await until("!!document.querySelector('.cw-file') && !document.querySelector('.cw-content-inner[inert]')")
    await click('Leer base de operadores')
    await until("document.querySelectorAll('.cw-result-table tbody tr').length === 2 && !document.querySelector('.cw-content-inner[inert]')")
    await click('Confirmar 2 operadores')
    await until("!document.querySelector('.cw-content-inner[inert]')")
    const operators=await stored('.contextWorkspace.operators')
    assert.ok(operators.every(o=>o.status==='confirmed' && o.calculated_efficiency===null))
    assert.equal(operators[0].efficiency_reported.raw,'85%')
    console.log('Passed: original CSV upload, operator import and explicit acceptance.')
    await go('Así entendimos tu planta')
    await click('Actualizar revisión y estudios')
    await until("!!document.querySelector('.cw-study-inventory') && !document.querySelector('.cw-content-inner[inert]')")
    assert.equal(await evaluate("document.querySelectorAll('.cw-result-table tbody tr').length"),120)
    await screenshot('backend-studies-review.png')
    await go('Prioridades de decisión')
    await evaluate("document.querySelector('.cw-priority-toggle input').click()")
    await pause(250)
    assert.equal(await stored('.prioritiesEnabled'),false)
    await go('Tiempos')
    await click('+ Agregar dato')
    await fill('.cw-manual-form input','Tiempo manual')
    await fill('.cw-manual-form textarea','12 minutos por pieza, observado por Laura')
    await click('Agregar al contexto')
    await click('Guardar copia del proyecto')
    await until("!document.querySelector('.cw-content-inner[inert]')")
    await pause(200)
    console.log('Passed: deliverables, coverage questions, optional priorities and manual edits persist.')
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
    for(const topic of ['Cuéntanos tu planta','Estudios del trabajo','Personal','Así entendimos tu planta']) {
        await go(topic)
        assert.ok(await evaluate("document.querySelector('.cw-content').scrollWidth <= document.querySelector('.cw-content').clientWidth+1"),`No mobile overflow: ${topic}`)
    }
    await screenshot('backend-mobile.png')
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false})
    await go('Mis proyectos')
    await fill('.cw-project-create-form input','Plano desde maestro')
    await click('Crear proyecto')
    await go('Cuéntanos tu planta')
    await fill('#cw-story','La bodega mide 32 x 16 m. Hay 1 horno. Horno de 2 x 2 m. El horno está al fondo a la derecha.')
    await click('Organizar información')
    await until("document.querySelectorAll('.cw-proposal').length === 6 && !document.querySelector('.cw-content-inner[inert]')")
    await click('Confirmar todos los datos')
    await until("!document.querySelector('.cw-proposal') && !document.querySelector('.cw-content-inner[inert]')")
    await click('Volver al proyecto')
    await click('Construir el plano desde mi contexto')
    await until("!!document.querySelector('.cw-construction-review')")
    const built=await stored('.draft')
    assert.deepEqual(built.size,{w:32,d:16})
    assert.equal(built.stations.length,1)
    const point=built.layout[built.stations[0].id]
    assert.ok(point[0]>32*2/3 && point[1]<16/3)
    assert.equal(await stored('.info.verification.status'),'verified')
    console.log('Passed: accepted master builds the requested layout and shows requirement verification without another model extraction.')
    assert.deepEqual(exceptions,[])
    console.log('Data backend browser integration passed.')
} finally {
    socket?.close()
    browser.kill()
}
