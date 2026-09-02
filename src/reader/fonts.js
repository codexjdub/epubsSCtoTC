/* Reading fonts.
 *
 * System fonts only. A CJK webfont carries 20,000+ glyphs -- Noto Serif CJK is
 * ~16MB per weight, a few MB even subset -- which would wreck the
 * single-file design and reintroduce a network dependency the page is built
 * to avoid.
 *
 * There is deliberately no availability detection. It cannot be done reliably
 * for CJK: document.fonts.check() returns true for any family name at all, and
 * width measurement cannot discriminate because CJK glyphs are uniformly
 * full-width across virtually every CJK face. So each choice is an ordered
 * stack and the browser silently uses the first family that is installed.
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

  var GENERIC = { serif: 'serif', sans: 'sans-serif', kai: 'serif' };
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
    }
  };

  /* Latin faces for books that are not Chinese. The reader forces a font
   * because converted text needs glyphs the book's embedded subset lacks --
   * that argument does not apply to a book nothing was converted in, and
   * rendering English through a CJK face gives it that face's cramped,
   * incidental Latin glyphs. */
  var LATIN = {
    serif: ['Iowan Old Style', 'Palatino Linotype', 'Palatino', 'Georgia', 'Charter'],
    sans: ['Helvetica Neue', 'Inter', 'Segoe UI', 'Arial'],
    kai: ['Iowan Old Style', 'Palatino Linotype', 'Palatino', 'Georgia', 'Charter']
  };

  /* Books this converter did not touch. An empty or missing language is
   * treated as Chinese: that is what this app is for. */
  function isHan(language) {
    var v = String(language || 'zh').toLowerCase();
    return v.indexOf('zh') === 0 || v.indexOf('cmn') === 0 || v.indexOf('yue') === 0;
  }

  var STYLES = [
    { id: 'serif', label: '明體', latin: 'Serif',
      note: 'Serif. The conventional face for long-form reading.' },
    { id: 'sans',  label: '黑體', latin: 'Sans',
      note: 'Sans-serif. Cleaner on lower-resolution screens.' },
    /* No latin label: 楷書 is a brush style with no Latin counterpart, and
     * offering it for an English book meant two of three choices rendered
     * identically. */
    { id: 'kai',   label: '楷書', latin: '',
      note: 'Brush style, as used in textbooks and poetry.' }
  ];

  /* The choices worth offering for this book, named in terms that mean
   * something for the script it is written in. */
  function stylesFor(language) {
    if (isHan(language)) return STYLES;
    return STYLES.filter(function (st) { return st.latin; })
      .map(function (st) { return { id: st.id, label: st.latin, note: st.note }; });
  }

  /* Which option should appear selected: a stored 楷書 has no entry in a Latin
   * list, and it renders as the serif stack there anyway. */
  function effectiveStyle(styleId, language) {
    if (isHan(language)) return isValidStyle(styleId) ? styleId : DEFAULT;
    return styleId === 'kai' ? 'serif' : (isValidStyle(styleId) ? styleId : DEFAULT);
  }

  /* Which glyph region a conversion preset implies. */
  function regionFor(presetId) {
    if (presetId === 'tw' || presetId === 'twp') return 'tw';
    if (presetId === 'hk' || presetId === 'hkp') return 'hk';
    return 'tw';   // plain traditional: Taiwan shapes are the common default
  }

  function isValidStyle(id) {
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return true;
    return false;
  }

  function stackFor(styleId, presetId, language) {
    var style = isValidStyle(styleId) ? styleId : DEFAULT;
    var families = isHan(language)
      ? (STACKS[style][regionFor(presetId)] || STACKS[style].tw)
      : LATIN[style];
    return families.map(function (f) { return '"' + f + '"'; })
      .concat([GENERIC[style]]).join(', ');
  }

  App.fonts = App.fonts || {};
  App.readingFonts = {
    STYLES: STYLES,
    STACKS: STACKS,
    stylesFor: stylesFor,
    effectiveStyle: effectiveStyle,
    LATIN: LATIN,
    isHan: isHan,
    DEFAULT: DEFAULT,
    stackFor: stackFor,
    regionFor: regionFor,
    isValidStyle: isValidStyle
  };
})(window.App = window.App || {});
