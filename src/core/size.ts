export type SizeTier = 'Small' | 'Typical' | 'Large' | 'Huge';

export const TIERS: { tier: SizeTier; below: number }[] = [
  { tier: 'Small', below: 2_000_000 },
  { tier: 'Typical', below: 10_000_000 },
  { tier: 'Large', below: 25_000_000 },
  { tier: 'Huge', below: Infinity },
];

/** Informational size class by pixel count. Never blocks anything. */
export function sizeTier(pixels: number): SizeTier {
  return TIERS.find((t) => pixels < t.below)!.tier;
}

/** Largest map the editor will create. Bigger grids fail to allocate in most browsers. */
export const MAX_PIXELS = 120_000_000;

/** Why a map of this size can't be made, or null when it can. */
export function sizeProblem(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 4 || height < 4) return 'Each side needs at least 4 px.';
  if (width * height > MAX_PIXELS) return `Too large: ${formatCount(width * height)} px. The limit is ${formatCount(MAX_PIXELS)}.`;
  return null;
}

/** "3.16M", "640k" */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString('en-US');
}
