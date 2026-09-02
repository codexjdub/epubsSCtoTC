/* The conversion pass.
 *
 * Converts text nodes only. Tag names, class, id and href are never touched --
 * converting a class name would silently break the book's stylesheet, and
 * converting an href would break its internal links.
 *
 * Annotation records are emitted from the start, even though only the reader
 * (phase 4) consumes them, because addressing them retroactively would mean
 * re-walking every document a second time.
 */
(function (App) {
  'use strict';

  var SKIP_TAGS = { script: 1, style: 1, code: 1, pre: 1, kbd: 1, samp: 1 };

  /* Attributes holding prose a reader will actually see. Everything else --
   * id, class, href, src, epub:type -- is machine-facing and must survive
   * conversion byte-identical. */
  var TEXT_ATTRS = ['alt', 'title', 'aria-label'];

  /* Labels and their tooltips are Chinese: they name the target of a Chinese
   * conversion and are read by someone reading a Chinese book. */
  var PRESETS = [
    { id: 'hk',  label: '香港',        to: 'hk',  lang: 'zh-HK',
      note: '香港字形，詞彙照原文。' },
    { id: 'hkp', label: '香港（含詞彙）', to: 'hkp', lang: 'zh-HK',
      note: '連大陸詞彙一併轉換，小說讀來可能生硬。' },
    { id: 'tw',  label: '臺灣',        to: 'tw',  lang: 'zh-TW',
      note: '臺灣字形（裡、著），詞彙照原文。' },
    { id: 'twp', label: '臺灣（含詞彙）', to: 'twp', lang: 'zh-TW',
      note: '軟體、網路、滑鼠。適合技術類書籍。' },
    { id: 't',   label: '繁體',        to: 't',   lang: 'zh-Hant',
      note: '只轉字形，不分地區用法。' }
  ];

  function presetById(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return PRESETS[0];
  }

  function createConverter(presetId) {
    var preset = presetById(presetId);
    return { preset: preset, convert: OpenCC.Converter({ from: 'cn', to: preset.to }) };
  }

  function shouldSkip(node) {
    for (var el = node.parentNode; el && el.nodeType === 1; el = el.parentNode) {
      if (SKIP_TAGS[el.localName]) return true;
    }
    return false;
  }

  /* Positional alignment between source and output.
   *
   * Where the two are the same length, offset i in the source corresponds to
   * offset i in the output and ambiguous characters can be located exactly.
   * Where they differ -- a phrase rule that changed character count -- there
   * is no honest correspondence, so annotation for that node is skipped
   * rather than guessed. This is checked per node, not assumed per preset.
   */
  function markNode(source, output, table, nodeIndex, into) {
    if (source.length !== output.length) return false;
    for (var i = 0; i < source.length; i++) {
      var ch = source.charAt(i);
      var candidates = table[ch];
      if (!candidates) continue;
      var chosen = output.charAt(i);
      /* The neighbouring SOURCE characters are recorded so a reader override
       * can be scoped to the word it was made in. Keying an override on the
       * bare character would be wrong: choosing 髮 for 发 must not also
       * rewrite 发展 to 髮展. */
      into.push({
        nodeIndex: nodeIndex,
        offset: i,
        source: ch,
        chosen: chosen,
        before: i > 0 ? source.charAt(i - 1) : '',
        after: i + 1 < source.length ? source.charAt(i + 1) : '',
        candidates: candidates.indexOf(chosen) >= 0
          ? candidates
          : [chosen].concat(candidates)
      });
    }
    return true;
  }

  /* Walk one parsed chapter. Returns annotation records addressed by
   * (text-node index, character offset) -- a stable address the reader can
   * resolve by re-walking the same document in the same order, so the
   * exported markup stays free of marker elements. */
  function convertDocument(doc, converter, table) {
    var walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT, null, false);
    var marks = [];
    var nodeIndex = 0;
    var changedNodes = 0;
    var unaligned = 0;
    var node;

    while ((node = walker.nextNode())) {
      var source = node.nodeValue;
      if (!source || !source.trim()) { nodeIndex++; continue; }
      if (shouldSkip(node)) { nodeIndex++; continue; }

      var output = converter.convert(source);
      if (output !== source) {
        node.nodeValue = output;
        changedNodes++;
      }
      if (!markNode(source, output, table, nodeIndex, marks)) unaligned++;
      nodeIndex++;
    }

    var elements = doc.getElementsByTagName('*');
    for (var i = 0; i < elements.length; i++) {
      for (var a = 0; a < TEXT_ATTRS.length; a++) {
        var name = TEXT_ATTRS[a];
        if (!elements[i].hasAttribute(name)) continue;
        var value = elements[i].getAttribute(name);
        var converted = converter.convert(value);
        if (converted !== value) elements[i].setAttribute(name, converted);
      }
    }

    return { marks: marks, changedNodes: changedNodes, unalignedNodes: unaligned, textNodeCount: nodeIndex };
  }

  /* zh-CN / zh-Hans / zh -> the preset's language tag. Region-tagged
   * traditional values are left alone; a book already marked zh-TW that is
   * being converted to Hong Kong forms keeps whatever it declared. */
  function retagLanguage(value, preset) {
    if (!value) return preset.lang;
    var v = value.toLowerCase();
    if (v === 'zh' || v.indexOf('zh-cn') === 0 || v.indexOf('zh-hans') === 0 ||
        v.indexOf('zh-sg') === 0 || v.indexOf('zh-chs') === 0) {
      return preset.lang;
    }
    return value;
  }

  /* Context key for a reader override: the ambiguous character plus its
   * immediate source neighbours. Overrides apply to recurrences of the same
   * short context, not to every instance of the character. */
  function contextKey(mark) {
    return mark.before + '|' + mark.source + '|' + mark.after;
  }

  App.convert = App.convert || {};
  App.convert.PRESETS = PRESETS;
  App.convert.presetById = presetById;
  App.convert.createConverter = createConverter;
  App.convert.convertDocument = convertDocument;
  App.convert.retagLanguage = retagLanguage;
  App.convert.contextKey = contextKey;
  App.convert.SKIP_TAGS = SKIP_TAGS;
  App.convert.TEXT_ATTRS = TEXT_ATTRS;
})(window.App = window.App || {});
