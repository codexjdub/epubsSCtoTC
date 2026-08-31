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
    var state = App.punct.createState();
    var changed = 0;
    var paths = [];
    book.manifest.forEach(function (item) {
      if (/xhtml|html/i.test(item.mediaType) && book.entries.has(item.path)) paths.push(item.path);
    });
    /* Spine order, so quotation nesting is tracked in reading order. */
    var ordered = book.spine.items.map(function (s) { return s.item.path; })
      .filter(function (p) { return paths.indexOf(p) >= 0; });

    for (var i = 0; i < ordered.length; i++) {
      var entry = book.entries.get(ordered[i]);
      var text = await Z.loadText(entry);
      var doc = P.parseXml(text, ordered[i]);
      changed += App.punct.convertDocument(doc, state);
      entry.text = App.convert.serialize(doc, text);
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
    if (options.handleFonts !== false) {
      summary.fontReport = await App.fonts.analyze(book, { threshold: options.fontThreshold });
      summary.fontsStripped = await App.fonts.stripInsufficient(book, summary.fontReport);
    }

    summary.blob = await Z.write(book.entries, onProgress);
    return summary;
  }

  function filenameFor(book) {
    var base = (book.metadata.title || 'converted').replace(/[\\/:*?"<>|]/g, '').trim() || 'converted';
    return base + '.epub';
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
