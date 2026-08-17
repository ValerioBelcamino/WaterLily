import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: 'test-results',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  // This scenario intentionally mutates a persistent graph. Retrying against
  // the same web-server database would not be an isolated second attempt.
  retries: 0,
  testDir: './e2e',
  timeout: 45_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/mock-provider.mjs',
      reuseExistingServer: false,
      timeout: 30_000,
      url: 'http://127.0.0.1:4320/health',
    },
    {
      command: 'node e2e/start-service.mjs',
      reuseExistingServer: false,
      timeout: 30_000,
      url: 'http://127.0.0.1:4317/api/health',
    },
    {
      command: 'corepack pnpm --filter @waterlily/web preview',
      reuseExistingServer: false,
      timeout: 30_000,
      url: 'http://127.0.0.1:4173',
    },
  ],
  workers: 1,
});
