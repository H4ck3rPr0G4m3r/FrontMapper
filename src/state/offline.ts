import { signal } from '@preact/signals';

/** The browser says it has a network connection. */
export const online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
/** A service worker controls the page: the app opens without a connection. */
export const offlineReady = signal(false);

export function watchConnection() {
  window.addEventListener('online', () => (online.value = true));
  window.addEventListener('offline', () => (online.value = false));
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then(() => navigator.serviceWorker.ready)
    .then(() => (offlineReady.value = true))
    .catch(() => (offlineReady.value = false));
}
