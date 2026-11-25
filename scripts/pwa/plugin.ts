import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

/** Small files from public/ the app needs to start offline (the big border data loads on demand). */
const PUBLIC_FILES = ['favicon.svg', 'apple-touch-icon.png', 'manifest.webmanifest', 'data/countries-low.json', 'data/flags.json', 'data/cities-index.json', 'data/provinces-index.json'];

/**
 * Emits sw.js next to index.html with every built file in its precache list, versioned by
 * their names, so a deploy replaces the old cache. Build only: dev serves no service worker.
 */
export function serviceWorker(): Plugin {
  return {
    name: 'fm-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const files = [...Object.keys(bundle).filter((f) => !f.endsWith('.map')), ...PUBLIC_FILES];
      const urls = ['./', ...files.map((f) => `./${f}`)];
      const version = createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 12);
      const template = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(urls, null, 2)),
      });
    },
  };
}
