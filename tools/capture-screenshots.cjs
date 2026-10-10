'use strict';
// README screenshots use a fresh headless context; no existing browser profile is read.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const project = path.resolve(__dirname, '..');
const output = path.join(project, 'docs', 'screenshots');
const port = Number(process.env.SCREENSHOT_PORT || 4197);
const base = `http://127.0.0.1:${port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser;

async function assertPortAvailable() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

async function freshPage() {
  const context = await browser.newContext({
    viewport: { width: 360, height: 800 }, deviceScaleFactor: 1,
    locale: 'zh-CN', colorScheme: 'light', reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => window.__appReady === true);
  assert.equal(await page.locator('.script-card').count(), 4);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('.top-brand img').evaluate(image => image.complete && image.naturalWidth > 0), true);
  return { context, page, errors };
}

async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.querySelector('#toast.show'));
  await delay(180);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false });
}

(async () => {
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'Invalid screenshot server port');
  await assertPortAvailable();
  server = spawn(process.execPath, ['tools/preview.cjs'], {
    cwd: project, env: { ...process.env, PORT: String(port) }, stdio: 'ignore'
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error('Screenshot preview server exited');
    try { if ((await fetch(`${base}/examples.json`)).ok) { ready = true; break; } } catch (_) {}
    await delay(100);
  }
  assert.ok(ready, 'Screenshot preview server did not become ready');
  const installedChrome = process.env.SCREENSHOT_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({ headless: true, ...(fs.existsSync(installedChrome) ? { executablePath: installedChrome } : {}) });
  fs.mkdirSync(output, { recursive: true });

  const light = await freshPage();
  await capture(light.page, 'library');
  // Run the unchanged, bundled greeting through the actual Worker and alert UI.
  await light.page.getByRole('button', { name: '编辑 你好，Android', exact: true }).click();
  await light.page.locator('#editor-run').click();
  await light.page.locator('.native-alert').waitFor();
  await light.page.locator('.native-alert').getByRole('button', { name: '打个招呼', exact: true }).click();
  await light.page.waitForFunction(() => !ScriptRunner.isRunning() && document.querySelector('#output-state')?.textContent === '已完成');
  assert.equal(await light.page.locator('.log-row').count(), 2);
  assert.match(await light.page.locator('#output-content').textContent(), /你的第一个 JavaScript 脚本运行成功/);
  await light.page.locator('#code-input').evaluate(input => input.blur());
  await capture(light.page, 'editor');
  await light.page.locator('#editor-back').click();
  await light.page.locator('[data-tab="examples"]').click();
  assert.equal(await light.page.locator('.example-card').count(), 20);
  await capture(light.page, 'gallery');
  assert.deepEqual(light.errors, []);
  await light.context.close();

  // A separate empty context keeps the dark library at its four default scripts.
  const dark = await freshPage();
  await dark.page.locator('[data-tab="settings"]').click();
  await dark.page.locator('#theme-setting').selectOption('dark');
  await dark.page.locator('[data-tab="scripts"]').click();
  assert.equal(await dark.page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await dark.page.locator('.script-card').count(), 4);
  await capture(dark.page, 'dark');
  assert.deepEqual(dark.errors, []);
  await dark.context.close();
  console.log('Captured four current UI screenshots (360×800): library, completed greeting editor, 20-example gallery, dark library.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
});
