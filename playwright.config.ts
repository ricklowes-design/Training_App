import { defineConfig, devices } from '@playwright/test';

// End-to-end tests: every screen, driven in Chromium against the production build.
// Time-heavy flows use Playwright's fake clock; camera flows use Chromium's fake webcam.
export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    viewport: { width: 1366, height: 768 },
    trace: 'retain-on-failure',
    actionTimeout: 20_000,
    screenshot: 'only-on-failure',
    acceptDownloads: true,
    permissions: ['camera'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: false, // always test a fresh build
    timeout: 120_000,
  },
});
