import { defineConfig, devices } from '@playwright/test'

// Browser checks run against the built site (npm run build + vite preview), the same static
// files GitLab Pages serves. See docs/browser-checks.md and docs/decisions/0018-browser-checks.md.
const port = 4173

export default defineConfig({
  testDir: './e2e',
  // *.e2e.ts, not *.test.ts or *.spec.ts, so Vitest never picks these files up.
  testMatch: '**/*.e2e.ts',
  outputDir: 'test-results/output',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://localhost:${port}/`,
    trace: 'retain-on-failure',
  },
  // Every check runs with the device in light mode. The checks whose result depends on the
  // colors run again in dark mode; any new file runs once unless it is added to that list.
  projects: [
    { name: 'light', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    {
      name: 'dark',
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
      testMatch: ['accessibility.e2e.ts', 'keyboard.e2e.ts', 'review-screenshots.e2e.ts'],
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
