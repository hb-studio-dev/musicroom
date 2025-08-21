// Dual-API loader for @ffmpeg/ffmpeg: supports v0.12 (FFmpeg class) and legacy createFFmpeg
let ff: any | null = null
let api: 'v012' | 'legacy' | null = null

async function loadFFmpeg() {
  if (ff) return ff
  const mod: any = await import('@ffmpeg/ffmpeg')
  // v0.12 style: new FFmpeg()
  if (typeof mod?.FFmpeg === 'function') {
    api = 'v012'
    ff = new mod.FFmpeg()
    await ff.load()
    return ff
  }
  // legacy style: createFFmpeg({})
  const createFFmpeg = mod?.createFFmpeg || mod?.default?.createFFmpeg
  if (typeof createFFmpeg === 'function') {
    api = 'legacy'
    ff = createFFmpeg({ log: false })
    await ff.load()
    return ff
  }
  console.error('[MusicRoom] FFmpeg module keys:', Object.keys(mod||{}), 'defaultKeys:', Object.keys(mod?.default||{}))
  throw new Error('[MusicRoom] FFmpeg module export mismatch')
}

async function fileToU8(file: File): Promise<Uint8Array> {
  const ab = await file.arrayBuffer()
  return new Uint8Array(ab)
}

async function writeFile(name: string, data: Uint8Array) {
  if (api === 'v012') return await ff.writeFile(name, data)
  return ff.FS('writeFile', name, data)
}

async function exec(args: string[]) {
  if (api === 'v012') return await ff.exec(args)
  return ff.run(...args)
}

async function readFile(name: string): Promise<Uint8Array> {
  if (api === 'v012') return await ff.readFile(name)
  return ff.FS('readFile', name)
}

/** Decode any media to stereo 44.1kHz Float32 WAV buffer (normalized upstream) */
export async function decodeWithFFmpeg(file: File): Promise<ArrayBuffer> {
  await loadFFmpeg()
  const inName = 'input.bin'
  const outName = 'out.wav'
  const u8 = await fileToU8(file)
  await writeFile(inName, u8)
  await exec(['-i', inName, '-ac', '2', '-ar', '44100', '-acodec', 'pcm_f32le', outName])
  const data = await readFile(outName)
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
}
