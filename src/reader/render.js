/* Shadow-DOM chapter renderer.
 *
 * Shadow DOM rather than an iframe: at file:// the page origin is `null`, and
 * two null origins are not same-origin, so a parent page cannot script into a
 * srcdoc iframe -- no scroll tracking, no link interception, no DOM queries.
 * A shadow root gives the same CSS encapsulation while staying in one
 * scriptable document.
 */
(function (App) {
  'use strict';

  var Z = App.zip;
  var P = App.parse;
  var XHTML_NS = 'http://www.w3.org/1999/xhtml';

  /* ---- resources -------------------------------------------------------- */

  function createResourceMap(book) {
    var urls = new Map();

    async function urlFor(path) {
      if (!path) return '';
      if (urls.has(path)) return urls.get(path);
      var entry = book.entries.get(path);
      if (!entry) return '';
      var blob;
      if (entry.text !== null) {
        blob = new Blob([entry.text], { type: entry.mediaType || 'text/plain' });
      } else {
        var bytes = await Z.loadBytes(entry);
        blob = new Blob([bytes], { type: entry.mediaType || 'application/octet-stream' });
      }
      var url = URL.createObjectURL(blob);
      urls.set(path, url);
      return url;
    }

    function revokeAll() {
      urls.forEach(function (u) { URL.revokeObjectURL(u); });
      urls.clear();
    }

    return { urlFor: urlFor, revokeAll: revokeAll, map: urls };
  }

  /* ---- stylesheet scoping ------------------------------------------------ */

  /* Book CSS is written for a whole document, so `body { margin: 5% }` and
   * `html { font-size: ... }` have to become :host rules or they simply never
   * match inside a shadow root. @page is meaningless here and is dropped. */
  function scopeSelector(selector) {
    return selector.split(',').map(function (part) {
      var s = part.trim();
      if (!s) return s;
      if (/^(html|body)$/i.test(s)) return ':host';
      s = s.replace(/^(html|body)\s+/i, '');
      s = s.replace(/^(html|body)([.:#\[])/i, ':host$2');
      return s;
    }).filter(Boolean).join(', ');
  }

  function scopeCss(css, opts) {
    opts = opts || {};
    var out = '';
    var i = 0;

    while (i < css.length) {
      var braceAt = css.indexOf('{', i);
      if (braceAt < 0) { out += css.slice(i); break; }

      var prelude = css.slice(i, braceAt).trim();

      // Find the matching close brace, tracking nesting for at-rules.
      var depth = 0, j = braceAt;
      for (; j < css.length; j++) {
        if (css.charAt(j) === '{') depth++;
        else if (css.charAt(j) === '}') { depth--; if (depth === 0) break; }
      }
      var bodyText = css.slice(braceAt + 1, j);

      if (/^@page/i.test(prelude)) {
        /* dropped */
      } else if (/^@font-face/i.test(prelude)) {
        if (!opts.stripFontFace) out += prelude + '{' + bodyText + '}\n';
      } else if (/^@(media|supports)/i.test(prelude)) {
        out += prelude + '{' + scopeCss(bodyText, opts) + '}\n';
      } else if (prelude.charAt(0) === '@') {
        out += prelude + '{' + bodyText + '}\n';
      } else {
        var scoped = scopeSelector(prelude);
        if (scoped) out += scoped + '{' + bodyText + '}\n';
      }
      i = j + 1;
    }
    return out;
  }

  /* ---- ambiguity marks --------------------------------------------------- */

  /* Marks are addressed by (text-node index, offset) against the same walk
   * order the converter used, so the exported markup never carries marker
   * elements -- they exist only in the rendered copy. */
  function applyMarks(doc, marks) {
    if (!marks || !marks.length) return 0;

    var walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [];
    var node;
    while ((node = walker.nextNode())) nodes.push(node);

    var byNode = new Map();
    marks.forEach(function (m) {
      if (!byNode.has(m.nodeIndex)) byNode.set(m.nodeIndex, []);
      byNode.get(m.nodeIndex).push(m);
    });

    var applied = 0;
    byNode.forEach(function (list, index) {
      var target = nodes[index];
      if (!target || !target.parentNode) return;
      /* Descending offsets: splitting the tail first keeps earlier offsets
       * valid in the node we are still working on. */
      list.slice().sort(function (a, b) { return b.offset - a.offset; }).forEach(function (m) {
        if (m.offset >= target.nodeValue.length) return;
        var tail = target.splitText(m.offset);
        if (tail.nodeValue.length > 1) tail.splitText(1);
        if (tail.nodeValue !== m.chosen) return;   // drifted; leave it alone
        var span = doc.createElementNS(XHTML_NS, 'span');
        span.setAttribute('class', 'amb-mark');
        span.setAttribute('data-source', m.source);
        span.setAttribute('data-candidates', m.candidates.join(''));
        span.setAttribute('data-chosen', m.chosen);
        span.setAttribute('data-key', App.convert.contextKey(m));
        span.appendChild(doc.createTextNode(m.chosen));
        tail.parentNode.replaceChild(span, tail);
        applied++;
      });
    });
    return applied;
  }

  /* ---- chapter rendering -------------------------------------------------- */

  async function collectCss(book, doc, basePath, resources, opts) {
    var css = '';
    var dir = Z.dirname(basePath);

    var links = P.tags(doc, 'link');
    for (var i = 0; i < links.length; i++) {
      var rel = (links[i].getAttribute('rel') || '').toLowerCase();
      if (rel.indexOf('stylesheet') < 0) continue;
      var href = links[i].getAttribute('href');
      if (!href) continue;
      var entry = book.entries.get(Z.resolve(dir, href));
      if (entry) css += await Z.loadText(entry) + '\n';
    }

    var styles = P.tags(doc, 'style');
    for (var s = 0; s < styles.length; s++) css += styles[s].textContent + '\n';

    css = await rewriteCssUrls(css, dir, book, resources);
    return scopeCss(css, opts);
  }

  /* url(...) inside the book's CSS points at zip paths the browser cannot
   * fetch; each has to become a blob URL. */
  async function rewriteCssUrls(css, dir, book, resources) {
    var pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    var found = [];
    var m;
    while ((m = pattern.exec(css))) found.push(m[2]);

    for (var i = 0; i < found.length; i++) {
      var raw = found[i];
      if (/^(data:|https?:|blob:)/i.test(raw)) continue;
      var url = await resources.urlFor(Z.resolve(dir, raw));
      if (url) css = css.split(raw).join(url);
    }
    return css;
  }

  async function rewriteResourceRefs(doc, basePath, book, resources) {
    var dir = Z.dirname(basePath);

    var images = P.tags(doc, 'img');
    for (var i = 0; i < images.length; i++) {
      var src = images[i].getAttribute('src');
      if (!src || /^(data:|https?:|blob:)/i.test(src)) continue;
      var url = await resources.urlFor(Z.resolve(dir, src));
      if (url) images[i].setAttribute('src', url);
    }

    var svgImages = P.tags(doc, 'image');
    for (var s = 0; s < svgImages.length; s++) {
      var href = svgImages[s].getAttribute('href') ||
                 svgImages[s].getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (!href || /^(data:|https?:|blob:)/i.test(href)) continue;
      var svgUrl = await resources.urlFor(Z.resolve(dir, href));
      if (svgUrl) {
        svgImages[s].setAttribute('href', svgUrl);
        svgImages[s].setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', svgUrl);
      }
    }
  }

  /* Build a detached DOM for one spine item, ready to drop into a shadow
   * root. Returns the body element plus the scoped stylesheet text. */
  async function renderChapter(book, item, resources, opts) {
    opts = opts || {};
    var entry = book.entries.get(item.path);
    if (!entry) throw new Error('Missing spine document: ' + item.path);

    var original = opts.source === 'original' && typeof entry.original === 'string';
    var text = original ? entry.original : await Z.loadText(entry);
    var doc = P.parseContentDocument(text, item.path).doc;

    /* Mark addresses are offsets into the CONVERTED text, so they are
     * meaningless against the original and are skipped there. */
    var marks = (!original && book.report && book.report.marks)
      ? book.report.marks.get(item.path) : null;
    var markCount = opts.showMarks === false ? 0 : applyMarks(doc, marks);

    await rewriteResourceRefs(doc, item.path, book, resources);
    var css = await collectCss(book, doc, item.path, resources, opts);

    var body = P.tags(doc, 'body')[0];
    return { body: body, css: css, markCount: markCount, path: item.path };
  }

  App.reader = App.reader || {};
  App.reader.createResourceMap = createResourceMap;
  App.reader.renderChapter = renderChapter;
  App.reader.scopeCss = scopeCss;
  App.reader.scopeSelector = scopeSelector;
  App.reader.applyMarks = applyMarks;
  App.reader.XHTML_NS = XHTML_NS;
})(window.App = window.App || {});
