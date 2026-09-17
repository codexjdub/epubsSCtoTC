/* Press the page keys in the built app and check that each one moves exactly
 * one page.
 *
 * This exists because the browser test pages cannot reach the defect it is
 * written for. None of them loads src/ui/app.js, so under tests/ only ONE
 * document keydown listener has ever been registered -- and the bug was that
 * the real app registers two. ui/app.js bound the arrows and PageUp/PageDown
 * for focus mode; reader/keys.js bound the same four keys days later, for
 * readers who do not use vim. Neither stops the other, so every press fired
 * both and ArrowRight turned two pages. tests/reader.html presses PageDown and
 * asserts the position, and passed throughout, because in that page the second
 * listener does not exist.
 *
 * So the page is driven whole, over file://, the same way export-fixture.js
 * drives the converter -- listeners, wiring and all.
 *
 * The chapter edges are checked too. Turning backwards out of a chapter used
 * to work only because app.js's duplicate binding happened to call prevPage();
 * removing the duplicate left PageUp stopping dead at the head of a chapter
 * while PageDown carried on at the foot.
 */
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..');

/* Three chapters, each several pages long at the viewport below, so both
 * boundaries can be crossed without running out of book. */
async function buildFixture() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.folder('META-INF').file('container.xml',
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>' +
    '</rootfiles></container>');

  const oebps = zip.folder('OEBPS');
  const ids = ['c1', 'c2', 'c3'];
  oebps.file('content.opf',
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:title>键盘测试</dc:title><dc:language>zh-CN</dc:language>' +
    '<dc:identifier id="bookid">urn:uuid:keyboard-fixture-0001</dc:identifier>' +
    '</metadata><manifest>' +
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' +
    ids.map(id => '<item id="' + id + '" href="' + id +
                  '.xhtml" media-type="application/xhtml+xml"/>').join('') +
    '</manifest><spine toc="ncx">' +
    ids.map(id => '<itemref idref="' + id + '"/>').join('') +
    '</spine></package>');

  oebps.file('toc.ncx',
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/>' +
    '<docTitle><text>键盘测试</text></docTitle><navMap>' +
    ids.map((id, i) =>
      '<navPoint id="n' + i + '" playOrder="' + (i + 1) + '">' +
      '<navLabel><text>第' + (i + 1) + '章</text></navLabel>' +
      '<content src="' + id + '.xhtml"/></navPoint>').join('') +
    '</navMap></ncx>');

  ids.forEach((id, i) => {
    let ps = '';
    for (let n = 1; n <= 40; n++) {
      ps += '<p>第' + (i + 1) + '章第' + n + '段：她的头发很长，房间很干净，' +
            '里面有人在吃面条，老板和皇后都在松树下面放松。' +
            '这是一段用来把页面填满的普通句子，没有别的用处。</p>';
    }
    oebps.file(id + '.xhtml',
      '<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html>' +
      '<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">' +
      '<head><meta charset="utf-8"/><title>第' + (i + 1) + '章</title></head>' +
      '<body><h1>第' + (i + 1) + '章</h1>' + ps + '</body></html>');
  });

  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  return Array.from(new Uint8Array(buf));
}

async function openPaged(bytes) {
  /* Paged before the book opens, which is what a returning reader has: the
     class that gives the column a box to break into is set by loadBuffer from
     this preference, not afterwards. */
  window.localStorage.setItem('epub-tc:paged', '1');
  await window.App.ui.loadBuffer(new Uint8Array(bytes).buffer, 'keyboard.epub');
  const reader = window.App.ui.current.reader;
  if (!reader) throw new Error('the app opened no reader');
  if (!reader.state.paged) throw new Error('the reader did not start paginated');
  return true;
}

function readState() {
  const r = window.App.ui.current.reader;
  return { chapter: r.state.index, left: r.mount.scrollLeft, pitch: r.viewportExtent(),
           pages: Math.max(1, Math.round(r.mount.scrollWidth / r.viewportExtent())) };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });

  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  let failed = 0;
  function check(what, ok, detail) {
    console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + what + (ok ? '' : '   ' + detail));
    if (!ok) failed++;
  }

  const url = 'file://' + path.join(root, 'dist', 'index.html');
  await page.goto(url);
  await page.waitForFunction('window.App && window.App.ui && window.JSZip');

  const bytes = await page.evaluate(buildFixture);
  await page.evaluate(openPaged, bytes);
  await page.waitForTimeout(600);

  /* Keys land on the document, so nothing may hold the keyboard. */
  await page.evaluate(() => document.body.focus());

  async function goto(chapter, page_) {
    await page.evaluate(async (at) => {
      const r = window.App.ui.current.reader;
      await r.show(at.chapter);
      if (at.page === 'last') r.scrollToEnd(); else r.scrollToStart();
    }, { chapter, page: page_ });
    await page.waitForTimeout(500);
    return page.evaluate(readState);
  }

  async function press(key) {
    const before = await page.evaluate(readState);
    await page.keyboard.press(key);
    await page.waitForTimeout(450);
    const after = await page.evaluate(readState);
    return { before, after,
             moved: before.chapter === after.chapter
               ? (after.left - before.left) / before.pitch : null };
  }

  console.log('--- one press, one page (the middle of a chapter) ---');
  for (const [key, want] of [['ArrowRight', 1], ['ArrowLeft', -1],
                             ['PageDown', 1], ['PageUp', -1],
                             ['ArrowDown', 1], ['ArrowUp', -1]]) {
    await goto(1, 'first');
    await page.keyboard.press('ArrowRight');       // off the first page, so back is possible
    await page.waitForTimeout(450);
    const r = await press(key);
    check(key + ' moves exactly ' + want + ' page',
          r.moved === want,
          'moved ' + r.moved + ' (chapter ' + r.before.chapter + '→' + r.after.chapter + ')');
  }

  console.log('\n--- the foot of a chapter carries on into the next ---');
  for (const key of ['PageDown', 'ArrowRight', ' ']) {
    await goto(1, 'last');
    const r = await press(key);
    check((key === ' ' ? 'Space' : key) + ' crosses forward',
          r.after.chapter === 2,
          'chapter ' + r.before.chapter + '→' + r.after.chapter);
  }

  console.log('\n--- and the head of one goes back, to the page before it ---');
  for (const key of ['PageUp', 'ArrowLeft']) {
    await goto(1, 'first');
    const r = await press(key);
    check(key + ' crosses backward',
          r.after.chapter === 0,
          'chapter ' + r.before.chapter + '→' + r.after.chapter);
    check(key + ' lands on the last page of that chapter',
          r.after.chapter === 0 && r.after.left >= (r.after.pages - 1) * r.after.pitch - 2,
          'at ' + r.after.left + ' of ' + ((r.after.pages - 1) * r.after.pitch));
  }

  console.log('\n--- and the ends of the book stay put ---');
  {
    await goto(0, 'first');
    const r = await press('PageUp');
    check('PageUp on the first page of the book does nothing',
          r.after.chapter === 0 && r.after.left === 0,
          'chapter ' + r.after.chapter + ' at ' + r.after.left);
  }

  await browser.close();

  if (errors.length) {
    console.error('\npage errors:');
    errors.forEach(e => console.error('  ' + e));
    failed++;
  }
  console.log('\n' + (failed ? failed + ' keyboard check(s) failed' : 'keyboard checks passed'));
  process.exit(failed ? 1 : 0);
})();
