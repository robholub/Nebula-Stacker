import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Upload, Play, Download, Trash2, Sliders, Layers, 
  Star, Info, Loader2, BarChart2, Zap, Sun, 
  Settings2, Eye, Camera, ShieldAlert, Crosshair,
  Activity, Palette, CheckCircle2, XCircle, RotateCcw,
  Image as ImageIcon, Sparkles
} from 'lucide-react';

// --- ROBUST ALIGNMENT & MATH ENGINE ---

/**
 * Finds star centroids using a local maxima search with 
 * center-of-mass estimation for sub-pixel accuracy.
 */
function findStars(imageData, threshold = 45) {
  const { data, width, height } = imageData;
  const stars = [];
  const step = 4; // Optimized for mobile performance

  for (let y = 20; y < height - 20; y += step) {
    for (let x = 20; x < width - 20; x += step) {
      const i = (y * width + x) * 4;
      const val = (data[i] + data[i+1] + data[i+2]) / 3;
      
      if (val > threshold) {
        let sumX = 0, sumY = 0, sumI = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const ni = ((y + dy) * width + (x + dx)) * 4;
            const nv = (data[ni] + data[ni+1] + data[ni+2]) / 3;
            sumX += (x + dx) * nv;
            sumY += (y + dy) * nv;
            sumI += nv;
          }
        }
        if (sumI > 0) {
            stars.push({ x: sumX / sumI, y: sumY / sumI, b: sumI });
            x += 12; // Region lock to avoid multiple detections of one star
        }
      }
    }
  }
  return stars.sort((a, b) => b.b - a.b).slice(0, 35);
}

/**
 * Geometric Invariant Triangle Matcher
 * Identifies triangles in both frames and matches them by side-length ratios.
 */
function getAlignTransform(refStars, srcStars) {
  if (refStars.length < 3 || srcStars.length < 3) return null;

  const getTriangles = (stars) => {
    const tris = [];
    const max = Math.min(stars.length, 12);
    for (let i = 0; i < max; i++) {
      for (let j = i + 1; j < max; j++) {
        for (let k = j + 1; k < max; k++) {
          const d1 = Math.hypot(stars[i].x - stars[j].x, stars[i].y - stars[j].y);
          const d2 = Math.hypot(stars[j].x - stars[k].x, stars[j].y - stars[k].y);
          const d3 = Math.hypot(stars[k].x - stars[i].x, stars[k].y - stars[i].y);
          const sides = [d1, d2, d3].sort((a, b) => b - a);
          if (sides[0] < 15) continue;
          tris.push({ r1: sides[1] / sides[0], r2: sides[2] / sides[0], points: [stars[i], stars[j], stars[k]] });
        }
      }
    }
    return tris;
  };

  const refTris = getTriangles(refStars);
  const srcTris = getTriangles(srcStars);
  let bestMatch = null;
  let maxVotes = 0;

  for (const rt of refTris) {
    for (const st of srcTris) {
      if (Math.abs(rt.r1 - st.r1) + Math.abs(rt.r2 - st.r2) < 0.005) {
        const rc = { x: (rt.points[0].x + rt.points[1].x + rt.points[2].x) / 3, y: (rt.points[0].y + rt.points[1].y + rt.points[2].y) / 3 };
        const sc = { x: (st.points[0].x + st.points[1].x + st.points[2].x) / 3, y: (st.points[0].y + st.points[1].y + st.points[2].y) / 3 };
        const dx = rc.x - sc.x;
        const dy = rc.y - sc.y;

        let votes = 0;
        for (let sIdx = 0; sIdx < Math.min(srcStars.length, 15); sIdx++) {
            const s = srcStars[sIdx];
            if (refStars.some(r => Math.abs(r.x - (s.x + dx)) < 5 && Math.abs(r.y - (s.y + dy)) < 5)) votes++;
        }
        if (votes > maxVotes) { maxVotes = votes; bestMatch = { dx, dy }; }
      }
    }
  }
  return maxVotes >= 3 ? bestMatch : null;
}

// --- UI COMPONENTS ---

const CompactSlider = ({ label, min, max, step, value, onChange, icon: Icon, suffix = "" }) => (
  <div className="bg-white/5 border border-white/5 p-3 rounded-xl space-y-2">
    <div className="flex justify-between items-center">
      <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-black uppercase tracking-widest">
        <Icon size={12} className="text-blue-500" />
        {label}
      </div>
      <span className="text-[10px] font-mono text-blue-400 font-bold bg-blue-500/10 px-1.5 py-0.5 rounded">{value}{suffix}</span>
    </div>
    <input 
      type="range" min={min} max={max} step={step} value={value} 
      onChange={e => onChange(parseFloat(e.target.value))}
      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none accent-blue-500"
    />
  </div>
);

export default function App() {
  const [activeTab, setActiveTab] = useState('view');
  const [images, setImages] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Ready");
  const [stackedResult, setStackedResult] = useState(null);
  const [refIndex, setRefIndex] = useState(0);

  // Enhancement States
  const [exposure, setExposure] = useState(1.0);
  const [stretch, setStretch] = useState(4.0);
  const [blackPoint, setBlackPoint] = useState(0.04);
  const [saturation, setSaturation] = useState(1.2);
  const [showStars, setShowStars] = useState(false);

  const canvasRef = useRef(null);
  const previewRef = useRef(null);

  const handleUpload = (e) => {
    const files = Array.from(e.target.files).map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      url: URL.createObjectURL(file),
      name: file.name,
      status: 'pending'
    }));
    setImages(prev => [...prev, ...files]);
    if (activeTab === 'view' && images.length === 0) setActiveTab('files');
  };

  const processStack = async () => {
    if (images.length < 2) return;
    setIsProcessing(true);
    setActiveTab('view');
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    setStatus("Reference Check...");
    const refImg = await loadImage(images[refIndex].url);
    canvas.width = refImg.width; canvas.height = refImg.height;
    ctx.drawImage(refImg, 0, 0);
    const refData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const refStars = findStars(refData);
    
    setImages(prev => prev.map((img, i) => i === refIndex ? { ...img, status: 'reference', stars: refStars } : img));

    const acc = new Float64Array(canvas.width * canvas.height * 3);
    for (let i = 0; i < refData.data.length; i += 4) {
      acc[(i/4)*3] = refData.data[i];
      acc[(i/4)*3+1] = refData.data[i+1];
      acc[(i/4)*3+2] = refData.data[i+2];
    }

    let count = 1;
    for (let i = 0; i < images.length; i++) {
      if (i === refIndex) continue;
      setProgress(Math.round((i / images.length) * 100));
      setStatus(`Stacking ${i+1}/${images.length}...`);
      
      try {
        const currentImg = await loadImage(images[i].url);
        const tCanvas = document.createElement('canvas');
        tCanvas.width = canvas.width; tCanvas.height = canvas.height;
        const tCtx = tCanvas.getContext('2d');
        tCtx.drawImage(currentImg, 0, 0);
        const currentData = tCtx.getImageData(0, 0, canvas.width, canvas.height);
        const transform = getAlignTransform(refStars, findStars(currentData));

        if (transform) {
          count++;
          setImages(prev => prev.map((img, idx) => idx === i ? { ...img, status: 'success' } : img));
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const sx = Math.round(x - transform.dx); const sy = Math.round(y - transform.dy);
              if (sx >= 0 && sx < canvas.width && sy >= 0 && sy < canvas.height) {
                const sIdx = (sy * canvas.width + sx) * 4;
                const dIdx = (y * canvas.width + x) * 3;
                acc[dIdx] += currentData.data[sIdx];
                acc[dIdx+1] += currentData.data[sIdx+1];
                acc[dIdx+2] += currentData.data[sIdx+2];
              }
            }
          }
        } else {
          setImages(prev => prev.map((img, idx) => idx === i ? { ...img, status: 'failed' } : img));
        }
      } catch (e) {
          console.error("Frame failed:", e);
      }
      await new Promise(r => setTimeout(r, 0));
    }

    const finalData = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    for (let i = 0; i < acc.length; i += 3) {
      const pIdx = (i / 3) * 4;
      finalData[pIdx] = acc[i] / count;
      finalData[pIdx+1] = acc[i+1] / count;
      finalData[pIdx+2] = acc[i+2] / count;
      finalData[pIdx+3] = 255;
    }

    setStackedResult(new ImageData(finalData, canvas.width, canvas.height));
    setIsProcessing(false);
    setStatus("Done");
    setActiveTab('edit');
  };

  const loadImage = (url) => new Promise(r => {
    const img = new Image();
    img.onload = () => r(img);
    img.src = url;
  });

  useEffect(() => {
    if (!stackedResult || !previewRef.current) return;
    const canvas = previewRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = stackedResult.width; canvas.height = stackedResult.height;

    const out = new ImageData(new Uint8ClampedArray(stackedResult.data), stackedResult.width, stackedResult.height);
    const d = out.data;

    for (let i = 0; i < d.length; i += 4) {
      d[i] *= exposure; d[i+1] *= exposure; d[i+2] *= exposure;
      for (let j = 0; j < 3; j++) {
        let v = d[i+j] / 255;
        v = Math.max(0, v - blackPoint) / (1 - blackPoint);
        v = Math.pow(v, 1 / stretch);
        const gray = (d[i] + d[i+1] + d[i+2]) / (3 * 255);
        v = gray + (v - gray) * saturation;
        d[i+j] = Math.min(255, v * 255);
      }
    }
    ctx.putImageData(out, 0, 0);

    if (showStars && images[refIndex]?.stars) {
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 3;
        images[refIndex].stars.forEach(s => {
            ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, Math.PI * 2); ctx.stroke();
        });
    }
  }, [stackedResult, stretch, blackPoint, saturation, exposure, showStars, refIndex, images]);

  return (
    <div className="fixed inset-0 bg-[#020617] text-slate-100 flex flex-col font-sans select-none overflow-hidden">
      
      {/* Header */}
      <header className="h-14 border-b border-white/5 px-4 flex items-center justify-between shrink-0 bg-slate-950/90 backdrop-blur-xl z-50">
        <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Activity size={14} className="text-white" />
            </div>
            <span className="text-xs font-black tracking-tighter uppercase italic">Nebula<span className="text-blue-500">Stack</span></span>
        </div>
        <button 
            onClick={processStack}
            disabled={images.length < 2 || isProcessing}
            className="h-8 px-5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest transition-all shadow-xl"
        >
            {isProcessing ? "Processing..." : "Integrate"}
        </button>
      </header>

      {/* Main UI Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        
        {/* Persistent Viewport for Edit and View modes */}
        {(activeTab === 'view' || activeTab === 'edit') && (
            <div className="bg-black aspect-video md:aspect-square flex items-center justify-center relative overflow-hidden shrink-0 border-b border-white/10 shadow-2xl">
                {stackedResult ? (
                    <canvas ref={previewRef} className="w-full h-full object-contain" />
                ) : (
                    <div className="flex flex-col items-center gap-3 opacity-20 text-slate-500">
                        <ImageIcon size={48} strokeWidth={1} />
                        <p className="text-[10px] font-black uppercase tracking-[0.3em]">No Data Active</p>
                    </div>
                )}
                
                {isProcessing && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center">
                        <div className="w-16 h-16 rounded-full border-4 border-white/5 border-t-blue-500 animate-spin mb-6" />
                        <p className="text-sm font-black uppercase tracking-widest text-white">{status}</p>
                        <p className="text-[10px] text-slate-400 font-mono mt-2 tracking-widest">{progress}% COMPLETE</p>
                    </div>
                )}

                {stackedResult && (
                    <div className="absolute top-4 right-4 flex flex-col gap-2">
                        <button onClick={() => setShowStars(!showStars)} className={`p-3 rounded-2xl border backdrop-blur-xl ${showStars ? 'bg-blue-600 border-blue-400' : 'bg-black/60 border-white/10 text-slate-500'}`}>
                            <Star size={20} />
                        </button>
                    </div>
                )}
            </div>
        )}

        {/* Scrollable Panel */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden bg-[#050a1a]">
            
            {activeTab === 'view' && (
                <div className="p-5 space-y-5 animate-in fade-in slide-in-from-bottom-2">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-2"><Sparkles size={10} className="text-blue-400" /> Gain</p>
                            <p className="text-xl font-black">{images.length > 0 ? (Math.sqrt(images.length)*10).toFixed(1) : "0"} dB</p>
                        </div>
                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-2"><CheckCircle2 size={10} className="text-emerald-400" /> Aligned</p>
                            <p className="text-xl font-black text-emerald-500">{images.filter(i => i.status === 'success' || i.status === 'reference').length}</p>
                        </div>
                    </div>
                    <div className="bg-blue-500/5 border border-blue-500/10 p-4 rounded-2xl text-[11px] text-blue-300/60 leading-relaxed">
                        Each frame is aligned using triangle similarity. 
                        Best results are achieved with tracked exposures between 30-120 seconds.
                    </div>
                </div>
            )}

            {activeTab === 'edit' && (
                <div className="p-5 space-y-4 animate-in fade-in slide-in-from-bottom-2 pb-10">
                    {!stackedResult ? (
                        <div className="py-12 text-center space-y-3 opacity-20"><Sliders size={32} className="mx-auto" /><p className="text-xs font-bold uppercase tracking-widest">Awaiting Master</p></div>
                    ) : (
                        <>
                            <CompactSlider label="Gain (EV)" icon={Sun} min={0.5} max={4} step={0.1} value={exposure} onChange={setExposure} suffix="x" />
                            <CompactSlider label="Nebula Stretch" icon={Zap} min={1} max={15} step={0.1} value={stretch} onChange={setStretch} suffix="x" />
                            <CompactSlider label="Black Level" icon={RotateCcw} min={0} max={0.15} step={0.001} value={blackPoint} onChange={setBlackPoint} suffix="%" />
                            <CompactSlider label="Color Boost" icon={Palette} min={1} max={3} step={0.05} value={saturation} onChange={setSaturation} suffix="x" />
                            <div className="pt-4 flex gap-3">
                                <button onClick={() => { setExposure(1.0); setStretch(4.0); setBlackPoint(0.04); setSaturation(1.2); }} className="flex-1 py-4 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Reset</button>
                                <button onClick={() => { const link = document.createElement('a'); link.download = "master.png"; link.href = previewRef.current.toDataURL(); link.click(); }} className="flex-[2] py-4 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white text-[10px] font-black uppercase tracking-[0.2em]">Save Image</button>
                            </div>
                        </>
                    )}
                </div>
            )}

            {activeTab === 'files' && (
                <div className="p-5 space-y-5 animate-in fade-in slide-in-from-bottom-2 pb-10">
                    <div className="flex items-center justify-between">
                        <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Library ({images.length})</h2>
                        <label className="text-[10px] font-black text-blue-400 bg-blue-400/10 px-4 py-2 rounded-full cursor-pointer uppercase tracking-widest border border-blue-400/20">
                            Add Frames
                            <input type="file" multiple className="hidden" onChange={handleUpload} />
                        </label>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                        {images.length === 0 ? (
                            <div className="py-20 text-center space-y-4 opacity-20 border-2 border-dashed border-white/5 rounded-3xl"><ImageIcon size={40} className="mx-auto" /><p className="text-[10px] font-bold uppercase tracking-widest">Upload Fits/Jpg</p></div>
                        ) : (
                            images.map((img, i) => (
                                <div key={img.id} className={`flex items-center gap-4 p-3 rounded-2xl border transition-all ${refIndex === i ? 'bg-blue-600/10 border-blue-500/30' : 'bg-white/5 border-white/5'}`}>
                                    <div className="w-12 h-12 rounded-xl bg-black overflow-hidden relative shrink-0">
                                        <img src={img.url} className="w-full h-full object-cover opacity-40" />
                                        <div className="absolute inset-0 flex items-center justify-center scale-75">
                                            {img.status === 'success' && <CheckCircle2 size={18} className="text-emerald-500" />}
                                            {img.status === 'failed' && <XCircle size={18} className="text-red-500" />}
                                            {img.status === 'reference' && <Star size={18} className="text-amber-500" />}
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[11px] font-bold truncate text-slate-200">{img.name}</p>
                                        <p className="text-[9px] text-slate-500 uppercase tracking-widest font-black">Frame {i+1}</p>
                                    </div>
                                    <div className="flex gap-1">
                                        <button onClick={() => setRefIndex(i)} className={`p-2 rounded-lg ${refIndex === i ? 'text-amber-500' : 'text-slate-600'}`}><Crosshair size={18} /></button>
                                        <button onClick={() => setImages(prev => prev.filter(x => x.id !== img.id))} className="p-2 text-red-500/40"><Trash2 size={18} /></button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

        </div>
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Navigation Dock */}
      <nav className="h-20 shrink-0 border-t border-white/5 bg-slate-950/80 backdrop-blur-2xl flex items-center justify-around px-6 pb-6 pt-2">
        {[
            { id: 'files', label: 'Library', icon: Layers },
            { id: 'view', label: 'Status', icon: Eye },
            { id: 'edit', label: 'Develop', icon: Sliders },
        ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center gap-1.5 px-6 py-2 transition-all relative ${activeTab === tab.id ? 'text-blue-500 scale-110' : 'text-slate-600'}`}>
                <tab.icon size={20} strokeWidth={activeTab === tab.id ? 2.5 : 2} />
                <span className="text-[9px] font-black uppercase tracking-[0.15em]">{tab.label}</span>
                {activeTab === tab.id && <div className="absolute -top-2 w-8 h-[2px] bg-blue-500 rounded-full" />}
            </button>
        ))}
      </nav>

      <style>{`
        input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none; width: 24px; height: 24px;
            background: #3b82f6; border-radius: 50%;
            cursor: pointer; border: 5px solid #020617;
            box-shadow: 0 0 15px rgba(59, 130, 246, 0.4);
        }
        .animate-in { animation: animateIn 0.25s ease-out forwards; }
        @keyframes animateIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
