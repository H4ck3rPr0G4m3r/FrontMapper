import { useMemo, useState } from 'preact/hooks';
import { ISSUE_TEXT, type Nation } from '../../core/nations';
import type { EditorController } from '../../state/controller';
import { flagCodes, flagUrl } from '../../state/flags';
import { issuesByNation } from '../../state/nationChecks';
import { CrowdedFix } from './CrowdedFix';
import { spawnRooms } from '../../state/spawnRoom';
import { formatCount } from '../../core/size';
import { meta, nations, project, selectedNation, tool } from '../../state/store';
import {
  cityMode, cityPicks, cityThreshold, dropCityPicks, earthNationsBusy, earthNationsNote, nationsFromEarth, pickSettings, picking, placeCityPicks, previewCityPicks,
  rerollCityPicks, hasEarthTarget, type EarthNationSource,
} from '../../state/earthNationOps';
import { openAlign } from '../../state/alignState';
import { online } from '../../state/offline';
import { nationGuide } from '../../core/nationGuide';
import { analysis } from '../../state/analysis';
import type { JSX } from 'preact';

function update(id: string, patch: Partial<Nation>) {
  nations.value = nations.value.map((n) => (n.id === id ? { ...n, ...patch } : n));
}

export function NationsTab({ controller }: { controller: EditorController }) {
  const list = nations.value;
  return (
    <>
      <HowManyNations />
      {hasEarthTarget(project.value) ? <FromEarth /> : <LineUp />}
      <section class="grp">
        <h4>{list.length ? `${list.length} ${list.length === 1 ? 'nation' : 'nations'}` : 'Nations'}</h4>
        {!list.length && (
          <p class="empty-note">
            No nations yet. Pick the spawn tool <kbd>N</kbd> and click on land to place one.
          </p>
        )}
        <CrowdedFix />
        {list.length > 0 && (
          <ul class="nations">
            {list.map((n) => (
              <NationRow key={n.id} n={n} controller={controller} />
            ))}
          </ul>
        )}
        {tool.value !== 'spawn' && (
          <button class="btn grp-action" onClick={() => (tool.value = 'spawn')}>
            <i aria-hidden="true" class="ph ph-flag" />
            Place nations
          </button>
        )}
      </section>
      {!project.value?.earth && list.length >= 2 && <StartingRoom controller={controller} />}
    </>
  );
}

const ROOM_ROWS = 8;

/**
 * How fair the starts are on a hand-made map: each nation's room to grow (land it reaches
 * before anyone else), as ranked bars. Earth maps skip this: real countries are not fair.
 */
function StartingRoom({ controller }: { controller: EditorController }) {
  const [all, setAll] = useState(false);
  const rooms = spawnRooms.value;
  const issues = issuesByNation.value;
  if (!rooms) return <section class="grp"><h4>Starting room</h4><p class="empty-note" aria-busy="true">Measuring…</p></section>;
  const rows = nations.value
    .map((n) => ({ n, room: rooms.get(n.id)?.room ?? 0 }))
    .sort((a, b) => b.room - a.room);
  const max = rows[0]?.room || 1;
  const total = rows.reduce((s, r) => s + r.room, 0) || 1;
  const least = rows[rows.length - 1].room;
  const shown = all ? rows : rows.slice(0, ROOM_ROWS);
  return (
    <section class="grp">
      <h4>Starting room</h4>
      <p class="room-sum">
        {least > 0 ? (
          <>The roomiest start has <b>{(max / least).toFixed(1)}×</b> the land of the tightest.</>
        ) : (
          <>Some nations have no land to grow into.</>
        )}
      </p>
      <ul class="room-list">
        {shown.map(({ n, room }) => {
          const tight = issues.get(n.id)?.some((i) => i.kind === 'boxed-in' || i.kind === 'small-island' || i.kind === 'removed-on-export');
          return (
            <li key={n.id}>
              <button class={`room-row${tight ? ' tight' : ''}`} onClick={() => { selectedNation.value = n.id; controller.focusNation(n.id); }} title={`${n.name}: ${formatCount(room)} px of land`}>
                <span class="room-name">
                  {tight && <i aria-hidden="true" class="ph-bold ph-warning" />}
                  {n.name}
                </span>
                <span class="room-bar"><b style={{ width: `${(room / max) * 100}%` }} /></span>
                <span class="room-val">{`${Math.round((room / total) * 100)}%`}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length > ROOM_ROWS && (
        <button class="undo-accept room-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
      <p class="note">Land each nation reaches before anyone else, walking over land.</p>
    </section>
  );
}

function NationRow({ n, controller }: { n: Nation; controller: EditorController }) {
  const [picking, setPicking] = useState(false);
  const issues = issuesByNation.value.get(n.id);
  const selected = selectedNation.value === n.id;
  return (
    <li class={`nation${selected ? ' on' : ''}`}>
      <div class="nation-row" onClick={() => { selectedNation.value = n.id; controller.focusNation(n.id); }}>
        <button class="flag-btn" aria-label={n.flag ? `Flag ${n.flag}` : 'Choose flag'} onClick={(e) => { e.stopPropagation(); setPicking(!picking); }}>
          {n.flag ? <img src={flagUrl(n.flag)} alt="" /> : <i aria-hidden="true" class="ph ph-flag" />}
        </button>
        <input
          class="nation-name"
          value={n.name}
          aria-label="Nation name"
          onClick={(e) => e.stopPropagation()}
          onInput={(e) => update(n.id, { name: (e.currentTarget as HTMLInputElement).value })}
        />
        {issues && <span class="sq" title={issues.map((i) => ISSUE_TEXT[i.kind]).join('\n')} />}
        <button class="icon-btn sm" title="Delete nation" aria-label={`Delete ${n.name}`} onClick={(e) => {
          e.stopPropagation();
          nations.value = nations.value.filter((v) => v.id !== n.id);
          if (selectedNation.value === n.id) selectedNation.value = null;
        }}>
          <i aria-hidden="true" class="ph ph-trash" />
        </button>
      </div>
      {issues && selected && (
        <ul class="nation-issues">
          {issues.map((i) => <li key={i.kind}>{ISSUE_TEXT[i.kind]}</li>)}
        </ul>
      )}
      {picking && <FlagPicker current={n.flag} onPick={(f) => { update(n.id, { flag: f }); setPicking(false); }} />}
    </li>
  );
}

const FLAG_PAGE = 60;

function FlagPicker({ current, onPick }: { current: string; onPick: (code: string) => void }) {
  const [q, setQ] = useState('');
  const codes = flagCodes.value;
  const all = useMemo(() => {
    if (!codes) return [];
    const s = q.trim().toLowerCase();
    return s ? codes.filter((c) => c.toLowerCase().includes(s)) : codes;
  }, [q, codes]);
  const matches = all.slice(0, FLAG_PAGE);
  return (
    <div class="flag-picker">
      <input autoFocus placeholder="Search flags (id, de, DE-BB...)" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      {!codes && (
        <div class="flag-manual">
          <span class="empty-note">Flag list unavailable. Type a code:</span>
          <button class="btn sm" disabled={!q.trim()} onClick={() => onPick(q.trim())}>Use</button>
        </div>
      )}
      <div class="flag-grid">
        <button class={!current ? 'on' : ''} onClick={() => onPick('')}>
          <i aria-hidden="true" class="ph ph-prohibit" />
          <span>None</span>
        </button>
        {matches.map((c) => (
          <button key={c} class={c === current ? 'on' : ''} onClick={() => onPick(c)} title={c}>
            <img src={flagUrl(c)} alt="" loading="lazy" />
            <span>{c}</span>
          </button>
        ))}
      </div>
      {codes && !matches.length && <p class="flag-more">No flag matches that.</p>}
      {all.length > FLAG_PAGE && <p class="flag-more">{`Showing ${FLAG_PAGE} of ${all.length}. Search to narrow it down.`}</p>}
    </div>
  );
}

/** Nations other maps with this much land have, and the lobby sizes the game will use. */
export function useNationGuide() {
  const land = analysis.value?.sim.landTiles;
  return land ? nationGuide(land, meta.value.categories) : null;
}

function HowManyNations() {
  const g = useNationGuide();
  const placed = nations.value.length;
  if (!g) return null;
  const [lo, hi] = g.typical;
  const max = Math.max(10, Math.ceil(hi * 1.35), Math.ceil(placed * 1.1));
  const at = (v: number) => `${(Math.min(v, max) / max) * 100}%`;
  const outside = placed > 0 && (placed < lo || placed > hi);
  const range = lo === hi ? `about ${lo}` : `${lo} to ${hi}`;
  const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`;
  return (
    <section class="grp guide">
      <h4>
        How many nations
        <span class="pending mono">{`${placed} placed`}</span>
      </h4>
      <div class="guide-strip" role="img" aria-label={`Most maps with this much land have ${range} nations, about ${g.median} is typical. This map has ${placed}.`}>
        <span class="guide-band" style={{ left: at(lo), width: `calc(${at(hi)} - ${at(lo)})` }} />
        <span class="guide-med" style={{ left: at(g.median) }} />
        {placed > 0 && (
          <span class={`guide-you${outside ? ' warn' : ''}`} style={{ left: at(placed) }}>
            <b>{placed}</b>
          </span>
        )}
      </div>
      <div class="guide-axis">
        <span>0</span>
        <span>{`${range} typical`}</span>
        <span>{max}</span>
      </div>
      {outside && (
        <p class="guide-warn">
          <span class="sq" />
          <span>{`${placed < lo ? 'Fewer' : 'More'} than most maps with this much land. Most have ${range}${lo === hi ? '' : `, about ${g.median} is typical`}.`}</span>
        </p>
      )}
      {g.kind && <p class="guide-kind">{`${g.kind.label} usually have more like ${g.kind.count}.`}</p>}
      <dl class="kv guide-kv">
        <dt>Large lobby</dt>
        <dd>{players(g.lobby.large)}</dd>
        <dt>Medium lobby</dt>
        <dd>{players(g.lobby.medium)}</dd>
        <dt>Small lobby</dt>
        <dd>{players(g.lobby.small)}</dd>
      </dl>
      <p class="note">From 48 OpenFront maps (Feb 2026). Lobby size follows land, about one player per 20k land tiles; how many nations is your call.</p>
    </section>
  );
}

type Btn = (source: EarthNationSource, icon: string, label: string, aria?: string) => JSX.Element;

/** Cities as nations: every city over a size, or a number of them spread out or picked for even starts. */
function CityNations({ btn }: { btn: Btn }) {
  const mode = cityMode.value;
  const o = pickSettings.value;
  const g = useNationGuide();
  const count = o.count || g?.median || 12;
  const picks = cityPicks.value;
  const busy = picking.value;
  const set = (patch: Partial<typeof o>) => {
    pickSettings.value = { ...o, ...patch };
    dropCityPicks();
  };
  const num = (v: string, fallback: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return (
    <div class="fe-cities">
      <div class="seg fe-mode" role="group" aria-label="Cities">
        <button class={mode === 'all' ? 'on' : ''} aria-pressed={mode === 'all'} onClick={() => { cityMode.value = 'all'; dropCityPicks(); }}>Every city over</button>
        <button class={mode === 'pick' ? 'on' : ''} aria-pressed={mode === 'pick'} onClick={() => (cityMode.value = 'pick')}>Pick a number</button>
      </div>
      {mode === 'all' ? (
        <div class="fe-city">
          <label>
            Cities over
            <input
              type="number"
              min={0}
              step={100000}
              aria-label="Minimum city population"
              value={cityThreshold.value}
              onInput={(e) => {
                const v = Number((e.currentTarget as HTMLInputElement).value);
                if (Number.isFinite(v) && v >= 0) cityThreshold.value = v;
              }}
            />
          </label>
          {btn('city', 'ph-buildings', 'Place', 'Place cities')}
        </div>
      ) : (
        <div class="fe-pick">
          <label class="fe-row">
            <span>Nations</span>
            <input type="number" min={1} max={500} aria-label="Number of cities" value={count} onInput={(e) => set({ count: Math.max(1, num((e.currentTarget as HTMLInputElement).value, count)) })} />
          </label>
          <label class="fe-row">
            <span>Cities over</span>
            <input type="number" min={0} step={10000} aria-label="Smallest city to pick" value={o.minPop} onInput={(e) => set({ minPop: num((e.currentTarget as HTMLInputElement).value, o.minPop) })} />
          </label>
          <div class="fe-row">
            <span>Method</span>
            <div class="seg" role="group" aria-label="How to pick">
              <button class={o.method === 'spread' ? 'on' : ''} aria-pressed={o.method === 'spread'} title="Trade city size against distance" onClick={() => set({ method: 'spread' })}>Spread out</button>
              <button class={o.method === 'fair' ? 'on' : ''} aria-pressed={o.method === 'fair'} title="Even out the land each nation can grow into" onClick={() => set({ method: 'fair' })}>Fair start</button>
            </div>
          </div>
          {o.method === 'spread' ? (
            <>
              <label class="fe-row">
                <span>Spread</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  aria-label="Spread"
                  value={Math.round(o.spread * 100)}
                  style={{ '--p': `${o.spread * 100}%` }}
                  onInput={(e) => set({ spread: +(e.currentTarget as HTMLInputElement).value / 100 })}
                />
                <span class="val">{`${Math.round(o.spread * 100)}%`}</span>
              </label>
              <div class="fe-ends"><span>Biggest cities</span><span>Even spread</span></div>
            </>
          ) : (
            <p class="hint-line">Picks cities so each nation has about the same land to grow into before meeting a neighbour.</p>
          )}
          {picks && (
            <p class="fe-picked" role="status">
              {`${picks.nations.length} ${picks.nations.length === 1 ? 'city' : 'cities'} picked, shown on the map.`}
              {picks.nations.length < count && ` That is every city over ${o.minPop.toLocaleString()} on this map's land; lower "Cities over" for more.`}
              {picks.evenness !== null && picks.nations.length > 1 && (
                <> The roomiest start has <b>{picks.evenness > 0 ? `${(1 / picks.evenness).toFixed(1)}×` : 'far more than'}</b> the land of the tightest.</>
              )}
            </p>
          )}
          <div class="fe-actions">
            {picks ? (
              <>
                <button class="btn sm" disabled={busy} onClick={() => rerollCityPicks(count)} title="Pick again among similarly good cities">
                  <i aria-hidden="true" class={`ph ${busy ? 'ph-circle-notch spin' : 'ph-shuffle'}`} />
                  Other picks
                </button>
                <button class="btn sm" disabled={busy} onClick={dropCityPicks}>Cancel</button>
                <button class="btn sm primary" disabled={busy} onClick={placeCityPicks}>{`Place ${picks.nations.length}`}</button>
              </>
            ) : (
              <button class="btn sm primary" disabled={busy} onClick={() => previewCityPicks(count)}>
                <i aria-hidden="true" class={`ph ${busy ? 'ph-circle-notch spin' : 'ph-map-pin'}`} />
                {busy ? 'Picking…' : `Pick ${count} cities`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** For maps not made from Earth data: pin them to Earth to use the Earth nation tools. */
function LineUp() {
  const pins = project.value?.georef?.pins.length ?? 0;
  return (
    <section class="grp line-up">
      <h4>From Earth</h4>
      <p class="empty-note">
        {pins
          ? "This map's pins no longer fit. Open the alignment to check them."
          : 'Made this map yourself? Line it up with Earth to place cities, countries and provinces on it.'}
      </p>
      <button class="btn grp-action" disabled={!online.value} onClick={openAlign}>
        <i aria-hidden="true" class="ph ph-globe-hemisphere-west" />
        Line up with Earth
      </button>
      {!online.value && <p class="note">Needs a connection for the satellite view.</p>}
    </section>
  );
}

function FromEarth() {
  const busy = earthNationsBusy.value;
  const note = earthNationsNote.value;
  const btn = (source: EarthNationSource, icon: string, label: string, aria?: string) => (
    <button class="btn sm" disabled={!!busy} aria-label={aria} onClick={() => nationsFromEarth(source)}>
      <i aria-hidden="true" class={`ph ${busy === source ? 'ph-circle-notch spin' : icon}`} />
      {label}
    </button>
  );
  return (
    <section class="grp from-earth">
      <h4>From Earth</h4>
      {!project.value?.earth && (
        <div class="fe-aligned">
          <i aria-hidden="true" class="ph ph-push-pin" />
          <span>{`Lined up with ${project.value?.georef?.pins.length ?? 0} pins`}</span>
          <button class="btn sm" disabled={!online.value} onClick={openAlign}>Edit</button>
        </div>
      )}
      <CityNations btn={btn} />
      <div class="fe-regions">
        {btn('country', 'ph-globe-hemisphere-east', 'Countries')}
        {btn('province', 'ph-squares-four', 'Provinces')}
      </div>
      {(project.value?.earth?.regions?.length ?? 0) > 0 && <div class="fe-custom">{btn('region', 'ph-selection-plus', 'Your regions')}</div>}
      <p class="hint-line">Each replaces the nations it placed before. Ones placed by hand stay.</p>
      {note && (
        <p class={`fe-note${note.error ? ' err' : ''}`} role="status">
          {note.text}
        </p>
      )}
    </section>
  );
}
