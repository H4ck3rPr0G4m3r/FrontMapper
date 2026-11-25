import { selectedRegionIds } from '../../earth/selectionOps';
import type { CustomRegion, RegionRef } from '../../earth/types';
import { newNationId } from '../../core/nations';
import { countriesLow, customRegions, earthOps, provincesByCountry } from '../../state/earthState';

/** Map fill per region, in a fixed order (validated categorical palette, dark steps). Regions past 8 stay uncoloured. */
export const REGION_COLORS = ['#338ced', '#e76624', '#00a888', '#d28e05', '#e24d8b', '#0aac23', '#9887ef', '#eb6263'];

export const regionColor = (k: number) => REGION_COLORS[k] ?? null;

function nameOf(m: RegionRef): string {
  if (m.level === 'country') return countriesLow.value?.features.find((f) => f.properties.id === m.id)?.properties.name ?? m.id;
  for (const fc of provincesByCountry.value.values()) {
    const f = fc.features.find((p) => p.properties.id === m.id);
    if (f) return f.properties.name;
  }
  return m.id;
}

/** Selected countries and provinces, as region references. */
function selectedRefs(): RegionRef[] {
  const ids = selectedRegionIds(earthOps.value);
  const country = new Map<string, string>();
  for (const o of earthOps.value) if (o.shape.kind === 'region' && o.shape.level === 'province' && o.shape.country) country.set(o.shape.id, o.shape.country);
  return [
    ...[...ids.country].map((id) => ({ level: 'country' as const, id })),
    ...[...ids.province].map((id) => ({ level: 'province' as const, id, country: country.get(id) })),
  ];
}

const same = (a: RegionRef, b: RegionRef) => a.level === b.level && a.id === b.id;

/** Group the selected countries and provinces into a new region (taking them out of any other). */
function groupSelection() {
  const refs = selectedRefs();
  if (!refs.length) return;
  const rest = customRegions.value
    .map((r) => ({ ...r, members: r.members.filter((m) => !refs.some((x) => same(x, m))) }))
    .filter((r) => r.members.length);
  let k = rest.length + 1;
  while (rest.some((r) => r.name === `Region ${k}`)) k++;
  const name = refs.length === 1 ? nameOf(refs[0]) : `Region ${k}`;
  customRegions.value = [...rest, { id: newNationId(), name, members: refs }];
}

function update(id: string, patch: Partial<CustomRegion>) {
  customRegions.value = customRegions.value.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

/** Countries and provinces grouped into regions of the user's own: each becomes one nation. */
export function CustomRegions() {
  const list = customRegions.value;
  const selected = selectedRefs();
  const grouped = new Set(list.flatMap((r) => r.members.map((m) => `${m.level}:${m.id}`)));
  const fresh = selected.filter((m) => !grouped.has(`${m.level}:${m.id}`)).length;
  return (
    <section class="grp custom-regions">
      <h4>
        Your regions
        {list.length > 0 && <span class="pending">{list.length}</span>}
      </h4>
      {!list.length && (
        <p class="empty-note">Group selected countries or provinces into a region of your own, like a historical or made-up country. Each becomes one nation in the editor.</p>
      )}
      {list.length > 0 && (
        <ul class="cr-list">
          {list.map((r, k) => (
            <li key={r.id}>
              <span class="cr-sw" style={{ background: regionColor(k) ?? 'transparent' }} aria-hidden="true" />
              <span class="cr-main">
                <input value={r.name} aria-label="Region name" onInput={(e) => update(r.id, { name: (e.currentTarget as HTMLInputElement).value })} />
                <small title={r.members.map(nameOf).join(', ')}>{r.members.map(nameOf).join(', ')}</small>
              </span>
              <button class="icon-btn sm" aria-label={`Delete region ${r.name}`} title="Delete region" onClick={() => (customRegions.value = list.filter((x) => x.id !== r.id))}>
                <i aria-hidden="true" class="ph ph-trash" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button class="btn sm grp-action" disabled={!selected.length} onClick={groupSelection} title="Make the selected countries and provinces one region">
        <i aria-hidden="true" class="ph ph-selection-plus" />
        {selected.length ? `Group selection (${selected.length})` : 'Group selection'}
      </button>
      {selected.length > 0 && fresh < selected.length && <p class="hint-line">Parts already in a region move to the new one.</p>}
    </section>
  );
}
