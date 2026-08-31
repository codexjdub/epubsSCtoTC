/* LLM disambiguation -- wired up, inert until served from a real origin.
 *
 * A cross-origin request from a file:// page carries Origin: null, which the
 * API will not accept, so this feature is gated on the page having a real
 * origin. The conversion pipeline is fully functional without it; this only
 * ever refines characters the dictionaries left genuinely ambiguous.
 *
 * Only the sentences CONTAINING an ambiguous character are ever sent -- a
 * small fraction of the text. The book itself never leaves the browser.
 */
(function (App) {
  'use strict';

  function available() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }

  function reason() {
    if (available()) return '';
    return 'Opened from a local file. Serve the folder over localhost to enable this.';
  }

  /* Group marks into the minimal set of sentences that need a decision. */
  function collectAmbiguousSentences(book, limit) {
    var out = [];
    if (!book.report || !book.report.marks) return out;
    book.report.marks.forEach(function (marks, path) {
      marks.forEach(function (m) {
        if (m.candidates.length < 2) return;
        out.push({ path: path, nodeIndex: m.nodeIndex, offset: m.offset,
                   source: m.source, chosen: m.chosen, candidates: m.candidates,
                   context: m.before + m.source + m.after });
        });
    });
    return limit ? out.slice(0, limit) : out;
  }

  async function disambiguate() {
    throw new Error('LLM disambiguation is not enabled in this build.');
  }

  App.llm = {
    available: available,
    reason: reason,
    collectAmbiguousSentences: collectAmbiguousSentences,
    disambiguate: disambiguate
  };
})(window.App = window.App || {});
