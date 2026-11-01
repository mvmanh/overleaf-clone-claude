import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against a running stack (`pnpm stack:up`, or `pnpm dev` with infra).
 * E2E_BASE_URL defaults to the compose web port.
 */
export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
