/* Synthetic EPUBs built in-browser, so the pipeline can be tested against
 * known-tricky input without needing a real book on disk. */
(function (App) {
  'use strict';

  /* 1x1 transparent PNG. */
  var PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  function bytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* Every ambiguous character appears in BOTH readings, so a converter that
   * blindly applies one mapping fails visibly. */
  var PROSE_1 =
    '<p class="body-text" id="p1">她的头发很长，这个城市发展得很快。</p>' +
    '<p class="body-text" id="p2">房间很干净，他是干部，衣服干了。</p>' +
    '<p class="body-text" id="p3">里面有人，走了三公里。</p>' +
    '<p class="body-text" id="p4">他吃了一碗面条，桌子的表面很光滑。</p>';

  var PROSE_2 =
    '<p id="p5">老板买了一块木板。</p>' +
    '<p id="p6">松树很高，他放松了一下。</p>' +
    '<p id="p7">皇后走了，后来再也没有回来。</p>' +
    '<p id="p8">复习功课，重复练习，覆盖全部。</p>' +
    '<p id="p9"><img src="../images/pic.png" alt="一张头发的照片" title="干净的房间"/></p>' +
    '<pre id="code">const 发 = "干";  // must not be converted</pre>' +
    '<p id="p10"><a href="chapter1.xhtml#p1">回到第一章</a></p>' +
    '<p id="p11">他又买了一块木板。</p>';

  function xhtml(title, body, lang) {
    /* lang === null builds a document declaring no language at all, which is
     * common in the wild. */
    var langAttrs = lang === null ? '' :
      ' lang="' + lang + '" xml:lang="' + lang + '"';
    return '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<!DOCTYPE html>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml"' + langAttrs + '>\n' +
      '<head><meta charset="utf-8"/><title>' + title + '</title>' +
      '<link rel="stylesheet" type="text/css" href="../styles/main.css"/></head>\n' +
      '<body><h1 class="chapter-title">' + title + '</h1>\n' + body + '\n</body>\n</html>\n';
  }

  var CSS = '.body-text { font-family: "Subset CN", serif; line-height: 1.8; }\n' +
            '.chapter-title { font-size: 1.5em; }\n';

  function opf2() {
    return '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">\n' +
      '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
      '    <dc:title>头发与发展</dc:title>\n' +
      '    <dc:creator>张干净</dc:creator>\n' +
      '    <dc:language>zh-CN</dc:language>\n' +
      '    <dc:identifier id="bookid">urn:uuid:test-book-0001</dc:identifier>\n' +
      '    <dc:publisher>里面出版社</dc:publisher>\n' +
      '  </metadata>\n' +
      '  <manifest>\n' +
      '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n' +
      '    <item id="c1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
      '    <item id="c2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>\n' +
      '    <item id="css" href="styles/main.css" media-type="text/css"/>\n' +
      '    <item id="img" href="images/pic.png" media-type="image/png"/>\n' +
      '  </manifest>\n' +
      '  <spine toc="ncx">\n' +
      '    <itemref idref="c1"/>\n' +
      '    <itemref idref="c2"/>\n' +
      '  </spine>\n' +
      '</package>\n';
  }

  /* Deliberately nested, to prove the tree survives conversion. */
  function ncx() {
    return '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n' +
      '  <head><meta name="dtb:uid" content="urn:uuid:test-book-0001"/></head>\n' +
      '  <docTitle><text>头发与发展</text></docTitle>\n' +
      '  <navMap>\n' +
      '    <navPoint id="n1" playOrder="1"><navLabel><text>第一章 干净的头发</text></navLabel>\n' +
      '      <content src="text/chapter1.xhtml"/>\n' +
      '      <navPoint id="n1a" playOrder="2"><navLabel><text>里面的故事</text></navLabel>\n' +
      '        <content src="text/chapter1.xhtml#p3"/></navPoint>\n' +
      '    </navPoint>\n' +
      '    <navPoint id="n2" playOrder="3"><navLabel><text>第二章 老板与皇后</text></navLabel>\n' +
      '      <content src="text/chapter2.xhtml"/></navPoint>\n' +
      '  </navMap>\n' +
      '</ncx>\n';
  }

  function opf3() {
    return '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">\n' +
      '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
      '    <dc:title>头发与发展</dc:title>\n' +
      '    <dc:creator>张干净</dc:creator>\n' +
      '    <dc:language>zh-Hans</dc:language>\n' +
      '    <dc:identifier id="bookid">urn:uuid:test-book-0003</dc:identifier>\n' +
      '  </metadata>\n' +
      '  <manifest>\n' +
      '    <item id="nav" href="text/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n' +
      '    <item id="c1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>\n' +
      '    <item id="c2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>\n' +
      '    <item id="css" href="styles/main.css" media-type="text/css"/>\n' +
      '    <item id="img" href="images/pic.png" media-type="image/png"/>\n' +
      '  </manifest>\n' +
      '  <spine page-progression-direction="ltr">\n' +
      '    <itemref idref="c1"/>\n' +
      '    <itemref idref="c2"/>\n' +
      '  </spine>\n' +
      '</package>\n';
  }

  function navDoc() {
    return '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<!DOCTYPE html>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">\n' +
      '<head><meta charset="utf-8"/><title>目录</title></head>\n' +
      '<body><nav epub:type="toc" id="toc"><h1>目录</h1>\n' +
      '  <ol>\n' +
      '    <li><a href="chapter1.xhtml">第一章 干净的头发</a>\n' +
      '      <ol><li><a href="chapter1.xhtml#p3">里面的故事</a></li></ol>\n' +
      '    </li>\n' +
      '    <li><a href="chapter2.xhtml">第二章 老板与皇后</a></li>\n' +
      '  </ol>\n' +
      '</nav></body></html>\n';
  }

  function addCommon(zip, lang) {
    zip.folder('text').file('chapter1.xhtml', xhtml('第一章 干净的头发', PROSE_1, lang));
    zip.folder('text').file('chapter2.xhtml', xhtml('第二章 老板与皇后', PROSE_2, lang));
    zip.folder('styles').file('main.css', CSS);
    zip.folder('images').file('pic.png', bytes(PNG_B64));
  }

  function container(opfPath) {
    return '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
      '  <rootfiles><rootfile full-path="' + opfPath + '" media-type="application/oebps-package+xml"/></rootfiles>\n' +
      '</container>\n';
  }

  async function build(kind) {
    var zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.folder('META-INF').file('container.xml', container('OEBPS/content.opf'));
    var oebps = zip.folder('OEBPS');

    if (kind === 'nolang') {
      oebps.file('content.opf', opf2());
      oebps.file('toc.ncx', ncx());
      addCommon(oebps, null);
    } else if (kind === 'epub3') {
      oebps.file('content.opf', opf3());
      oebps.folder('text').file('nav.xhtml', navDoc());
      addCommon(oebps, 'zh-Hans');
    } else {
      oebps.file('content.opf', opf2());
      oebps.file('toc.ncx', ncx());
      addCommon(oebps, 'zh-CN');
    }

    return zip.generateAsync({ type: 'arraybuffer' });
  }


  /* A deliberately inadequate subset font, built with opentype.js's own
   * writer. Its cmap covers the SIMPLIFIED glyphs the book started with and
   * none of their traditional counterparts, which is exactly the real-world
   * failure the coverage check exists to catch. */
  function subsetFont(coveredChars) {
    var notdef = new opentype.Glyph({
      name: '.notdef', unicode: 0, advanceWidth: 1000, path: new opentype.Path()
    });
    var glyphs = [notdef];
    for (var i = 0; i < coveredChars.length; i++) {
      var cp = coveredChars.charCodeAt(i);
      var path = new opentype.Path();
      path.moveTo(100, 0); path.lineTo(100, 700); path.lineTo(800, 700); path.lineTo(800, 0);
      path.close();
      glyphs.push(new opentype.Glyph({
        name: 'uni' + cp.toString(16).toUpperCase(),
        unicode: cp, advanceWidth: 1000, path: path
      }));
    }
    var font = new opentype.Font({
      familyName: 'SubsetCN', styleName: 'Regular',
      unitsPerEm: 1000, ascender: 800, descender: -200, glyphs: glyphs
    });
    return new Uint8Array(font.toArrayBuffer());
  }

  /* The simplified characters used across the fixture prose. */
  var SIMPLIFIED_COVERAGE =
    '她的头发很长这个城市展得快房间干净他是部衣服了里面有人走三公一碗条桌子表光滑' +
    '老板买块木松树高放皇后来再没回复习功课重练覆盖全第章与照片张的';

  async function buildWithFont() {
    var zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.folder('META-INF').file('container.xml', container('OEBPS/content.opf'));
    var oebps = zip.folder('OEBPS');
    oebps.file('content.opf', opfWithFont());
    oebps.file('toc.ncx', ncx());
    addCommon(oebps, 'zh-CN');
    oebps.folder('fonts').file('subset.ttf', subsetFont(SIMPLIFIED_COVERAGE));
    oebps.folder('styles').file('main.css',
      '@font-face { font-family: "SubsetCN"; src: url(../fonts/subset.ttf) format("truetype"); }\n' +
      'body { font-family: "SubsetCN", serif; }\n' + CSS);
    return zip.generateAsync({ type: 'arraybuffer' });
  }

  function opfWithFont() {
    return opf2().replace('  </manifest>',
      '    <item id="font" href="fonts/subset.ttf" media-type="application/font-sfnt"/>\n  </manifest>');
  }


  /* A chapter long enough to overflow a test viewport, so scrolling and the
   * vim motions have something real to act on. */
  function longProse(n) {
    var out = [];
    for (var i = 1; i <= n; i++) {
      out.push('<p id="lp' + i + '">第' + i + '段：她的头发很长，房间很干净，' +
               '里面有人在吃面条，老板和皇后都在松树下面放松。</p>');
    }
    return out.join('\n');
  }

  async function buildLong() {
    var zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.folder('META-INF').file('container.xml', container('OEBPS/content.opf'));
    var oebps = zip.folder('OEBPS');
    oebps.file('content.opf', opf2());
    oebps.file('toc.ncx', ncx());
    oebps.folder('text').file('chapter1.xhtml', xhtml('第一章 干净的头发', longProse(60), 'zh-CN'));
    oebps.folder('text').file('chapter2.xhtml', xhtml('第二章 老板与皇后', longProse(60), 'zh-CN'));
    oebps.folder('styles').file('main.css', CSS);
    oebps.folder('images').file('pic.png', bytes(PNG_B64));
    return zip.generateAsync({ type: 'arraybuffer' });
  }

  /* Hostile chapter markup for the reader's trust-boundary tests. The
   * fixture deliberately mixes executable markup and network-capable URLs
   * with ordinary in-archive resources so a sanitizer cannot "pass" merely
   * by deleting every attribute or all book styling. */
  var HOSTILE_PROSE =
    '<p id="safe-text" class="safe-local-bg" onclick="window.__epubEventRan = true">Safe local content</p>' +
    '<script id="evil-script">window.__epubScriptRan = true;<\/script>' +
    '<iframe id="evil-frame" srcdoc="&lt;script&gt;parent.__epubFrameRan=true;&lt;/script&gt;"></iframe>' +
    '<object id="evil-object" data="https://reader-test.invalid/object"></object>' +
    '<embed id="evil-embed" src="https://reader-test.invalid/embed"/>' +
    '<video id="evil-video" autoplay="autoplay" src="https://reader-test.invalid/video.mp4"></video>' +
    '<audio id="evil-audio" autoplay="autoplay" src="https://reader-test.invalid/audio.mp3"></audio>' +
    '<form id="evil-form" action="https://reader-test.invalid/submit">' +
      '<input name="secret"/><button formaction="javascript:window.__epubFormRan=true">Send</button>' +
    '</form>' +
    '<base id="evil-base" href="https://reader-test.invalid/"/>' +
    '<meta id="evil-meta" http-equiv="refresh" content="0;url=https://reader-test.invalid/refresh"/>' +
    '<svg id="evil-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="window.__epubSvgRan=true">' +
      '<script>window.__epubSvgScriptRan = true;<\/script>' +
      '<foreignObject id="evil-foreign-object"><iframe src="https://reader-test.invalid/nested-frame"></iframe></foreignObject>' +
      '<animate id="evil-animation" attributeName="x" from="0" to="100" dur="1s"/>' +
      '<feImage id="evil-filter-image" xlink:href="https://reader-test.invalid/filter.svg"/>' +
      '<image id="remote-svg-image" xlink:href="https://reader-test.invalid/svg-image.png"/>' +
      '<image id="local-svg-image" xlink:href="../images/pic.png"/>' +
      '<use id="javascript-svg-use" href="&#x0A;JaVaScRiPt:window.__epubSvgUseRan=true"/>' +
    '</svg>' +
    '<span id="spoofed-mark" class="amb-mark" data-source="x" data-candidates="xy" data-chosen="x" data-key="attacker">x</span>' +
    '<img id="local-image" src="../images/pic.png" alt="Local image" onerror="window.__epubEventRan=true"/>' +
    '<img id="remote-image" src="https://reader-test.invalid/tracker.png" alt="Remote image"/>' +
    '<img id="scheme-relative-image" src="//reader-test.invalid/tracker-2.png" alt="Remote image"/>' +
    '<img id="foreign-blob-image" src="blob:https://reader-test.invalid/not-owned" alt="Foreign blob"/>' +
    '<img id="data-svg-image" src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20onload%3D%22alert(1)%22%2F%3E" alt="Active data image"/>' +
    '<a id="safe-local-link" href="chapter2.xhtml#safe-target">Safe local link</a>' +
    '<a id="safe-fragment-link" href="#safe-text">Safe fragment link</a>' +
    '<a id="javascript-link" href="java&#x73;cript:window.__epubLinkRan=true">Unsafe link</a>' +
    '<a id="obfuscated-javascript-link" href="&#x0A;JaVaScRiPt:window.__epubLinkRan=true">Obfuscated unsafe link</a>' +
    '<a id="data-html-link" href="data:text/html,%3Cscript%3Ealert(1)%3C%2Fscript%3E">Unsafe data link</a>' +
    '<link id="remote-stylesheet" rel="stylesheet" href="https://reader-test.invalid/body.css"/>' +
    '<p id="inline-remote-style" style="background-image:url(https://reader-test.invalid/inline.png)">Styled text</p>' +
    '<style id="body-style">@import url(https://reader-test.invalid/body-import.css);' +
      '.body-remote { background-image: url(//reader-test.invalid/body.png); }</style>';

  var HOSTILE_CSS =
    '@import url("https://reader-test.invalid/import.css");\n' +
    '@import "//reader-test.invalid/import-2.css";\n' +
    '.safe-local-bg { background-image: url(../images/pic.png); color: rgb(1, 2, 3); }\n' +
    '.remote-bg { background-image: url(https://reader-test.invalid/css.png); }\n' +
    '.scheme-relative-bg { background-image: url(//reader-test.invalid/css-2.png); }\n' +
    '.active-data-bg { background-image: url("data:image/svg+xml,%3Csvg%20onload%3D%22alert(1)%22%2F%3E"); }\n' +
    '.javascript-bg { background-image: url("javascript:window.__epubCssRan=true"); }\n';

  async function buildHostile() {
    var zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.folder('META-INF').file('container.xml', container('OEBPS/content.opf'));
    var oebps = zip.folder('OEBPS');
    oebps.file('content.opf', opf2());
    oebps.file('toc.ncx', ncx());
    oebps.folder('text').file('chapter1.xhtml', xhtml('Security fixture', HOSTILE_PROSE, 'zh-CN'));
    oebps.folder('text').file('chapter2.xhtml', xhtml(
      'Safe destination', '<p id="safe-target">Ordinary local navigation survived.</p>', 'zh-CN'));
    oebps.folder('styles').file('main.css', HOSTILE_CSS);
    oebps.folder('images').file('pic.png', bytes(PNG_B64));
    return zip.generateAsync({ type: 'arraybuffer' });
  }


  /* Deliberately not well-formed XML: unclosed <p>, a bare &, an unquoted
   * attribute. The strict parser rejects all of this; plenty of real EPUBs
   * ship it anyway. */
  var BROKEN_PROSE =
    '<p class=lead>她的头发很长 & 房间很干净\n' +
    '<p>里面有人在吃面条，老板和皇后都在松树下面放松。\n' +
    '<br>\n' +
    '<p>干部说：这个城市发展得很快。';

  async function buildBroken() {
    var zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.folder('META-INF').file('container.xml', container('OEBPS/content.opf'));
    var oebps = zip.folder('OEBPS');
    oebps.file('content.opf', opf2());
    oebps.file('toc.ncx', ncx());
    oebps.folder('text').file('chapter1.xhtml',
      '<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">\n' +
      '<head><title>第一章</title></head><body>\n' + BROKEN_PROSE + '\n</body></html>\n');
    oebps.folder('text').file('chapter2.xhtml', xhtml('第二章 老板与皇后', PROSE_2, 'zh-CN'));
    oebps.folder('styles').file('main.css', CSS);
    oebps.folder('images').file('pic.png', bytes(PNG_B64));
    return zip.generateAsync({ type: 'arraybuffer' });
  }

  App.fixtures = { build: build, buildBroken: buildBroken, buildLong: buildLong, buildHostile: buildHostile,
                   buildWithFont: buildWithFont,
                   subsetFont: subsetFont, SIMPLIFIED_COVERAGE: SIMPLIFIED_COVERAGE,
                   PNG_B64: PNG_B64 };
})(window.App = window.App || {});
