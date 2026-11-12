import { useMemo, useState } from 'preact/hooks';
import { ISSUE_TEXT, type Nation } from '../../core/nations';
import type { EditorController } from '../../state/controller';
import { flagCodes, flagUrl } from '../../state/flags';
import { issuesByNation } from '../../state/nationChecks';
import { nations, selectedNation, tool } from '../../state/store';

function update(id: string, patch: Partial<Nation>) {
  nations.value = nations.value.map((n) => (n.id === id ? { ...n, ...patch } : n));
}

export function NationsTab({ controller }: { controller: EditorController }) {
  const list = nations.value;
  return (
    <>
      <section class="grp">
        <h4>{list.length ? `${list.length} ${list.length === 1 ? 'nation' : 'nations'}` : 'Nations'}</h4>
        {!list.length && (
          <p class="empty-note">
            No nations yet. Pick the spawn tool <kbd>N</kbd> and click on land to place one.
          </p>
        )}
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
    </>
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
        <button class="icon-btn sm" title="Delete nation" aria-label={`Delete ${n.name}`} onClick={(e) => { e.stopPropagation(); nations.value = nations.value.filter((v) => v.id !== n.id); }}>
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

function FlagPicker({ current, onPick }: { current: string; onPick: (code: string) => void }) {
  const [q, setQ] = useState('');
  const codes = flagCodes.value;
  const matches = useMemo(() => {
    if (!codes) return [];
    const s = q.trim().toLowerCase();
    return (s ? codes.filter((c) => c.toLowerCase().includes(s)) : codes).slice(0, 60);
  }, [q, codes]);
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
    </div>
  );
}
