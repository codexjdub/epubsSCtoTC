/* Export: apply reader overrides and font decisions, then rebuild the file. */
(function (App) {
  'use strict';

  var Z = App.zip;
  var P = App.parse;

  /* Reader choices are stored against a context key, so they are re-resolved
   * here against the same (node index, offset) addresses the converter
   * recorded. Every replacement is one character for one character, so
   * offsets within a node stay valid as we go. */
  async function applyOverrides(book, overrides) {
    if (!overrides || !Object.keys(overrides).length) return 0;
    if (!book.report || !book.report.marks) return 0;

    var applied = 0;

    for (var pair of book.report.marks) {
      var path = pair[0], marks = pair[1];
      var relevant = marks.filter(function (m) {
        var choice = overrides[App.convert.contextKey(m)];
        return choice && choice !== m.chosen;
      });
      if (!relevant.length) continue;

      var entry = book.entries.get(path);
      if (!entry) continue;
      var text = await Z.loadText(entry);
      var doc = P.parseXml(text, path);

      var walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT, null, false);
      var nodes = [];
      var node;
      while ((node = walker.nextNode())) nodes.push(node);

      relevant.forEach(function (m) {
        var target = nodes[m.nodeIndex];
        if (!target || m.offset >= target.nodeValue.length) return;
        if (target.nodeValue.charAt(m.offset) !== m.chosen) return;  // drifted
        var choice = overrides[App.convert.contextKey(m)];
        target.nodeValue = target.nodeValue.slice(0, m.offset) + choice +
                           target.nodeValue.slice(m.offset + 1);
        m.chosen = choice;
        applied++;
      });

      entry.text = App.convert.serialize(doc, text);
    }
    return applied;
  }

  async function applyPunctuation(book) {
    var changed = 0;
    var paths = new Set();
    book.manifest.forEach(function (item) {
      if (/xhtml|html/i.test(item.mediaType) && book.entries.has(item.path)) paths.add(item.path);
    });

    /* Spine order, so quotation nesting is tracked in reading order. */
    var ordered = book.spine.items.map(function (s) { return s.item.path; })
      .filter(function (p) { return paths.has(p); });
    /* Documents outside the spine -- a nav document, a cover page -- carry
     * prose too, and skipping them left them quoted the mainland way inside
     * an otherwise converted book. */
    var extra = [];
    paths.forEach(function (p) { if (ordered.indexOf(p) < 0) extra.push(p); });

    async function pass(list, state) {
      for (var i = 0; i < list.length; i++) {
        var entry = book.entries.get(list[i]);
        var text = await Z.loadText(entry);
        /* Same repair as everywhere else: a chapter the converter could not
         * parse must not take the export down with it. */
        var doc = P.parseContentDocument(text, list[i]).doc;
        changed += App.punct.convertDocument(doc, state);
        entry.text = App.convert.serialize(doc, text);
      }
    }

    await pass(ordered, App.punct.createState());
    /* Each of these stands alone, so nesting restarts rather than inheriting
     * whatever depth the spine happened to end on. */
    for (var i = 0; i < extra.length; i++) {
      await pass([extra[i]], App.punct.createState());
    }
    return changed;
  }

  async function buildFile(book, options, onProgress) {
    options = options || {};
    var summary = { overrides: 0, punctuation: 0, fontsStripped: [], fontReport: [] };

    if (options.overrides) {
      summary.overrides = await applyOverrides(book, options.overrides);
    }
    if (options.punctuation) {
      summary.punctuation = await applyPunctuation(book);
    }
    /* Only an EPUB carries the book's own fonts, so only an EPUB cares whether
       they can still render the converted text. */
    summary.format = options.format || 'epub';
    if (summary.format !== 'epub') {
      summary.blob = await App.formats.build(book, summary.format);
      return summary;
    }

    if (options.handleFonts !== false) {
      summary.fontReport = await App.fonts.analyze(book, { threshold: options.fontThreshold });
      summary.fontsStripped = await App.fonts.stripInsufficient(book, summary.fontReport);
    }

    summary.blob = await Z.write(book.entries, onProgress);
    return summary;
  }

  function filenameFor(book, format) {
    var base = (book.metadata.title || 'converted').replace(/[\\/:*?"<>|]/g, '').trim() || 'converted';
    var spec = App.formats.FORMATS[format || 'epub'];
    return base + '.' + (spec ? spec.extension : 'epub');
  }

  /* At file:// the File System Access API is unavailable -- it requires a
   * secure context -- so this is a plain download in every case. */
  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  App.export = {
    buildFile: buildFile,
    applyOverrides: applyOverrides,
    applyPunctuation: applyPunctuation,
    filenameFor: filenameFor,
    download: download
  };
})(window.App = window.App || {});
