import React, { useEffect, useRef, useState, useMemo } from "react";
import MuiSlider from "@mui/material/Slider";
import { Button } from "@mui/base/Button";
import playUrl from "./assets/play.svg";
import pauseUrl from "./assets/pause.svg";
import rewindUrl from "./assets/rewind.svg";

type ViewState = "Normal" | "Hide";
type StemKey = "Vocal" | "Bass" | "Drums" | "Piano" | "Guitar" | "Others";
type ImportPayload = { type: "file"; file: File };

function fmtTime(sec:number){ if(!isFinite(sec)||sec<0) sec=0; const m=Math.floor(sec/60), s=Math.floor(sec%60); return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }

export default function App(){
  // ----- Import Unit (File only) -----
  const [droppedFile, setDroppedFile] = useState<File|null>(null);
  const filePickRef = useRef<HTMLInputElement>(null);
  const importReady = !!droppedFile;
  const [lastImportedLabel, setLastImportedLabel] = useState<string | null>(null);
  const [importPayload, setImportPayload] = useState<ImportPayload | null>(null);
  const [importRequested, setImportRequested] = useState(false);

  const handleImport = ()=>{
    if(!importReady) return;
    const payload: ImportPayload = { type:"file", file: droppedFile! };
    setLastImportedLabel(payload.file.name);
    setImportPayload(payload);
    setImportRequested(true);
    window.dispatchEvent(new CustomEvent('musicroom:import', { detail: payload })); // UIは状態遷移しない
  };

  // ----- Two states only -----
  const [viewState, setViewState] = useState<ViewState>("Hide");
  const [overlayText, setOverlayText] = useState<string>("Welcome to the music room.\nPlease import your audio files.");
  const overlayActive = viewState === "Hide";
  // Bridge to processing layer
  useEffect(() => {
    (window as any).musicRoom = {
      setState: (s: ViewState) => setViewState(s),
      setOverlay: (t: string) => setOverlayText(t),
      setKeptName: (n: string) => setLastImportedLabel(n),
    };
    const onImport = (ev: any) => {
      const file: File | undefined = ev?.detail?.file;
      if (file) {
        import('./format-integration').then(m => m.startFormatAndAnalyze(file));
      }
    };
    window.addEventListener('musicroom:import', onImport as any);
    return () => window.removeEventListener('musicroom:import', onImport as any);
  }, []);


  // ----- Mixer -----
  const stems: StemKey[] = ["Vocal","Bass","Drums","Piano","Guitar","Others"];
  const [presence, setPresence] = useState<Record<StemKey,"present"|"absent"|"na">>({
    Vocal:"present", Bass:"present", Drums:"present", Piano:"present", Guitar:"present", Others:"present"
  });
  const [amps, setAmps] = useState<Record<StemKey, number>>({ Vocal:1,Bass:1,Drums:1,Piano:1,Guitar:1,Others:1 });
  const [muteMap, setMuteMap] = useState<Record<StemKey, boolean>>({ Vocal:false,Bass:false,Drums:false,Piano:false,Guitar:false,Others:false });
  const [solo, setSolo] = useState<StemKey|null>(null);

  const MIN_DB=-70, MAX_DB=6;
  const sliderToDb=(v:number)=> v<=70? MIN_DB+(0-MIN_DB)*(v/70) : 0+(MAX_DB-0)*((v-70)/30);
  const dbToSlider=(db:number)=>{ db=Math.max(MIN_DB,Math.min(MAX_DB,db)); return db<=0? (db-MIN_DB)/(0-MIN_DB)*70 : 70+(db/(MAX_DB-0))*30; }
  const ampToDb=(amp:number)=> amp<=0? MIN_DB : Math.max(MIN_DB, Math.min(MAX_DB, 20*Math.log10(amp)));
  const dbToAmp=(db:number)=> db<=MIN_DB? 0 : Math.pow(10, Math.max(MIN_DB,Math.min(MAX_DB,db))/20);

  function finalAmp(key: StemKey){
    const base = amps[key];
    const muted = muteMap[key];
    if (solo && solo !== key) return 0;
    return muted ? 0 : base;
  }

  // expose current mix as amplitudes
  useEffect(()=>{
    const out: Record<string, number> = {};
    stems.forEach(k => out[k] = finalAmp(k));
    window.dispatchEvent(new CustomEvent('musicroom:mixChange', { detail: out }));
  }, [amps, muteMap, solo]);

  // ----- Pitch & Speed -----
  const [semitones, setSemitones] = useState(0);
  const [speedExp, setSpeedExp] = useState(0);
  const speed = useMemo(()=> Math.pow(2, speedExp), [speedExp]);
  const setSpeedFromValue = (v:number)=> setSpeedExp(Math.log2(Math.min(4, Math.max(0.25, v))));

  // ----- Playback (externally controlled) -----
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);

  // Expose external API for the app
  useEffect(()=>{
    (window as any).musicRoom = {
      // 2-state control
      setViewState: (s:ViewState)=> setViewState(s),
      setOverlayText: (t:string)=> setOverlayText(t),

      // playback external setters
      setPlaying: (on:boolean)=> setIsPlaying(!!on),
      setPlayback: (current:number, duration?:number)=>{ setCurrentSec(Math.max(0,current||0)); if(typeof duration==='number') setDurationSec(Math.max(0,duration)); },

      // import queue helpers
      peekImportRequest: ()=> importRequested ? importPayload : null,
      consumeImportRequest: ()=> { if(!importRequested) return null; const p=importPayload; setImportRequested(false); return p; },

      // presence update from analysis
      setPresence: (p: Partial<Record<StemKey,'present'|'absent'|'na'>>)=> setPresence(prev=>({ ...prev, ...p })),
    };
  }, [importRequested, importPayload]);

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-[#7b84ff] via-[#b17fb0] to-[#ff935c] text-white">
      <div className="mx-auto max-w-[1060px] px-5 pt-14 pb-24">
        <h1 className="text-center text-5xl md:text-6xl font-extrabold tracking-tight drop-shadow-sm">Music Room</h1>

        {/* Import Unit (File only) */}
        <section className="mt-10 flex flex-col items-center">
          <div className="mt-3 mx-auto w-[980px]">
            <div className="grid grid-cols-6 gap-4 w-full h-[80px]">
              <div className="col-span-5 rounded-xl border-2 border-dashed border-white/60 bg-white/5 px-4 py-2 cursor-pointer flex items-center justify-center text-center"
                onDragOver={(e)=>e.preventDefault()}
                onDrop={(e)=>{e.preventDefault(); const f=e.dataTransfer?.files?.[0]; if(f) setDroppedFile(f);}}
                onClick={()=>filePickRef.current?.click()}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl select-none">+</span>
                  <span className="text-sm opacity-90">{droppedFile ? `Selected: ${droppedFile.name}` : "Drag & Drop"}</span>
                  <span className="text-xs opacity-70">/ click to choose</span>
                </div>
                <input ref={filePickRef} type="file" accept="audio/*" className="hidden"
                  onChange={(e)=>{ const f=(e.target as HTMLInputElement).files?.[0]; if(f) setDroppedFile(f); }} />
              </div>
              <div className="col-span-1">
                <Button disabled={!importReady} onClick={handleImport}
                  className={`h-full w-full rounded-xl border border-white/70 px-2 py-2 text-lg backdrop-blur-sm transition-transform duration-150 will-change-transform hover:-translate-y-[1px] active:translate-y-[1px] active:scale-95 focus-visible:ring-2 focus-visible:ring-white/70 ${importReady ? 'hover:bg-white/10' : 'opacity-40 cursor-not-allowed'}`}>
                  Import
                </Button>
              </div>
            </div>
          </div>

          {/* Show latest file name */}
          {lastImportedLabel && (
            <div className="mt-2 text-xs opacity-85 text-center break-all max-w-[980px] w-full">
              {lastImportedLabel}
            </div>
          )}
        </section>

        {/* Working area */}
        <div className="relative mt-10">
          <div className={`transition-opacity duration-300 ${overlayActive?'pointer-events-none select-none opacity-30':'opacity-100'}`}>
            {/* Mixer */}
            <section className="flex justify-center">
              <div className="grid grid-cols-6 gap-4 max-w-[980px] w-full rounded-2xl border border-white/60 p-4">
                {stems.map((key)=> (
                  <Fader key={key} label={key} presence={presence[key]}
                    amp={amps[key]} setAmp={(a)=>setAmps(s=>({...s,[key]:a}))}
                    muted={muteMap[key]}
                    onToggleMute={()=> setMuteMap(m=> ({...m, [key]: !m[key]}))}
                    solo={solo===key}
                    onToggleSolo={()=> setSolo(s=> s===key? null : key)}
                    sliderToDb={sliderToDb} dbToSlider={dbToSlider} ampToDb={ampToDb} dbToAmp={dbToAmp}
                  />
                ))}
              </div>
            </section>

            {/* Pitch & Speed */}
            <section className="mx-auto mt-8 max-w-[980px] w-full">
              <div className="grid grid-cols-2 gap-6">
                <RowWithNumber title="Pitch" leftUnit="±" value={semitones}
                  setValue={(v)=>setSemitones(Math.round(Math.max(-12,Math.min(12,v))))}
                  min={-12} max={12} step={1} sliderValue={semitones} onSlider={(v)=>setSemitones(Math.round(v))}
                  leftLabel="-12" rightLabel="+12" marks={Array.from({length:25}, (_,i)=>({value:-12+i}))}
                />
                <RowWithNumber title="Speed" leftUnit="×" value={parseFloat(speed.toFixed(2))}
                  setValue={(v)=>setSpeedFromValue(v)} minExp={-2} maxExp={2} sliderValue={speedExp}
                  onSlider={(exp)=>setSpeedExp(exp)} leftLabel="0.25" rightLabel="4.0" isSpeed
                />
              </div>
            </section>
{/* Playback (externally controlled) */}
            <section className="mx-auto mt-6 max-w-[980px] w-full">
              <div className="flex items-center gap-4">
                <Button onClick={()=>window.dispatchEvent(new CustomEvent('musicroom:rewind'))} title="Back to start" className="rounded-full border border-white/60 px-3 py-2 hover:bg-white/10 transition-transform duration-150 will-change-transform hover:-translate-y-[1px] active:scale-90 focus-visible:ring-2 focus-visible:ring-white/70">
                  <img src={rewindUrl} alt="rewind" className="w-5 h-5" />
                </Button>
                <Button onClick={()=>window.dispatchEvent(new CustomEvent('musicroom:playToggle'))} title="Play / Pause" className="rounded-full border border-white/60 px-3 py-2 hover:bg-white/10 transition-transform duration-150 will-change-transform hover:-translate-y-[1px] active:scale-90 focus-visible:ring-2 focus-visible:ring-white/70">
                  <img src={isPlaying?pauseUrl:playUrl} alt="play-pause" className="w-5 h-5" />
                </Button>
                <MuiSlider
                  value={durationSec>0 ? (currentSec/durationSec)*100 : 0}
                  onChangeCommitted={(_,v)=>{ const pct = Array.isArray(v)? (v[0] as number) : (v as number); const sec = durationSec * (pct/100); window.dispatchEvent(new CustomEvent('musicroom:seekTo', { detail: { seconds: sec } })); }}
                  onChange={()=>{/* noop */}}
                  sx={sliderSx} className="flex-1" />
                <div className="w-[140px] text-right tabular-nums">{fmtTime(currentSec)} / {fmtTime(durationSec)}</div>
              </div>
            </section>
          </div>

          {/* Overlay for 'Hide' state */}
          <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${overlayActive?'opacity-100 pointer-events-auto':'opacity-0 pointer-events-none'}`} aria-hidden={!overlayActive}>
            <div className="mx-auto max-w-[980px] w-full rounded-2xl bg-black/60 text-center py-24">
              <div className="text-xl md:text-2xl whitespace-pre-line">{overlayText}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const sliderSx = {
  color: '#fff',
  '& .MuiSlider-thumb': { width: 18, height: 18, boxShadow: '0 1px 3px rgba(0,0,0,.35)' },
  '& .MuiSlider-rail': { opacity: 0.4 },
  '& .MuiSlider-mark': { width: 4, height: 4, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,.5)', transform: 'translateX(-2px) translateY(-2px)' },
  '& .MuiSlider-markActive': { backgroundColor: '#fff' },
  '& .MuiSlider-markLabel': { display: 'none' },
  '&.MuiSlider-vertical .MuiSlider-rail, &.MuiSlider-vertical .MuiSlider-track': { width: 8 },
  '&.MuiSlider-horizontal .MuiSlider-rail, &.MuiSlider-horizontal .MuiSlider-track': { height: 8 },
} as const;

function Fader({ label, presence, amp, setAmp, muted, onToggleMute, solo, onToggleSolo, sliderToDb, dbToSlider, ampToDb, dbToAmp }:
{ label:string; presence:"present"|"absent"|"na"; amp:number; setAmp:(a:number)=>void; muted:boolean; onToggleMute:()=>void; solo:boolean; onToggleSolo:()=>void; sliderToDb:(v:number)=>number; dbToSlider:(db:number)=>number; ampToDb:(a:number)=>number; dbToAmp:(db:number)=>number; }) {
  const disabled = presence !== "present";
  const [slider, setSlider] = useState<number>(()=>dbToSlider(ampToDb(amp)));
  const [dbText, setDbText] = useState<number>(()=>Math.round(ampToDb(amp)));
  const onSlider=(v:number)=>{ setSlider(v); const db=Math.round(sliderToDb(v)); setDbText(db); setAmp(dbToAmp(db)); };
  const onDbInput=(db:number)=>{ const d=Math.round(Math.max(-70, Math.min(6, db))); setDbText(d); setSlider(dbToSlider(d)); setAmp(dbToAmp(d)); };

  return (
    <div className={`relative flex flex-col items-center rounded-xl border border-white/40 p-3 transition-opacity duration-300 ${disabled?'opacity-40':'opacity-100'}`} aria-disabled={disabled}>
      <div className="flex items-center gap-2 mb-2 text-xs">
        <input type="number" min={-70} max={6} step={1} value={dbText} disabled={disabled} onChange={(e)=>onDbInput(parseFloat(e.target.value))} className="w-14 bg-transparent border-b border-white/50 text-center" />
        <span>dB</span>
      </div>

      <div className="flex items-center justify-center" style={{height:'180px'}}>
        <MuiSlider orientation="vertical" min={0} max={100} step={1} value={slider} disabled={disabled}
          onChange={(_,v)=>onSlider(v as number)} sx={sliderSx} className="h-[180px]" />
      </div>

      <div className="mt-3 flex items-center gap-2 text-sm opacity-90">
        <button onClick={onToggleMute} disabled={disabled} className={`px-2 py-1 rounded-md border ${muted?'bg-red-500/80':''}`}>M</button>
        <button onClick={onToggleSolo} disabled={disabled} className={`px-2 py-1 rounded-md border ${solo?'bg-blue-500/80':''}`}>S</button>
      </div>
      <div className="mt-1 text-sm opacity-90">{label}</div>

      {disabled && <div className="pointer-events-none absolute inset-0 rounded-xl bg-black/30" />}
    </div>
  );
}

function RowWithNumber({ title, leftUnit, value, setValue, min, max, step, sliderValue, onSlider, leftLabel, rightLabel, isSpeed, marks }:
{ title:string; leftUnit:string; value:number; setValue:(v:number)=>void; min?:number; max?:number; step?:number; sliderValue?:number; onSlider?:(v:number)=>void; leftLabel?:string; rightLabel?:string; isSpeed?:boolean; marks?: {value:number,label?:string}[] }) {
  return (
    <div>
      <div className="mb-1 flex items-end justify-between text-sm">
        <div className="flex items-baseline gap-3">
          <span className="text-base font-medium">{title}</span>
          <div className="flex items-center gap-2">
            <span className="opacity-80">{leftUnit}</span>
            <input type="number" value={value} onChange={(e)=>{ const v=parseFloat(e.target.value); setValue(isNaN(v)?(isSpeed?1:0):v); }} className="w-20 bg-transparent border-b border-white/50 text-center" />
          </div>
        </div>
        <div className="opacity-80 text-xs">{leftLabel} <span className="mx-2">~</span> {rightLabel}</div>
      </div>
      {isSpeed ? (
        <MuiSlider min={-2} max={2} step={0.01} value={sliderValue} onChange={(_,v)=>onSlider&&onSlider(v as number)} sx={sliderSx} className="w-full" />
      ) : (
        <MuiSlider min={min} max={max} step={step} value={sliderValue} onChange={(_,v)=>onSlider&&onSlider(v as number)} marks={marks} sx={sliderSx} className="w-full" />
      )}
    </div>
  );
}
