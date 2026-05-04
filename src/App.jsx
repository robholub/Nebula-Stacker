import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, Play, Download, Trash2, Sliders, Layers, 
  Star, Info, Loader2, Zap, Sun, 
  Activity, Palette, CheckCircle2, XCircle, RotateCcw,
  Image as ImageIcon, Crosshair, FileCode, Eye
} from 'lucide-react';

/**
 * --- DECODING UTILITIES ---
 */

// Custom FITS Parser (Handles 8, 16, 32 bit and -32 float)
async function parseFITS(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  let offset = 0;
  const header = {};
  
  // 1. Read Header Units (2880 bytes each)
  while (offset < arrayBuffer.byteLength) {
    const block = new TextDecoder().decode(new Uint8Array(arrayBuffer, offset, 2880));
    for (let i = 0; i < 36; i++) {
      const line = block.slice(i * 80, (i + 1) * 80);
      if (line.startsWith('END')) {
        offset += 2880;
        gotoData();
        return;
      }
      const [key, valPart] = line.split('=');
      if (valPart) {
        const val = valPart.split('/')[0].trim();
        header[key.trim()] = isNaN(val) ? val.replace(/'/g, "") : parseFloat(val);
      }
    }
    offset += 2880;
  }

  function gotoData() {
    const bitpix = header['BITPIX'];
    const width = header['NAXIS1'];
    const height = header['NAXIS2'];
    const size = width * height;
    let data;

    // Interpret binary data based on BITPIX
    if (bitpix === 16) {
      data = new Int16Array(size);
      for (let i = 0; i < size; i++) data[i] = view.getInt16(offset + i * 2, false);
    } else if (bitpix === 32) {
      data = new Int32Array(size);
      for (let i = 0; i < size; i++) data[i] = view.getInt32(offset + i * 4, false);
    } else if (bitpix === -32) {
      data = new Float32Array(size);
      for (let i = 0; i < size; i++) data[i] = view.getFloat32(offset + i * 4, false);
    } else {
      data = new Uint8Array(arrayBuffer, offset, size);
    }

    // Normalize FITS data to 0-255 for our engine
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < size; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
    
    const normalized = new Uint8Array(size * 4);
    for (let i = 0; i < size; i++) {
      const val = ((data[i] - min) / (max - min)) * 255;
      const idx = i * 4;
      normalized[idx] = normalized[idx+1] = normalized[idx+2] = val;
      normalized[idx+3] = 255;
    }
    header.pixelData = normalized;
  }

  return header;
}

// RAW Decoder using UTIF (Handles ARW, DNG, CR2)
async function decodeRAW(arrayBuffer) {
  try {
    const ifds = window.UTIF.decode(arrayBuffer);
    window.UTIF.decodeImage(arrayBuffer, ifds[0]);
    const rgba = window.UTIF.toRGBA8(ifds[0]);
    return {
      width: ifds[0].width,
      height: ifds[0].height,
      pixelData: rgba
    };
  } catch (e) {
    throw new Error("RAW decoding failed. Ensure file is TIFF-based (ARW/DNG/CR2).");
  }
}

/**
 * --- STAR DETECTION & ALIGNMENT ---
 */

function findStars(pixelData, width, height, threshold = 45) {
  const stars = [];
  const step = 4;
  for (let y = 20; y < height - 20; y += step) {
    for (let x = 20; x < width - 20; x += step) {
      const i = (y * width + x) * 4;
      const val = (pixelData[i] + pixelData[i+1] + pixelData[i+2]) / 3;
      if (val > threshold) {
        let sumX = 0, sumY = 0, sumI = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const ni = ((y + dy) * width + (x + dx)) * 4;
            const nv = (pixelData[ni] + pixelData[ni+1] + pixelData[ni+2]) / 3;
            sumX += (x + dx) * nv; sumY += (y + dy) * nv; sumI += nv;
          }
        }
        if (sumI > 0) {
          stars.push({ x: sumX / sumI, y: sumY / sumI, b: sumI });
          x += 12;
        }
      }
    }
  }
  return stars.sort((a, b) => b.b - a.b).slice(0, 35);
}

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
  let best = null, maxVotes = 0;
  for (const rt of refTris) {
    for (const st of srcTris) {
      if (Math.abs(rt.r1 - st.r1) + Math.abs(rt.r2 - st.r2) < 0.005) {
        const dx = (rt.points[0].x + rt.points[1].x + rt.points[2].x)/3 - (st.points[0].x + st.points[1].x + st.points[2].x)/3;
        const dy = (rt.points[0].y + rt.points[1].y + rt.points[2].y)/3 - (st.points[0].y + st.points[1].y + st.points[2].y)/3;
        let votes = 0;
        for (let sIdx = 0; sIdx < Math.min(srcStars.length, 15); sIdx++) {
          const s = srcStars[sIdx];
          if (refStars.some(r => Math.abs(r.x - (s.x + dx)) < 5 && Math.abs(r.y - (s.y + dy)) < 5)) votes++;
        }
        if (votes > maxVotes) { maxVotes = votes; best = { dx, dy }; }
      }
    }
  }
  return maxVotes >= 3 ? best : null;
}

/**
 * --- MAIN APP COMPONENT ---
 */

export default function App() {
  const [activeTab, setActiveTab] = useState('files');
  const [images, setImages] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Ready");
  const [stackedResult, setStackedResult] = useState(null);
  const [refIndex, setRefIndex] = useState(0);

  // Edit States
  const [exposure, setExposure] = useState(1.0);
  const [stretch, setStretch] = useState(4.0);
  const [blackPoint, setBlackPoint] = useState(0.04);
  const [saturation, setSaturation] = useState(1.2);

  const canvasRef = useRef(null);
  const previewRef = useRef(null);

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files);
    const newImages = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file: file,
      name: file.name,
      status: 'pending',
      type: file.name.split('.').pop().toLowerCase()
    }));
    setImages(prev => [...prev, ...newImages]);
  };

  const processFile = async (fileObj) => {
    const buffer = await fileObj.file.arrayBuffer();
    const ext = fileObj.type;

    if (ext === 'fits' || ext === 'fit') {
      const fits = await parseFITS(buffer);
      return { width: fits.NAXIS1, height: fits.NAXIS2, pixelData: fits.pixelData };
    } else if (['arw', 'dng', 'cr2', 'nef', 'tiff', 'tif'].includes(ext)) {
      return await decodeRAW(buffer);
    } else {
      // Standard Browser Formats
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          resolve({ width: img.width, height: img.height, pixelData: ctx.getImageData(0, 0, img.width, img.height).data });
        };
        img.src = URL.createObjectURL(fileObj.file);
      });
    }
  };

  const processStack = async () => {
    if (images.length < 2) return;
    setIsProcessing(true);
    setActiveTab('view');
    
    try {
      setStatus("Decoding Master...");
      const ref = await processFile(images[refIndex]);
      const refStars = findStars(ref.pixelData, ref.width, ref.height);
      
      const acc = new Float64Array(ref.width * ref.height * 3);
      for (let i = 0; i < ref.pixelData.length; i += 4) {
        acc[(i/4)*3] = ref.pixelData[i];
        acc[(i/4)*3+1] = ref.pixelData[i+1];
        acc[(i/4)*3+2] = ref.pixelData[i+2];
      }

      let count = 1;
      for (let i = 0; i < images.length; i++) {
        if (i === refIndex) continue;
        setProgress(Math.round((i / images.length) * 100));
        setStatus(`Integrating ${images[i].name}...`);
        
        const current = await processFile(images[i]);
        const currentStars = findStars(current.pixelData, current.width, current.height);
        const transform = getAlignTransform(refStars, currentStars);

        if (transform) {
          count++;
          setImages(p => p.map((img, idx) => idx === i ? { ...img, status: 'success' } : img));
          for (let y = 0; y < ref.height; y++) {
            for (let x = 0; x < ref.width; x++) {
              const sx = Math.round(x - transform.dx), sy = Math.round(y - transform.dy);
              if (sx >= 0 && sx < current.width && sy >= 0 && sy < current.height) {
                const sIdx = (sy * current.width + sx) * 4, dIdx = (y * ref.width + x) * 3;
                acc[dIdx] += current.pixelData[sIdx];
                acc[dIdx+1] += current.pixelData[sIdx+1];
                acc[dIdx+2] += current.pixelData[sIdx+2];
              }
            }
          }
        } else {
          setImages(p => p.map((img, idx) => idx === i ? { ...img, status: 'failed' } : img));
        }
        await new Promise(r => setTimeout(r, 0));
      }

      const final = new Uint8ClampedArray(ref.width * ref.height * 4);
      for (let i = 0; i < acc.length; i += 3) {
        const pIdx = (i / 3) * 4;
        final[pIdx] = acc[i] / count; final[pIdx+1] = acc[i+1] / count; final[pIdx+2] = acc[i+2] / count; final[pIdx+3] = 255;
      }
      setStackedResult(new ImageData(final, ref.width, ref.height));
      setActiveTab('edit');
    } catch (e) {
      console.error(e);
      setStatus("Error processing files");
    }
    setIsProcessing(false);
  };

  useEffect(() => {
    if (!stackedResult || !previewRef.current) return;
    const canvas = previewRef.current;
    canvas.width = stackedResult.width; canvas.height = stackedResult.height;
    const ctx = canvas.getContext('2d');
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
  }, [stackedResult, stretch, blackPoint, saturation, exposure]);

  return (
    <div className="fixed inset-0 bg-[#020617] text-slate-100 flex flex-col font-sans select-none overflow-hidden">
      
      {/* Header */}
      <header className="h-14 border-b border-white/5 px-4 flex items-center justify-between shrink-0 bg-slate-950/90 backdrop-blur-xl z-50">
        <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
                <Activity size={14} className="text-white" />
            </div>
            <span className="text-xs font-black tracking-tighter uppercase italic">Nebula<span className="text-blue-500">Stack</span> <span className="text-[10px] bg-white/10 px-1 rounded not-italic">RAW</span></span>
        </div>
        <button 
            onClick={processStack}
            disabled={images.length < 2 || isProcessing}
            className="h-8 px-5 bg-blue-600 disabled:bg-slate-800 text-white rounded-full text-[10px] font-black uppercase tracking-widest transition-all"
        >
            {isProcessing ? "Processing..." : "Run Stack"}
        </button>
      </header>

      <div className="flex-1 flex flex-col overflow-hidden">
        {(activeTab === 'view' || activeTab === 'edit') && (
            <div className="bg-black aspect-video flex items-center justify-center relative overflow-hidden shrink-0 border-b border-white/10 shadow-2xl">
                {stackedResult ? <canvas ref={previewRef} className="w-full h-full object-contain" /> : <div className="opacity-20 flex flex-col items-center gap-2"><ImageIcon size={48} /><p className="text-[10px] font-black uppercase tracking-widest">No Image Data</p></div>}
                {isProcessing && (
                    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center p-6">
                        <div className="w-12 h-12 border-2 border-white/5 border-t-blue-500 rounded-full animate-spin mb-4" />
                        <p className="text-xs font-black uppercase tracking-widest">{status}</p>
                    </div>
                )}
            </div>
        )}

        <div className="flex-1 overflow-y-auto bg-[#050a1a]">
            {activeTab === 'files' && (
                <div className="p-5 space-y-5 pb-10">
                    <div className="flex items-center justify-between">
                        <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Library ({images.length})</h2>
                        <label className="text-[10px] font-black text-blue-400 bg-blue-400/10 px-4 py-2 rounded-full cursor-pointer uppercase tracking-widest border border-blue-400/20">
                            Add Raw/Fits
                            <input type="file" multiple className="hidden" onChange={handleUpload} />
                        </label>
                    </div>
                    <div className="space-y-2">
                        {images.length === 0 ? (
                            <div className="py-20 text-center opacity-20 border-2 border-dashed border-white/5 rounded-3xl"><FileCode size={40} className="mx-auto" /><p className="text-[10px] font-bold uppercase mt-2">Support: .fits .arw .dng .tiff</p></div>
                        ) : (
                            images.map((img, i) => (
                                <div key={img.id} className={`flex items-center gap-4 p-3 rounded-2xl border ${refIndex === i ? 'bg-blue-600/10 border-blue-500/30' : 'bg-white/5 border-white/5'}`}>
                                    <div className="w-10 h-10 rounded-lg bg-black flex items-center justify-center relative shrink-0">
                                        <span className="text-[8px] font-bold uppercase text-slate-500">{img.type}</span>
                                        <div className="absolute inset-0 flex items-center justify-center scale-75">
                                            {img.status === 'success' && <CheckCircle2 size={16} className="text-emerald-500" />}
                                            {img.status === 'failed' && <XCircle size={16} className="text-red-500" />}
                                            {img.status === 'reference' && <Star size={16} className="text-amber-500" />}
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[11px] font-bold truncate text-slate-200">{img.name}</p>
                                        <p className="text-[9px] text-slate-500 uppercase tracking-widest font-black">Sub #{i+1}</p>
                                    </div>
                                    <button onClick={() => setRefIndex(i)} className={`p-2 rounded-lg ${refIndex === i ? 'text-amber-500' : 'text-slate-600'}`}><Crosshair size={18} /></button>
                                    <button onClick={() => setImages(p => p.filter(x => x.id !== img.id))} className="p-2 text-red-500/40"><Trash2 size={18} /></button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'edit' && (
                <div className="p-5 space-y-4 pb-10">
                    <CompactSlider label="Gain" icon={Sun} min={0.5} max={4} step={0.1} value={exposure} onChange={setExposure} suffix="x" />
                    <CompactSlider label="Nebula Stretch" icon={Zap} min={1} max={15} step={0.1} value={stretch} onChange={setStretch} suffix="x" />
                    <CompactSlider label="Black Point" icon={RotateCcw} min={0} max={0.15} step={0.001} value={blackPoint} onChange={setBlackPoint} suffix="%" />
                    <CompactSlider label="Saturation" icon={Palette} min={1} max={3} step={0.05} value={saturation} onChange={setSaturation} suffix="x" />
                    <button onClick={() => { const link = document.createElement('a'); link.download = "master.png"; link.href = previewRef.current.toDataURL(); link.click(); }} className="w-full py-4 mt-4 rounded-2xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-[0.2em]">Export Final Image</button>
                </div>
            )}
        </div>
      </div>

      {/* Bottom Nav */}
      <nav className="h-20 shrink-0 border-t border-white/5 bg-slate-950/80 backdrop-blur-2xl flex items-center justify-around px-6 pb-6 pt-2">
        {[{ id: 'files', label: 'Library', icon: Layers }, { id: 'view', label: 'Analyze', icon: Eye }, { id: 'edit', label: 'Develop', icon: Sliders }].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center gap-1.5 px-6 py-2 transition-all relative ${activeTab === tab.id ? 'text-blue-500 scale-110' : 'text-slate-600'}`}>
                <tab.icon size={20} />
                <span className="text-[9px] font-black uppercase tracking-[0.15em]">{tab.label}</span>
                {activeTab === tab.id && <div className="absolute -top-2 w-8 h-[2px] bg-blue-500 rounded-full" />}
            </button>
        ))}
      </nav>

      <style>{`
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px; background: #3b82f6; border-radius: 50%; cursor: pointer; border: 4px solid #020617; }
      `}</style>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

const CompactSlider = ({ label, min, max, step, value, onChange, icon: Icon, suffix = "" }) => (
  <div className="bg-white/5 p-3 rounded-xl space-y-2 border border-white/5">
    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-400">
      <div className="flex items-center gap-1.5"><Icon size={12} className="text-blue-500" />{label}</div>
      <span className="text-blue-400">{value}{suffix}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none accent-blue-500" />
  </div>
);
