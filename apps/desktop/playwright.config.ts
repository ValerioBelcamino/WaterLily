import { defineConfig } from '@playwright/test';

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: '../../test-results/desktop',
  reporter: process.env.CI ? [['github']] : 'list',
  retries: 0,
  testDir: './e2e',
  timeout: 45_000,
  workers: 1,
});
