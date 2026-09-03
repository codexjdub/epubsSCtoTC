/* Every user-visible label in one table, in both languages.
 *
 * Each entry is [中文, English]. One line, both columns visible side by side,
 * so a translation that drifts from its original is a diff you can read rather
 * than two files to hold in your head. The build audit refuses an entry that is
 * missing its second column.
 *
 * The language follows the READER, never the book. No reading app relabels its
 * interface because you opened a different title, and switching books from the
 * shelf would do exactly that. Typeface selection is the opposite case and
 * correctly follows the book: see reader/fonts.js.
 *
 * Chinese is the default, and NOT navigator.language. Everyone who opens this
 * app is converting a Chinese book in order to read it in Chinese; a reader
 * abroad on an English-language browser is the ordinary case here, not the
 * exception, and greeting them in English would be the wrong guess.
 *
 * Markup carries data-i18n / data-i18n-title and is filled by apply(). Code
 * asks for text through get(), which interpolates {placeholders}. Changing the
 * locale means re-running both, plus every option list built in JS -- see
 * relabel() in ui/app.js, which is the one place that knows the whole set.
 */
(function (App) {
  'use strict';

  var ZH = 0, EN = 1;

  var TEXT = {
    /* ---- the app ---- */
    'app.tagline': ['簡體中文 EPUB 轉繁體，就在這裡讀',
                    'Simplified to Traditional EPUB'],

    /* ---- the landing page ---- */
    'landing.blurb': ['把簡體中文的 EPUB 轉成繁體，直接在這裡閱讀。書不會離開這個瀏覽器，什麼都不會上傳。',
                      'Convert a simplified Chinese EPUB to traditional and read it right here. ' +
                      'Your book never leaves this browser — nothing is uploaded.'],
    'landing.drop': ['把 EPUB 拖到這裡', 'Drop an EPUB here'],
    'landing.pick': ['或點一下選擇檔案', 'or click to choose a file'],
    'landing.convertTo': ['轉換為', 'Convert to'],
    'landing.theme': ['主題', 'Theme'],
    'landing.books': ['你的書', 'Your books'],

    /* ---- the bar ---- */
    'bar.shelf': ['書架', 'Shelf'],
    'bar.shelf.title': ['已存的書', 'Books saved on this device'],
    'bar.toc': ['目錄', 'Contents'],
    'bar.aa.title': ['閱讀設定', 'Reading settings'],
    'bar.convert': ['轉換', 'Convert'],
    'bar.convert.title': ['轉換設定', 'Conversion settings'],
    /* The bar's button opens the export options; the one inside them does it.
       The format is chosen there, so the bar's label no longer names it. */
    'bar.export': ['匯出', 'Export'],
    'bar.export.title': ['匯出檔案', 'Export a file'],
    'panel.export.run': ['匯出 {format}', 'Export {format}'],
    'panel.format.title': ['匯出格式', 'Export format'],
    'format.epub': ['EPUB', 'EPUB'],
    'format.html': ['HTML', 'HTML'],
    'format.md': ['Markdown', 'Markdown'],
    /* A format name, like the others: '匯出 {format}' puts a space before it,
       which reads wrongly between two Chinese words. */
    'format.txt': ['TXT', 'TXT'],

    /* ---- reading settings ---- */
    'panel.typeface.title': ['字體', 'Typeface'],
    'panel.leading': ['行距', 'Leading'],
    'panel.measure': ['行寬', 'Width'],
    'panel.align.title': ['對齊方式', 'Alignment'],
    /* Deliberately inverted: the button names the language you would GET, so
       each column holds the OTHER language. A bilingual site shows you the way
       out, not the room you are standing in. */
    'panel.lang': ['English', '中文'],
    'panel.lang.title': ['切換成英文介面', 'Switch the interface to Chinese'],
    'panel.focus': ['專注閱讀', 'Focus'],
    'panel.focus.title': ['只留下正文，按 Esc 離開',
                          'The reading column and nothing else. Esc to leave.'],
    'panel.paged': ['翻頁', 'Pagination'],
    'panel.paged.title': ['一頁一頁翻，不用捲動', 'Turn pages instead of scrolling'],
    'panel.vim.title': ['Vim 鍵盤操作（按 ? 看說明）',
                        'Vim keys (press ? for the list)'],
    'align.default': ['對齊：預設', 'Align: publisher'],
    'align.left': ['對齊：靠左', 'Align: left'],
    'align.justify': ['對齊：兩端', 'Align: justified'],

    /* ---- conversion settings ---- */
    'panel.punct': ['匯出時轉為「 」', 'Use 「 」 quotes on export'],
    'panel.marks.show': ['顯示標記', 'Show marks'],
    'panel.marks.hide': ['隱藏標記', 'Hide marks'],
    'panel.report': ['轉換報告', 'Conversion report'],
    'report.title': ['轉換報告', 'Conversion report'],
    'reader.source.original': ['原文', 'Original'],
    'reader.source.converted': ['轉換後', 'Converted'],
    'reader.banner': ['正在顯示未轉換的原文，標記與更正暫時隱藏。',
                      'Showing the unconverted original. Marks and corrections are hidden.'],
    'sidebar.toc': ['目錄', 'Contents'],
    'toc.empty': ['這本書沒有目錄。', 'This book has no table of contents.'],

    /* ---- the shelf ---- */
    'shelf.open': ['開啟新書…', 'Open a book…'],
    'shelf.drag': ['也可以把 EPUB 拖進視窗', 'You can also drop an EPUB on the window'],
    'shelf.count': ['這部裝置存了 {n} 本書。', '{n} books saved on this device.'],
    'shelf.count.one': ['這部裝置存了 1 本書。', '1 book saved on this device.'],
    'shelf.empty': ['還沒有存書。開過的書會留在這裡。',
                    'No books yet. The ones you open are kept here.'],
    'shelf.remove': ['從這部裝置移除', 'Remove from this device'],

    /* ---- the pager ---- */
    'pager.back': ['↩ 返回', '↩ Back'],
    'pager.prev': ['← 上一章', '← Previous'],
    'pager.next': ['下一章 →', 'Next →'],
    /* Pages are a setting of their own, so the same two buttons turn pages
       wherever it is on -- in focus mode or out of it. */
    'pager.prevPage': ['← 上一頁', '← Page back'],
    'pager.nextPage': ['下一頁 →', 'Page forward →'],

    /* ---- what the app is doing ---- */
    'status.opening': ['開啟《{title}》…', 'Opening {title}…'],
    'status.exporting': ['正在匯出…', 'Exporting…'],
    'status.exporting.pct': ['正在匯出… {pct}%', 'Exporting… {pct}%'],
    'status.exported': ['已匯出 {name}', 'Exported {name}'],
    'status.exported.corrections': ['，含 {n} 處手動更正', ', with {n} manual corrections'],
    'status.exported.corrections.one': ['，含 1 處手動更正', ', with 1 manual correction'],
    'status.exported.fonts': ['，移除 {n} 個內嵌字型', ', {n} embedded fonts removed'],
    'status.exported.fonts.one': ['，移除 1 個內嵌字型', ', 1 embedded font removed'],
    'status.external': ['未開啟外部連結：{href}', 'External link not opened: {href}'],
    'status.missing': ['這個項目不在閱讀順序內（{path}）。',
                       'That item is not in the reading order ({path}).'],
    'error.export': ['匯出失敗：{message}', 'Export failed: {message}'],
    'error.open': ['無法開啟：{message}', 'Could not open: {message}'],

    /* ---- themes ---- */
    'theme.system': ['系統', 'System'],
    'theme.light': ['明亮', 'Light'],
    'theme.sepia': ['米黃', 'Sepia'],
    'theme.green': ['青綠', 'Green'],
    'theme.slate': ['石板', 'Slate'],
    'theme.grey': ['淺灰', 'Grey'],
    'theme.dark': ['暗色', 'Dark'],

    /* ---- conversion targets ---- */
    'preset.hk': ['香港', 'Hong Kong'],
    'preset.hk.note': ['香港字形，詞彙照原文。',
                       'Hong Kong character forms; vocabulary left as written.'],
    'preset.hkp': ['香港（含詞彙）', 'Hong Kong (with vocabulary)'],
    'preset.hkp.note': ['連大陸詞彙一併轉換，小說讀來可能生硬。',
                        'Also converts mainland vocabulary, which can read stiffly in fiction.'],
    'preset.tw': ['臺灣', 'Taiwan'],
    'preset.tw.note': ['臺灣字形（裡、著），詞彙照原文。',
                       'Taiwan character forms (裡, 著); vocabulary left as written.'],
    'preset.twp': ['臺灣（含詞彙）', 'Taiwan (with vocabulary)'],
    'preset.twp.note': ['軟體、網路、滑鼠。適合技術類書籍。',
                        '軟體, 網路, 滑鼠. Suited to technical books.'],
    'preset.t': ['繁體', 'Traditional'],
    'preset.t.note': ['只轉字形，不分地區用法。',
                      'Character forms only, with no regional usage.'],

    /* ---- typefaces, Han ---- */
    'font.serif': ['明體', '明體 Ming'],
    'font.serif.note': ['襯線體，長篇閱讀的慣用字體。',
                        'Serif. The conventional face for long-form reading.'],
    'font.sans': ['黑體', '黑體 Hei'],
    'font.sans.note': ['無襯線，低解析度螢幕上較清楚。',
                       'Sans-serif. Clearer on lower-resolution screens.'],
    'font.kai': ['楷書', '楷書 Kai'],
    'font.kai.note': ['毛筆字形，課本與詩詞常用。',
                      'Brush forms. Common in textbooks and poetry.'],
    'font.yuan': ['圓體', '圓體 Yuan'],
    'font.yuan.note': ['圓潤的無襯線，比黑體柔和。',
                       'Rounded sans-serif, softer than 黑體.'],
    'font.fangsong': ['仿宋', '仿宋 Fangsong'],
    'font.fangsong.note': ['較細的宋體，引文與公文常用。',
                           'A lighter Song face, used for quotations and documents.'],

    /* ---- typefaces, Latin ---- */
    'latin.serif': ['Serif', 'Serif'],
    'latin.serif.note': ['襯線體，長篇閱讀的慣用字體。',
                         'Old-style serif. The conventional face for long-form reading.'],
    'latin.sans': ['Sans', 'Sans'],
    'latin.sans.note': ['無襯線，低解析度螢幕上較清楚。',
                        'Sans-serif. Cleaner on lower-resolution screens.'],
    'latin.classic': ['Classic', 'Classic'],
    'latin.classic.note': ['對比較強，也窄了約一成，像 Baskerville 那一類。',
                           'Higher contrast and about a tenth narrower — Baskerville and its kin.'],
    'latin.legible': ['Legible', 'Legible'],
    'latin.legible.note': ['寬鬆開闊，字小或眼睛累時最好讀。',
                           'Wide and open. The easiest at small sizes or with tired eyes.'],

    /* ---- the vim help overlay ---- */
    'keys.title': ['Vim 鍵盤操作', 'Vim navigation'],
    'keys.close': ['按 ? 或 Esc 關閉。', 'Press ? or Esc to close.'],
    'keys.scrollFwd': ['往下捲動', 'Scroll forward'],
    'keys.scrollBack': ['往上捲動', 'Scroll back'],
    'keys.halfFwd': ['往下半頁', 'Half page forward'],
    'keys.halfBack': ['往上半頁', 'Half page back'],
    'keys.pageFwd': ['往下一頁', 'Page forward'],
    'keys.pageBack': ['往上一頁', 'Page back'],
    'keys.chapterStart': ['本章開頭', 'Start of chapter'],
    'keys.chapterEnd': ['本章結尾', 'End of chapter'],
    'keys.nextChapter': ['下一章', 'Next chapter'],
    'keys.prevChapter': ['上一章', 'Previous chapter'],
    'keys.toc': ['開關目錄', 'Toggle table of contents'],
    'keys.source': ['原文／轉換後', 'Toggle original / converted'],
    'keys.marks': ['開關轉換標記', 'Toggle ambiguity marks'],
    'keys.fontSize': ['字級大小', 'Font size'],
    'keys.focus': ['專注閱讀（桌機）', 'Focus mode (desktop)'],
    'keys.help': ['這份說明', 'This help'],
    'keys.closeHelp': ['關閉說明', 'Close help'],
    'keys.counts': ['數字可重複：做三次', 'Counts work: repeat 3 times']
  };

  /* Stored rather than derived every time, so a reader who has chosen once is
   * not overruled by a browser setting they did not change. */
  var LOCALE_KEY = 'epub-tc:lang';

  function detect() {
    try {
      var stored = window.localStorage.getItem(LOCALE_KEY);
      if (stored === 'zh' || stored === 'en') return stored;
    } catch (e) { /* unavailable at file:// in some browsers */ }
    return 'zh';
  }

  var locale = detect();

  function markDocument() {
    if (document.documentElement) {
      document.documentElement.setAttribute('lang', locale === 'zh' ? 'zh-Hant' : 'en');
    }
  }

  function setLocale(next) {
    locale = next === 'zh' ? 'zh' : 'en';
    try { window.localStorage.setItem(LOCALE_KEY, locale); } catch (e) { /* ignore */ }
    markDocument();
    return locale;
  }

  function current() { return locale; }

  /* A missing key returns the key itself: visible in the interface, harmless
   * in use, and obvious in a test. An entry with no second column falls back to
   * the first, so an untranslated label reads as Chinese rather than as a key.
   * The audit stops one shipping either way. */
  function get(key, vars) {
    /* English has a singular and Chinese has not, and exactly three strings
       here take a count. A key may carry a '.one' variant, used when {n} is 1 --
       three special cases being rather less machinery than plural rules, and
       visible in the table where a translator would look for them. */
    if (vars && Number(vars.n) === 1 && TEXT[key + '.one']) key = key + '.one';
    var entry = TEXT[key];
    if (entry === undefined) return key;
    var value = locale === 'en' && entry[EN] !== undefined ? entry[EN] : entry[ZH];
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

  App.strings = { get: get, apply: apply, TEXT: TEXT,
                  setLocale: setLocale, locale: current, detect: detect,
                  markDocument: markDocument };
})(window.App = window.App || {});
