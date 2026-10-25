import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', workers: 1,
  webServer: {command: 'python -m uvicorn traceguard.main:app --host 127.0.0.1 --port 8000', cwd:'../backend', url:'http://127.0.0.1:8000/health', reuseExistingServer:false, env:{TRACEGUARD_DB:'../frontend/test-results/browser.sqlite'}},
  use: {baseURL: 'http://127.0.0.1:8000', headless: true,
    launchOptions: process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']} : {}},
});
