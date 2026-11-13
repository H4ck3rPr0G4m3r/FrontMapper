import { useRef } from 'preact/hooks';
import L from 'leaflet';
import { selectedRegionIds, toggleRegion } from '../../earth/selectionOps';
import { canConvert, countriesLow, earthOps, earthTool, ensureProvinces, provincesByCountry, type EarthTool } from '../../state/earthState';
import { EarthMap } from './EarthMap';
import { SearchBox, type SearchHit } from './SearchBox';
import { SizePanel } from './SizePanel';
import { ConvertProgress } from './ConvertProgress';
import { reconverting } from '../../state/conversion';
import './earth.css';

const TOOLS: { id: EarthTool; icon: string; label: string; text?: string }[] = [
  { id: 'country', icon: 'ph-cursor-click', label: 'Click countries', text: 'Country' },
  { id: 'province', icon: 'ph-squares-four', label: 'Click provinces', text: 'Province' },
  { id: 'rect', icon: 'ph-selection', label: 'Square select' },
  { id: 'lasso', icon: 'ph-lasso', label: 'Hand draw' },
  { id: 'circle', icon: 'ph-circle-dashed', label: 'Circle select' },
];

interface Props {
  onBack: () => void;
  onConvert: () => void;
}

export function EarthPicker({ onBack, onConvert }: Props) {
  const flyTo = useRef<((b: L.LatLngBoundsExpression) => void) | null>(null);

  const pick = async (h: SearchHit) => {
    earthOps.value = toggleRegion(earthOps.value, h.level, h.id, false, h.level === 'province' ? h.country : undefined);
    if (h.level === 'province') earthTool.value = 'province';
    const geom =
      h.level === 'country'
        ? countriesLow.value?.features.find((f) => f.properties.id === h.id)
        : (await ensureProvinces(h.country)).features.find((f) => f.properties.id === h.id);
    if (geom && flyTo.current) flyTo.current(L.geoJSON(geom as any).getBounds());
  };

  const ids = selectedRegionIds(earthOps.value);
  const names: { key: string; label: string; remove: () => void }[] = [];
  for (const id of ids.country) {
    const name = countriesLow.value?.features.find((f) => f.properties.id === id)?.properties.name ?? id;
    names.push({ key: `c:${id}`, label: name, remove: () => (earthOps.value = toggleRegion(earthOps.value, 'country', id, true)) });
  }
  for (const id of ids.province) {
    let name = id;
    for (const fc of provincesByCountry.value.values()) {
      const f = fc.features.find((p) => p.properties.id === id);
      if (f) name = f.properties.name;
    }
    names.push({ key: `p:${id}`, label: name, remove: () => (earthOps.value = toggleRegion(earthOps.value, 'province', id, true)) });
  }
  const shapes = earthOps.value.filter((o) => o.shape.kind !== 'region').length;
  const again = reconverting.value;

  return (
    <div class="earth screen-in">
      <header class="earth-top">
        <button class="icon-btn" aria-label={again ? 'Back to editor' : 'Back to start'} title={again ? 'Back to the editor, unchanged' : 'Back to start'} onClick={onBack}>
          <i aria-hidden="true" class="ph ph-arrow-left" />
        </button>
        <SearchBox onPick={pick} />
        <span class="bar-sep" />
        <div class="seg" role="group" aria-label="Selection tool">
          {TOOLS.map((t) => (
            <button key={t.id} class={earthTool.value === t.id ? 'on' : ''} aria-pressed={earthTool.value === t.id} aria-label={t.label} title={t.label} onClick={() => (earthTool.value = t.id)}>
              <i aria-hidden="true" class={`ph ${t.icon}`} />
              {t.text && <span>{t.text}</span>}
            </button>
          ))}
        </div>
        <span class="earth-hint">
          {earthTool.value === 'country' || earthTool.value === 'province' ? (
            <>
              <kbd>Shift</kbd> click adds, again removes
            </>
          ) : (
            <>
              <kbd>Shift</kbd> adds <kbd>Alt</kbd> cuts out
            </>
          )}
        </span>
      </header>
      <div class="earth-body">
        <EarthMap onFlyTo={(fn) => (flyTo.current = fn)} />
        <aside class="earth-side">
          <div class="earth-scroll">
          <section class="grp">
            <h4>
              Selection
              {names.length > 1 && <span class="pending">{names.length}</span>}
            </h4>
            {!names.length && !shapes && (
              <p class="empty-note">
                Search or click a country. <kbd>Shift</kbd> click to add more.
              </p>
            )}
            <div class="sel-tags">
              {names.map((n) => (
                <span key={n.key} class="sel-tag">
                  {n.label}
                  <button aria-label={`Remove ${n.label}`} onClick={n.remove}>
                    <i aria-hidden="true" class="ph ph-x" />
                  </button>
                </span>
              ))}
              {shapes > 0 && (
                <span class="sel-tag">
                  {`${shapes} drawn ${shapes === 1 ? 'shape' : 'shapes'}`}
                  <button aria-label="Remove drawn shapes" onClick={() => (earthOps.value = earthOps.value.filter((o) => o.shape.kind === 'region'))}>
                    <i aria-hidden="true" class="ph ph-x" />
                  </button>
                </span>
              )}
            </div>
          </section>
          <SizePanel />
          </div>
          <div class="earth-foot">
            {again && <p class="reconvert-note">{`Converting replaces the terrain of “${again.meta.name.trim() || 'Untitled map'}”. Its nations and info are kept.`}</p>}
            <button class="btn primary convert" disabled={!canConvert.value} onClick={onConvert}>
              Convert to map
              <i aria-hidden="true" class="ph-bold ph-arrow-right" />
            </button>
          </div>
        </aside>
      </div>
      <ConvertProgress />
    </div>
  );
}
