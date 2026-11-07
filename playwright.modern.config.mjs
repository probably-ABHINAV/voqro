import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/browser-modern',outputDir:'./test-results-modern',workers:1,fullyParallel:false,timeout:90000,reporter:'list',
 use:{actionTimeout:15000,navigationTimeout:45000,baseURL:'http://127.0.0.1:3210',headless:true,trace:'retain-on-failure',launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}},
 webServer:{command:'node scripts/serve-modern-test.mjs',url:'http://127.0.0.1:3210/api/health',reuseExistingServer:false,timeout:120000}
});
