import { lazy, Suspense } from 'preact/compat';
import { screen } from '../state/session';
import { Editor } from './editor/Editor';
import { StartScreen } from './start/StartScreen';

const params = new URLSearchParams(location.search);
const fixture = import.meta.env.DEV ? params.get('fixture') : null;
const FixtureView = import.meta.env.DEV ? lazy(() => import('../dev/FixtureView').then((m) => ({ default: m.FixtureView }))) : null;

export function App() {
  if (fixture && FixtureView) {
    return (
      <Suspense fallback={null}>
        <FixtureView name={fixture} editor={params.has('editor')} />
      </Suspense>
    );
  }
  if (screen.value === 'editor') return <Editor />;
  if (screen.value === 'earth') return <EarthPlaceholder />;
  return <StartScreen />;
}

/** Replaced by the Earth picker (plan Task 18). */
function EarthPlaceholder() {
  return (
    <main class="start">
      <button class="btn" onClick={() => (screen.value = 'start')}>Back</button>
    </main>
  );
}
