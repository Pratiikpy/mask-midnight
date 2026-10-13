import { defineConfig, devices } from '@playwright/test';

// The suite drives a production build of the app, served by `vite preview`,
// because that is what ships. `npm run test:e2e` builds it first, without the
// proving keys that demo mode never reads.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5176',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx vite preview --outDir ${process.env.MASK_E2E_DIST ?? '/tmp/mask-e2e-dist'} --port 5176 --host 127.0.0.1 --strictPort`,
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: true,
    timeout: 240_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
