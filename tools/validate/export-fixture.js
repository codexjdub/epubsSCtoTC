/* Drive the built app in a real browser, convert a book, and write both the
 * input and the exported output to disk for epubcheck.
 *
 * The page is loaded over file://, so this exercises the double-click path the
 * app is designed around -- the one case the interactive tooling cannot reach.
 *
 * Both files are validated, not just the output: if the fixture itself were
 * invalid, a failure would say nothing about the conversion. Input passing and
 * output failing is the signal that matters.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..');
const outDir = path.join(root, 'tmp-validate');

const BUILD_FIXTURE = `async () => {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.folder('META-INF').file('container.xml',
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>' +
    '</rootfiles></container>');

  const oebps = zip.folder('OEBPS');
  oebps.file('content.opf',
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:title>头发与干净的房间</dc:title><dc:creator>张三</dc:creator>' +
    '<dc:language>zh-CN</dc:language>' +
    '<dc:identifier id="bookid">urn:uuid:6b3c1f2e-0000-4000-8000-00000000abcd</dc:identifier>' +
    '</metadata><manifest>' +
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' +
    '<item id="css" href="style.css" media-type="text/css"/>' +
    '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>' +
    '</manifest><spine toc="ncx">' +
    '<itemref idref="c1"/><itemref idref="c2"/></spine></package>');

  oebps.file('toc.ncx',
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">' +
    '<head><meta name="dtb:uid" content="urn:uuid:6b3c1f2e-0000-4000-8000-00000000abcd"/>' +
    '<meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/>' +
    '<meta name="dtb:maxPageNumber" content="0"/></head>' +
    '<docTitle><text>头发与干净的房间</text></docTitle><navMap>' +
    '<navPoint id="n1" playOrder="1"><navLabel><text>第一章 干净的头发</text></navLabel>' +
    '<content src="chapter1.xhtml"/></navPoint>' +
    '<navPoint id="n2" playOrder="2"><navLabel><text>第二章 老板与皇后</text></navLabel>' +
    '<content src="chapter2.xhtml"/></navPoint></navMap></ncx>');

  oebps.file('style.css', 'body { line-height: 1.8; } p { text-indent: 2em; }');

  const chapter = (title, body) =>
    /* No doctype: EPUB 2 content is XHTML 1.1, and an HTML5 doctype would
       fail validation for reasons that have nothing to do with conversion. */
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN" xml:lang="zh-CN"><head>' +
    '<title>' + title + '</title>' +
    '<link rel="stylesheet" type="text/css" href="style.css"/></head><body>' +
    '<h1>' + title + '</h1>' + body + '</body></html>';

  oebps.file('chapter1.xhtml', chapter('第一章 干净的头发',
    '<p>她的头发很长，这个城市发展得很快。</p>' +
    '<p>房间很干净，他是干部，衣服干了。</p>' +
    '<p>里面有人，走了三公里。他吃了一碗面条。</p>'));
  oebps.file('chapter2.xhtml', chapter('第二章 老板与皇后',
    '<p>老板买了一块木板。松树很高，他放松了一下。</p>' +
    '<p>皇后走了，后来再也没有回来。</p>' +
    '<p><a href="chapter1.xhtml">回到第一章</a></p>'));

  return Array.from(new Uint8Array(await zip.generateAsync({ type: 'arraybuffer' })));
}`;

const CONVERT_AND_EXPORT = `async (inputBytes) => {
  const buf = new Uint8Array(inputBytes).buffer;
  await window.App.ui.loadBuffer(buf, 'fixture.epub');
  const book = window.App.ui.current.book;
  if (!book) throw new Error('the app failed to open the fixture');
  const summary = await window.App.export.buildFile(book, { overrides: {} });
  const out = await summary.blob.arrayBuffer();
  return {
    bytes: Array.from(new Uint8Array(out)),
    title: book.metadata.title,
    documents: book.report.documents,
    changed: book.report.changedNodes,
    warnings: book.report.warnings
  };
}`;

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  const url = 'file://' + path.join(root, 'dist', 'index.html');
  await page.goto(url);
  await page.waitForFunction('window.App && window.App.ui && window.App.export');

  const inputBytes = await page.evaluate(BUILD_FIXTURE);
  fs.writeFileSync(path.join(outDir, 'input.epub'), Buffer.from(inputBytes));

  const result = await page.evaluate(CONVERT_AND_EXPORT, inputBytes);
  fs.writeFileSync(path.join(outDir, 'converted.epub'), Buffer.from(result.bytes));

  await browser.close();

  console.log('loaded over: ' + url);
  console.log('title after conversion: ' + result.title);
  console.log('documents converted:    ' + result.documents);
  console.log('text nodes changed:     ' + result.changed);
  if (result.warnings.length) console.log('warnings: ' + result.warnings.join(' | '));
  console.log('wrote tmp-validate/input.epub and tmp-validate/converted.epub');

  /* The app is supposed to work from a local file. A page error here is a
   * genuine failure of that promise, not a validation detail. */
  const ignorable = /favicon|ERR_FILE_NOT_FOUND/i;
  const real = errors.filter(e => !ignorable.test(e));
  if (real.length) {
    console.error('\nJavaScript errors while running from file://:');
    real.forEach(e => console.error('  ' + e));
    process.exit(1);
  }
  if (!/^頭髮/.test(result.title)) {
    console.error('\nconversion did not run: title is still "' + result.title + '"');
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });
