import type { ComponentChildren } from 'preact';
import { signal } from '@preact/signals';
import { formatCount, sizeTier, TIERS } from '../../core/size';
import { analysis, analysisPending } from '../../state/analysis';
import type { EditorController } from '../../state/controller';
import { ISSUE_TEXT, type NationIssueKind } from '../../core/nations';
import { currentNationIssues } from '../../state/nationChecks';
import { infoErrors } from '../../state/mapOps';
import { nations, project } from '../../state/store';

/** Accepted warnings, keyed by a signature of the bodies they covered. */
const accepted = signal<{ islands: string | null; lakes: string | null }>({ islands: null, lakes: null });
const showIndex = signal({ islands: 0, lakes: 0 });

const signature = (bodies: Int32Array[]) => bodies.map((b) => `${b[0]}:${b.length}`).join(',');

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

interface Props {
  controller: EditorController;
  /** Extra sections (nations, map info) supplied by other features. */
  children?: ComponentChildren;
}

export function ChecksTab({ controller, children }: Props) {
  const a = analysis.value;
  const p = project.value;
  if (!a || !p) {
    return <p class="empty-note">Checking…</p>;
  }
  const islands = a.sim.removedIslands.map((b) => b.cells);
  const lakes = a.sim.removedLakes.map((b) => b.cells);
  const islandSig = signature(islands);
  const lakeSig = signature(lakes);
  const pixels = p.grid.width * p.grid.height;
  const tier = sizeTier(pixels);

  const show = (kind: 'islands' | 'lakes', bodies: Int32Array[]) => {
    const i = showIndex.value[kind] % bodies.length;
    controller.focusCells(bodies[i]);
    showIndex.value = { ...showIndex.value, [kind]: i + 1 };
  };

  return (
    <>
      <section class="grp" aria-busy={analysisPending.value}>
        <h4>
          Lost on export
          {analysisPending.value && <span class="pending"> · checking…</span>}
        </h4>
        <Issue
          count={islands.length}
          accepted={accepted.value.islands === islandSig}
          text={islands.length ? `${islands.length} ${plural(islands.length, 'island under 30 px gets', 'islands under 30 px get')} deleted` : 'No islands get deleted'}
        >
          <button class="btn" onClick={() => show('islands', islands)}>Show</button>
          <button class="btn" onClick={() => controller.growIslands(islands)}>Grow to 30</button>
          <button class="btn" onClick={() => (accepted.value = { ...accepted.value, islands: islandSig })}>Accept</button>
        </Issue>
        <Issue
          count={lakes.length}
          accepted={accepted.value.lakes === lakeSig}
          text={lakes.length ? `${lakes.length} ${plural(lakes.length, 'lake under 200 px fills', 'lakes under 200 px fill')} in` : 'No lakes fill in'}
        >
          <button class="btn" onClick={() => show('lakes', lakes)}>Show</button>
          <button class="btn" onClick={() => (accepted.value = { ...accepted.value, lakes: lakeSig })}>Accept</button>
        </Issue>
      </section>

      <section class="grp">
        <h4>Size</h4>
        <dl class="kv">
          <dt>Pixels</dt>
          <dd>{formatCount(pixels)}</dd>
          <dt>Land tiles</dt>
          <dd>{formatCount(a.sim.landTiles)}</dd>
        </dl>
        <div class="tiers">
          {TIERS.map((t) => (
            <div key={t.tier} data-tier aria-current={t.tier === tier ? 'true' : undefined} class={t.tier === tier ? 'on' : ''}>
              {t.tier}
            </div>
          ))}
        </div>
        {tier === 'Huge' && <p class="note">Large maps run poorly on mobile.</p>}
      </section>

      <NationSummary />

      <section class="grp">
        <h4>Map info</h4>
        {infoErrors.value.length ? (
          <ul class="nation-sum">
            {infoErrors.value.map((e) => (
              <li key={e}>
                <span class="sq" />
                <span>{e}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div class="issue ok">
            <i aria-hidden="true" class="ph ph-check" />
            <span>info.json is valid</span>
          </div>
        )}
      </section>

      {children}
    </>
  );
}

function NationSummary() {
  const list = nations.value;
  const issues = currentNationIssues.value;
  const byKind = new Map<NationIssueKind, number>();
  for (const i of issues) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  return (
    <section class="grp">
      <h4>Nations</h4>
      {!list.length && <p class="empty-note">No nations placed. Players will spawn anywhere.</p>}
      {list.length > 0 && !issues.length && (
        <div class="issue ok">
          <i aria-hidden="true" class="ph ph-check" />
          <span>{list.length === 1 ? 'The nation looks fine' : `All ${list.length} nations look fine`}</span>
        </div>
      )}
      {issues.length > 0 && (
        <ul class="nation-sum">
          {[...byKind].map(([kind, n]) => (
            <li key={kind}>
              <span class="sq" />
              <span>{`${ISSUE_TEXT[kind]} (${n})`}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Issue(props: { count: number; accepted: boolean; text: string; children: ComponentChildren }) {
  if (!props.count) {
    return (
      <div class="issue ok">
        <i aria-hidden="true" class="ph ph-check" />
        <span>{props.text}</span>
      </div>
    );
  }
  if (props.accepted) {
    return (
      <div class="issue accepted">
        <i aria-hidden="true" class="ph ph-check" />
        <span>{props.text} (accepted)</span>
      </div>
    );
  }
  return (
    <div class="issue warn">
      <p>
        <span class="sq" />
        <span>{props.text}</span>
      </p>
      <div class="row">{props.children}</div>
    </div>
  );
}
