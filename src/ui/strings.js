/* Every user-visible label in one table.
 *
 * The reader's controls are Chinese and its prose is English, which is a rule
 * about the audience rather than about any one file -- so the strings live
 * together where that rule can be seen, instead of scattered across markup,
 * option lists and status calls.
 *
 * There is one language here on purpose. Adding a second means adding a column
 * and a lookup that reads it: the point of this table is that the work is
 * bounded and visible, not that it has already been done. When it is done, the
 * language should follow the READER -- a locale setting, defaulting to
 * navigator.language -- and never the book. No reading app relabels its
 * interface because you opened a different title, and switching books from the
 * shelf would do exactly that. Typeface selection is the opposite case and
 * correctly follows the book: see reader/fonts.js.
 *
 * Markup carries data-i18n / data-i18n-title and is filled by apply(). Code
 * asks for text through get(), which interpolates {placeholders}.
 */
(function (App) {
  'use strict';

  var TEXT = {
    /* ---- the bar ---- */
    'bar.shelf': '書架',
    'bar.shelf.title': '已存的書',
    'bar.toc': '目錄',
    'bar.aa.title': '閱讀設定',
    'bar.convert': '轉換',
    'bar.convert.title': '轉換設定',
    'bar.export': '匯出 EPUB',
    'bar.export.format': '匯出 {format}',
    'bar.export.short': '匯出',
    'panel.format.title': '匯出格式',
    'format.epub': 'EPUB',
    'format.html': 'HTML',
    'format.md': 'Markdown',
    /* A format name, like the others: '匯出 {format}' puts a space before it,
       which reads wrongly between two Chinese words. */
    'format.txt': 'TXT',

    /* ---- reading settings ---- */
    'panel.typeface.title': '字體',
    'panel.leading': '行距',
    'panel.align.title': '對齊方式',
    'panel.vim.title': 'Vim 鍵盤操作（按 ? 看說明）',
    'align.default': '對齊：預設',
    'align.left': '對齊：靠左',
    'align.justify': '對齊：兩端',

    /* ---- conversion settings ---- */
    'panel.punct': '匯出時轉為「 」',
    'panel.marks.show': '顯示標記',
    'panel.marks.hide': '隱藏標記',
    'panel.report': '轉換報告',
    'reader.source.original': '原文',
    'reader.source.converted': '轉換後',
    'reader.banner': '正在顯示未轉換的原文，標記與更正暫時隱藏。',

    /* ---- the shelf ---- */
    'shelf.open': '開啟新書…',
    'shelf.drag': '也可以把 EPUB 拖進視窗',
    'shelf.count': '這部裝置存了 {n} 本書。',
    'shelf.empty': '還沒有存書。開過的書會留在這裡。',

    /* ---- the pager ---- */
    'pager.back': '↩ 返回',
    'pager.prev': '← 上一章',
    'pager.next': '下一章 →',

    /* ---- what the app is doing ---- */
    'status.opening': '開啟《{title}》…',
    'status.exporting': '正在匯出…',
    'status.exporting.pct': '正在匯出… {pct}%',
    'status.exported': '已匯出 {name}',
    'status.exported.corrections': '，含 {n} 處手動更正',
    'status.exported.fonts': '，移除 {n} 個內嵌字型',
    'status.external': '未開啟外部連結：{href}',
    'status.missing': '這個項目不在閱讀順序內（{path}）。',
    'error.export': '匯出失敗：{message}',
    'error.open': '無法開啟：{message}',

    /* ---- themes ---- */
    'theme.system': '系統',
    'theme.light': '明亮',
    'theme.sepia': '米黃',
    'theme.green': '青綠',
    'theme.slate': '石板',
    'theme.grey': '淺灰',
    'theme.dark': '暗色',

    /* ---- conversion targets ---- */
    'preset.hk': '香港',
    'preset.hk.note': '香港字形，詞彙照原文。',
    'preset.hkp': '香港（含詞彙）',
    'preset.hkp.note': '連大陸詞彙一併轉換，小說讀來可能生硬。',
    'preset.tw': '臺灣',
    'preset.tw.note': '臺灣字形（裡、著），詞彙照原文。',
    'preset.twp': '臺灣（含詞彙）',
    'preset.twp.note': '軟體、網路、滑鼠。適合技術類書籍。',
    'preset.t': '繁體',
    'preset.t.note': '只轉字形，不分地區用法。',

    /* ---- typefaces, Han ---- */
    'font.serif': '明體',
    'font.serif.note': '襯線體，長篇閱讀的慣用字體。',
    'font.sans': '黑體',
    'font.sans.note': '無襯線，低解析度螢幕上較清楚。',
    'font.kai': '楷書',
    'font.kai.note': '毛筆字形，課本與詩詞常用。',
    'font.yuan': '圓體',
    'font.yuan.note': '圓潤的無襯線，比黑體柔和。',
    'font.fangsong': '仿宋',
    'font.fangsong.note': '較細的宋體，引文與公文常用。',

    /* ---- typefaces, Latin ---- */
    'latin.serif': 'Serif',
    'latin.serif.note': 'Old-style serif. The conventional face for long-form reading.',
    'latin.sans': 'Sans',
    'latin.sans.note': 'Sans-serif. Cleaner on lower-resolution screens.',
    'latin.classic': 'Classic',
    'latin.classic.note': 'Higher contrast and about a tenth narrower — Baskerville and its kin.',
    'latin.legible': 'Legible',
    'latin.legible.note': 'Wide and open. The easiest at small sizes or with tired eyes.'
  };

  /* A missing key returns the key itself: visible in the interface, harmless
   * in use, and obvious in a test. */
  function get(key, vars) {
    var value = TEXT[key];
    if (value === undefined) return key;
    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, function (whole, name) {
      return vars[name] !== undefined ? vars[name] : whole;
    });
  }

  function apply(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = get(nodes[i].getAttribute('data-i18n'));
    }
    var titled = scope.querySelectorAll('[data-i18n-title]');
    for (var j = 0; j < titled.length; j++) {
      titled[j].setAttribute('title', get(titled[j].getAttribute('data-i18n-title')));
    }
  }

  App.strings = { get: get, apply: apply, TEXT: TEXT };
})(window.App = window.App || {});
