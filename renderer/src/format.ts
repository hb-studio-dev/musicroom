export type FormattedResult = {
  wavBlob: Blob;
  wavUrl: string;
  sampleRate: number; // 44100
  channels: number;   // 2
  lengthSec: number;
  peak: number;
  scaleApplied: number;
};

export async function formatFileToWavFloat32(file: File): Promise<FormattedResult> {
  const arrayBuffer = await file.arrayBuffer();

  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));

  const sr = 44100;
  const frames = decoded.length;
  const ch = decoded.numberOfChannels;

  const L = new Float32Array(frames);
  const R = new Float32Array(frames);
  if (ch === 1) {
    const d0 = decoded.getChannelData(0); L.set(d0); R.set(d0);
  } else if (ch === 2) {
    L.set(decoded.getChannelData(0)); R.set(decoded.getChannelData(1));
  } else {
    const gains: number[] = [];
    for (let i = 0; i < ch; i++) gains[i] = (i===3?0.0:(i<=2?0.7071:0.7071));
    for (let i = 0; i < ch; i++) {
      const d = decoded.getChannelData(i), g = gains[i];
      if (i===0) for (let n=0;n<frames;n++) L[n]+=d[n]*1.0;
      else if (i===1) for (let n=0;n<frames;n++) R[n]+=d[n]*1.0;
      else if (i===2) for (let n=0;n<frames;n++){ const v=d[n]*g; L[n]+=v; R[n]+=v; }
      else if (i%2===0) for (let n=0;n<frames;n++) L[n]+=d[n]*g;
      else for (let n=0;n<frames;n++) R[n]+=d[n]*g;
    }
  }

  let peak = 0; for (let i=0;i<frames;i++){ const a=Math.abs(L[i]); if(a>peak) peak=a; const b=Math.abs(R[i]); if(b>peak) peak=b; }
  const target = 0.98;
  const scale = peak > target ? (target / peak) : 1.0;
  if (scale !== 1.0) { for (let i=0;i<frames;i++){ L[i]*=scale; R[i]*=scale; } }

  const wavBuffer = encodeWavFloat32([L, R], sr);
  const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
  const wavUrl = URL.createObjectURL(wavBlob);
  return { wavBlob, wavUrl, sampleRate: sr, channels: 2, lengthSec: frames / sr, peak, scaleApplied: scale };
}

function encodeWavFloat32(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const numChannels = channels.length; const frames = channels[0].length; const bps=4;
  const blockAlign = numChannels * bps; const byteRate = sampleRate * blockAlign; const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize); const view = new DataView(buffer); let off = 0;
  function ws(s:string){ for(let i=0;i<s.length;i++) view.setUint8(off++, s.charCodeAt(i)); }
  function u32(v:number){ view.setUint32(off, v, true); off+=4; } function u16(v:number){ view.setUint16(off, v, true); off+=2; }
  ws('RIFF'); u32(36+dataSize); ws('WAVE');
  ws('fmt '); u32(16); u16(3); u16(numChannels); u32(sampleRate); u32(byteRate); u16(blockAlign); u16(32);
  ws('data'); u32(dataSize);
  const inter = new Float32Array(frames*numChannels);
  for(let i=0;i<frames;i++){ for(let ch=0;ch<numChannels;ch++){ inter[i*numChannels+ch]=channels[ch][i]; } }
  new Float32Array(buffer, 44).set(inter);
  return buffer;
}




// --- Adapter for UI integration (updated) ---
export async function formatToWavBuffer(file: File): Promise<ArrayBuffer> {
  try {
    // Preferred: user's function that returns { wavBlob, ... }
    // @ts-ignore
    if (typeof formatFileToWavFloat32 === 'function') {
      // @ts-ignore
      const res = await formatFileToWavFloat32(file);
      if (res?.wavBlob) {
        return await res.wavBlob.arrayBuffer();
      }
    }
  } catch {}
  try {
    // legacy names
    // @ts-ignore
    if (typeof formatAudioToWavBuffer === 'function') return await formatAudioToWavBuffer(file);
    // @ts-ignore
    if (typeof format === 'function') return await format(file);
  } catch {}
  try {
    const selfMod: any = await import(/* @vite-ignore */ './format');
    if (typeof selfMod?.default === 'function') return await selfMod.default(file);
    if (typeof selfMod?.formatAudioToWavBuffer === 'function') return await selfMod.formatAudioToWavBuffer(file);
    if (typeof selfMod?.formatFileToWavFloat32 === 'function') {
      const res = await selfMod.formatFileToWavFloat32(file);
      if (res?.wavBlob) return await res.wavBlob.arrayBuffer();
    }
  } catch {}
  throw new Error('formatToWavBuffer adapter could not find an underlying formatter')
}
