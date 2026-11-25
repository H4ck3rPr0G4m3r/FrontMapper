import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5179',
    // Full Chromium in new-headless mode; avoids the separate headless-shell download.
    channel: 'chromium',
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    {
      command: 'npx vite --port 5179 --strictPort',
      url: 'http://localhost:5179',
      reuseExistingServer: !process.env.CI,
    },
    {
      // The production build, for what only exists there (the service worker).
      command: 'npx vite build --outDir .cache/e2e-dist --emptyOutDir && npx vite preview --outDir .cache/e2e-dist --port 5180 --strictPort',
      url: 'http://localhost:5180',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
