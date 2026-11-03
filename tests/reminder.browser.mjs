// Full homepage + real auth/reminder code; all external services are isolated.
// Run with the same PLAYWRIGHT_MODULE / IPAD_CHROMIUM_EXECUTABLE as personal-summary.browser.mjs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!file.startsWith(root)) throw Error('Invalid path');
    const content = await readFile(file);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.IPAD_CHROMIUM_EXECUTABLE ? { executablePath: process.env.IPAD_CHROMIUM_EXECUTABLE } : {}), args: ['--no-sandbox', '--disable-gpu', '--no-zygote'] });
const page = await browser.newPage({ timezoneId: 'Asia/Hong_Kong', viewport: { width: 1024, height: 1366 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
await page.addInitScript({ path: path.join(root, 'tests/fixtures/reminder-browser.js') });
await page.route('**/*', route => {
  if (route.request().url().startsWith(origin + '/')) return route.continue();
  return route.fulfill({ contentType: route.request().resourceType() === 'stylesheet' ? 'text/css' : 'text/javascript', body: '' });
});
await page.clock.install({ time: new Date('2026-11-03T04:00:00Z') });
const dialog = page.locator('#previewReminder');
const items = page.locator('#previewReminderItems');
const visible = () => page.waitForFunction(() => !document.getElementById('previewReminder').classList.contains('hidden'));
const hidden = async () => assert.ok(await dialog.evaluate(e => e.classList.contains('hidden')));
async function emit(event, user) {
  const previous = await page.evaluate(() => reminderTestReads);
  await page.evaluate(([event, user]) => emitReminderTestAuth(event, user), [event, user]);
  await page.waitForFunction(previous => reminderTestReads > previous, previous);
  await page.waitForTimeout(100);
}
const pass = label => console.log('PASS', label);
try {
  await page.goto(origin);
  // Tailwind's network script is isolated; the visibility class is all this test needs.
  await page.addStyleTag({ content: '.hidden{display:none!important}' });
  await visible();
  assert.match(await items.innerText(), /iPad × 12/);
  assert.match(await items.innerText(), /Mobile × 5/);
  assert.doesNotMatch(await items.innerText(), /iPad × 8|iPad × 99/);
  assert.match(await page.locator('#previewReminderRange').innerText(), /02\/11\/2026 至 08\/11\/2026/);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('ipad-login-reminder')), null);
  pass('Existing signed-in session shows this week’s own and alias bookings without a login flag');

  await page.getByRole('button', { name: '明白，返回系統' }).click({ force: true });
  await hidden();
  for (const event of ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED']) {
    await emit(event, 'a'); await hidden();
  }
  pass('Closing stays closed during repeated auth and token events');

  await page.reload();
  await page.addStyleTag({ content: '.hidden{display:none!important}' });
  await visible();
  assert.match(await items.innerText(), /iPad × 12/);
  await page.keyboard.press('Escape'); await hidden();
  pass('Refreshing the actual homepage shows the reminder again; Escape still closes it');

  await emit('SIGNED_OUT', null); await hidden();
  await page.reload();
  await page.waitForTimeout(150);
  await hidden();
  pass('Signed-out homepage does not show a reminder');

  await emit('SIGNED_IN', 'a'); await visible();
  await emit('SIGNED_IN', 'b'); await visible();
  await page.waitForFunction(() => document.getElementById('previewReminderItems').textContent.includes('iPad × 8'));
  assert.doesNotMatch(await items.innerText(), /iPad × 12|Mobile × 5/);
  pass('Signing in and switching accounts shows only the current teacher’s bookings');

  await emit('SIGNED_OUT', null);
  await page.evaluate(() => { reminderTestDB.bookings = []; });
  await emit('SIGNED_IN', 'a'); await visible();
  assert.equal(await items.innerText(), '本週暫無借用記錄。');
  assert.deepEqual(errors, []);
  pass('Empty week shows the existing message; no browser or initialization errors');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
