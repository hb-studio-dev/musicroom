import modelsConf from './models.json'

export type StemKey = 'Vocal'|'Bass'|'Drums'|'Piano'|'Guitar'|'Others'

let worker: Worker | null = null

function getWorker(){
  if (!worker){
    worker = new Worker(new URL('./workers/mdx-worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

export async function runSeparation(wav: ArrayBuffer){
  const w = getWorker()
  const models = (modelsConf as any).models || []
  const messageId = Math.random().toString(36).slice(2)
  return new Promise<any>((resolve, reject)=>{
    const onMsg = (ev: MessageEvent)=>{
      const { id, type, payload, error } = ev.data || {}
      if (id !== messageId) return
      if (type === 'progress'){
        try { window.dispatchEvent(new CustomEvent('musicroom:progress', { detail: payload })) } catch {}
      }
      if (type === 'done'){
        cleanup()
        resolve(payload)
      }
      if (type === 'error'){
        cleanup()
        reject(new Error(error||'Worker error'))
      }
    }
    const cleanup=()=>{
      w.removeEventListener('message', onMsg as any)
    }
    w.addEventListener('message', onMsg as any)
    w.postMessage({ id: messageId, type: 'run', payload: { wav, models } }, [wav])
  })
}
