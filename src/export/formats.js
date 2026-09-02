/* Exporting the converted book as something other than an EPUB.
 *
 * All three read the same source: the spine, in reading order, with the
 * converted text already in entry.text. What differs is how much of the
 * structure survives.
 *
 *   html      everything, in one self-contained file that opens anywhere and
 *             is the honest route to PDF -- the browser's own print dialogue
 *             breaks CJK lines properly, which no library small enough to ship
 *             here would.
 *   markdown  headings, emphasis, quotes and lists; the rest is dropped.
 *   text      the words alone. Roughly half a converted book by character
 *             count is markup, so this is for feeding somewhere else rather
 *             than for reading.
 *
 * The book's own stylesheet is deliberately not carried into the HTML: it
 * references fonts that the export may have stripped and images by paths that
 * no longer exist outside the archive. A clean stylesheet renders everywhere,
 * which is the whole point of the format.
 */
(function (App) {
  'use strict';

  var Z = App.zip;
  var P = App.parse;

  function spineDocs(book) {
    var seen = {};
    var out = [];
    book.spine.items.forEach(function (s) {
      if (s.linear === false || seen[s.item.path]) return;
      if (!book.entries.has(s.item.path)) return;
      seen[s.item.path] = true;
      out.push(s.item.path);
    });
    return out;
  }

  async function documentFor(book, path) {
    var entry = book.entries.get(path);
    var text = await Z.loadText(entry);
    return P.parseContentDocument(text, path).doc;
  }

  function bodyOf(doc) {
    return P.tags(doc, 'body')[0] || doc.documentElement;
  }

  /* ---- plain text --------------------------------------------------------- */

  var BLOCK = { p: 1, div: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1,
                li: 1, blockquote: 1, tr: 1, br: 1, section: 1, article: 1 };

  function textFrom(node, out) {
    for (var child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        out.push(child.nodeValue.replace(/\s+/g, ' '));
      } else if (child.nodeType === 1) {
        if (App.convert.SKIP_TAGS[child.localName]) continue;
        textFrom(child, out);
        if (BLOCK[child.localName]) out.push('\n');
      }
    }
    return out;
  }

  async function toText(book) {
    var paths = spineDocs(book);
    var parts = [];
    for (var i = 0; i < paths.length; i++) {
      var doc = await documentFor(book, paths[i]);
      var raw = textFrom(bodyOf(doc), []).join('');
      var tidy = raw.split('\n').map(function (l) { return l.trim(); })
        .filter(Boolean).join('\n\n');
      if (tidy) parts.push(tidy);
    }
    var head = [book.metadata.title, book.metadata.creator].filter(Boolean).join('\n');
    return (head ? head + '\n\n' : '') + parts.join('\n\n\n');
  }

  /* ---- markdown ----------------------------------------------------------- */

  /* Escaped sparingly. Chinese prose almost never contains these, and a text
   * peppered with backslashes is worse than a stray asterisk. */
  function mdEscape(s) {
    return s.replace(/([\\`*_[\]])/g, '\\$1');
  }

  var EMPHASIS = { em: '*', i: '*', strong: '**', b: '**', code: '`' };

  function mdInline(node) {
    var out = '';
    for (var child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        out += mdEscape(child.nodeValue.replace(/\s+/g, ' '));
        continue;
      }
      if (child.nodeType !== 1) continue;
      var name = child.localName;
      if (App.convert.SKIP_TAGS[name] && name !== 'code') continue;
      if (name === 'br') { out += '  \n'; continue; }
      if (name === 'img') {
        out += '![' + (child.getAttribute('alt') || '') + '](' +
               (child.getAttribute('src') || '') + ')';
        continue;
      }
      if (name === 'a') {
        var href = child.getAttribute('href');
        /* Only links that still lead somewhere. A chapter-relative href is
         * meaningless in a single markdown file, so the text stays and the
         * link goes rather than shipping one that cannot be followed. */
        out += /^(https?:|mailto:)/i.test(href || '')
          ? '[' + mdInline(child) + '](' + href + ')'
          : mdInline(child);
        continue;
      }
      var mark = EMPHASIS[name];
      var inner = mdInline(child);
      out += mark && inner.trim() ? mark + inner + mark : inner;
    }
    return out;
  }

  function mdBlocks(node, out, depth) {
    for (var child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        var loose = child.nodeValue.trim();
        if (loose) out.push(mdEscape(loose));
        continue;
      }
      if (child.nodeType !== 1) continue;
      var name = child.localName;
      if (App.convert.SKIP_TAGS[name]) continue;

      if (/^h[1-6]$/.test(name)) {
        var text = mdInline(child).trim();
        if (text) out.push(new Array(+name.charAt(1) + 1).join('#') + ' ' + text);
      } else if (name === 'p') {
        var para = mdInline(child).trim();
        if (para) out.push(para);
      } else if (name === 'blockquote') {
        var quoted = [];
        mdBlocks(child, quoted, depth);
        if (quoted.length) out.push(quoted.join('\n\n').split('\n')
          .map(function (l) { return '> ' + l; }).join('\n'));
      } else if (name === 'ul' || name === 'ol') {
        var n = 0;
        var items = [];
        for (var li = child.firstChild; li; li = li.nextSibling) {
          if (li.nodeType !== 1 || li.localName !== 'li') continue;
          n++;
          var bullet = name === 'ol' ? n + '. ' : '- ';
          items.push(bullet + mdInline(li).trim());
        }
        if (items.length) out.push(items.join('\n'));
      } else if (name === 'hr') {
        out.push('---');
      } else if (name === 'img') {
        out.push('![' + (child.getAttribute('alt') || '') + '](' +
                 (child.getAttribute('src') || '') + ')');
      } else {
        mdBlocks(child, out, depth + 1);
      }
    }
    return out;
  }

  async function toMarkdown(book) {
    var paths = spineDocs(book);
    var parts = [];
    if (book.metadata.title) parts.push('# ' + mdEscape(book.metadata.title));
    if (book.metadata.creator) parts.push('*' + mdEscape(book.metadata.creator) + '*');
    for (var i = 0; i < paths.length; i++) {
      var doc = await documentFor(book, paths[i]);
      var blocks = mdBlocks(bodyOf(doc), [], 0);
      if (blocks.length) parts.push(blocks.join('\n\n'));
    }
    return parts.join('\n\n') + '\n';
  }

  /* ---- single-file html --------------------------------------------------- */

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function base64(bytes) {
    var chunk = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return btoa(parts.join(''));
  }

  var XLINK = 'http://www.w3.org/1999/xlink';

  async function dataUri(book, basePath, ref) {
    if (!ref || /^(data:|https?:)/i.test(ref)) return '';
    var entry = book.entries.get(Z.resolve(Z.dirname(basePath), ref));
    if (!entry) return '';
    var bytes = await Z.loadBytes(entry);
    return 'data:' + (entry.mediaType || 'image/jpeg') + ';base64,' + base64(bytes);
  }

  /* Images come with the file or not at all: a relative reference means nothing
   * once the document is out of the archive.
   *
   * Both spellings, because covers are usually the second one -- an <image>
   * inside an <svg>, addressed by xlink:href. Handling only <img> shipped a
   * cover pointing at a path that no longer existed, and it showed as nothing.
   */
  async function inlineImages(doc, basePath, book) {
    var images = P.tags(doc, 'img');
    for (var i = 0; i < images.length; i++) {
      var uri = await dataUri(book, basePath, images[i].getAttribute('src'));
      if (uri) images[i].setAttribute('src', uri);
      else if (images[i].getAttribute('src')) images[i].removeAttribute('src');
    }

    var svgImages = P.tags(doc, 'image');
    for (var j = 0; j < svgImages.length; j++) {
      var ref = svgImages[j].getAttribute('href') ||
                svgImages[j].getAttributeNS(XLINK, 'href');
      var svgUri = await dataUri(book, basePath, ref);
      if (!svgUri) continue;
      svgImages[j].setAttribute('href', svgUri);
      svgImages[j].setAttributeNS(XLINK, 'xlink:href', svgUri);
    }
  }

  var HTML_CSS =
    'html { color-scheme: light dark; }\n' +
    'body { margin: 0 auto; padding: 2.5rem 1.25rem 4rem; max-width: 34em;\n' +
    '  font-family: "Songti TC", "Songti SC", "PMingLiU", serif;\n' +
    '  font-size: 18px; line-height: 1.9; }\n' +
    'h1, h2, h3, h4, h5, h6 { line-height: 1.4; margin: 2.2em 0 .8em; }\n' +
    'p { margin: 0 0 1em; }\n' +
    'img { max-width: 100%; height: auto; }\n' +
    'blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid currentColor;\n' +
    '  opacity: .8; }\n' +
    'hr.chapter { border: 0; border-top: 1px solid currentColor; opacity: .25;\n' +
    '  margin: 3em 0; }\n' +
    /* Printing is what this format is for as much as reading: a chapter should
       start on its own page, and a heading should not sit alone at the foot. */
    '@media print {\n' +
    '  body { max-width: none; font-size: 11pt; }\n' +
    '  hr.chapter { display: none; }\n' +
    '  section { break-before: page; }\n' +
    '  h1, h2, h3 { break-after: avoid; }\n' +
    '}\n';

  /* Every chapter link points at a file that will not exist once the book is
   * one document, so they are turned into fragments into it -- a link with a
   * fragment keeps its own target, one without lands on the chapter's section.
   * Left alone they were 157 dead hrefs in a file whose whole promise is that
   * it stands on its own. */
  function rewriteLinks(doc, basePath, sectionFor, ids) {
    var anchors = P.tags(doc, 'a');
    for (var i = 0; i < anchors.length; i++) {
      var href = anchors[i].getAttribute('href');
      if (!href || /^(https?:|mailto:)/i.test(href)) continue;
      var fragment = Z.fragmentOf(href);
      var target = href.charAt(0) === '#' ? basePath : Z.resolve(Z.dirname(basePath), href);
      if (fragment && ids[fragment]) anchors[i].setAttribute('href', '#' + fragment);
      else if (sectionFor[target]) anchors[i].setAttribute('href', '#' + sectionFor[target]);
      else anchors[i].removeAttribute('href');
    }
  }

  function collectIds(doc, into) {
    var all = doc.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      var id = all[i].getAttribute && all[i].getAttribute('id');
      if (id) into[id] = true;
    }
    return into;
  }

  async function toHtml(book) {
    var paths = spineDocs(book);
    var sectionFor = {};
    paths.forEach(function (path, i) { sectionFor[path] = 'chapter-' + (i + 1); });

    /* Two passes: a link can point into a chapter that has not been read yet,
       so every id in the book has to be known before any href is rewritten.
       Otherwise a fragment is kept on faith and lands nowhere. */
    var docs = [];
    var ids = {};
    for (var d = 0; d < paths.length; d++) {
      var parsed = await documentFor(book, paths[d]);
      collectIds(parsed, ids);
      docs.push(parsed);
    }
    Object.keys(sectionFor).forEach(function (path) { ids[sectionFor[path]] = true; });

    var sections = [];
    var claimed = {};
    for (var i = 0; i < paths.length; i++) {
      var doc = docs[i];
      await inlineImages(doc, paths[i], book);
      rewriteLinks(doc, paths[i], sectionFor, ids);
      var body = bodyOf(doc);
      var inner = '';
      for (var child = body.firstChild; child; child = child.nextSibling) {
        inner += new XMLSerializer().serializeToString(child);
      }
      if (!inner.trim()) continue;

      /* An id on <body> is a real link target -- ten of them in the sample --
       * and serialising only the body's children throws it away. It becomes an
       * empty anchor inside the section, because the section already carries
       * its own id, and only once: a book split by Calibre repeats the same
       * body id across every piece of the original chapter. */
      var bodyId = body.getAttribute && body.getAttribute('id');
      var anchor = '';
      if (bodyId && !claimed[bodyId]) {
        claimed[bodyId] = true;
        anchor = '<span id="' + escapeHtml(bodyId) + '"></span>\n';
      }
      sections.push('<section id="' + sectionFor[paths[i]] + '">\n' +
                    anchor + inner + '\n</section>');
    }
    var lang = book.metadata.language || 'zh-Hant';
    var title = escapeHtml(book.metadata.title || 'book');
    return '<!DOCTYPE html>\n<html lang="' + escapeHtml(lang) + '">\n<head>\n' +
      '<meta charset="utf-8"/>\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1"/>\n' +
      '<title>' + title + '</title>\n<style>\n' + HTML_CSS + '</style>\n</head>\n<body>\n' +
      '<h1>' + title + '</h1>\n' +
      (book.metadata.creator ? '<p><em>' + escapeHtml(book.metadata.creator) + '</em></p>\n' : '') +
      sections.join('\n<hr class="chapter"/>\n') +
      '\n</body>\n</html>\n';
  }

  var FORMATS = {
    epub: { extension: 'epub', mediaType: 'application/epub+zip' },
    html: { extension: 'html', mediaType: 'text/html;charset=utf-8', build: toHtml },
    md:   { extension: 'md',   mediaType: 'text/markdown;charset=utf-8', build: toMarkdown },
    txt:  { extension: 'txt',  mediaType: 'text/plain;charset=utf-8', build: toText }
  };

  async function build(book, format) {
    var spec = FORMATS[format];
    if (!spec || !spec.build) throw new Error('Unknown export format: ' + format);
    var content = await spec.build(book);
    return new Blob([content], { type: spec.mediaType });
  }

  App.formats = {
    FORMATS: FORMATS,
    build: build,
    toText: toText,
    toMarkdown: toMarkdown,
    toHtml: toHtml,
    spineDocs: spineDocs
  };
})(window.App = window.App || {});
