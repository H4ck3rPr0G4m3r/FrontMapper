import { LAND, VOID, WATER } from '../../core/grid';
import { MIN_LAKE } from '../../core/generator';
import type { Symmetry } from '../../core/symmetry';
import type { Paint } from '../../core/tools/common';
import type { EditorController } from '../../state/controller';
import {
  brushDiameter, busy, canPaste, floating, paint, raiseAmount, riverStatus, riverWidth, selection, symmetry, textureOpts, tool, wandOpts,
} from '../../state/store';
import { TOOL_INFO } from './ToolRail';

const SWATCHES: { label: string; paint: Paint; color: string }[] = [
  { label: 'Water', paint: { terrain: WATER, mag: 0 }, color: 'rgb(70,132,180)' },
  { label: 'Plains', paint: { terrain: LAND, mag: 5 }, color: 'rgb(190,210,138)' },
  { label: 'Highlands', paint: { terrain: LAND, mag: 15 }, color: 'rgb(230,213,168)' },
  { label: 'Mountains', paint: { terrain: LAND, mag: 25 }, color: 'rgb(240,240,240)' },
  { label: 'Void', paint: { terrain: VOID, mag: 0 }, color: '#000' },
];

const MIRRORS: { id: Symmetry; icon: string; label: string }[] = [
  { id: 'off', icon: 'ph-minus', label: 'No mirror' },
  { id: 'x', icon: 'ph-square-split-horizontal', label: 'Mirror left and right' },
  { id: 'y', icon: 'ph-square-split-vertical', label: 'Mirror top and bottom' },
  { id: 'xy', icon: 'ph-grid-four', label: 'Mirror four ways' },
  { id: 'rot', icon: 'ph-arrows-clockwise', label: 'Half turn around the centre' },
];

/** Plains below 10, highlands 10 to 19, mountains from 20. */
const band = (mag: number) => (mag < 10 ? 0 : mag < 20 ? 1 : 2);

const SIZE_TOOLS = new Set(['brush', 'raise', 'smooth', 'texture']);
const MIRROR_TOOLS = new Set(['brush', 'fill', 'river', 'raise', 'smooth', 'texture']);

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
        style={{ '--p': `${((props.value - props.min) / (props.max - props.min)) * 100}%` }}
        onInput={(e) => props.onInput(+(e.currentTarget as HTMLInputElement).value)}
      />
      <span class="val">{props.format ? props.format(props.value) : props.value}</span>
    </label>
  );
}

function IconBtn(props: { icon: string; label: string; keys?: string; text?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button class={`icon-btn${props.text ? ' with-text' : ''}`} aria-label={props.label} title={props.keys ? `${props.label} (${props.keys})` : props.label} disabled={props.disabled} onClick={props.onClick}>
      <i aria-hidden="true" class={`ph ${props.icon}`} />
      {props.text && <span aria-hidden="true">{props.text}</span>}
    </button>
  );
}

/** Flip and quarter-turn buttons. */
function TransformBtns({ controller, disabled }: { controller: EditorController; disabled?: boolean }) {
  return (
    <>
      <IconBtn icon="ph-flip-horizontal" label="Flip horizontally" disabled={disabled} onClick={() => controller.transform('flipX')} />
      <IconBtn icon="ph-flip-vertical" label="Flip vertically" disabled={disabled} onClick={() => controller.transform('flipY')} />
      <IconBtn icon="ph-arrow-arc-left" text="90°" label="Rotate left" disabled={disabled} onClick={() => controller.transform('rotateCCW')} />
      <IconBtn icon="ph-arrow-arc-right" text="90°" label="Rotate right" disabled={disabled} onClick={() => controller.transform('rotateCW')} />
    </>
  );
}

/** Copy, paste, flip, rotate and clear for the current selection, or place / cancel a floating piece. */
function SelectionActions({ controller }: { controller: EditorController }) {
  const sel = selection.value;
  if (floating.value) {
    return (
      <div class="sel-actions" role="group" aria-label="Floating selection">
        <span class="hint">Drag to move.</span>
        <TransformBtns controller={controller} />
        <span class="bar-sep" />
        <button class="btn" onClick={() => controller.cancelFloat()} title="Esc">Cancel</button>
        <button class="btn primary" onClick={() => controller.placeFloat()} title="Enter">
          <i aria-hidden="true" class="ph ph-check" />
          Place
        </button>
      </div>
    );
  }
  return (
    <div class="sel-actions" role="group" aria-label="Selection">
      <IconBtn icon="ph-copy" label="Copy" keys="Ctrl+C" disabled={!sel} onClick={() => controller.copy()} />
      <IconBtn icon="ph-clipboard" label="Paste" keys="Ctrl+V" disabled={!canPaste.value} onClick={() => controller.paste()} />
      <span class="bar-sep" />
      <TransformBtns controller={controller} disabled={!sel} />
      <span class="bar-sep" />
      <IconBtn icon="ph-eraser" label="Clear: fill with what surrounds it" keys="Delete" disabled={!sel} onClick={() => controller.clearSelection()} />
    </div>
  );
}

export function BottomBar({ controller }: { controller: EditorController }) {
  const t = tool.value;
  const p = paint.value;
  const showPaint = t === 'brush' || t === 'fill' || t === 'eyedropper';
  const selecting = t === 'select' || t === 'wand';
  const rs = riverStatus.value;
  return (
    <div class="ed-bottom">
      <div class="tool-id">
        <i aria-hidden="true" class={`ph ${TOOL_INFO[t].icon}`} />
        {TOOL_INFO[t].label}
      </div>
      <span class="bar-sep" />
      {showPaint && (
        <div class="swatches" role="group" aria-label="Terrain">
          {SWATCHES.map((s) => {
            const on = s.paint.terrain === p.terrain && (s.paint.terrain !== LAND || band(s.paint.mag) === band(p.mag));
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
          <span class="hint">Hold <kbd>Alt</kbd> to lower</span>
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
            <button class="btn" disabled={busy.value} onClick={() => controller.textureSelection()}>
              <i aria-hidden="true" class="ph ph-selection-all" />
              {busy.value ? 'Texturing…' : 'Texture selection'}
            </button>
          )}
        </>
      )}
      {t === 'river' && (
        <>
          <Slider label="Width" min={1} max={9} value={riverWidth.value} format={(v) => `${v} px`} onInput={(v) => (riverWidth.value = v)} />
          {rs ? (
            <span class={`river-status${rs.stays ? '' : ' warn'}`} role="status">
              <i aria-hidden="true" class={`ph-bold ${rs.stays ? 'ph-check' : 'ph-warning'}`} />
              {rs.stays ? 'This river stays on export' : `This river is ${rs.size} px and reaches no sea or lake: it fills in on export (needs ${MIN_LAKE} px)`}
            </span>
          ) : (
            <span class="hint">Drag across land to carve a river. Join it to the sea or a lake so it stays.</span>
          )}
        </>
      )}
      {t === 'wand' && (
        <>
          <Slider label="Elevation range" min={0} max={30} value={wandOpts.value.tolerance} format={(v) => `±${v}`} onInput={(v) => (wandOpts.value = { ...wandOpts.value, tolerance: v })} />
          <label class="ctl check">
            <input type="checkbox" checked={wandOpts.value.contiguous} onChange={(e) => (wandOpts.value = { ...wandOpts.value, contiguous: (e.currentTarget as HTMLInputElement).checked })} />
            Connected only
          </label>
        </>
      )}
      {selecting && <SelectionActions controller={controller} />}
      {selecting && !floating.value && (
        <span class="hint">
          {t === 'select' && selection.value ? (
            <>Drag inside to move, <kbd>Ctrl</kbd>+drag to copy</>
          ) : (
            <><kbd>Shift</kbd> adds, <kbd>Alt</kbd> removes</>
          )}
        </span>
      )}
      {t === 'pan' && <span class="hint">Drag to move, scroll to zoom. Hold <kbd>Space</kbd> to pan with any tool.</span>}
      {t === 'spawn' && <span class="hint">Click land to place a nation, drag a pin to move it.</span>}
      {(SIZE_TOOLS.has(t) || MIRROR_TOOLS.has(t)) && (
        <div class="end">
          {MIRROR_TOOLS.has(t) && (
            <div class="ctl">
              Mirror
              <div class="seg icons" role="group" aria-label="Mirror painting">
                {MIRRORS.map((m) => (
                  <button key={m.id} class={symmetry.value === m.id ? 'on' : ''} aria-pressed={symmetry.value === m.id} aria-label={m.label} title={m.label} onClick={() => (symmetry.value = m.id)}>
                    <i aria-hidden="true" class={`ph ${m.icon}`} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {SIZE_TOOLS.has(t) && <Slider label="Size" min={1} max={256} value={brushDiameter.value} onInput={(v) => (brushDiameter.value = v)} />}
        </div>
      )}
    </div>
  );
}
