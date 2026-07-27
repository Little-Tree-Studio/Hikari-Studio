import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4188', channel: 'chrome', viewport: { width: 1440, height: 960 }, trace: 'retain-on-failure' },
});
