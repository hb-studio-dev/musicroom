// / <reference lib="webworker" />
import * as ort from 'onnxruntime-web'

type StemKey = 'Vocal'|'Bass'|'Drums'|'Piano'|'Guitar'|'Others'
type MDXModelSpec = {
  name: string; path: string; target: StemKey;
  n_fft: number; hop_length: number; window: 'hann';
  inputLayout: 'NCHW'|'NHWC'|'NFCT'|'NCWH'; magOnly?: boolean;
}

const CFG = {
  wienerIters: 4,
  maskSharpen: { Vocal: 1.0, Bass: 1.2, Drums: 1.2, Piano: 1.2, Guitar: 1.2, Others: 1.0 } as Record<StemKey, number>,
  eps: 1e-8,
  wienerPower: 1.5,
  residualTarget: 'Others' as StemKey,
  stereoMaskMode: 'shared' as 'shared'|'per-channel',
} as const;

function midSideBoost(S:any, Y:any, keys:string[]){
  // boost center (mid) for vocals to reduce muffling & leakage
  if (!S['Vocal']) return;
  const Lre=Y.Lre, Lim=Y.Lim, Rre=Y.Rre, Rim=Y.Rim;
  const V=S['Vocal'];
  for (let t=0;t<Lre.length;t++){
    const yLre=Lre[t], yLim=Lim[t], yRre=Rre[t], yRim=Rim[t];
    const vLre=V.Lre[t], vLim=V.Lim[t], vRre=V.Rre[t], vRim=V.Rim[t];
    for (let f=0; f<yLre.length; f++){
      const MLre = 0.5*(yLre[f]+yRre[f]);
      const MLim = 0.5*(yLim[f]+yRim[f]);
      const Lmag = Math.hypot(yLre[f], yLim[f]), Rmag = Math.hypot(yRre[f], yRim[f]);
      const Mmag = Math.hypot(MLre, MLim);
      const denom = Lmag + Rmag + 1e-12;
      const center = Math.min(1, Mmag / (denom*0.7 + 1e-9)); // center ratio
      const boost = 1 + 0.6*center; // 0~1.6
      vLre[f]*=boost; vLim[f]*=boost; vRre[f]*=boost; vRim[f]*=boost;
    }
  }
}

function computeMagFrames(S:any){
  const frames=S.Lre.length, bins=S.Lre[0].length;
  const M=Array.from({length:frames},()=>new Float32Array(bins));
  for (let t=0;t<frames;t++){
    const re=S.Lre[t], im=S.Lim[t];
    const mr=M[t];
    for (let f=0;f<bins;f++){ mr[f]=Math.hypot(re[f], im[f]); }
  }
  return M;
}

function hpss(magFrames: Float32Array[], kTime=9, kFreq=17){
  // simple median-filter HPSS
  const T=magFrames.length, F=magFrames[0].length;
  const harm=Array.from({length:T},()=>new Float32Array(F));
  const perc=Array.from({length:T},()=>new Float32Array(F));
  const tempCol=new Float32Array(T);
  for (let f=0; f<F; f++){
    for (let t=0; t<T; t++) tempCol[t]=magFrames[t][f];
    for (let t=0; t<T; t++){
      const a=Math.max(0, t-Math.floor(kTime/2)), b=Math.min(T, t+Math.ceil(kTime/2));
      // median in [a,b)
      const seg = Array.from(tempCol.slice(a,b)); seg.sort((x,y)=>x-y);
      const medT = seg[Math.floor(seg.length/2)];
      const medFSeg = Array.from(magFrames[t].slice(Math.max(0,f-Math.floor(kFreq/2)), Math.min(F, f+Math.ceil(kFreq/2)))).sort((x,y)=>x-y);
      const medF = medFSeg[Math.floor(medFSeg.length/2)];
      const h = Math.max(0, medF);
      const p = Math.max(0, medT);
      const sum = h + p + 1e-12;
      harm[t][f] = (h / sum) * magFrames[t][f];
      perc[t][f] = (p / sum) * magFrames[t][f];
    }
  }
  return { harm, perc };
}

function redistributeOthers(S:any, Y:any, keys:string[]){
  // enforce Others as residual and gently push harmonic energy to Guitar/Piano, percussive to Drums
  const frames=Y.Lre.length, bins=Y.Lre[0].length;
  // Compute current sum
  const sumLre=Array.from({length:frames},()=>new Float32Array(bins));
  const sumLim=Array.from({length:frames},()=>new Float32Array(bins));
  const sumRre=Array.from({length:frames},()=>new Float32Array(bins));
  const sumRim=Array.from({length:frames},()=>new Float32Array(bins));
  const stemKeys = keys.filter(k=>k!=='Others');
  for (const k of stemKeys){
    for (let t=0;t<frames;t++){
      const a=S[k].Lre[t], b=S[k].Lim[t], c=S[k].Rre[t], d=S[k].Rim[t];
      for (let f=0; f<bins; f++){ sumLre[t][f]+=a[f]; sumLim[t][f]+=b[f]; sumRre[t][f]+=c[f]; sumRim[t][f]+=d[f]; }
    }
  }
  // residual into Others
  if (!S['Others']) return;
  for (let t=0;t<frames;t++){
    const yL=Y.Lre[t], yLi=Y.Lim[t], yR=Y.Rre[t], yRi=Y.Rim[t];
    const oL=S['Others'].Lre[t], oLi=S['Others'].Lim[t], oR=S['Others'].Rre[t], oRi=S['Others'].Rim[t];
    for (let f=0; f<bins; f++){
      oL[f] = yL[f] - sumLre[t][f];
      oLi[f]= yLi[f]- sumLim[t][f];
      oR[f] = yR[f] - sumRre[t][f];
      oRi[f]= yRi[f]- sumRim[t][f];
    }
  }
  // HPSS on accompaniment (sum of non-vocal)
  const acc = { Lre: sumLre, Lim: sumLim, Rre: sumRre, Rim: sumRim };
  const accMag = computeMagFrames({ Lre: acc.Lre, Lim: acc.Lim });
  const { harm, perc } = hpss(accMag, 9, 17);
  // Push percussive -> Drums
  if (S['Drums']){
    for (let t=0;t<frames;t++){
      const dL=S['Drums'].Lre[t], dLi=S['Drums'].Lim[t], dR=S['Drums'].Rre[t], dRi=S['Drums'].Rim[t];
      for (let f=0; f<bins; f++){
        const g = Math.min(1.5, 1 + 0.8 * (perc[t][f] / (harm[t][f]+perc[t][f]+1e-9)));
        dL[f]*=g; dLi[f]*=g; dR[f]*=g; dRi[f]*=g;
      }
    }
  }
  // Split harmonic -> Guitar / Piano by band heuristics
  const band = (f:number, sr:number, nfft:number)=> (f * (sr/nfft));
  const sr = (self as any).__CFG_SR__ || 44100;
  if (S['Guitar'] || S['Piano']){
    for (let t=0;t<frames;t++){
      const gL=S['Guitar']? S['Guitar'].Lre[t]:null, gLi=S['Guitar']? S['Guitar'].Lim[t]:null, gR=S['Guitar']? S['Guitar'].Rre[t]:null, gRi=S['Guitar']? S['Guitar'].Rim[t]:null;
      const pL=S['Piano']? S['Piano'].Lre[t]:null, pLi=S['Piano']? S['Piano'].Lim[t]:null, pR=S['Piano']? S['Piano'].Rre[t]:null, pRi=S['Piano']? S['Piano'].Rim[t]:null;
      for (let f=0; f<bins; f++){
        const hz = band(f, sr, bins*2);
        const wG = hz>200 && hz<5500 ? 0.6 : 0.2; // guitar mid-high bias
        const wP = hz<4000 ? 0.4 : 0.2;
        const sum = wG + wP;
        const g = (wG/sum), p = (wP/sum);
        if (gL){ gL[f]*=(1+0.5*g); gLi[f]*=(1+0.5*g); gR[f]*=(1+0.5*g); gRi[f]*=(1+0.5*g); }
        if (pL){ pL[f]*=(1+0.5*p); pLi[f]*=(1+0.5*p); pR[f]*=(1+0.5*p); pRi[f]*=(1+0.5*p); }
      }
    }
  }
}


function postProgress(id: string, percent: number)
{
  try{ (self as any).postMessage({ id, type:'progress', payload:{ percent: Math.max(0,Math.min(100, Math.round(percent))) } }) }catch{}
}

function reportProgress(id: string, p: number){ postProgress(id, p) }{ try{ (self as any).postMessage({ id, type:'progress', payload:{percent} }) }catch{} }

const hannCache = new Map<number, Float32Array>()
function hann(N:number){
  let win = hannCache.get(N)
  if (!win){
    win = new Float32Array(N)
    for (let n=0;n<N;n++) win[n] = 0.5*(1-Math.cos(2*Math.PI*n/(N-1)))
    hannCache.set(N, win)
  }
  return win!
}

function fftRadix2(re: Float32Array, im: Float32Array){
  const n=re.length, levels=Math.log2(n)|0; if ((1<<levels)!==n) throw new Error('FFT size must be pow2')
  for (let i=0,j=0;i<n;i++){ if (j>i){ let tr=re[i]; re[i]=re[j]; re[j]=tr; let ti=im[i]; im[i]=im[j]; im[j]=ti } let m=n>>1; while(m>=1 && j>=m){ j-=m; m>>=1 } j+=m }
  for (let size=2; size<=n; size<<=1){ const half=size>>1, step=2*Math.PI/size
    for (let i=0;i<n;i+=size){ for (let j=0;j<half;j++){ const k=i+j, l=k+half, c=Math.cos(step*j), s=Math.sin(step*j)
      const tre=re[l]*c - im[l]*s, tim=re[l]*s + im[l]*c
      re[l]=re[k]-tre; im[l]=im[k]-tim; re[k]+=tre; im[k]+=tim
    } } }
}
function ifftRadix2(re: Float32Array, im: Float32Array){ for (let i=0;i<re.length;i++) im[i]=-im[i]; fftRadix2(re,im); const n=re.length; for (let i=0;i<n;i++){ re[i]/=n; im[i]/=-n } }

function stftStereo(xL: Float32Array, xR: Float32Array, nfft:number, hop:number){
  const win = hann(nfft), pad=(nfft/2)|0, N=xL.length, total=N+2*pad, frames=Math.max(1, Math.ceil((total-nfft)/hop)+1)
  const Lre:Float32Array[]=[], Lim:Float32Array[]=[], Rre:Float32Array[]=[], Rim:Float32Array[]=[]
  for (let t=0;t<frames;t++){
    const o=t*hop - pad
    const a=new Float32Array(nfft), b=new Float32Array(nfft), c=new Float32Array(nfft), d=new Float32Array(nfft)
    for (let n=0;n<nfft;n++){ const idx=o+n; const l=(idx>=0&&idx<N)?xL[idx]:0; const r=(idx>=0&&idx<N)?xR[idx]:0; const w=win[n]; a[n]=l*w; c[n]=r*w }
    fftRadix2(a,b); fftRadix2(c,d); Lre.push(a); Lim.push(b); Rre.push(c); Rim.push(d)
  }
  return { Lre, Lim, Rre, Rim, pad, N }
}
function istftStereo(Lre:Float32Array[], Lim:Float32Array[], Rre:Float32Array[], Rim:Float32Array[], nfft:number, hop:number, outLen:number, pad:number){
  const win=hann(nfft); const L=new Float32Array(outLen+2*pad), R=new Float32Array(outLen+2*pad), W=new Float32Array(outLen+2*pad)
  for (let t=0,o=0;t<Lre.length;t++,o+=hop){ const a=Lre[t].slice(), b=Lim[t].slice(), c=Rre[t].slice(), d=Rim[t].slice(); ifftRadix2(a,b); ifftRadix2(c,d)
    for (let n=0;n<nfft;n++){ const w=win[n], ww=w*w; L[o+n]+=a[n]*w; R[o+n]+=c[n]*w; W[o+n]+=ww }
  }
  for (let i=0;i<L.length;i++){ const w=W[i]; if (w>1e-8){ L[i]/=w; R[i]/=w } }
  return { L: L.slice(pad,pad+outLen), R: R.slice(pad,pad+outLen) }
}

function parseWav(ab: ArrayBuffer){
  const dv=new DataView(ab); const dec=(o:number,l:number)=>String.fromCharCode(...new Uint8Array(ab,o,l))
  let off=12, fmt:any=null, dataOff=0, dataLen=0
  while(off<dv.byteLength){ const id=dec(off,4), size=dv.getUint32(off+4,true); off+=8
    if(id==='fmt ') fmt={ audioFormat: dv.getUint16(off,true), numChannels: dv.getUint16(off+2,true), sampleRate: dv.getUint32(off+4,true), bitsPerSample: dv.getUint16(off+14,true) }
    if(id==='data'){ dataOff=off; dataLen=size } off+=size
  }
  if(!fmt||!dataOff) throw new Error('Invalid WAV')
  let L:Float32Array, R:Float32Array
  if (fmt.bitsPerSample===32 && fmt.audioFormat===3){ const f32=new Float32Array(ab, dataOff, dataLen/4)
    if (fmt.numChannels===2){ const frames=f32.length/2; L=new Float32Array(frames); R=new Float32Array(frames); for (let i=0,j=0;i<f32.length;i+=2,j++){ L[j]=f32[i]; R[j]=f32[i+1] } }
    else { L=f32.slice(); R=f32.slice() }
  } else if (fmt.bitsPerSample===16 && fmt.audioFormat===1){ const i16=new Int16Array(ab, dataOff, dataLen/2)
    if (fmt.numChannels===2){ const frames=i16.length/2; L=new Float32Array(frames); R=new Float32Array(frames); for (let i=0,j=0;i<i16.length;i+=2,j++){ L[j]=i16[i]/32768; R[j]=i16[i+1]/32768 } }
    else { L=new Float32Array(i16.length); R=new Float32Array(i16.length); for (let i=0;i<i16.length;i++){ const v=i16[i]/32768; L[i]=v; R[i]=v } }
  } else { throw new Error('Unsupported WAV format') }
  return { L, R, sampleRate: fmt.sampleRate }
}

function encodeWavFloat32(channels: Float32Array[], sampleRate: number){
  const numChannels=channels.length, frames=channels[0].length, bps=4
  const blockAlign=numChannels*bps, byteRate=sampleRate*blockAlign, dataSize=frames*blockAlign
  const buffer=new ArrayBuffer(44+dataSize), view=new DataView(buffer); let off=0
  const ws=(s:string)=>{ for(let i=0;i<s.length;i++) view.setUint8(off++, s.charCodeAt(i)) }
  const u32=(v:number)=>{ view.setUint32(off,v,true); off+=4 }, u16=(v:number)=>{ view.setUint16(off,v,true); off+=2 }
  ws('RIFF'); u32(36+dataSize); ws('WAVE'); ws('fmt '); u32(16); u16(3); u16(numChannels); u32(sampleRate); u32(byteRate); u16(blockAlign); u16(32)
  ws('data'); u32(dataSize)
  const inter=new Float32Array(frames*numChannels); for(let i=0;i<frames;i++){ for(let ch=0;ch<numChannels;ch++){ inter[i*numChannels+ch]=channels[ch][i] } }
  new Float32Array(buffer,44).set(inter); return buffer
}
function encodeWavPCM16(channels: Float32Array[], sampleRate: number){
  const numChannels=channels.length, frames=channels[0].length, bps=2
  const blockAlign=numChannels*bps, byteRate=sampleRate*blockAlign, dataSize=frames*blockAlign
  const buffer=new ArrayBuffer(44+dataSize), view=new DataView(buffer); let off=0
  const ws=(s:string)=>{ for(let i=0;i<s.length;i++) view.setUint8(off++, s.charCodeAt(i)) }
  const u32=(v:number)=>{ view.setUint32(off,v,true); off+=4 }, u16=(v:number)=>{ view.setUint16(off,v,true); off+=2 }
  ws('RIFF'); u32(36+dataSize); ws('WAVE'); ws('fmt '); u32(16); u16(1); u16(numChannels); u32(sampleRate); u32(byteRate); u16(blockAlign); u16(16)
  ws('data'); u32(dataSize)
  const inter=new Int16Array(frames*numChannels); for(let i=0;i<frames;i++){ for(let ch=0;ch<numChannels;ch++){ let s=channels[ch][i]; if(s>1)s=1; if(s<-1)s=-1; inter[i*numChannels+ch]=Math.round(s*32767) } }
  new Int16Array(buffer,44).set(inter); return buffer
}

// builtin fake masks (placeholder)
async function runBuiltinLite(target: StemKey, nfft:number, frames:number, bins:number, sampleRate:number){
  const maskL:Float32Array[] = Array.from({length:frames},()=> new Float32Array(bins).fill(0))
  const maskR:Float32Array[] = Array.from({length:frames},()=> new Float32Array(bins).fill(0))
  const binToHz=(k:number)=> k*(sampleRate/nfft)
  for (let t=0;t<frames;t++){
    for (let k=0;k<bins;k++){
      const hz=binToHz(k); let m=0
      switch(target){
        case 'Bass': m = hz<180?1:hz<260?0.5:0.05; break
        case 'Drums': m = (hz>120&&hz<6000)?0.6:0.2; break
        case 'Vocal': m = (hz>200&&hz<3500)?0.9:0.05; break
        case 'Guitar': m=(hz>120&&hz<5500)?0.6:0.1; break
        case 'Piano': m=(hz>80&&hz<6000)?0.5:0.1; break
        case 'Others': m=0.3; break
      }
      maskL[t][k]=m; maskR[t][k]=m
    }
  }
  return { maskL, maskR }
}

// placeholder (real ORT inference to be implemented with actual model I/O)
async function runORT(spec: MDXModelSpec, magL: Float32Array[], magR: Float32Array[]){
  const frames=magL.length, bins=magL[0].length
  const maskL=Array.from({length:frames},()=> new Float32Array(bins).fill(1/6))
  const maskR=Array.from({length:frames},()=> new Float32Array(bins).fill(1/6))
  return { maskL, maskR }
}

self.addEventListener('message', async (ev: MessageEvent)=>{
  const { id, type, payload } = (ev.data||{})
  if (type!=='run') return
  try{
    const wavBuf: ArrayBuffer = payload.wav
    const models: MDXModelSpec[] = payload.models

    const { L:mixL, R:mixR, sampleRate } = parseWav(wavBuf)
    postProgress(id, 5)
    const nfft=models[0].n_fft|0, hop=models[0].hop_length|0
    const stft = stftStereo(mixL, mixR, nfft, hop)
    postProgress(id, 15)
    const frames = stft.Lre.length, bins = nfft, pad= (stft as any).pad, outLen=(stft as any).N

    // magnitude
    const magL = Array.from({length:frames},(_,t)=>{ const a=stft.Lre[t], b=stft.Lim[t]; const m=new Float32Array(bins); for(let k=0;k<bins;k++) m[k]=Math.hypot(a[k],b[k]); return m })
    const magR = Array.from({length:frames},(_,t)=>{ const a=stft.Rre[t], b=stft.Rim[t]; const m=new Float32Array(bins); for(let k=0;k<bins;k++) m[k]=Math.hypot(a[k],b[k]); return m })

    // masks
    const masks: Record<StemKey,{maskL:Float32Array[],maskR:Float32Array[]}> = {} as any
    for (let i=0;i<models.length;i++){
      const spec=models[i]
      const r = spec.path.startsWith('builtin://') ? await runBuiltinLite(spec.target, nfft, frames, bins, sampleRate) : await runORT(spec, magL, magR)
      masks[spec.target]=r; postProgress(id, 30 + Math.floor((i/models.length)*10))
    }

    // power init
    const targets = models.map(m=> m.target as StemKey)
    let v: Record<StemKey, Float32Array[]> = {} as any
    for (const t of targets){
      // progress per target
      try{ const idx = targets.indexOf(t); reportProgress(id, 15 + Math.floor(50 * (idx+1)/Math.max(1,targets.length))) }catch{}

      const alpha = CFG.maskSharpen[t] ?? 1.0, src = masks[t], vArr:Float32Array[] = new Array(frames)
      for (let f=0; f<frames; f++){
        const vBin=new Float32Array(bins)
        for (let k=0;k<bins;k++){
          const m = CFG.stereoMaskMode==='shared' ? 0.5*(src.maskL[f][k]+src.maskR[f][k]) : Math.max(src.maskL[f][k], src.maskR[f][k])
          vBin[k]=Math.max(CFG.eps, Math.pow(m, alpha))
        }
        vArr[f]=vBin
      }
      v[t]=vArr
    }

    function wienerStep(vIn: Record<StemKey, Float32Array[]>) {
      const S:any = {}; for (const t of targets){
      // progress per target
      try{ const idx = targets.indexOf(t); reportProgress(id, 15 + Math.floor(50 * (idx+1)/Math.max(1,targets.length))) }catch{}
 S[t]={Lre:[],Lim:[],Rre:[],Rim:[]} }
      for (let f=0; f<frames; f++){
        const denom=new Float32Array(bins)
        for (let k=0;k<bins;k++){ let s=CFG.eps; for (const t of targets) s+=vIn[t][f][k]; denom[k]=s }
        for (const t of targets){
      // progress per target
      try{ const idx = targets.indexOf(t); reportProgress(id, 15 + Math.floor(50 * (idx+1)/Math.max(1,targets.length))) }catch{}

          const LreArr=new Float32Array(bins), LimArr=new Float32Array(bins), RreArr=new Float32Array(bins), RimArr=new Float32Array(bins)
          for (let k=0;k<bins;k++){
            const w=vIn[t][f][k]/denom[k]; LreArr[k]=stft.Lre[f][k]*w; LimArr[k]=stft.Lim[f][k]*w; RreArr[k]=stft.Rre[f][k]*w; RimArr[k]=stft.Rim[f][k]*w
          }
          S[t].Lre.push(LreArr); S[t].Lim.push(LimArr); S[t].Rre.push(RreArr); S[t].Rim.push(RimArr)
        }
      }
      const vOut:any = {}; for (const t of targets){
      // progress per target
      try{ const idx = targets.indexOf(t); reportProgress(id, 15 + Math.floor(50 * (idx+1)/Math.max(1,targets.length))) }catch{}
 const arr:Float32Array[] = new Array(frames)
        for (let f=0; f<frames; f++){ const vBin=new Float32Array(bins)
          const Lre=S[t].Lre[f], Lim=S[t].Lim[f], Rre=S[t].Rre[f], Rim=S[t].Rim[f]
          for (let k=0;k<bins;k++){ const pl=Lre[k]*Lre[k]+Lim[k]*Lim[k]; const pr=Rre[k]*Rre[k]+Rim[k]*Rim[k]; vBin[k]=Math.max(CFG.eps, 0.5*(pl+pr)) }
          arr[f]=vBin
        } vOut[t]=arr
      }
      return { S, vNext: vOut }
    }

    let vCur=v; let S:any=null
    for (let it=0; it<CFG.wienerIters; it++){ 
      try{ reportProgress(id, 70 + Math.floor(20*((it+1)/Math.max(1,CFG.wienerIters)))) }catch{}
const step=wienerStep(vCur); S=step.S; vCur=step.vNext; postProgress(id, 55 + Math.floor(((it+1)/Math.max(1,CFG.wienerIters))*30)) }

    // reconstruct
    const out:any = {}
    for (const t of targets){
      // progress per target
      try{ const idx = targets.indexOf(t); reportProgress(id, 15 + Math.floor(50 * (idx+1)/Math.max(1,targets.length))) }catch{}

      const { L, R } = istftStereo(S[t].Lre, S[t].Lim, S[t].Rre, S[t].Rim, nfft, hop, (stft as any).N, (stft as any).pad)
      const wavF32=encodeWavFloat32([L,R], sampleRate), wavI16=encodeWavPCM16([L,R], sampleRate)
      out[t]={ wavF32, wavI16, lengthSec: L.length/sampleRate, sampleRate, peak:0 }
    }

    // mixture projection
    // outLen already defined above; reuse existing value
    const sumL=new Float32Array(outLen), sumR=new Float32Array(outLen)
    for (const t of targets){
      // progress per target
      try{ const idx = targets.indexOf(t); reportProgress(id, 15 + Math.floor(50 * (idx+1)/Math.max(1,targets.length))) }catch{}
 const s=out[t]; const L=new Float32Array(new Float32Array(s.wavF32).length) /* placeholder to compute sum later if needed */ }
    const stemsWave:any = {}
    for (const t of targets){
      // progress per target
      try{ const idx = targets.indexOf(t); reportProgress(id, 15 + Math.floor(50 * (idx+1)/Math.max(1,targets.length))) }catch{}

      const arr=new Float32Array((out[t].wavF32.byteLength-44)/4)
      const inter=new Float32Array(out[t].wavF32, 44)
      // de-interleave to L/R, then sum easily by reading interleaved
      const frames = arr.length/2
      const L=new Float32Array(frames), R=new Float32Array(frames)
      for (let i=0;i<frames;i++){ L[i]=inter[i*2]; R[i]=inter[i*2+1] }
      stemsWave[t]={L,R}
      for (let i=0;i<frames;i++){ sumL[i]+=L[i]; sumR[i]+=R[i] }
    }
    const resT = CFG.residualTarget
    if (!stemsWave[resT]) stemsWave[resT] = { L:new Float32Array(outLen), R:new Float32Array(outLen) }
    for (let i=0;i<outLen;i++){ stemsWave[resT].L[i]+= (mixL[i]-sumL[i]); stemsWave[resT].R[i]+= (mixR[i]-sumR[i]); }

    // --- Mixture-consistent Wiener refinement in STFT domain ---
function refineWithWiener(stemsWave: Record<string,{L:Float32Array,R:Float32Array}>, mixL:Float32Array, mixR:Float32Array, sampleRate:number){
  try{
    const nfft = 4096, hop = 1024, p = (CFG as any).wienerPower || 1.5, iters = (CFG as any).wienerIters || 3
    const mixSpec = stftStereo(mixL, mixR, nfft, hop)
    const keys = Object.keys(stemsWave)
    const specs: any = {}
    for (const k of keys){ const s = stemsWave[k]; specs[k] = stftStereo(s.L, s.R, nfft, hop) }
    const frames = mixSpec.Lre.length, bins = nfft
    const chan = (which:'L'|'R')=>{
      const Yre = which==='L' ? mixSpec.Lre : mixSpec.Rre
      const Yim = which==='L' ? mixSpec.Lim : mixSpec.Rim
      const Sre: Record<string, Float32Array[]> = {}
      const Sim: Record<string, Float32Array[]> = {}
      for (const k of keys){ const sp = specs[k]; Sre[k] = which==='L'? sp.Lre: sp.Rre; Sim[k] = which==='L'? sp.Lim: sp.Rim }
      for (let it=0; it<iters; it++){
        for (let t=0;t<frames;t++){
          const yre = Yre[t], yim = Yim[t]
          const powArr: Record<string, Float32Array> = {}
          for (const k of keys){
            const sre = Sre[k][t], sim = Sim[k][t]
            const pwr = new Float32Array(bins)
            for (let f=0; f<bins; f++){ const a=sre[f], b=sim[f]; const mag2=a*a+b*b; pwr[f] = Math.pow(Math.max(mag2,1e-20), p/2) }
            powArr[k] = pwr
          }
          for (let f=0; f<bins; f++){
            let denom=0; for (const k of keys){ denom += powArr[k][f] }
            if (denom<=1e-20){ const K=keys.length; for (const k of keys){ Sre[k][t][f]=yre[f]/K; Sim[k][t][f]=yim[f]/K } }
            else { for (const k of keys){ const w=powArr[k][f]/denom; Sre[k][t][f]=w*yre[f]; Sim[k][t][f]=w*yim[f] } }
          }
        }
      }
    }
    chan('L'); chan('R')
    for (const k of keys){
      const sp = specs[k]; const rec = istftStereo(sp.Lre, sp.Lim, sp.Rre, sp.Rim, nfft, hop, mixSpec.N, mixSpec.pad)
      stemsWave[k] = { L: rec.L, R: rec.R }
    }
  }catch(e){ /* keep original stems on failure */ }
  return stemsWave
}
// repackage with projection
    const packaged:any = {}
    for (const t of targets){
      // progress per target
      try{ const idx = targets.indexOf(t); reportProgress(id, 15 + Math.floor(50 * (idx+1)/Math.max(1,targets.length))) }catch{}

      const L=stemsWave[t].L, R=stemsWave[t].R
      const wavF32=encodeWavFloat32([L,R], sampleRate), wavI16=encodeWavPCM16([L,R], sampleRate)
      packaged[t]={ wavF32, wavI16, lengthSec: L.length/sampleRate, sampleRate, peak:0 }
    }

    reportProgress(id, 90);
    postProgress(id, 95)
    ;(self as any).postMessage({ id, type:'done', payload: { stems: packaged } })
  }catch(err:any){
    ;(self as any).postMessage({ id, type:'error', error: String(err?.message||err) })
  }
})
