import { useEffect, useRef } from 'preact/hooks';
import { CONVERT_STEPS, type ConvertStep } from '../../earth/convert';
import { formatCount } from '../../core/size';
import { cancelConvert, convertStatus, startConvert } from '../../state/conversion';
import { frameSize } from '../../state/earthState';

const UNIT: Record<ConvertStep, string> = { Coastlines: 'tiles', Elevation: 'tiles', Borders: 'regions', 'Building map': '' };
const WHAT: Partial<Record<ConvertStep, string>> = { Coastlines: 'coastline', Elevation: 'elevation' };

/** Modal over the picker while a conversion runs, or when it failed. */
export function ConvertProgress() {
  const st = convertStatus.value;
  const primary = useRef<HTMLButtonElement>(null);
  const failed = st?.phase === 'error';

  useEffect(() => {
    if (!st) return;
    primary.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && cancelConvert();
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [!!st, failed]);

  if (!st) return null;
  const fs = frameSize.value;
  const stepIndex = CONVERT_STEPS.indexOf(st.step);

  return (
    <div class="cv-scrim">
      <div class={`cv-card${failed ? ' failed' : ''}`} role="dialog" aria-modal="true" aria-labelledby="cv-title" aria-describedby="cv-sub">
        <header class="cv-head">
          <h2 id="cv-title">{failed ? `Couldn't convert ${st.title}` : `Converting ${st.title}`}</h2>
          {fs && <p id="cv-sub" class="mono">{`${fs.width.toLocaleString('en-US')} × ${fs.height.toLocaleString('en-US')} px · ${formatCount(fs.width * fs.height)} pixels`}</p>}
        </header>

        <ol class="cv-steps">
          {CONVERT_STEPS.map((s, i) => {
            const state = failed ? (i < stepIndex ? 'done' : i === stepIndex ? 'fail' : 'todo') : st.finished.includes(s) || i < stepIndex ? 'done' : i === stepIndex ? 'now' : 'todo';
            const pct = st.phase === 'running' && state === 'now' && st.total ? Math.min(100, (st.done / st.total) * 100) : 0;
            const count =
              st.phase === 'running' && state === 'now' && st.total
                ? UNIT[s]
                  ? `${st.done.toLocaleString('en-US')} / ${st.total.toLocaleString('en-US')} ${UNIT[s]}`
                  : `${Math.round(pct)}%`
                : '';
            return (
              <li key={s} class={state} aria-current={state === 'now' ? 'step' : undefined}>
                <i aria-hidden="true" class={`ph-bold ${state === 'done' ? 'ph-check' : state === 'fail' ? 'ph-x' : state === 'now' ? 'ph-circle-notch' : 'ph-dot-outline'}`} />
                <span class="cv-label">{s}</span>
                <span class="cv-count mono">{count}</span>
                {state === 'now' && (
                  <span class="cv-bar" role="progressbar" aria-label={`${s} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                    <b style={{ width: `${pct}%` }} />
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        {failed && (
          <p class="cv-error" role="alert">
            {st.failedTiles
              ? `${st.failedTiles.toLocaleString('en-US')} of ${st.totalTiles?.toLocaleString('en-US')} ${WHAT[st.step] ?? 'map'} tiles didn't download, so nothing was converted. Check your connection and try again.`
              : `${st.message} Nothing was converted.`}
            <span>Your selection and map size are kept.</span>
          </p>
        )}

        <footer class="cv-foot">
          {failed ? (
            <>
              <button class="btn" onClick={cancelConvert}>Back to picker</button>
              <button ref={primary} class="btn primary" onClick={startConvert}>
                <i aria-hidden="true" class="ph-bold ph-arrow-clockwise" />
                Retry
              </button>
            </>
          ) : (
            <button ref={primary} class="btn" onClick={cancelConvert}>Cancel</button>
          )}
        </footer>
      </div>
    </div>
  );
}
