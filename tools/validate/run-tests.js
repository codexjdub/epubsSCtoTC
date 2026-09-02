/* Run the browser test pages in CI.
 *
 * The pages ARE the test suite: each stamps document.title with PASS or FAIL
 * and prints a RESULT line, which is what makes them readable by a machine as
 * well as by a person. They were only ever opened by hand, so nothing stopped
 * a regression from reaching main.
 *
 * They run against the dev server, not the built file: the library gates
 * itself off at file:// by design (IndexedDB from an opaque origin is not
 * dependable), so library.html has nothing to test without a real origin.
 */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.TEST_PORT || 8413);
const BASE = 'http://127.0.0.1:' + PORT;
const PAGES = ['run', 'reader', 'fonts', 'library', 'mobile'];
const PAGE_TIMEOUT = 180000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(BASE + '/tests/harness.js');
      if (res.ok) return;
    } catch (e) { /* not listening yet */ }
    await sleep(100);
  }
  throw new Error('the dev server never came up on ' + BASE);
}

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'tools', 'serve.js'), String(PORT)],
                       { stdio: ['ignore', 'ignore', 'inherit'] });
  let browser;
  let failed = 0;
  try {
    await waitForServer();
    browser = await chromium.launch();

    for (const name of PAGES) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));

      await page.goto(BASE + '/tests/' + name + '.html');
      let title;
      try {
        await page.waitForFunction(() => /^(PASS|FAIL)/.test(document.title),
                                   null, { timeout: PAGE_TIMEOUT });
        title = await page.title();
      } catch (e) {
        title = 'TIMEOUT';
      }

      const summary = (await page.textContent('#summary').catch(() => '')) || '(no summary)';
      const ok = /^PASS/.test(title);
      if (!ok) failed++;
      console.log((ok ? '  PASS  ' : '  FAIL  ') + name.padEnd(9) + summary.trim());

      /* Reported, never fatal: some pages deliberately feed the app hostile
       * input, and the page's own RESULT line is the verdict that counts. */
      if (errors.length) {
        errors.forEach(e => console.log('        page error: ' + e));
      }
      if (!ok) {
        const failures = await page.$$eval('#results li.fail', els => els.map(e => e.textContent));
        failures.forEach(f => console.log('        ' + f));
      }
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  if (failed) {
    console.error('\n' + failed + ' test page(s) failed');
    process.exit(1);
  }
  console.log('\nall ' + PAGES.length + ' test pages passed');
})().catch(e => { console.error(e); process.exit(1); });
