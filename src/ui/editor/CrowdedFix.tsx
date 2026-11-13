import { crowdedIds, crowdedRemoval, removeCrowded, undoRemoveCrowded } from '../../state/nationChecks';

const nationWord = (n: number) => (n === 1 ? 'nation' : 'nations');

/** One-click cleanup for auto-placed nations (cities, provinces, countries) that crowd each other. */
export function CrowdedFix() {
  const done = crowdedRemoval.value;
  if (done) {
    return (
      <div class="crowd-fix done" aria-live="polite">
        <i aria-hidden="true" class="ph ph-check" />
        <span>Removed {done.count} crowded {nationWord(done.count)}.</span>
        <button class="undo-accept" aria-label="Undo removing crowded nations" onClick={undoRemoveCrowded}>Undo</button>
      </div>
    );
  }
  const n = crowdedIds.value.length;
  if (!n) return null;
  return (
    <div class="crowd-fix">
      <p>
        <span class="sq" />
        <span>
          {n} auto-placed {nationWord(n)} {n === 1 ? 'sits' : 'sit'} too close to a bigger one
        </span>
      </p>
      <button class="btn sm" onClick={removeCrowded} title="Keeps custom nations, then countries, provinces and the biggest cities">
        Remove {n} crowded
      </button>
    </div>
  );
}
