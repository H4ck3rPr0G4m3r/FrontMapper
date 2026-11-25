import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { serviceWorker } from './scripts/pwa/plugin.ts';

export default defineConfig({
  base: process.env.PAGES_BASE ?? '/',
  plugins: [preact(), serviceWorker()],
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
