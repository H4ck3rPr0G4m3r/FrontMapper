import { lazy, Suspense } from 'preact/compat';
import { useErrorBoundary } from 'preact/hooks';
import { backToStart, screen } from '../state/session';
import { Editor } from './editor/Editor';
import { StartScreen } from './start/StartScreen';
import { EarthPicker } from './earth/EarthPicker';

const params = new URLSearchParams(location.search);
const fixture = import.meta.env.DEV ? params.get('fixture') : null;
const FixtureView = import.meta.env.DEV ? lazy(() => import('../dev/FixtureView').then((m) => ({ default: m.FixtureView }))) : null;

/** Shown instead of a blank page when a screen fails to render (for example, no WebGL2). */
function Crash({ error, onBack }: { error: unknown; onBack: () => void }) {
  return (
    <div class="crash" role="alert">
      <i aria-hidden="true" class="ph-bold ph-warning" />
      <h1>Something went wrong</h1>
      <p>{error instanceof Error ? error.message : String(error)}</p>
      <p class="crash-note">Maps you worked on are saved in this browser and will be under Recent.</p>
      <div class="crash-actions">
        <button class="btn primary" onClick={onBack}>Back to start</button>
        <button class="btn" onClick={() => location.reload()}>Reload</button>
      </div>
    </div>
  );
}

export function App() {
  const [error, resetError] = useErrorBoundary();
  if (error) return <Crash error={error} onBack={() => { backToStart(); resetError(); }} />;
  if (fixture && FixtureView) {
    return (
      <Suspense fallback={null}>
        <FixtureView name={fixture} editor={params.has('editor')} />
      </Suspense>
    );
  }
  if (screen.value === 'editor') return <Editor />;
  if (screen.value === 'earth') return <EarthPicker onBack={() => (screen.value = 'start')} onConvert={() => {}} />;
  return <StartScreen />;
}
