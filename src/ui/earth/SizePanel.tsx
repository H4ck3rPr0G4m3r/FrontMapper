import { useEffect, useState } from 'preact/hooks';
import { kmPerPx } from '../../earth/projection';
import { formatCount, sizeTier } from '../../core/size';
import { curve, frameSize, includeOutliers, linked, outliers, recomputeFrame, setFrameSide } from '../../state/earthState';

function SideInput({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v >= 4 && v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <label class="dim-field">
      {label}
      <input
        type="number"
        step={4}
        min={4}
        aria-label={label}
        value={text}
        onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </label>
  );
}

export function SizePanel() {
  const fs = frameSize.value;
  const out = outliers.value;
  return (
    <>
      <section class="grp">
        <h4>Map size</h4>
        {!fs && <p class="empty-note">Select something to frame the map.</p>}
        {fs && (
          <>
            <div class="dims">
              <SideInput label="Width" value={fs.width} onCommit={(v) => setFrameSide('width', v)} />
              <button
                class={`link-btn${linked.value ? ' on' : ''}`}
                aria-label={linked.value ? 'Unlink width and height' : 'Link width and height'}
                aria-pressed={linked.value}
                title={linked.value ? 'Linked: the frame stays, resolution changes' : 'Unlinked: the scale stays, the frame grows'}
                onClick={() => (linked.value = !linked.value)}
              >
                <i aria-hidden="true" class={`ph ${linked.value ? 'ph-link-simple' : 'ph-link-simple-break'}`} />
              </button>
              <SideInput label="Height" value={fs.height} onCommit={(v) => setFrameSide('height', v)} />
            </div>
            <p class="hint-line">{linked.value ? 'Linked: the frame stays, resolution changes.' : 'Unlinked: changing a side grows the frame, the scale stays.'}</p>
            <dl class="kv">
              <dt>Scale</dt>
              <dd data-km>{`${kmPerPx(fs).toFixed(2)} km/px`}</dd>
              <dt>Pixels</dt>
              <dd>{`${formatCount(fs.width * fs.height)}, ${sizeTier(fs.width * fs.height)}`}</dd>
            </dl>
          </>
        )}
        {out.length > 0 && (
          <div class="outliers">
            <span>{includeOutliers.value ? `Including ${out.length} far-off ${out.length === 1 ? 'part' : 'parts'}` : `${out.length} far-off ${out.length === 1 ? 'part' : 'parts'} not included`}</span>
            <button class="btn sm" onClick={() => { includeOutliers.value = !includeOutliers.value; void recomputeFrame(); }}>
              {includeOutliers.value ? 'Leave out' : 'Include'}
            </button>
          </div>
        )}
      </section>

      <section class="grp">
        <h4>Terrain</h4>
        <div class="dims two">
          <label class="dim-field">
            Highlands from
            <span class="unit">
              <input type="number" step={50} min={1} value={curve.value.highlandsFrom} aria-label="Highlands from (m)"
                onInput={(e) => (curve.value = { ...curve.value, highlandsFrom: +(e.currentTarget as HTMLInputElement).value })} />
              m
            </span>
          </label>
          <label class="dim-field">
            Mountains from
            <span class="unit">
              <input type="number" step={50} min={1} value={curve.value.mountainsFrom} aria-label="Mountains from (m)"
                onInput={(e) => (curve.value = { ...curve.value, mountainsFrom: +(e.currentTarget as HTMLInputElement).value })} />
              m
            </span>
          </label>
        </div>
      </section>

      <section class="grp">
        <h4>Outside the selection</h4>
        <div class="legend">
          <b style={{ background: '#000' }} />
          <span>Land becomes impassable</span>
          <b style={{ background: 'rgb(70,132,180)' }} />
          <span>Water stays water</span>
        </div>
      </section>
    </>
  );
}
