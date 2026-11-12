import { lazy, Suspense } from 'preact/compat';

const fixture = import.meta.env.DEV ? new URLSearchParams(location.search).get('fixture') : null;
const FixtureView = import.meta.env.DEV ? lazy(() => import('../dev/FixtureView').then((m) => ({ default: m.FixtureView }))) : null;

export function App() {
  if (fixture && FixtureView) {
    return (
      <Suspense fallback={null}>
        <FixtureView name={fixture} />
      </Suspense>
    );
  }
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 16, margin: 0 }}>FrontMapper</h1>
    </main>
  );
}
