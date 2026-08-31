/* Opt-in punctuation conversion.
 *
 * Mainland typesetting uses “ ” for speech; Taiwan and Hong Kong convention is
 * 「 」 with 『 』 nested inside. Nesting depth is tracked across the whole
 * document, because a quotation can open in one paragraph and close in
 * another. Off by default -- getting it wrong mangles dialogue.
 */
(function (App) {
  'use strict';

  var OPENERS = { '“': 1, '‘': 1 };   // “ ‘
  var CLOSERS = { '”': 1, '’': 1 };   // ” ’
  var PAIRS = [['「', '」'], ['『', '』']];  // 「」 『』

  function createState() { return { depth: 0 }; }

  function convertText(text, state) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (OPENERS[ch]) {
        out += PAIRS[state.depth % 2][0];
        state.depth++;
      } else if (CLOSERS[ch]) {
        state.depth = Math.max(0, state.depth - 1);
        out += PAIRS[state.depth % 2][1];
      } else {
        out += ch;
      }
    }
    return out;
  }

  /* Applied to an already-converted document. Quote characters are one-to-one
   * replacements, so text-node lengths are unchanged and any ambiguity
   * annotations recorded earlier stay correctly aligned. */
  function convertDocument(doc, state) {
    var walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT, null, false);
    var changed = 0;
    var node;
    while ((node = walker.nextNode())) {
      for (var el = node.parentNode; el && el.nodeType === 1; el = el.parentNode) {
        if (App.convert.SKIP_TAGS[el.localName]) { node = null; break; }
      }
      if (!node) continue;
      var out = convertText(node.nodeValue, state);
      if (out !== node.nodeValue) { node.nodeValue = out; changed++; }
    }
    return changed;
  }

  App.punct = {
    createState: createState,
    convertText: convertText,
    convertDocument: convertDocument
  };
})(window.App = window.App || {});
