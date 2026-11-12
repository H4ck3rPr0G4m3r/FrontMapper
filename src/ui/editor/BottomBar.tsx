import { LAND, VOID, WATER } from '../../core/grid';
import type { Paint } from '../../core/tools/common';
import { brushDiameter, busy, paint, raiseAmount, selection, textureOpts, tool } from '../../state/store';

const SWATCHES: { label: string; paint: Paint; color: string }[] = [
  { label: 'Water', paint: { terrain: WATER, mag: 0 }, color: 'rgb(70,132,180)' },
  { label: 'Plains', paint: { terrain: LAND, mag: 5 }, color: 'rgb(190,210,138)' },
  { label: 'Highlands', paint: { terrain: LAND, mag: 15 }, color: 'rgb(230,213,168)' },
  { label: 'Mountains', paint: { terrain: LAND, mag: 25 }, color: 'rgb(240,240,240)' },
  { label: 'Void', paint: { terrain: VOID, mag: 0 }, color: '#000' },
];

const SIZE_TOOLS = new Set(['brush', 'raise', 'smooth', 'texture']);

function Slider(props: { label: string; min: number; max: number; step?: number; value: number; onInput: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label class="ctl">
      {props.label}
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onInput={(e) => props.onInput(+(e.currentTarget as HTMLInputElement).value)}
      />
      <span class="val">{props.format ? props.format(props.value) : props.value}</span>
    </label>
  );
}

export function BottomBar({ onTextureSelection }: { onTextureSelection: () => void }) {
  const t = tool.value;
  const p = paint.value;
  const showPaint = t === 'brush' || t === 'fill' || t === 'eyedropper';
  return (
    <div class="ed-bottom">
      {showPaint && (
        <div class="swatches" role="group" aria-label="Terrain">
          {SWATCHES.map((s) => {
            const on = s.paint.terrain === p.terrain && (s.paint.terrain !== LAND || s.paint.mag === p.mag);
            return (
              <button key={s.label} class={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => (paint.value = s.paint)}>
                <b style={{ background: s.color }} />
                {s.label}
              </button>
            );
          })}
        </div>
      )}
      {showPaint && p.terrain === LAND && (
        <Slider label="Elevation" min={0} max={30} value={p.mag} onInput={(v) => (paint.value = { terrain: LAND, mag: v })} />
      )}
      {t === 'raise' && (
        <>
          <Slider label="Amount" min={1} max={10} value={raiseAmount.value} onInput={(v) => (raiseAmount.value = v)} />
          <span class="hint">Hold Alt to lower</span>
        </>
      )}
      {t === 'texture' && (
        <>
          <div class="seg" role="group" aria-label="Texture mode">
            <button class={textureOpts.value.mode === 'coast+elevation' ? 'on' : ''} onClick={() => (textureOpts.value = { ...textureOpts.value, mode: 'coast+elevation' })}>
              Coast + elevation
            </button>
            <button class={textureOpts.value.mode === 'elevation' ? 'on' : ''} onClick={() => (textureOpts.value = { ...textureOpts.value, mode: 'elevation' })}>
              Elevation only
            </button>
          </div>
          <Slider label="Strength" min={5} max={100} step={5} value={Math.round(textureOpts.value.strength * 100)} format={(v) => `${v}%`} onInput={(v) => (textureOpts.value = { ...textureOpts.value, strength: v / 100 })} />
          <Slider label="Grain" min={2} max={64} value={textureOpts.value.grain} onInput={(v) => (textureOpts.value = { ...textureOpts.value, grain: v })} />
          {selection.value && (
            <button class="btn" disabled={busy.value} onClick={onTextureSelection}>
              <i class="ph ph-selection-all" />
              {busy.value ? 'Texturing…' : 'Texture selection'}
            </button>
          )}
        </>
      )}
      {t === 'select' && <span class="hint">{selection.value ? 'Esc clears the selection' : 'Drag to select an area; tools only affect the selection'}</span>}
      {t === 'pan' && <span class="hint">Drag to move, scroll to zoom</span>}
      {t === 'spawn' && <span class="hint">Click land to place a nation, drag a pin to move it</span>}
      {SIZE_TOOLS.has(t) && (
        <div style={{ marginLeft: 'auto' }}>
          <Slider label="Size" min={1} max={256} value={brushDiameter.value} onInput={(v) => (brushDiameter.value = v)} />
        </div>
      )}
    </div>
  );
}
