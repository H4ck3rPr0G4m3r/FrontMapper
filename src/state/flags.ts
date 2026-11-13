import { signal } from '@preact/signals';

/** OpenFront flag codes (file names in resources/flags without .svg); null until loaded or if unavailable. */
export const flagCodes = signal<string[] | null>(null);
let started = false;

export function loadFlags() {
  if (started) return;
  started = true;
  fetch(`${import.meta.env.BASE_URL}data/flags.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((codes: string[] | null) => (flagCodes.value = Array.isArray(codes) ? codes : null))
    .catch(() => (flagCodes.value = null));
}

export function flagUrl(code: string) {
  return `https://raw.githubusercontent.com/openfrontio/OpenFrontIO/main/resources/flags/${encodeURIComponent(code)}.svg`;
}
