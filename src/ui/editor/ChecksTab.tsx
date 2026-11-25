import type { ComponentChildren } from 'preact';
import { signal } from '@preact/signals';
import { formatCount, sizeTier, TIERS } from '../../core/size';
import { analysis, analysisPending } from '../../state/analysis';
import { acceptedChecks } from '../../state/checks';
import type { EditorController } from '../../state/controller';
import { ISSUE_TEXT, type NationIssueKind } from '../../core/nations';
import { currentNationIssues } from '../../state/nationChecks';
import { CrowdedFix } from './CrowdedFix';
import { infoErrors } from '../../state/mapOps';
import { nations, project, riverPreview } from '../../state/store';

const showIndex = signal({ islands: 0, lakes: 0 });

const setAccepted = (kind: 'islands' | 'lakes', on: boolean) => (acceptedChecks.value = { ...acceptedChecks.value, [kind]: on });

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
    return <p class="empty-note" aria-busy="true">Checking the map…</p>;
  }
  const islands = a.sim.removedIslands.map((b) => b.cells);
  const lakes = a.sim.removedLakes.map((b) => b.cells);
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
          {analysisPending.value && <span class="pending">checking…</span>}
        </h4>
        <Issue
          count={islands.length}
          accepted={acceptedChecks.value.islands}
          onUndo={() => setAccepted('islands', false)}
          undoLabel="Undo accepting islands"
          text={islands.length ? `${islands.length} ${plural(islands.length, 'island under 30 px gets', 'islands under 30 px get')} deleted` : 'No islands get deleted'}
        >
          <button class="btn sm" onClick={() => show('islands', islands)}>Show</button>
          <button class="btn sm" onClick={() => controller.growIslands(islands)}>Grow to 30</button>
          <button class="btn sm" onClick={() => setAccepted('islands', true)}>Accept</button>
        </Issue>
        <Issue
          count={lakes.length}
          accepted={acceptedChecks.value.lakes}
          onUndo={() => setAccepted('lakes', false)}
          undoLabel="Undo accepting lakes"
          text={lakes.length ? `${lakes.length} ${plural(lakes.length, 'lake under 200 px fills', 'lakes under 200 px fill')} in` : 'No lakes fill in'}
        >
          <button class="btn sm" onClick={() => show('lakes', lakes)}>Show</button>
          <button
            class="btn sm"
            aria-pressed={!!riverPreview.value}
            onClick={() => (riverPreview.value ? controller.clearRiverPreview() : controller.previewRivers())}
            title="Shows how rivers would be joined to the sea or lakes so they stay. Round ponds are left alone."
          >
            Grow rivers…
          </button>
          <button class="btn sm" onClick={() => setAccepted('lakes', true)}>Accept</button>
        </Issue>
        <RiverPlan controller={controller} />
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

/** What Grow rivers would do, shown (in cyan on the map) before it is applied. */
function RiverPlan({ controller }: { controller: EditorController }) {
  const r = riverPreview.value;
  if (!r) return null;
  const steps = [
    r.joints && `close ${r.joints} ${plural(r.joints, 'corner joint', 'corner joints')}`,
    r.bridges && `bridge ${r.bridges} ${plural(r.bridges, 'gap', 'gaps')} to the sea, a lake or another river piece`,
    r.widened && `widen ${r.widened} ${plural(r.widened, 'river', 'rivers')} that ${plural(r.widened, 'reaches', 'reach')} nothing, from the downstream end`,
  ].filter(Boolean) as string[];
  const left = [
    r.tooShort && `${r.tooShort} ${plural(r.tooShort, 'river piece is', 'river pieces are')} too short to stay without becoming a lake`,
    r.ponds && `${r.ponds} round ${plural(r.ponds, 'pond', 'ponds')}`,
  ].filter(Boolean) as string[];
  return (
    <div class="river-plan" role="region" aria-label="Grow rivers preview">
      {r.carved.length ? (
        <>
          <p>
            <span class="swatch" />
            <span>
              Turns <b>{formatCount(r.carved.length)} px</b> into water (cyan on the map):
            </span>
          </p>
          <ul>
            {steps.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </>
      ) : (
        <p>No river can be kept by joining or widening it.</p>
      )}
      {left.length > 0 && <p class="note">Left as they are: {left.join(', ')}. Draw a river with the River tool to connect them.</p>}
      <div class="row">
        {r.carved.length > 0 && <button class="btn sm" onClick={() => controller.focusCells(r.carved)}>Show</button>}
        <span class="grow" />
        <button class="btn sm" onClick={() => controller.clearRiverPreview()}>{r.carved.length ? 'Cancel' : 'Close'}</button>
        {r.carved.length > 0 && <button class="btn sm primary" onClick={() => controller.growRivers()}>Apply</button>}
      </div>
    </div>
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
      <CrowdedFix />
    </section>
  );
}

function Issue(props: { count: number; accepted: boolean; onUndo: () => void; undoLabel: string; text: string; children: ComponentChildren }) {
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
        <button class="undo-accept" aria-label={props.undoLabel} onClick={props.onUndo}>Undo</button>
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
