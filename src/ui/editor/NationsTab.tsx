import { useMemo, useState } from 'preact/hooks';
import { ISSUE_TEXT, type Nation } from '../../core/nations';
import type { EditorController } from '../../state/controller';
import { flagCodes, flagUrl } from '../../state/flags';
import { issuesByNation } from '../../state/nationChecks';
import { CrowdedFix } from './CrowdedFix';
import { spawnRooms } from '../../state/spawnRoom';
import { formatCount } from '../../core/size';
import { nations, project, selectedNation, tool } from '../../state/store';
import { cityThreshold, earthNationsBusy, earthNationsNote, nationsFromEarth, type EarthNationSource } from '../../state/earthNationOps';

function update(id: string, patch: Partial<Nation>) {
  nations.value = nations.value.map((n) => (n.id === id ? { ...n, ...patch } : n));
}

export function NationsTab({ controller }: { controller: EditorController }) {
  const list = nations.value;
  return (
    <>
      {project.value?.earth && <FromEarth />}
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
