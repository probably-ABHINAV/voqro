import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser-preview',
  outputDir: './test-results-preview',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3002',
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox']
    }
  },
  webServer: {
    command: 'npm run build:vercel && node scripts/serve-preview.mjs',
    env: {...process.env, VOQRO_PREVIEW: '1', PREVIEW_PORT: '3002'},
    url: 'http://127.0.0.1:3002/',
    reuseExistingServer: false,
    timeout: 60000
  }
});
