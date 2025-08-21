import { formatToWavBuffer } from './format'
import { runSeparation } from './separate'

export async function startFormatAndAnalyze(file: File){
  const app = (window as any).musicRoom || {}
  const setState = app.setState || app.setViewState || (()=>{})
  const setOverlay = app.setOverlay || app.setOverlayText || (()=>{})
  const setKeptName = app.setKeptName || app.setLastImportedLabel || (()=>{})

  // progress overlay updater
  const onProg = (ev: any)=>{
    const raw = ev?.detail?.percent
    const p = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)))
    try { setOverlay(`Analyzing... ${p}%`) } catch {}
  }

  try {
    // UI: keep latest name, move to Hide + Formatting...
    try { setKeptName(file?.name || '') } catch {}
    try { setState('Hide') } catch {}
    try { setOverlay('Formatting...') } catch {}

    // 1) Format to WAV (44.1kHz stereo float32)
    const wav = await formatToWavBuffer(file)

    // 2) Analyze with progress
    window.addEventListener('musicroom:progress', onProg as any)
    try { setOverlay('Analyzing... 0%') } catch {}
    const sepRes: any = await runSeparation(wav)

    // 3) Collect stems to stream-zip
    const baseName = ((file as any)?.name || 'audio').replace(/\.[^./]+$/, '')
    const entries: { name: string, blob: Blob }[] = []
    if (sepRes && sepRes.stems) {
      for (const k of Object.keys(sepRes.stems)) {
        const info = sepRes.stems[k] || {}
        const buf: ArrayBuffer | undefined =
          (info.wavI16 instanceof ArrayBuffer && info.wavI16) ||
          (info.wavF32 instanceof ArrayBuffer && info.wavF32)
        if (buf) entries.push({ name: `${baseName}-${k}.wav`, blob: new Blob([buf], { type: 'audio/wav' }) })
      }
    } else if (sepRes && sepRes.stemsFloat32) {
      for (const k of Object.keys(sepRes.stemsFloat32)) {
        const buf = sepRes.stemsFloat32[k]
        if (buf instanceof ArrayBuffer) entries.push({ name: `${baseName}-${k}.wav`, blob: new Blob([buf], { type: 'audio/wav' }) })
      }
    } else {
      throw new Error('Separation returned no stems')
    }

    // 4) Streaming zip (low memory) with zip.js
    const zipjs = await import('@zip.js/zip.js')
    const writer = new zipjs.ZipWriter(new zipjs.BlobWriter('application/zip'))
    for (const e of entries) {
      await writer.add(e.name, new zipjs.BlobReader(e.blob), { level: 0 })
    }
    const zipBlob = await writer.close()

    // Download + notify UI
    try {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(zipBlob)
      a.download = `${baseName}-stems.zip`
      a.style.display = 'none'
      document.body.appendChild(a); a.click(); a.remove()
    } catch {}
    try { window.dispatchEvent(new CustomEvent('musicroom:zip-ready', { detail: { zipBlob, baseName } })) } catch {}

    // 5) Back to Normal
    try { setState('Normal') } catch {}
    try { setOverlay('') } catch {}
  } catch (e) {
    console.error('[MusicRoom] Process failed:', e)
    try { window.dispatchEvent(new Event('musicroom:analyze-failed')) } catch {}
    try { setState('Hide'); setOverlay('Analysis Failed. Please Try with a different audio source.') } catch {}
    throw e
  } finally {
    try { window.removeEventListener('musicroom:progress', onProg as any) } catch {}
  }
}
