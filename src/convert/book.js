/* Whole-book conversion: every spine document, plus the metadata and TOC
 * labels that a reader's library view will show. */
(function (App) {
  'use strict';

  var Z = App.zip;
  var P = App.parse;

  var XHTML_RE = /(xhtml|html)/i;

  /* XMLSerializer drops the XML declaration and can normalise the doctype,
   * so the original prolog is captured verbatim and re-prepended. */
  function prologOf(text) {
    var i = text.search(/<html[\s>]/i);
    if (i < 0) return '';
    return text.slice(0, i);
  }

  function serialize(doc, originalText) {
    var body = new XMLSerializer().serializeToString(doc);
    var prolog = prologOf(originalText);
    if (!prolog) return body;
    var j = body.search(/<html[\s>]/i);
    return j < 0 ? body : prolog + body.slice(j);
  }

  function convertTocTree(nodes, convert) {
    nodes.forEach(function (n) {
      n.originalLabel = n.label;
      n.label = convert(n.label);
      if (n.children && n.children.length) convertTocTree(n.children, convert);
    });
  }

  /* TOC labels live in a separate document from the chapters, so they need
   * their own pass or the sidebar stays simplified. */
  async function convertTocDocument(book, converter) {
    if (!book.tocPath) return 0;
    var entry = book.entries.get(book.tocPath);
    if (!entry) return 0;

    var text = await Z.loadText(entry);
    var doc = P.parseXml(text, book.tocPath);
    var count = 0;

    var labelTags = book.tocSource === 'ncx' ? ['text'] : ['a', 'span'];
    labelTags.forEach(function (tag) {
      P.tags(doc, tag).forEach(function (el) {
        var walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        var node;
        while ((node = walker.nextNode())) {
          var out = converter.convert(node.nodeValue);
          if (out !== node.nodeValue) { node.nodeValue = out; count++; }
        }
      });
    });

    entry.original = text;
    entry.text = serialize(doc, text);
    return count;
  }

  async function convertOpf(book, converter) {
    var entry = book.entries.get(book.opfPath);
    var text = await Z.loadText(entry);
    var doc = book.opfDoc;
    var pkg = P.tags(doc, 'package')[0];
    var md = P.tags(pkg, 'metadata')[0];
    if (!md) return;

    ['title', 'creator', 'publisher', 'description', 'subject'].forEach(function (k) {
      P.tags(md, k).forEach(function (el) {
        el.textContent = converter.convert(el.textContent || '');
      });
    });

    P.tags(md, 'language').forEach(function (el) {
      el.textContent = App.convert.retagLanguage((el.textContent || '').trim(), converter.preset);
    });

    book.metadata.original = {
      title: book.metadata.title,
      creator: book.metadata.creator,
      publisher: book.metadata.publisher,
      language: book.metadata.language
    };
    entry.original = text;
    book.metadata.title = converter.convert(book.metadata.title);
    book.metadata.creator = converter.convert(book.metadata.creator);
    book.metadata.publisher = converter.convert(book.metadata.publisher);
    book.metadata.language = App.convert.retagLanguage(book.metadata.language, converter.preset);
    entry.text = serialize(doc, text);
  }

  async function convertBook(book, presetId, onProgress) {
    var converter = App.convert.createConverter(presetId);
    var table = App.ambiguityTable;
    var solo = App.convert.createSoloCache(converter);

    var docs = [];
    book.manifest.forEach(function (item) {
      if (XHTML_RE.test(item.mediaType) && book.entries.has(item.path)) docs.push(item);
    });

    var report = {
      preset: converter.preset,
      documents: 0,
      recovered: 0,
      changedNodes: 0,
      unalignedNodes: 0,
      marks: new Map(),
      markCount: 0,
      imagesWithText: 0,
      warnings: []
    };

    for (var i = 0; i < docs.length; i++) {
      var item = docs[i];
      var entry = book.entries.get(item.path);
      var text = await Z.loadText(entry);
      var parsed;
      try {
        parsed = P.parseContentDocument(text, item.path);
      } catch (e) {
        report.warnings.push(item.path + ': ' + e.message + ' (left unconverted)');
        continue;
      }
      var doc = parsed.doc;
      if (parsed.recovered) {
        report.recovered++;
        report.warnings.push(item.path + ': not well-formed XML, repaired via the ' +
                             'HTML parser and converted');
      }

      var result = App.convert.convertDocument(doc, converter, table, solo);

      var html = P.tags(doc, 'html')[0];
      if (html) {
        ['lang', 'xml:lang'].forEach(function (attr) {
          /* Set the tag even when the document declared none: without it a
           * reading system has no signal that the text is now traditional
           * and may fall back to simplified fonts. */
          html.setAttribute(attr, html.hasAttribute(attr)
            ? App.convert.retagLanguage(html.getAttribute(attr), converter.preset)
            : converter.preset.lang);
        });
      }

      entry.original = text;
      entry.text = serialize(doc, text);
      report.documents++;
      report.changedNodes += result.changedNodes;
      report.unalignedNodes += result.unalignedNodes;
      if (result.marks.length) {
        report.marks.set(item.path, result.marks);
        report.markCount += result.marks.length;
      }

      if (onProgress) onProgress((i + 1) / docs.length, item.path);
    }

    await convertOpf(book, converter);
    await convertTocDocument(book, converter);
    convertTocTree(book.toc, converter.convert);

    /* Text baked into images cannot be converted. Say so rather than
     * silently shipping a half-converted book. */
    book.manifest.forEach(function (item) {
      if (/^image\//.test(item.mediaType)) report.imagesWithText++;
    });

    book.converted = true;
    book.report = report;
    return report;
  }

  App.convert = App.convert || {};
  App.convert.book = convertBook;
  App.convert.serialize = serialize;
  App.convert.prologOf = prologOf;
})(window.App = window.App || {});
