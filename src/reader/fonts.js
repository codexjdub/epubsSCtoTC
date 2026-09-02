/* Reading fonts.
 *
 * System fonts only. A CJK webfont carries 20,000+ glyphs -- Noto Serif CJK is
 * ~16MB per weight, a few MB even subset -- which would wreck the
 * single-file design and reintroduce a network dependency the page is built
 * to avoid.
 *
 * Each choice is an ordered stack and the browser silently uses the first
 * family that is installed.
 *
 * Availability IS detectable, contrary to what this comment used to claim.
 * document.fonts.check() does return true for any family name at all, and
 * width measurement genuinely cannot discriminate CJK, because every glyph is
 * one em wide across virtually every CJK face. Both of those are true and
 * neither rules out the third method: draw a glyph to a canvas and hash the
 * pixels. A family that is not installed renders as the default face, byte for
 * byte, so a stack that resolves to nothing is recognisable. That matters --
 * Apple moved Kaiti, Yuanti and Fangsong to on-demand download, so 楷書 was
 * offered on machines where it silently rendered as the generic fallback.
 *
 * The stacks are ordered by REGION as well as style. Taiwan and Hong Kong
 * standards draw the same codepoints with different glyph shapes (骨, 直, 者
 * among others), so text converted to Hong Kong forms should be rendered by a
 * Hong Kong font where one exists -- otherwise the page shows Taiwan glyph
 * shapes on Hong Kong text, undoing in the rendering what the conversion just
 * did.
 */
(function (App) {
  'use strict';

  var GENERIC = { serif: 'serif', sans: 'sans-serif', kai: 'serif',
                  yuan: 'sans-serif', fangsong: 'serif' };
  var DEFAULT = 'sans';

  /* Per style, per region, most-preferred first. Windows, macOS and Noto
   * names are interleaved rather than grouped: what matters is glyph region,
   * not which OS happens to supply the face. */
  var STACKS = {
    serif: {
      hk: ['Noto Serif CJK HK', 'Source Han Serif HC', 'MingLiU_HKSCS',
           'Songti TC', 'PMingLiU', 'Songti SC'],
      tw: ['Songti TC', 'PMingLiU', 'MingLiU', 'Noto Serif CJK TC',
           'Source Han Serif TC', 'LiSong Pro'],
      cn: ['Songti SC', 'SimSun', 'Noto Serif CJK SC', 'Source Han Serif SC']
    },
    sans: {
      hk: ['PingFang HK', 'Noto Sans CJK HK', 'Source Han Sans HC',
           'Microsoft JhengHei', 'Hiragino Sans CNS', 'Heiti TC'],
      tw: ['PingFang TC', 'Microsoft JhengHei', 'Noto Sans CJK TC',
           'Source Han Sans TC', 'Hiragino Sans CNS', 'Heiti TC'],
      cn: ['PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC',
           'Hiragino Sans GB', 'STHeiti', 'SimHei']
    },
    /* 楷書 has no regional cuts worth distinguishing; DFKai-SB is the standard
     * Taiwan textbook face and the most widely installed on Windows. */
    kai: {
      hk: ['Kaiti TC', 'DFKai-SB', 'BiauKai', 'Kaiti SC', 'KaiTi'],
      tw: ['Kaiti TC', 'DFKai-SB', 'BiauKai', 'Kaiti SC', 'KaiTi'],
      cn: ['Kaiti SC', 'KaiTi', 'Kaiti TC', 'DFKai-SB']
    },
    /* 圓體: a rounded sans, softer than 黑體. Common on Apple platforms,
     * scarce elsewhere, which is what the availability check is for. */
    yuan: {
      hk: ['Yuanti TC', 'Yuanti SC', 'YouYuan'],
      tw: ['Yuanti TC', 'Yuanti SC', 'YouYuan'],
      cn: ['Yuanti SC', 'YouYuan', 'Yuanti TC']
    },
    /* 仿宋: a lighter Song with calligraphic movement, conventional for
     * official documents and quoted passages. Windows ships FangSong. */
    fangsong: {
      hk: ['STFangsong', 'FangSong', 'FangSong_GB2312'],
      tw: ['STFangsong', 'FangSong', 'FangSong_GB2312'],
      cn: ['STFangsong', 'FangSong', 'FangSong_GB2312']
    }
  };

  /* Latin faces for books that are not Chinese. The reader forces a font
   * because converted text needs glyphs the book's embedded subset lacks --
   * that argument does not apply to a book nothing was converted in, and
   * rendering English through a CJK face gives it that face's cramped,
   * incidental Latin glyphs. */
  /* Four faces that are genuinely distinct, each listing the macOS and Windows
   * members so a stack resolves on either. Measured at 48px, the widths of
   * "Handgloves mixed 0123" separate them: the old-style group sits around
   * 507-515, Baskerville and Times near 466-469, Verdana out at 581. */
  var LATIN = {
    serif:   ['Iowan Old Style', 'Palatino Linotype', 'Palatino', 'Georgia', 'Charter'],
    sans:    ['Helvetica Neue', 'Inter', 'Segoe UI', 'Arial'],
    classic: ['Baskerville', 'Constantia', 'Cambria', 'Times New Roman'],
    legible: ['Verdana', 'Tahoma', 'DejaVu Sans', 'Geneva']
  };

  var LATIN_GENERIC = { serif: 'serif', sans: 'sans-serif',
                        classic: 'serif', legible: 'sans-serif' };

  var LATIN_STYLES = [
    { id: 'serif',   key: 'latin.serif' },
    { id: 'sans',    key: 'latin.sans' },
    { id: 'classic', key: 'latin.classic' },
    { id: 'legible', key: 'latin.legible' }
  ];

  /* Books this converter did not touch. An empty or missing language is
   * treated as Chinese: that is what this app is for. */
  function isHan(language) {
    var v = String(language || 'zh').toLowerCase();
    return v.indexOf('zh') === 0 || v.indexOf('cmn') === 0 || v.indexOf('yue') === 0;
  }

  /* Labels live in ui/strings.js. stylesFor() fills in `label` and `note`, so
   * callers still read plain text. */
  var STYLES = [
    { id: 'serif', key: 'font.serif' },
    { id: 'sans',  key: 'font.sans' },
    { id: 'kai',   key: 'font.kai' },
    { id: 'yuan',  key: 'font.yuan' },
    { id: 'fangsong', key: 'font.fangsong' }
  ];

  /* The choices worth offering for this book, named in terms that mean
   * something for the script it is written in. */
  function labelled(style) {
    return {
      id: style.id,
      label: App.strings.get(style.key),
      note: App.strings.get(style.key + '.note')
    };
  }

  function stylesFor(language) {
    return (isHan(language) ? STYLES : LATIN_STYLES).map(labelled);
  }

  /* ---- availability, by rendering ---------------------------------------- */

  var signatures = {};

  /* Hash of the pixels a single glyph paints in this family. Two families that
   * are both absent hash identically, because both render as the default. */
  function signature(fontSpec, sample) {
    var key = fontSpec + '\u0000' + sample;
    if (signatures[key] !== undefined) return signatures[key];
    var value = '';
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 120; canvas.height = 120;
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 120, 120);
      ctx.fillStyle = '#000';
      ctx.font = '96px ' + fontSpec;
      ctx.textBaseline = 'top';
      ctx.fillText(sample, 6, 6);
      var data = ctx.getImageData(0, 0, 120, 120).data;
      var h = 2166136261;
      for (var i = 3; i < data.length; i += 4) { h ^= data[i]; h = Math.imul(h, 16777619); }
      value = (h >>> 0).toString(36);
    } catch (e) { value = ''; }   /* no canvas: treat everything as available */
    signatures[key] = value;
    return value;
  }

  var MISSING = '"__no_such_family__"';

  function familyAvailable(family, sample) {
    var absent = signature(MISSING, sample);
    if (!absent) return true;
    return signature('"' + family + '"', sample) !== absent;
  }

  function stackAvailable(families, sample) {
    for (var i = 0; i < families.length; i++) {
      if (familyAvailable(families[i], sample)) return true;
    }
    return false;
  }

  /* The styles worth offering on THIS machine. A style whose whole stack is
   * missing renders as the generic fallback, so listing it promises something
   * the reader cannot deliver. The default is never dropped -- an empty menu
   * would be worse than an optimistic one. */
  function availableStyles(language, presetId) {
    var han = isHan(language);
    var all = stylesFor(language);
    var sample = han ? '書' : 'Rg';
    var kept = all.filter(function (st) {
      var families = han
        ? (STACKS[st.id][regionFor(presetId)] || STACKS[st.id].tw)
        : LATIN[st.id];
      return st.id === DEFAULT || stackAvailable(families, sample);
    });
    return kept.length ? kept : all;
  }

  /* Which option should appear selected: a stored 楷書 has no entry in a Latin
   * list, and it renders as the serif stack there anyway. */
  function effectiveStyle(styleId, language) {
    return isHan(language) ? hanStyle(styleId) : latinStyle(styleId);
  }

  /* Which glyph region a conversion preset implies. */
  function regionFor(presetId) {
    if (presetId === 'tw' || presetId === 'twp') return 'tw';
    if (presetId === 'hk' || presetId === 'hkp') return 'hk';
    return 'tw';   // plain traditional: Taiwan shapes are the common default
  }

  /* A stored choice is kept whichever script it came from: someone who picks
   * Legible for an English book and then opens a Chinese one should still find
   * Legible waiting when they go back. Each script resolves it to its own
   * nearest equivalent for rendering. */
  function isValidStyle(id) {
    return !!(id && (STACKS[id] || LATIN[id]));
  }

  /* What a choice made in one script becomes in the other. */
  var EQUIVALENT = {
    classic: 'serif', legible: 'sans',
    kai: 'serif', yuan: 'sans', fangsong: 'serif'
  };

  function hanStyle(id) {
    if (STACKS[id]) return id;
    return STACKS[EQUIVALENT[id]] ? EQUIVALENT[id] : DEFAULT;
  }

  function latinStyle(id) {
    if (LATIN[id]) return id;
    return LATIN[EQUIVALENT[id]] ? EQUIVALENT[id] : DEFAULT;
  }

  function stackFor(styleId, presetId, language) {
    var han = isHan(language);
    var style = han ? hanStyle(styleId) : latinStyle(styleId);
    var families = han
      ? (STACKS[style][regionFor(presetId)] || STACKS[style].tw)
      : LATIN[style];
    var generic = han ? GENERIC[style] : LATIN_GENERIC[style];
    return families.map(function (f) { return '"' + f + '"'; })
      .concat([generic]).join(', ');
  }

  /* App.fonts belongs to convert/fonts.js, which owns it outright; this file
   * only ever added an empty object to a namespace it does not use. The two
   * files sharing a basename is the whole reason that line looked necessary. */
  App.readingFonts = {
    STYLES: STYLES,
    STACKS: STACKS,
    stylesFor: stylesFor,
    availableStyles: availableStyles,
    familyAvailable: familyAvailable,
    stackAvailable: stackAvailable,
    effectiveStyle: effectiveStyle,
    LATIN: LATIN,
    LATIN_STYLES: LATIN_STYLES,
    isHan: isHan,
    DEFAULT: DEFAULT,
    stackFor: stackFor,
    regionFor: regionFor,
    isValidStyle: isValidStyle
  };
})(window.App = window.App || {});
