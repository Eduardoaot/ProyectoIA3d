import { useRef, useState } from 'react'
import { workspaceRequest as request } from '../../workspaceApi'
import { attachmentFile } from '../../contextWorkspace'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export default function useWorkspaceBackend(project, activeId, onProjectChange) {
    const id = project.serverWorkspaceId || activeId
    const revision = useRef(project.serverRevision || 0)
    const [busy, setBusy] = useState(false)
    const [notice, setNotice] = useState('')
    const [job, setJob] = useState(null)
    const [questions, setQuestions] = useState([])
    const [deliverables, setDeliverables] = useState(null)

    const mark = (saved, apply = false) => {
        revision.current = saved.revision
        onProjectChange({ ...(apply ? { context: saved.project.context, contextWorkspace: saved.project.contextWorkspace } : {}), serverRevision: saved.revision, serverWorkspaceId: saved.id })
        return saved
    }
    const save = async (snapshot = project) => {
        const { serverRevision: _revision, serverWorkspaceId: _id, ...payload } = snapshot
        return mark(await request(`/${id}`, { method: 'PUT', body: { project: payload, expected_revision: revision.current } }))
    }
    const run = async (operation) => {
        if (busy) return null
        setBusy(true)
        setNotice('')
        try { return await operation() }
        catch (error) { setNotice(error.message); return null }
        finally { setBusy(false) }
    }
    const confirm = (ids, target = 'proposals') => run(async () => {
        await save()
        const saved = mark(await request(`/${id}/confirm`, { method: 'POST', body: { expected_revision: revision.current, ids, target } }), true)
        setNotice(`${saved.result.accepted.length} aceptados.${saved.result.blocked.length ? ` ${saved.result.blocked.length} requieren corrección.` : ''}`)
        return saved
    })
    const interpret = (text, kind = 'context', sourceId = null, topic = null, retryId = null) => run(async () => {
        await save()
        let work = await request(`/${id}/jobs`, { method: 'POST', body: { expected_revision: revision.current, kind, text, source_id: sourceId, topic, retry_job_id: retryId } })
        setJob(work)
        while (work.status === 'queued' || work.status === 'running') {
            await delay(700)
            work = await request(`/${id}/jobs/${work.id}`)
            setJob(work)
        }
        if (!['done', 'partial'].includes(work.status)) throw new Error(work.error || (work.status === 'cancelled' ? 'Interpretación cancelada. Los originales siguen guardados.' : 'No se pudo interpretar. Revisa el proveedor e inténtalo de nuevo.'))
        mark(await request(`/${id}`), true)
        setNotice(work.status === 'partial' ? 'Resultado parcial: revisa los bloques con errores antes de usarlo.' : 'Información organizada. Puedes revisar y confirmar el conjunto.')
        return work
    })
    const upload = async (file, topic) => {
        await save()
        return request(`/${id}/documents?name=${encodeURIComponent(file.name)}&topic=${topic}`, { method: 'POST', body: file, binary: true })
    }
    const importOperators = (sourceId) => run(async () => {
        await save()
        mark(await request(`/${id}/operators`, { method: 'POST', body: { expected_revision: revision.current, source_id: sourceId } }), true)
        setNotice('Operadores importados para revisión. Los indicadores conservan su significado original.')
    })
    const review = () => run(async () => {
        await save()
        const [coverage, studies] = await Promise.all([request(`/${id}/coverage`), request(`/${id}/deliverables`)])
        setQuestions(coverage.questions)
        setDeliverables(studies)
        setNotice('Revisión actualizada con la información confirmada.')
    })
    const restore = () => run(async () => {
        const saved = await request(`/${id}`)
        revision.current = saved.revision
        onProjectChange({ ...saved.project, serverRevision: saved.revision, serverWorkspaceId: saved.id })
        setNotice('Copia guardada recuperada.')
    })
    const exportProject = () => run(async () => {
        const replacements = {}
        const attachments = []
        for (const file of project.contextWorkspace?.attachments || []) {
            if (file.storage === 'server') attachments.push(file)
            else {
                const original = await attachmentFile(file.id)
                const uploaded = await upload(original, file.topic)
                replacements[file.id] = uploaded.id
                attachments.push(uploaded)
            }
        }
        const snapshot = JSON.parse(JSON.stringify({ ...project, contextWorkspace: { ...project.contextWorkspace, attachments } }), (_key, value) => typeof value === 'string' ? replacements[value] || value : value)
        mark(await save(snapshot), true)
        const link = document.createElement('a')
        link.href = `/api/workspaces/${id}/export`
        link.download = 'cauce-proyecto.zip'
        link.click()
    })
    const importProject = (file) => run(async () => {
        const saved = await request('/import', { method: 'POST', body: file, binary: true })
        revision.current = saved.revision
        onProjectChange({ ...saved.project, serverRevision: saved.revision, serverWorkspaceId: saved.id })
        setNotice('Paquete restaurado en este proyecto. El expediente original permanece guardado.')
    })
    const cancel = async () => {
        if (job?.id) await request(`/${id}/jobs/${job.id}/cancel`, { method: 'POST' })
    }
    const clearNotice = () => setNotice('')
    const retry = () => job && interpret(job.text, job.kind, job.source_id, job.topic, job.id)
    const saveCopy = () => run(async () => { await save(); setNotice('Copia del proyecto guardada.'); return true })
    return { id, busy, notice, job, questions, deliverables, run, save, saveCopy, confirm, interpret, upload, review, restore, exportProject, importProject, importOperators, cancel, clearNotice, retry }
}
