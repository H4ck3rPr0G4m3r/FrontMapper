import { useEffect, useRef, useState } from 'preact/hooks';
import { tileColor } from '../../core/colors';
import type { MapGrid } from '../../core/grid';
import { DEFAULT_GEN, generateMap, heightmapToGrid, luminance, type GenOpts } from '../../core/procgen';
import { formatCount, sizeProblem, sizeTier } from '../../core/size';
import { newBlankMap, openNewGrid } from '../../state/session';
import type { GenerateRequest, GenerateResponse } from '../../workers/generate.worker';

type Mode = 'blank' | 'generate' | 'heightmap';

const PRESETS: [number, number][] = [
  [2000, 1500],
  [3000, 2000],
  [4000, 2500],
];
const PREVIEW_W = 432;
const PREVIEW_H = 200;
/** Largest map a heightmap is sized to by default (it can be changed after). */
const HM_MAX_PX = 12_000_000;

const snap4 = (v: number) => Math.max(4, Math.round(v / 4) * 4);

/** Paint a grid in game colours (no shorelines: a preview). */
function drawGrid(cv: HTMLCanvasElement, g: MapGrid) {
  cv.width = g.width;
  cv.height = g.height;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(g.width, g.height);
  for (let i = 0; i < g.terrain.length; i++) {
    const [r, gg, b] = tileColor(g.terrain[i], g.mag[i], false, 12);
    img.data.set([r, gg, b, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
}

/** Preview size with the map's shape, inside PREVIEW_W x PREVIEW_H. */
function previewSize(w: number, h: number) {
  const s = Math.min(PREVIEW_W / w, PREVIEW_H / h, 1);
  return { pw: Math.max(1, Math.round(w * s)), ph: Math.max(1, Math.round(h * s)) };
}

function readPixels(src: CanvasImageSource, w: number, h: number) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return luminance(ctx.getImageData(0, 0, w, h).data);
}

/** Water level that suits most heightmaps: just above a flat black sea, else the darkest 30%. */
function defaultSea(lum: Uint8Array) {
  let min = 255;
  for (const v of lum) if (v < min) min = v;
  let atMin = 0;
  for (const v of lum) if (v === min) atMin++;
  if (atMin > lum.length * 0.05) return min;
  const sorted = Uint8Array.from(lum).sort();
  return sorted[Math.floor(sorted.length * 0.3)];
}

function Slider(props: { label: string; min: number; max: number; step?: number; value: number; onInput: (v: number) => void; format: (v: number) => string }) {
  return (
    <label class="gen-ctl">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        style={{ '--p': `${((props.value - props.min) / (props.max - props.min)) * 100}%` }}
        onInput={(e) => props.onInput(+(e.currentTarget as HTMLInputElement).value)}
      />
      <span class="val">{props.format(props.value)}</span>
    </label>
  );
}

export function NewMapCard({ onError }: { onError: (msg: string) => void }) {
  const [mode, setMode] = useState<Mode>('blank');
  const [w, setW] = useState(3000);
  const [h, setH] = useState(2000);
  const [gen, setGen] = useState<GenOpts>({ ...DEFAULT_GEN, seed: 1 + Math.floor(Math.random() * 9999) });
  const [hm, setHm] = useState<{ bitmap: ImageBitmap; name: string; sea: number } | null>(null);
  const [working, setWorking] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const problem = sizeProblem(w, h);
  const { pw, ph } = previewSize(w, h);

  // Live preview, computed small with the same noise as the full map.
  useEffect(() => {
    if (mode === 'blank' || !preview.current || problem) return;
    const t = window.setTimeout(() => {
      if (!preview.current) return;
      if (mode === 'generate') drawGrid(preview.current, generateMap(pw, ph, gen, w, h, false));
      else if (hm) {
        const { lum, alpha } = readPixels(hm.bitmap, pw, ph);
        drawGrid(preview.current, heightmapToGrid(lum, alpha, pw, ph, hm.sea));
      }
    }, 60);
    return () => clearTimeout(t);
  }, [mode, gen, hm, w, h, pw, ph, problem]);

  const pickHeightmap = async (f: File | undefined) => {
    if (!f) return;
    try {
      const bitmap = await createImageBitmap(f);
      const s = Math.min(1, Math.sqrt(HM_MAX_PX / (bitmap.width * bitmap.height)));
      setW(snap4(bitmap.width * s));
      setH(snap4(bitmap.height * s));
      const small = previewSize(bitmap.width, bitmap.height);
      setHm({ bitmap, name: f.name.replace(/\.[^.]+$/, ''), sea: defaultSea(readPixels(bitmap, small.pw, small.ph).lum) });
    } catch {
      onError('That file is not an image this browser can open.');
    }
  };

  const create = async () => {
    if (problem || working) return;
    try {
      if (mode === 'blank') return newBlankMap(w, h);
      setWorking(true);
      if (mode === 'heightmap' && hm) {
        await new Promise((r) => setTimeout(r, 30)); // let "Creating…" paint first
        const { lum, alpha } = readPixels(hm.bitmap, w, h);
        openNewGrid(heightmapToGrid(lum, alpha, w, h, hm.sea), hm.name);
        return;
      }
      const grid = await new Promise<MapGrid>((resolve, reject) => {
        const worker = new Worker(new URL('../../workers/generate.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent<GenerateResponse>) => {
          worker.terminate();
          if (e.data.type === 'done') resolve({ width: w, height: h, terrain: e.data.terrain, mag: e.data.mag });
          else reject(new Error(e.data.message));
        };
        worker.onerror = (e) => {
          worker.terminate();
          reject(new Error(e.message || 'Generating the map failed.'));
        };
        worker.postMessage({ width: w, height: h, opts: gen } satisfies GenerateRequest);
      });
      openNewGrid(grid, `Generated ${gen.seed}`);
    } catch (e) {
      onError(e instanceof RangeError ? 'This browser could not allocate a map that large. Try a smaller size.' : e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };

  const label = mode === 'blank' ? 'Create blank map' : mode === 'generate' ? (working ? 'Generating…' : 'Generate map') : working ? 'Creating…' : 'Create map';
  const lead = {
    blank: 'All water. Paint land, then texture it.',
    generate: 'Continents, coasts and mountain ranges from a seed.',
    heightmap: 'A greyscale image: dark is low, bright is high.',
  }[mode];

  return (
    <div class="blank-card">
      <div class="card-head">
        <i aria-hidden="true" class={`ph ${mode === 'blank' ? 'ph-paint-brush' : mode === 'generate' ? 'ph-mountains' : 'ph-image'}`} />
        <span>
          <b>Without Earth</b>
          <small>{lead}</small>
        </span>
        <span class="seg mode-seg" role="group" aria-label="Kind of map">
          {(['blank', 'generate', 'heightmap'] as Mode[]).map((m) => (
            <button key={m} class={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === 'blank' ? 'Blank' : m === 'generate' ? 'Generate' : 'Heightmap'}
            </button>
          ))}
        </span>
      </div>
      <div class="blank-form">
        {mode === 'generate' && (
          <div class="gen">
            <div class="gen-preview" style={{ aspectRatio: `${w} / ${h}` }}>
              <canvas ref={preview} aria-label="Preview of the generated map" role="img" />
            </div>
            <div class="gen-ctls">
              <Slider label="Land" min={15} max={75} step={5} value={Math.round(gen.land * 100)} format={(v) => `${v}%`} onInput={(v) => setGen({ ...gen, land: v / 100 })} />
              <Slider label="Landmasses" min={1} max={8} value={gen.scale} format={(v) => (v <= 2 ? 'few' : v >= 6 ? 'many' : 'some')} onInput={(v) => setGen({ ...gen, scale: v })} />
              <Slider label="Mountains" min={0} max={100} step={10} value={Math.round(gen.mountains * 100)} format={(v) => `${v}%`} onInput={(v) => setGen({ ...gen, mountains: v / 100 })} />
              <div class="gen-ctl">
                <span>Seed</span>
                <input type="number" min={1} value={gen.seed} aria-label="Seed" onInput={(e) => setGen({ ...gen, seed: Math.max(1, Math.floor(+(e.currentTarget as HTMLInputElement).value) || 1) })} />
                <button class="icon-btn sm" aria-label="New seed" title="New seed" onClick={() => setGen({ ...gen, seed: 1 + Math.floor(Math.random() * 9999) })}>
                  <i aria-hidden="true" class="ph ph-shuffle" />
                </button>
              </div>
            </div>
          </div>
        )}
        {mode === 'heightmap' && (
          <div class="gen">
            {hm ? (
              <div class="gen-preview" style={{ aspectRatio: `${w} / ${h}` }}>
                <canvas ref={preview} aria-label="Preview of the map from the heightmap" role="img" />
              </div>
            ) : (
              <button class="hm-drop" onClick={() => fileInput.current?.click()}>
                <i aria-hidden="true" class="ph ph-upload-simple" />
                <b>Choose a heightmap…</b>
                <small>PNG or JPG. Transparent pixels become void.</small>
              </button>
            )}
            {hm && (
              <div class="gen-ctls">
                <div class="gen-ctl">
                  <span>Image</span>
                  <span class="hm-name" title={hm.name}>{hm.name}</span>
                  <button class="btn sm" onClick={() => fileInput.current?.click()}>Change…</button>
                </div>
                <Slider label="Water below" min={0} max={254} value={hm.sea} format={(v) => `${Math.round((v / 255) * 100)}%`} onInput={(v) => setHm({ ...hm, sea: v })} />
              </div>
            )}
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { const el = e.currentTarget as HTMLInputElement; void pickHeightmap(el.files?.[0]).finally(() => (el.value = '')); }} />
          </div>
        )}
        <span class="seg" role="group" aria-label="Size presets">
          {PRESETS.map(([a, b]) => {
            const on = a === w && b === h;
            return (
              <button key={a} class={on ? 'on' : ''} aria-pressed={on} onClick={() => { setW(a); setH(b); }}>
                {`${a} × ${b}`}
              </button>
            );
          })}
        </span>
        <span class="blank-size">
          <label>
            Width
            <input type="number" step={4} min={4} value={w} onInput={(e) => setW(+(e.currentTarget as HTMLInputElement).value)} />
          </label>
          <i aria-hidden="true" class="ph ph-x" />
          <label>
            Height
            <input type="number" step={4} min={4} value={h} onInput={(e) => setH(+(e.currentTarget as HTMLInputElement).value)} />
          </label>
          <button class="btn primary" disabled={!!problem || working || (mode === 'heightmap' && !hm)} onClick={() => void create()}>
            {working && <i aria-hidden="true" class="ph ph-circle-notch spin" />}
            {label}
          </button>
        </span>
        <span class={`blank-note${problem ? ' bad' : ''}`} aria-live="polite">
          {problem ?? `${formatCount(w * h)} px, ${sizeTier(w * h).toLowerCase()}${sizeTier(w * h) === 'Huge' ? '. Large maps run poorly on mobile.' : ''}`}
        </span>
      </div>
    </div>
  );
}
