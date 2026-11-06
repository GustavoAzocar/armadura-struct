import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.ARMSTRUCT_CHROMIUM
      ? {
          executablePath: process.env.ARMSTRUCT_CHROMIUM,
          args: JSON.parse(process.env.ARMSTRUCT_CHROMIUM_ARGS || '[]'),
        }
      : {},
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 1420',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
