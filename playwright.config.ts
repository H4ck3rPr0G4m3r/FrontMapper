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
  webServer: {
    command: 'npx vite --port 5179 --strictPort',
    url: 'http://localhost:5179',
    reuseExistingServer: !process.env.CI,
  },
});
