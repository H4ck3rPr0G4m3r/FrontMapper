import { useEffect, useMemo, useState } from 'preact/hooks';
import { loadProvinceIndex, type ProvinceIndexRow } from '../../earth/regions';
import { countriesLow, ensureCountries } from '../../state/earthState';

export interface SearchHit {
  level: 'country' | 'province';
  id: string;
  label: string;
  /** Country (ADM0_A3) the hit belongs to. */
  country: string;
}

/** Country and province search; Enter or click picks a result. */
export function SearchBox({ onPick }: { onPick: (h: SearchHit) => void }) {
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const [open, setOpen] = useState(false);
  const [provinces, setProvinces] = useState<ProvinceIndexRow[]>([]);
  /** Enter pressed before results existed (data still loading): pick the first one when it arrives. */
  const [pendingEnter, setPendingEnter] = useState(false);

  useEffect(() => {
    ensureCountries();
    loadProvinceIndex().then(setProvinces).catch(() => setProvinces([]));
  }, []);

  const countryName = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of countriesLow.value?.features ?? []) m.set(f.properties.id, f.properties.name);
    return m;
  }, [countriesLow.value]);

  const hits = useMemo<SearchHit[]>(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const rank = (name: string) => {
      const n = name.toLowerCase();
      return n.startsWith(s) ? 0 : n.includes(` ${s}`) ? 1 : n.includes(s) ? 2 : -1;
    };
    const out: (SearchHit & { r: number })[] = [];
    for (const [id, name] of countryName) {
      const r = rank(name);
      if (r >= 0) out.push({ level: 'country', id, label: name, country: id, r });
    }
    for (const [id, name, a3] of provinces) {
      const r = rank(name);
      if (r >= 0) out.push({ level: 'province', id, label: `${name}, ${countryName.get(a3) ?? a3}`, country: a3, r: r + 0.5 });
    }
    return out.sort((a, b) => a.r - b.r || a.label.length - b.label.length).slice(0, 8);
  }, [q, countryName, provinces]);

  const pick = (h: SearchHit) => {
    setQ(h.label);
    setOpen(false);
    setPendingEnter(false);
    onPick(h);
  };

  useEffect(() => {
    if (pendingEnter && hits[0]) pick(hits[0]);
  }, [pendingEnter, hits]);

  return (
    <div class="search">
      <i aria-hidden="true" class="ph ph-magnifying-glass" />
      <input
        placeholder="Search a country or province"
        value={q}
        role="combobox"
        aria-expanded={open && hits.length > 0}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onInput={(e) => {
          setQ((e.currentTarget as HTMLInputElement).value);
          setPendingEnter(false);
          setHl(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setHl(Math.min(hl + 1, hits.length - 1)); e.preventDefault(); }
          if (e.key === 'ArrowUp') { setHl(Math.max(hl - 1, 0)); e.preventDefault(); }
          if (e.key === 'Enter') {
            if (hits[hl]) pick(hits[hl]);
            else if (q.trim()) setPendingEnter(true);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && hits.length > 0 && (
        <ul class="search-results" role="listbox">
          {hits.map((h, i) => (
            <li key={`${h.level}:${h.id}`} role="option" aria-selected={i === hl} class={i === hl ? 'hl' : ''} onMouseDown={() => pick(h)}>
              <span>{h.label}</span>
              <small>{h.level === 'country' ? 'Country' : 'Province'}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
