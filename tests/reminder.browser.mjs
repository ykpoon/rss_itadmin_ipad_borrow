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
  if (process.env.REMINDER_TEST_FONT) {
    const font = (await readFile(process.env.REMINDER_TEST_FONT)).toString('base64');
    await page.addStyleTag({ content: `@font-face{font-family:ReminderQA;src:url(data:font/otf;base64,${font})}#previewReminder{font-family:ReminderQA,sans-serif}` });
    await page.evaluate(() => document.fonts.ready);
  }
  await visible();
  assert.match(await items.innerText(), /iPad × 12/);
  assert.match(await items.innerText(), /Mobile × 5/);
  assert.doesNotMatch(await items.innerText(), /iPad × 8|iPad × 99/);
  assert.match(await page.locator('#previewReminderRange').innerText(), /02\/11\/2026 至 08\/11\/2026/);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('ipad-login-reminder')), null);
  pass('Existing signed-in session shows this week’s own and alias bookings without a login flag');
  assert.match(await page.locator('#reminderTitle').innerText(), /本週借用及欠取提醒/);
  assert.equal(await page.locator('#reminderMissedWeekCount').innerText(), '本週 2 次');
  assert.equal(await page.locator('#reminderMissedTotal').innerText(), '5次');
  const missed = page.locator('#reminderMissedItems');
  assert.equal(await missed.locator('.reminder-missed-row').count(), 2);
  assert.match(await missed.innerText(), /02\/11\/2026（星期一） · 第 1 節/);
  assert.match(await missed.innerText(), /03\/11\/2026（星期二） · 第 3 節/);
  assert.doesNotMatch(await missed.innerText(), /OLD/);
  assert.equal(await page.locator('.reminder-other .reminder-booking').count(), 2);
  pass('Missed dates/lessons and all-history total include aliases and delegated records, independent of resettable counter');

  for (const width of [320, 390, 1024]) {
    await page.setViewportSize({ width, height: width === 1024 ? 1366 : 600 });
    const box = await page.locator('.reminder-dialog').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= (width === 1024 ? 1366 : 600));
    assert.ok(await page.locator('.reminder-body').evaluate(e => e.scrollWidth <= e.clientWidth));
    const button = await page.locator('.reminder-confirm').boundingBox();
    assert.ok(button.height >= 44 && button.y + button.height <= (width === 1024 ? 1366 : 600));
  }
  await page.setViewportSize({ width: 1024, height: 1366 });
  if (process.env.REMINDER_SCREENSHOT) await page.locator('.reminder-dialog').screenshot({ path: process.env.REMINDER_SCREENSHOT });
  pass('Phone and iPad layouts fit; long reminders scroll while the close/confirm controls remain reachable');

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
  assert.equal(await page.locator('.reminder-alert').count(), 0);
  assert.equal(await page.locator('#reminderTitle').innerText(), '🔔 本週設備借用提醒');
  pass('Signing in and switching accounts shows only the current teacher’s bookings');

  await emit('SIGNED_OUT', null);
  await page.evaluate(() => {
    reminderTestDB.bookings = reminderTestDB.bookings.filter(b => b.status === 'missed' && b.date < '2026-11-02');
  });
  await emit('SIGNED_IN', 'a'); await visible();
  assert.equal(await page.locator('.reminder-alert').count(), 0);
  assert.equal(await items.innerText(), '本週暫無借用記錄。');
  pass('Past missed records alone do not create a current-week alert');

  await emit('SIGNED_OUT', null);
  await page.evaluate(() => {
    reminderTestDB.bookings = Array.from({ length: 1001 }, (_, i) => ({ id: 'old-' + i, teacher_name: 'Teacher A', date: '2026-01-01', lesson: 1, device_type: 'iPad', quantity: 1, status: 'missed' }));
    reminderTestDB.bookings.push({ id: 'week', teacher_name: 'Teacher A', date: '2026-11-03', lesson: 2, device_type: 'iPad', quantity: 3, status: 'missed', class: '<img src=x onerror=window.badReminder=true>' });
    reminderTestDB.bookings.push({ id: 'not-mine', teacher_name: 'Teacher B', date: '2026-11-03', lesson: 2, device_type: 'iPad', quantity: 66, status: 'missed' });
  });
  await emit('SIGNED_IN', 'a'); await visible();
  assert.equal(await page.locator('#reminderMissedTotal').innerText(), '1002次');
  assert.equal(await page.locator('#reminderMissedWeekCount').innerText(), '本週 1 次');
  assert.equal(await page.locator('.reminder-other').count(), 0);
  assert.equal(await items.locator('img').count(), 0);
  assert.doesNotMatch(await items.innerText(), /iPad × 66/);
  pass('More than 1000 historical records are paginated; other teachers are excluded; missed-only and safe text rendering work');

  await emit('SIGNED_OUT', null);
  await page.evaluate(() => { reminderTestDB.bookings = []; });
  await emit('SIGNED_IN', 'a'); await visible();
  assert.equal(await items.innerText(), '本週暫無借用記錄。');
  assert.deepEqual(errors, []);
  pass('Empty week shows the existing message; no browser or initialization errors');

  const remote = await browser.newPage({ timezoneId: 'America/Los_Angeles' });
  await remote.addInitScript({ path: path.join(root, 'tests/fixtures/reminder-browser.js') });
  await remote.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.fulfill({ contentType: route.request().resourceType() === 'stylesheet' ? 'text/css' : 'text/javascript', body: '' }));
  await remote.clock.install({ time: new Date('2026-11-02T00:30:00Z') });
  await remote.goto(origin);
  await remote.waitForFunction(() => !document.getElementById('previewReminder').classList.contains('hidden'));
  assert.equal(await remote.locator('#previewReminderRange').innerText(), '02/11/2026 至 08/11/2026');
  assert.equal(await remote.locator('#reminderMissedWeekCount').innerText(), '本週 2 次');
  await remote.close();
  pass('Week boundaries follow Hong Kong Monday even when the device is still on Sunday');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
