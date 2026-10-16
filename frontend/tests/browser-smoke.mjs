// Optional real-browser smoke, no additional packages. CAUCE_BROWSER may point
// to a Chromium executable. Uses an isolated temporary profile and mocked API.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { fixture } from './helpers.mjs'

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const browserPath = process.env.CAUCE_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const server = await createServer({ server: { host: '127.0.0.1', port: 5187, strictPort: true }, logLevel: 'error' })
await server.listen()
const profile = await mkdtemp(join(tmpdir(), 'cauce-browser-'))
const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,1100', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
let socket
try {
    let port
    for (let i = 0; i < 100; i++) {
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
        if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(Error(message.error.message)) : p.resolve(message.result) }
        if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text + ': ' + (message.params.exceptionDetails.exception?.description || ''))
    })
    const call = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(Error(`Timeout: ${method}`)) }, 15000); pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params })) })
    const evaluate = async (expression) => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value }
    const until = async (expression) => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100) } throw Error(`Condition not met: ${expression}`) }
    await call('Runtime.enable'); await call('Page.enable')
    const source = await fixture('transformadores-v2')
    const plant = { ...source, schema_version: 3, size: { w: 40, d: 20 }, zones: [], walls: [], conveyors: [], stations: source.stations.slice(0, 3).map((s) => ({ ...s, w: 3, d: 2 })), layout: { recepcion: [5, 5, 0], corte: [15, 5, 0], nucleo: [25, 5, 0] }, routes: source.routes.slice(0, 2) }
    const analysis = await fixture('analyze-v2'), full = await fixture('capabilities-full')
    for (const enabled of [false, true]) {
        const init = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
            window.__calls = [];
            localStorage.clear();
            localStorage.setItem('cauce-proyecto-v3', JSON.stringify({draft:${JSON.stringify(plant)},info:{source:'Archivo JSON',notes:[]}}));
            const nativeFetch = window.fetch;
            window.fetch = async (path, options) => {
                if (!String(path).startsWith('/api/')) return nativeFetch(path, options);
                window.__calls.push({path,body:options?.body});
                if(path==='/api/capabilities') return ${enabled} ? Response.json(${JSON.stringify(full)}) : new Response('',{status:404});
                if(path==='/api/health') return Response.json({extractor:{model:'test',ready:false},engineer:{model:'test',ready:false}});
                if(path==='/api/catalog') return Response.json({kinds:[],zones:[],assumptions:[]});
                if(path==='/api/routes') return Response.json({legs:[],piece_m:0,blocked_legs:0,avoid_hits:[]});
                if(path==='/api/analyze') return Response.json(${JSON.stringify(analysis)});
                if(path==='/api/plan/ops') return Response.json({ops:[{op:'move',id:'corte',to:{x:16,z:6}}],rejected:[{op:{op:'move',id:'fixed'},reason:'Fijo de prueba'}]});
                return Response.json({});
            };
        ` })
        await call('Page.navigate', { url: 'http://127.0.0.1:5187' })
        await until("!!document.querySelector('.editor') && !document.querySelector('.intro')")
        await pause(500)
        const button = (text) => `[...document.querySelectorAll('button')].find(b=>(b.querySelector('.btn-label-swap > span') || b).textContent.trim()===${JSON.stringify(text)})`
        assert.equal(await evaluate(`${button('Analizar')}.disabled`), true)
        await evaluate(`${button('Confirmar Contexto 2')}.click()`); await pause(100)
        assert.equal(await evaluate(`${button('Analizar')}.disabled`), false)
        await evaluate("document.querySelector('.editor-canvas svg').scrollIntoView({block:'center'})")
        const clickPoint = async (x, z, modifiers = 0) => {
            const point = await evaluate(`(() => { const svg=document.querySelector('.editor-canvas svg'); const pt=svg.createSVGPoint();pt.x=${x};pt.y=${z}; const p=pt.matrixTransform(svg.getScreenCTM());return {x:p.x,y:p.y} })()`)
            await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point, modifiers })
            await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point, modifiers })
            await pause(80)
        }
        await clickPoint(5, 5); await clickPoint(15, 5, 8); await clickPoint(25, 5, 2)
        assert.ok(await evaluate("document.querySelector('.editor').textContent.includes('3 elementos seleccionados')"))
        await evaluate(`${button('Copiar')}.click()`); await pause(50)
        await evaluate(`${button('Pegar')}.click()`); await pause(400)
        assert.equal(await evaluate(`${button('Analizar')}.disabled`), true)
        assert.equal(await evaluate("JSON.parse(localStorage.getItem('cauce-proyecto-v3')).draft.stations.length"), 6)
        assert.equal(await evaluate("JSON.parse(localStorage.getItem('cauce-proyecto-v3')).draft.routes.length"), 4)
        await evaluate("document.querySelector('button[aria-label=Deshacer]').click()"); await pause(400)
        assert.equal(await evaluate("JSON.parse(localStorage.getItem('cauce-proyecto-v3')).draft.stations.length"), 3)
        assert.equal(await evaluate("window.__calls.filter(c=>c.path==='/api/analyze').length"), 0)
        assert.equal(await evaluate("!!document.querySelector('.plan-assistant')"), enabled)
        if (enabled) {
            await evaluate(`${button('Banda')}.click()`); await pause(80)
            await clickPoint(5, 5); await clickPoint(10, 10); await clickPoint(15, 5); await pause(400)
            assert.equal(await evaluate("JSON.parse(localStorage.getItem('cauce-proyecto-v3')).draft.conveyors[0].points.length"), 3)
            assert.ok(await evaluate("JSON.parse(localStorage.getItem('cauce-proyecto-v3')).draft.routes[0].conveyor"))
            await evaluate("document.querySelector('button[aria-label=Deshacer]').click()"); await pause(400)
            assert.equal(await evaluate("JSON.parse(localStorage.getItem('cauce-proyecto-v3')).draft.conveyors.length"), 0)
            await evaluate("(() => {const el=document.querySelector('.plan-assistant textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'mueve corte');el.dispatchEvent(new Event('input',{bubbles:true}));})()")
            await pause(100); await evaluate(`${button('Pedir propuesta')}.click()`)
            await until(`${button('Aplicar operaciones')} != null`)
            assert.ok(await evaluate("document.querySelector('.plan-assistant').textContent.includes('Fijo de prueba')"))
            await evaluate(`${button('Aplicar operaciones')}.click()`); await pause(400)
            assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('cauce-proyecto-v3')).draft.layout.corte"), [16, 6, 0])
            await evaluate("document.querySelector('button[aria-label=Deshacer]').click()"); await pause(400)
            assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('cauce-proyecto-v3')).draft.layout.corte"), [15, 5, 0])
        }
        await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: init.identifier })
        console.log(`Browser smoke ${enabled ? 'v3' : 'v2'}: selection, copy/paste/undo, confirmation and feature gating passed`)
    }
    assert.deepEqual(exceptions, [], 'No uncaught browser errors')
} finally {
    socket?.close()
    browser.kill()
    await server.close()
}
