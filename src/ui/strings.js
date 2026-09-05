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
    /* Not "Leading". That is the right typographic word and the wrong label:
       it is trade jargon, it reads as the ordinary word for "foremost", and it
       pairs plain Chinese with English a reader has to already know. 行距 and
       行寬 are parallel and everyday; so are these two. */
    'panel.leading': ['行距', 'Line spacing'],
    'panel.measure': ['行寬', 'Line width'],
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
    /* A mode, named like the two beside it -- "Vim" alone names a program. The
       label no longer changes when it is on: the button already shows that with
       its pressed state, the tooltip already says which key opens the list, and
       turning it on opens the list anyway. */
    'panel.vim': ['Vim 模式', 'Vim mode'],
    'panel.vim.title': ['Vim 鍵盤操作（按 ? 看說明）',
                        'Vim keys (press ? for the list)'],
    /* Not "default": what this leaves alone is whatever the PUBLISHER set, and
       both languages should say so. The Chinese read 預設 while the English read
       publisher, which are two different claims about the same option. */
    'align.default': ['對齊：出版方', 'Align: publisher'],
    'align.left': ['對齊：靠左', 'Align: left'],
    'align.justify': ['對齊：兩端', 'Align: justified'],

    /* ---- conversion settings ---- */
    'panel.punct': ['匯出時轉為「 」', 'Use 「 」 quotes on export'],
    'panel.marks.show': ['顯示標記', 'Show marks'],
    'panel.marks.hide': ['隱藏標記', 'Hide marks'],
    'panel.report': ['轉換報告', 'Conversion report'],
    'bar.bookmark': ['書籤', 'Bookmark'],
    'bar.bookmark.title': ['把讀到的地方記下來', 'Keep this spot'],
    'bar.bookmark.remove.title': ['移除這裡的書籤', 'Remove the bookmark here'],
    'sidebar.bookmarks': ['書籤', 'Bookmarks'],
    'bookmark.added': ['已加入書籤', 'Bookmark added'],
    'bookmark.removed': ['已移除書籤', 'Bookmark removed'],
    'bookmark.empty': ['還沒有書籤。讀到想記住的地方，按上面的「書籤」。',
                       'No bookmarks yet. Press Bookmark to keep the spot you are reading.'],
    'bookmark.removeNamed': ['移除書籤：{label}', 'Remove bookmark: {label}'],
    /* A bookmark on a block with no text of its own -- a picture, or a page
       break. Rare, but a blank row in the list is unreadable. */
    'bookmark.unlabelled': ['（沒有文字）', '(no text)'],
    'report.title': ['轉換報告', 'Conversion report'],
    'report.target': ['轉換目標', 'Target'],
    'report.documents': ['已轉換文件', 'Documents converted'],
    'report.nodes': ['變更的文字節點', 'Text nodes changed'],
    'report.marks': ['標記的一簡多繁字', 'Ambiguous characters marked'],
    'report.unmarked': ['未標記的節點', 'Nodes left unmarked'],
    'report.unmarked.why': ['{n}（長度已改變）', '{n} (length changed)'],
    'report.marks.note': ['虛線底線標示有多個繁體寫法的字。點一下可循環選用其他寫法' +
                          '——同一詞語中的每一處都會跟著改，匯出時也會保留。',
                          'Dotted underlines mark characters with more than one traditional ' +
                          'form. Click one to cycle through the alternatives — the choice ' +
                          'applies to every occurrence in the same wording, and is carried ' +
                          'into the exported file.'],
    'report.font.unreadable': ['無法讀取內嵌字型 {path}（{error}），匯出時會移除。',
                               'Embedded font {path} could not be read ({error}); ' +
                               'it will be dropped on export.'],
    'report.font.partial': ['內嵌字型「{family}」只涵蓋轉換後文字的 {pct}%{sample}，' +
                            '匯出時會移除，以免文字無法顯示。',
                            'Embedded font “{family}” covers only {pct}% of the converted ' +
                            'text{sample}. It will be dropped on export so the text stays readable.'],
    'report.font.sample': ['（例如缺少 {chars}）', ' (missing e.g. {chars})'],
    'report.font.ok': ['內嵌字型「{family}」涵蓋轉換後的文字。',
                       'Embedded font “{family}” covers the converted text.'],
    'report.font.obfuscated': ['有 {n} 個內嵌字型經過混淆處理，已先解碼再檢查涵蓋範圍。',
                               '{n} embedded fonts are obfuscated; they were decoded before ' +
                               'checking coverage.'],
    'report.font.obfuscated.one': ['有 1 個內嵌字型經過混淆處理，已先解碼再檢查涵蓋範圍。',
                                   '1 embedded font is obfuscated; it was decoded before ' +
                                   'checking coverage.'],
    'report.images': ['書中有 {n} 張圖片。畫在圖片裡的文字無法轉換，仍會是簡體。',
                      '{n} images in this book. Any text drawn inside an image cannot be ' +
                      'converted and will still read as simplified.'],
    'report.images.one': ['書中有 1 張圖片。畫在圖片裡的文字無法轉換，仍會是簡體。',
                          '1 image in this book. Any text drawn inside an image cannot be ' +
                          'converted and will still read as simplified.'],
    'reader.source.original': ['原文', 'Original'],
    'reader.source.converted': ['轉換後', 'Converted'],
    'reader.banner': ['正在顯示未轉換的原文，標記與更正暫時隱藏。',
                      'Showing the unconverted original. Marks and corrections are hidden.'],
    'sidebar.toc': ['目錄', 'Contents'],
    'toc.empty': ['這本書沒有目錄。', 'This book has no table of contents.'],

    /* ---- the shelf ---- */
    'shelf.open': ['開啟新書…', 'Open a book…'],
    'shelf.drag': ['也可以把 EPUB 拖進視窗', 'You can also drop an EPUB anywhere on this page'],
    'shelf.count': ['這部裝置存了 {n} 本書。', '{n} books saved on this device.'],
    'shelf.count.one': ['這部裝置存了 1 本書。', '1 book saved on this device.'],
    'shelf.empty': ['還沒有存書。開過的書會留在這裡。',
                    'No books yet. The ones you open are kept here.'],
    'shelf.remove': ['從這部裝置移除', 'Remove from this device'],
    /* Named, because the tooltip is not read aloud and "remove" on its own
       gives a screen reader no way to tell one row's button from another's. */
    'shelf.removeNamed': ['移除《{title}》', 'Remove {title}'],
    'shelf.reading': ['閱讀中', 'reading now'],
    'shelf.untitled': ['（未命名）', '(untitled)'],
    /* The landing page's own note. Longer than the shelf's because there is
       room for it there, and because it is the first thing a new reader sees. */
    'library.count': ['這部裝置存了 {n} 本書{size}。書不會離開這部裝置。',
                      '{n} books stored in this browser{size}. They never leave this device.'],
    'library.count.one': ['這部裝置存了 1 本書{size}。書不會離開這部裝置。',
                          '1 book stored in this browser{size}. It never leaves this device.'],
    'library.usage': ['，共 {size}', ', using {size}'],
    'library.today': ['今天', 'today'],
    'library.yesterday': ['昨天', 'yesterday'],
    'library.days': ['{n} 天前', '{n} days ago'],

    /* ---- the pager ---- */
    'pager.back': ['↩ 返回', '↩ Back'],
    /* Two parallel pairs, as in the Chinese: 上一章/下一章 against 上一頁/下一頁.
       The English used to say "Previous" for one and "Page back" for the other,
       blurring the very distinction the buttons exist to make.

       The direction comes from the arrow and the unit from the word, which is
       how the Chinese does it too -- 上一章 is three characters, not "previous
       chapter". The English has to be as terse for the same reason. Measured on
       a 375px phone against the widest position readout a long book produces,
       "← Previous chapter" wrapped to two lines and took the pager from 55px to
       78px; "← Prev chapter" wrapped as well. Only this fits every case. */
    'pager.prev': ['← 上一章', '← Chapter'],
    'pager.next': ['下一章 →', 'Chapter →'],
    /* Pages are a setting of their own, so the same two buttons turn pages
       wherever it is on -- in focus mode or out of it. */
    'pager.prevPage': ['← 上一頁', '← Page'],
    'pager.nextPage': ['下一頁 →', 'Page →'],

    /* ---- what the app is doing ---- */
    /* Delimited in both: 《》 in Chinese, quotes in English. Bare, a long title
       ran straight into the sentence around it. */
    'status.opening': ['開啟《{title}》…', 'Opening \u201c{title}\u201d…'],
    'status.reading': ['正在讀取 {name}…', 'Reading {name}…'],
    'status.converting': ['正在轉換…', 'Converting…'],
    'status.converting.pct': ['正在轉換… {pct}%', 'Converting… {pct}%'],
    'error.convert': ['轉換失敗：{message}', 'Conversion failed: {message}'],
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
                       'Rounded sans-serif, softer than 黑體 Hei.'],
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

  /* A label with a {placeholder} in it belongs to whoever has the value: apply()
     has no vars to fill it with, and writing it raw would put a literal
     "{format}" on the export button. Today the caller happens to run its own
     sync immediately afterwards and paints over it, which is luck rather than
     design -- skip it here and the luck is not needed. */
  function fillable(value) { return value.indexOf('{') < 0; }

  function apply(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var text = get(nodes[i].getAttribute('data-i18n'));
      if (fillable(text)) nodes[i].textContent = text;
    }
    var titled = scope.querySelectorAll('[data-i18n-title]');
    for (var j = 0; j < titled.length; j++) {
      var title = get(titled[j].getAttribute('data-i18n-title'));
      if (fillable(title)) titled[j].setAttribute('title', title);
    }
  }

  App.strings = { get: get, apply: apply, TEXT: TEXT,
                  setLocale: setLocale, locale: current,
                  markDocument: markDocument };
})(window.App = window.App || {});
