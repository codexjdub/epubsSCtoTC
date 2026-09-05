/* Application shell: drop a book in, read it converted, export if wanted. */
(function (App) {
  'use strict';

  var el = {};
  var api = {};      // internals exposed for tests
  var lastViewerScroll = 0;
  var current = { buffer: null, filename: '', book: null, reader: null, presetId: 'hk',
                  punctuation: false, format: 'epub', fontReport: [] };

  function $(id) { return document.getElementById(id); }
  function S(key, vars) { return App.strings.get(key, vars); }
  /* One breakpoint, written once. It was spelled out in four places here --
     two identical functions, an inline copy and the MediaQueryList -- plus
     twice in the stylesheet, where 701 is its complement. Moving it meant
     remembering all six, and a JS/CSS disagreement of one pixel is a width
     at which the desktop layout is on screen while this still says phone.
     The stylesheet cannot share the constant, so the audit checks it. */
  var NARROW = '(max-width: 700px)';
  var narrowQuery = window.matchMedia(NARROW);
  function isNarrowScreen() { return narrowQuery.matches; }

  /* A reading preference like the font size, but kept here rather than with the
   * reader's own prefs because the layout it asks for is not always available.
   * A phone has no fixed-height reading box to break pages in, and opening a
   * book on one must not overwrite the answer given on a desktop. */
  var PAGED_KEY = 'epub-tc:paged';
  /* Remembered here too, because this is the one preference that is re-read
   * mid-session -- settleForWidth asks for it again every time the breakpoint
   * moves. Where localStorage refuses (Safari at file://, private windows), a
   * dropped write used to mean pagination switched ITSELF off on the next
   * crossing, while the line width beside it in the same panel survived: the
   * reader's own prefs keep an in-memory copy and this did not. */
  var pagedMemory = null;
  function pagedPref() {
    try {
      var raw = window.localStorage.getItem(PAGED_KEY);
      if (raw !== null) return raw === '1';
    } catch (e) { /* fall through to memory */ }
    return pagedMemory === null ? false : pagedMemory;
  }
  function storePagedPref(on) {
    pagedMemory = !!on;
    try { window.localStorage.setItem(PAGED_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  /* Which element scrolls is a layout decision, so it is made here rather than
     in the reader: below the breakpoint the document scrolls, so the browser
     will collapse its own chrome; above it an inner container does, because
     the sidebar sits beside a full-height viewer. The inset is the fixed bar,
     which the anchor measures from -- without it a restored position sits that
     far underneath it. */
  function scrollerFor() {
    if (!isNarrowScreen()) return null;
    return function () {
      /* The bar's height whether or not it is currently tucked. Letting the
         inset follow the tuck made capture and restore disagree by 57px
         whenever the two happened on opposite sides of a scroll: a constant is
         slightly conservative while the bar is away, and always consistent. */
      /* el.topbar, not a fresh lookup: reaching for the bar by CSS class was
         the one piece of chrome addressed differently from everything else,
         and a rename would have returned null here and silently zeroed the
         inset -- putting every restored position a bar height out. */
      return App.reader.documentScroller(function () {
        return el.topbar ? el.topbar.offsetHeight : 0;
      });
    };
  }

  function show(node, visible) { node.classList.toggle('hidden', !visible); }

  /* Written to both lines: the landing page's own, and the reader's, since the
     landing one is hidden the moment a book opens. */
  function setStatus(text) {
    var value = text || '';
    el.status.textContent = value;
    if (el.readerStatus) el.readerStatus.textContent = value;
  }

  function showError(message) {
    el.error.textContent = message;
    show(el.error, true);
  }

  function clearError() { show(el.error, false); }

  /* ---- TOC ---- */

  function buildToc(book, reader, useOriginal) {
    function list(nodes) {
      var ul = document.createElement('ul');
      nodes.forEach(function (n) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        var label = useOriginal && n.originalLabel !== undefined ? n.originalLabel : n.label;
        a.textContent = label || S('shelf.untitled');
        a.href = '#';
        a.dataset.path = n.path;
        a.dataset.fragment = n.fragment || '';
        a.addEventListener('click', function (ev) {
          ev.preventDefault();
          reader.goToPath(n.path, n.fragment);
          if (isNarrowScreen()) {
            el.sidebar.classList.remove('open');
            el.backdrop.classList.add('hidden');
            el.toggleSidebar.setAttribute('aria-expanded', 'false');
          }
        });
        li.appendChild(a);
        if (n.children && n.children.length) li.appendChild(list(n.children));
        ul.appendChild(li);
      });
      return ul;
    }
    el.toc.textContent = '';
    if (!book.toc.length) {
      var p = document.createElement('p');
      p.className = 'hint';
      p.textContent = S('toc.empty');
      el.toc.appendChild(p);
      return;
    }
    el.toc.appendChild(list(book.toc));
  }

  /* Rebuilt per book: the typeface names only mean something in the script the
     book is written in, and 楷書 has no Latin counterpart to offer. */
  function populateFontStyles(language, presetId) {
    el.fontStyle.textContent = '';
    App.readingFonts.availableStyles(language, presetId).forEach(function (f) {
      var opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.label;
      opt.title = f.note;
      el.fontStyle.appendChild(opt);
    });
  }

  function bookLanguage(book) {
    var meta = book.metadata || {};
    return (meta.original && meta.original.language) || meta.language || '';
  }

  function titleFor(book, useOriginal) {
    var meta = useOriginal && book.metadata.original ? book.metadata.original : book.metadata;
    return meta.title || current.filename;
  }

  /* Re-label the chrome for whichever text is on screen. */
  function syncMarksLabel() {
    if (!el.toggleMarks || !current.reader) return;
    var on = current.reader.state.showMarks;
    el.toggleMarks.textContent = S(on ? 'panel.marks.hide' : 'panel.marks.show');
    el.toggleMarks.classList.toggle('active', on);
    el.toggleMarks.setAttribute('aria-pressed', String(!!on));
  }


  function syncSource() {
    var original = current.reader && current.reader.state.source === 'original';
    el.toggleSource.textContent =
      S(original ? 'reader.source.converted' : 'reader.source.original');
    el.toggleSource.classList.toggle('active', original);
    el.toggleSource.setAttribute('aria-pressed', String(!!original));
    el.banner.classList.toggle('hidden', !original);
    el.toggleMarks.disabled = original;
    if (current.book) {
      el.title.textContent = titleFor(current.book, original);
      buildToc(current.book, current.reader, original);
      highlightToc(current.reader.state.path || '');
    }
  }

  function highlightToc(path) {
    var links = el.toc.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) {
      links[i].classList.toggle('current', links[i].dataset.path === path);
    }
    revealCurrentInToc();
  }

  /* The list outruns the sidebar on any real book -- 69 entries in the sample,
     where chapter 31 sits 941px down and chapter 61 over 2000 -- so opening
     目錄 mid-book showed the beginning and left you to hunt for where you are.
     `nearest` is what keeps it from being annoying: an entry already on screen
     does not move, so clicking through the list never makes it jump. */
  function revealCurrentInToc() {
    var current = el.toc.querySelector('a.current');
    if (current && current.scrollIntoView) current.scrollIntoView({ block: 'nearest' });
  }

  /* ---- bookmarks ---- */

  /* The chapter's name as the table of contents gives it, since that is the
     name the reader has already been shown. Read off the built list rather
     than from book.toc, which is a tree and would need walking. */
  function chapterName(path) {
    var link = el.toc.querySelector('a[data-path="' + (window.CSS && CSS.escape
      ? CSS.escape(path) : path) + '"]');
    return link ? link.textContent : '';
  }

  function renderBookmarks() {
    if (!el.bookmarks) return;
    var marks = current.reader ? current.reader.bookmarks() : [];
    show(el.bookmarks, marks.length > 0);
    el.bookmarkList.textContent = '';
    marks.forEach(function (bm) {
      var row = document.createElement('div');
      row.className = 'bookmark-row';

      var go = document.createElement('button');
      go.type = 'button';
      go.className = 'go';
      var label = document.createElement('span');
      label.className = 'label';
      label.textContent = bm.label || S('bookmark.unlabelled');
      var where = document.createElement('span');
      where.className = 'where';
      where.textContent = chapterName(bm.path);
      go.appendChild(label);
      go.appendChild(where);
      go.addEventListener('click', function () {
        current.reader.goToBookmark(bm);
        if (isNarrowScreen() && api.setDrawer) api.setDrawer(false);
      });

      var drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'drop';
      drop.textContent = '×';
      drop.title = S('bookmark.removeNamed', { label: bm.label || S('bookmark.unlabelled') });
      drop.setAttribute('aria-label', drop.title);
      drop.addEventListener('click', function () {
        current.reader.removeBookmark(bm);
      });

      row.appendChild(go);
      row.appendChild(drop);
      el.bookmarkList.appendChild(row);
    });
  }

  /* Whether the spot on screen is one of them. Asked on every scroll, with the
     progress figure, so the button is right without anyone pressing it. */
  function syncBookmark() {
    if (!el.toggleBookmark) return;
    var on = !!(current.reader && current.reader.bookmarkAt());
    el.toggleBookmark.classList.toggle('active', on);
    el.toggleBookmark.setAttribute('aria-pressed', String(on));
    el.toggleBookmark.title = S(on ? 'bar.bookmark.remove.title' : 'bar.bookmark.title');
  }

  /* ---- report ---- */

  function renderReport(book, fontReport) {
    var r = book.report;
    var dl = document.createElement('dl');
    function row(term, value) {
      var dt = document.createElement('dt'); dt.textContent = term;
      var dd = document.createElement('dd'); dd.textContent = value;
      dl.appendChild(dt); dl.appendChild(dd);
    }
    row(S('report.target'), r.preset.label + ' (' + r.preset.lang + ')');
    row(S('report.documents'), String(r.documents));
    row(S('report.nodes'), String(r.changedNodes));
    row(S('report.marks'), String(r.markCount));
    if (r.unalignedNodes) {
      row(S('report.unmarked'), S('report.unmarked.why', { n: r.unalignedNodes }));
    }

    el.reportBody.textContent = '';
    el.reportBody.appendChild(dl);

    function notice(text, ok) {
      var d = document.createElement('div');
      d.className = 'notice' + (ok ? ' ok' : '');
      d.textContent = text;
      el.reportBody.appendChild(d);
    }

    if (r.markCount) notice(S('report.marks.note'), true);

    (fontReport || []).forEach(function (f) {
      if (f.error) {
        notice(S('report.font.unreadable', { path: f.path, error: f.error }));
      } else if (!f.ok) {
        notice(S('report.font.partial', {
          family: f.family || f.path,
          pct: Math.round(f.coverage * 100),
          sample: f.missingSample.length
            ? S('report.font.sample', { chars: f.missingSample.join(' ') }) : ''
        }));
      } else {
        notice(S('report.font.ok', { family: f.family || f.path }), true);
      }
    });

    var obfuscated = book.encryption.obfuscatedFonts.length;
    if (obfuscated) notice(S('report.font.obfuscated', { n: obfuscated }), true);

    var images = 0;
    book.manifest.forEach(function (i) { if (/^image\//.test(i.mediaType)) images++; });
    if (images) notice(S('report.images', { n: images }));

    r.warnings.forEach(function (w) { notice(w); });

  }

  /* ---- loading ---- */

  async function loadBuffer(buffer, filename) {
    clearError();
    setStatus(S('status.reading', { name: filename }));

    if (current.reader) { current.reader.destroy(); current.reader = null; }

    var book;
    try {
      book = await App.parse.load(buffer);
    } catch (e) {
      setStatus('');
      showError(e.message);
      return;
    }

    setStatus(S('status.converting'));
    await new Promise(function (r) { setTimeout(r, 0); });   // let the status paint

    try {
      await App.convert.book(book, current.presetId, function (fraction, path) {
        setStatus(S('status.converting.pct', { pct: Math.round(fraction * 100) }));
      });
    } catch (e) {
      setStatus('');
      showError(S('error.convert', { message: e.message }));
      return;
    }

    var fontReport = [];
    try {
      fontReport = await App.fonts.analyze(book);
    } catch (e) {
      fontReport = [];
    }

    current.book = book;
    current.buffer = buffer;
    current.filename = filename;

    el.title.textContent = book.metadata.title || filename;
    document.title = (book.metadata.title || filename) + ' — 繁花似錦';

    /* Focus mode borrows pages for as long as it runs, and it outlives the book
       -- opening another title from the shelf does not leave it. Consulting
       only the stored preference built the new reader scrolling while the mode
       was still on, so the chrome stayed hidden over a view with no pages in
       it: the one thing the mode exists to do, gone. */
    var wantPaged = pagedPref() || !!(api.focusOn && api.focusOn());
    /* Before create(), not after: on a phone this class is what gives the
       column a box with a height to break into, and the first render measures
       that box. Set afterwards, the first chapter came up as one tall page. */
    el.app.classList.toggle('paged', wantPaged);
    var reader = App.reader.create(el.viewer, book, {
      scroller: scrollerFor(),
      paged: wantPaged
    });
    current.reader = reader;

    /* Chapter count plus how far through the book, which the index alone does
       not tell you when chapters differ in length by an order of magnitude. */
    var pos = { index: 0, total: 0 };
    function renderPosition() {
      var pct = current.reader ? current.reader.progress() : null;
      var page = current.reader ? current.reader.pagePosition() : null;
      /* Paginating, how many pages are left in the chapter is the thing you
         want and a percentage of the book is not -- it is what every reader
         shows, and it is the only cue a swipe has, since the gesture itself is
         invisible. Digits only, so it needs no word in either language. */
      var tail = page ? ' · ' + page.page + '/' + page.pages
                      : (pct === null ? '' : ' · ' + Math.round(pct * 100) + '%');
      el.position.textContent = (pos.index + 1) + ' / ' + pos.total + tail;
      /* Here rather than on the chapter event, because paginating, the ends of
         the book are reached by turning a page and no chapter event fires. Left
         on the chapter event with a `!paged` guard, both buttons stayed lit and
         inert at the last page of the last chapter -- clicking did nothing and
         nothing said so. */
      if (!current.reader) return;
      el.prev.disabled = current.reader.atBookStart();
      el.next.disabled = current.reader.atBookEnd();
      syncBookmark();
    }

    reader.on('chapter', function (e) {
      reader.state.path = e.path;
      pos.index = e.index;
      pos.total = e.total;
      /* A new chapter starts at the top, so the pager belongs on screen --
         unless focus mode has deliberately put it away. Switching into that
         mode re-renders the chapter, which is how the strip it had just tucked
         came straight back. */
      if (api.tuckPager && !(api.focusOn && api.focusOn())) api.tuckPager(false);
      lastViewerScroll = 0;
      renderPosition();
      highlightToc(e.path);
      renderBookmarks();
    });
    reader.on('progress', renderPosition);
    /* The list changes only when a bookmark does; the BUTTON changes as the
       reader moves, which is why the two are separate. */
    reader.on('bookmarks', function () { renderBookmarks(); syncBookmark(); });
    /* Only offered once a link has actually been followed -- a button that is
       usually inert is worse than no button. */
    reader.on('trail', function (e) { el.back.hidden = e.depth === 0; });
    reader.on('external', function (e) {
      setStatus(S('status.external', { href: e.href }));
    });
    reader.on('missing', function (e) {
      setStatus(S('status.missing', { path: e.path }));
    });

    buildToc(book, reader, reader.state.source === 'original');
    setShelfOpen(false);
    /* Kept, so a language switch can rebuild the panel: the report is built
       in JS, and its heading is a data-i18n attribute, so without this the
       panel showed a translated heading over an untranslated body. */
    current.fontReport = fontReport;
    renderReport(book, fontReport);

    /* Store the ORIGINAL bytes, not the converted ones: reopening should
     * start from the source so the preset can still be changed. */
    if (App.library.available()) {
      App.library.requestPersistence();
      App.library.save(book, buffer, filename).then(function (r) {
        if (!r.saved && r.reason) setStatus(r.reason);
        return renderLibrary().then(renderShelf);
      });
    }

    show(el.landing, false);
    show(el.chrome, true);
    setStatus('');

    await reader.resume();
    populateFontStyles(bookLanguage(book), current.presetId);
    el.fontStyle.value =
      App.readingFonts.effectiveStyle(reader.state.fontStyle, bookLanguage(book));
    syncMarksLabel();
    el.lineHeight.value = reader.state.lineHeight;
    el.measure.value = reader.state.measure;
    el.align.value = reader.state.align;
    syncSource();
    if (api.syncPaged) api.syncPaged();
  }

  /* ---- saved books ---- */

  function formatSize(bytes) {
    return bytes >= 1048576
      ? (bytes / 1048576).toFixed(1) + ' MB'
      : Math.round(bytes / 1024) + ' KB';
  }

  function formatWhen(ts) {
    if (!ts) return '';
    var days = Math.floor((Date.now() - ts) / 86400000);
    if (days <= 0) return S('library.today');
    if (days === 1) return S('library.yesterday');
    if (days < 30) return S('library.days', { n: days });
    return new Date(ts).toLocaleDateString();
  }

  /* Opening a stored book is just the ordinary open path with bytes from
   * IndexedDB, so it converts with the currently selected preset and lands at
   * its own saved position. */
  async function openStored(entry, row) {
    clearError();
    if (row) row.classList.add('busy');
    setStatus(S('status.opening', { title: entry.title }));
    var ok = false;
    try {
      var bytes = await App.library.load(entry.id);
      if (!bytes) throw new Error('that book is no longer stored');
      await loadBuffer(bytes, entry.title);
      ok = true;
    } catch (e) {
      setStatus('');
      showError(S('error.open', { message: e.message }));
    }
    if (row) row.classList.remove('busy');
    return ok;
  }

  async function storedBooks() {
    try { return await App.library.list(); } catch (e) { return []; }
  }

  /* The landing page's library and the reader's shelf are one list in two
   * sets of clothes: same rows, same removal, different class names, subtitle
   * and pick action. The class names stay distinct because the two are
   * styled — and tested — separately. */
  function renderRows(config, books, currentId) {
    /* Blob URLs are per render, so the previous batch for THIS list is
       released first -- the two lists render independently. */
    (config.list.__covers || []).forEach(URL.revokeObjectURL);
    config.list.__covers = [];
    config.list.textContent = '';
    books.forEach(function (entry) {
      var row = document.createElement('div');
      row.className = config.row + (entry.id === currentId ? ' current' : '');

      var pick = document.createElement('button');
      pick.type = 'button';
      pick.className = config.pick;

      if (entry.cover) {
        var img = document.createElement('img');
        img.className = 'cover';
        img.alt = '';
        img.loading = 'lazy';
        var url = URL.createObjectURL(
          new Blob([entry.cover], { type: entry.coverType || 'image/jpeg' }));
        config.list.__covers.push(url);
        img.src = url;
        pick.appendChild(img);
      }

      /* Title and subtitle share a column so the cover can sit beside them
         rather than above: the shelf's button stacks its children. */
      var text = document.createElement('span');
      text.className = 'text';
      var name = document.createElement('span');
      name.className = config.name;
      name.textContent = entry.title || S('shelf.untitled');
      var meta = document.createElement('span');
      meta.className = config.meta;
      meta.textContent = config.subtitle(entry, currentId);
      text.appendChild(name);
      text.appendChild(meta);
      pick.appendChild(text);
      pick.addEventListener('click', function () { config.onPick(entry, row); });

      var drop = document.createElement('button');
      drop.type = 'button';
      drop.className = config.drop;
      drop.textContent = '×';
      drop.title = S('shelf.remove');
      drop.setAttribute('aria-label',
        S('shelf.removeNamed', { title: entry.title || S('shelf.untitled') }));
      drop.addEventListener('click', async function (ev) {
        ev.stopPropagation();
        await App.library.remove(entry.id);
        await renderLibrary();
        await renderShelf();
      });

      row.appendChild(pick);
      row.appendChild(drop);
      config.list.appendChild(row);
    });
  }

  async function renderLibrary() {
    if (!App.library.available()) { show(el.library, false); return; }

    var books = await storedBooks();
    if (!books.length) { show(el.library, false); return; }

    renderRows({
      list: el.libraryList,
      row: 'library-row', pick: 'open', name: 'name', meta: 'meta', drop: 'remove',
      subtitle: function (entry) {
        return formatSize(entry.size) +
          (entry.lastOpenedAt ? ' · ' + formatWhen(entry.lastOpenedAt) : '');
      },
      onPick: openStored
    }, books, null);

    /* Added up from the rows above, so the total IS the rows and can be
       checked by eye. It used to come from navigator.storage.estimate(),
       which answers a different question -- everything this origin has
       stored, including the 1.6MB app itself and, on WebKit, IndexedDB space
       the browser has not reclaimed yet. One 382KB book read as 17.2MB under
       a line that says it is reporting the books. Covers are stored beside a
       book but are not counted: they are not the book, and counting them
       would break the match with the rows. */
    var bytes = books.reduce(function (n, b) { return n + (b.size || 0); }, 0);
    el.libraryNote.textContent = S('library.count', {
      n: books.length,
      size: bytes ? S('library.usage', { size: formatSize(bytes) }) : ''
    });
    show(el.library, true);
  }

  /* ---- the shelf, inside the reader ----
   *
   * The shelf opens from its own button on the bar rather than sharing the
   * sidebar with the table of contents: they answer different questions --
   * "where am I in this book" versus "which book" -- and nesting one inside
   * the other made the second hard to find.
   */
  function setShelfOpen(open) {
    el.shelfPanel.classList.toggle('hidden', !open);
    el.toggleShelf.classList.toggle('active', open);
    el.toggleShelf.setAttribute('aria-expanded', String(open));
    if (open) renderShelf();
  }

  function shelfOpen() { return !el.shelfPanel.classList.contains('hidden'); }

  async function switchToBook(entry) {
    if (current.book && App.library.idFor(current.book) === entry.id) {
      setShelfOpen(false);
      return;
    }
    if (await openStored(entry)) setShelfOpen(false);
  }

  async function renderShelf() {
    if (!el.shelfPanel) return;
    if (!App.library.available()) {
      el.shelfList.textContent = '';
      el.shelfNote.textContent = App.library.reason();
      return;
    }

    var books = await storedBooks();
    var currentId = current.book ? App.library.idFor(current.book) : null;

    renderRows({
      list: el.shelfList,
      row: 'shelf-row', pick: 'pick', name: 't', meta: 's', drop: 'drop',
      subtitle: function (entry, id) {
        return formatSize(entry.size) + (entry.id === id ? ' · ' + S('shelf.reading') : '');
      },
      onPick: switchToBook
    }, books, currentId);

    el.shelfNote.textContent = books.length
      ? S('shelf.count', { n: books.length })
      : S('shelf.empty');
  }

  function readFile(file) {
    var reader = new FileReader();
    reader.onload = function () { loadBuffer(reader.result, file.name); };
    reader.onerror = function () { showError('Could not read that file.'); };
    reader.readAsArrayBuffer(file);
  }

  /* ---- export ---- */

  async function doExport() {
    if (!current.book) return;
    el.exportRun.disabled = true;
    setStatus(S('status.exporting'));
    try {
      /* Covers the archive write, which is the slow part on a large book.
         The passes before it are fast enough not to need their own reporting. */
      var summary = await App.export.buildFile(current.book, {
        overrides: current.reader ? current.reader.overrides() : {},
        punctuation: current.punctuation,
        format: current.format
      }, function (fraction) {
        setStatus(S('status.exporting.pct', { pct: Math.round(fraction * 100) }));
      });
      App.export.download(summary.blob, App.export.filenameFor(current.book, current.format));
      setStatus(S('status.exported', { name: App.export.filenameFor(current.book, current.format) }) +
                (summary.overrides ? S('status.exported.corrections', { n: summary.overrides }) : '') +
                (summary.fontsStripped.length
                  ? S('status.exported.fonts', { n: summary.fontsStripped.length }) : ''));
    } catch (e) {
      showError(S('error.export', { message: e.message }));
      setStatus('');
    }
    el.exportRun.disabled = false;
  }

  /* ---- wiring ---- */

  function init() {
    el.landing = $('landing');
    el.chrome = $('chrome');
    el.dropzone = $('dropzone');
    el.fileInput = $('fileInput');
    el.preset = $('preset');
    el.presetTop = $('presetTop');
    el.punctTop = $('punctTop');
    el.library = $('library');
    el.libraryList = $('libraryList');
    el.libraryNote = $('libraryNote');
    el.status = $('status');
    el.readerStatus = $('readerStatus');
    el.error = $('error');
    el.title = $('bookTitle');
    el.viewer = $('viewer');
    el.toc = $('toc');
    el.bookmarks = $('bookmarks');
    el.bookmarkList = $('bookmarkList');
    el.toggleBookmark = $('toggleBookmark');
    el.shelfPanel = $('shelfPanel');
    el.shelfList = $('shelfList');
    el.shelfNote = $('shelfNote');
    el.toggleShelf = $('toggleShelf');
    el.openNew = $('openNew');
    el.sidebar = $('sidebar');
    el.prev = $('prev');
    el.pager = document.querySelector('.pager');
    el.topbar = $('topbar');
    el.back = $('back');
    el.next = $('next');
    el.position = $('position');
    el.docBtn = $('docBtn');
    el.reportPanel = $('reportPanel');
    el.reportBody = $('reportBody');
    el.theme = $('theme');
    el.themeLanding = $('themeLanding');
    el.toggleSource = $('toggleSource');
    el.toggleVim = $('toggleVim');
    el.toggleFocus = $('toggleFocus');
    el.togglePaged = $('togglePaged');
    el.lang = $('lang');
    /* By id, like every other piece of chrome. The one element reached for by
       class was the bar, and a rename would have returned null and silently
       zeroed an inset rather than failing. */
    el.app = $('app');
    el.fontStyle = $('fontStyle');
    el.lineHeight = $('lineHeight');
    el.measure = $('measure');
    el.align = $('align');
    el.exportFormat = $('exportFormat');
    el.docPanel = $('docPanel');
    el.exportRun = $('exportRun');
    el.toggleSidebar = $('toggleSidebar');
    el.aaBtn = $('aaBtn');
    el.aaPanel = $('aaPanel');
    el.backdrop = $('drawerBackdrop');
    el.toggleMarks = $('toggleMarks');
    el.banner = $('originalBanner');

    App.strings.markDocument();
    App.strings.apply(document);

    /* Every option list is a named function, because each one has to be built
       twice: once at startup, and again whenever the interface language
       changes. Inline, they were unreachable from anywhere but init(). */
    function populateThemes() {
      [el.theme, el.themeLanding].forEach(function (select) { select.textContent = ''; });
      App.theme.THEMES.forEach(function (t) {
        [el.theme, el.themeLanding].forEach(function (select) {
          var opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = S(t.labelKey);
          select.appendChild(opt);
        });
      });
      el.theme.value = App.theme.current();
      el.themeLanding.value = App.theme.current();
    }
    populateThemes();

    function onThemeChange(value) {
      var applied = App.theme.apply(value);
      el.theme.value = applied;
      el.themeLanding.value = applied;
    }
    el.theme.addEventListener('change', function () { onThemeChange(this.value); });
    el.themeLanding.addEventListener('change', function () { onThemeChange(this.value); });

    function populatePresets() {
      [el.preset, el.presetTop].forEach(function (select) { select.textContent = ''; });
      App.convert.presets().forEach(function (p) {
        [el.preset, el.presetTop].forEach(function (select) {
          var opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.label;
          opt.title = p.note;
          select.appendChild(opt);
        });
      });
      el.preset.value = current.presetId;
      el.presetTop.value = current.presetId;
    }
    populatePresets();

    el.dropzone.addEventListener('click', function () { el.fileInput.click(); });
    /* The shelf answers "which book", and opening a file is the same question.
       The panel stays open behind the picker; loadBuffer closes it. */
    el.openNew.addEventListener('click', function () { el.fileInput.click(); });
    /* Opening the picker programmatically dispatches a click on the input,
       which bubbles to the document handler and closed the shelf underneath.
       Nothing needs this event beyond the input itself. */
    el.fileInput.addEventListener('click', function (ev) { ev.stopPropagation(); });
    el.fileInput.addEventListener('change', function () {
      if (el.fileInput.files[0]) readFile(el.fileInput.files[0]);
    });

    ['dragenter', 'dragover'].forEach(function (name) {
      document.addEventListener(name, function (ev) {
        ev.preventDefault();
        el.dropzone.classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      document.addEventListener(name, function (ev) {
        ev.preventDefault();
        if (name === 'dragleave' && ev.target !== document.documentElement) return;
        el.dropzone.classList.remove('over');
      });
    });
    document.addEventListener('drop', function (ev) {
      ev.preventDefault();
      var file = ev.dataTransfer && ev.dataTransfer.files[0];
      if (file) readFile(file);
    });

    renderLibrary();

    /* Three dropdowns on one bar, so they share the rules: one open at a time,
       any outside click closes them, and a click inside keeps them open. */
    var dropdowns = [
      { btn: el.toggleShelf, panel: el.shelfPanel, onOpen: renderShelf },
      { btn: el.aaBtn, panel: el.aaPanel },
      { btn: el.docBtn, panel: el.docPanel }
    ];

    function setDropdown(entry, open) {
      entry.panel.classList.toggle('hidden', !open);
      entry.btn.classList.toggle('active', open);
      entry.btn.setAttribute('aria-expanded', String(open));
      if (open && entry.onOpen) entry.onOpen();
    }

    function closeDropdowns(except) {
      dropdowns.forEach(function (d) { if (d !== except) setDropdown(d, false); });
    }

    dropdowns.forEach(function (entry) {
      entry.btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var open = entry.panel.classList.contains('hidden');
        closeDropdowns(entry);
        setDropdown(entry, open);
      });
      entry.panel.addEventListener('click', function (ev) { ev.stopPropagation(); });
    });
    document.addEventListener('click', function () { closeDropdowns(null); });

    /* A control that changes what you are looking at closes the panel, so you
       can see what it did. One that is adjusted by degrees -- the font size
       steps, and any select or slider -- leaves it open: closing after the
       first press means aiming at the button again for every step. */
    [el.aaPanel, el.docPanel].forEach(function (panel) {
      panel.addEventListener('click', function (ev) {
        if (ev.target.localName !== 'button') return;
        if (ev.target.hasAttribute('data-keep-open')) return;
        closeDropdowns(null);
      });
    });

    el.preset.addEventListener('change', function () { current.presetId = el.preset.value; });
    /* One control, in the export options where it takes effect. It used to be
     * mirrored on the landing page, offered before there was a book to export
     * and kept in step by hand. */
    el.punctTop.addEventListener('change', function () {
      current.punctuation = this.checked;
    });

    /* Changing the target re-converts from the ORIGINAL bytes: conversion
     * rewrites entries in place, so re-running it on an already-converted
     * book would compound the changes. */
    el.presetTop.addEventListener('change', function () {
      current.presetId = el.presetTop.value;
      el.preset.value = current.presetId;
      if (current.buffer) loadBuffer(current.buffer, current.filename);
    });

    el.back.addEventListener('click', function () { current.reader.back(); });
    /* Pages while paginating, chapters otherwise -- the reader decides, so
       nothing here has to know which mode is in force. */
    el.prev.addEventListener('click', function () { current.reader.prevPage(); });
    el.next.addEventListener('click', function () { current.reader.nextPage(); });


    /* Below the breakpoint the sidebar is an overlay drawer, so its open
     * state has to drive a backdrop too. Above it, the backdrop stays out of
     * the way and the sidebar is just shown or collapsed as before. */
    var isNarrow = isNarrowScreen;

    /* Two states with two different meanings, each owned by its breakpoint:
     * `.open` shows the mobile drawer (closed by default in CSS), `.hidden`
     * collapses the desktop sidebar (shown by default in CSS). Neither is
     * seeded at init, so a wrong width reading at startup cannot strand the
     * layout in the wrong state. */
    function setDrawer(open) {
      if (isNarrow()) {
        el.sidebar.classList.toggle('open', open);
        el.backdrop.classList.toggle('hidden', !open);
      } else {
        el.sidebar.classList.toggle('hidden', !open);
        el.backdrop.classList.add('hidden');
      }
      el.toggleSidebar.setAttribute('aria-expanded', String(open));
      /* Opening it is the other moment it matters: the highlight may have moved
         several times while the drawer was shut. */
      if (open) revealCurrentInToc();
    }

    function drawerOpen() {
      return isNarrow()
        ? el.sidebar.classList.contains('open')
        : !el.sidebar.classList.contains('hidden');
    }

    el.toggleSidebar.setAttribute('aria-expanded', String(drawerOpen()));
    el.toggleSidebar.addEventListener('click', function () {
      setDrawer(!drawerOpen());
      closeDropdowns(null);
    });
    el.backdrop.addEventListener('click', function () { setDrawer(false); });

    /* The pager gets out of the way while you read and comes back the moment
       you scroll up -- or reach the end of the chapter, which is exactly when
       下一章 is wanted. Only below the breakpoint: on a desktop, with a mouse
       and arrow keys, chrome that moves on scroll costs more than the height
       it saves. */
    function anyDropdownOpen() {
      return dropdowns.some(function (d) { return !d.panel.classList.contains('hidden'); });
    }

    /* Both strips move together: hiding one and leaving the other looks like a
       glitch rather than a decision. The bar stays while a panel is open --
       the panels hang off it, so tucking would take them along. */
    function tuckPager(hide) {
      var tuck = !!hide && !anyDropdownOpen();
      el.pager.classList.toggle('tucked', tuck);
      el.topbar.classList.toggle('tucked', tuck);
    }

    /* Both, because which one moves depends on the breakpoint and the handler
       is cheap: whichever is not scrolling never fires. */
    /* Whichever element is doing the scrolling at this width -- the same
       decision scrollerFor() makes, asked the same way rather than inferred
       from whichever happens to be non-zero. */
    function readingScroll() {
      if (isNarrow()) {
        var doc = document.scrollingElement || document.documentElement;
        return { top: doc.scrollTop, visible: window.innerHeight, full: doc.scrollHeight };
      }
      return { top: el.viewer.scrollTop, visible: el.viewer.clientHeight,
               full: el.viewer.scrollHeight };
    }

    function onReadingScroll() {
      /* In focus mode the strips are hidden because they were asked to be, so
         scrolling neither hides nor reveals them; only the pointer does. */
      if (!isNarrow()) { if (!focusMode.on) tuckPager(false); return; }
      var at = readingScroll();
      var delta = at.top - lastViewerScroll;
      if (Math.abs(delta) < 8) return;          /* ignore jitter and bounce */
      lastViewerScroll = at.top;
      tuckPager(at.top + at.visible >= at.full - 8 ? false : delta > 0);
    }
    el.viewer.addEventListener('scroll', onReadingScroll, { passive: true });
    window.addEventListener('scroll', onReadingScroll, { passive: true });

    api.tuckPager = tuckPager;

    /* ---- focus mode ----
     *
     * The reading column alone: both strips slide off, the table of contents
     * closes, and the browser goes fullscreen so its tabs and bookmarks go with
     * them. Nothing is stranded by the missing pager -- the arrow keys and
     * PageUp/PageDown change chapter whether or not vim mode is on.
     *
     * Desktop only, and gated twice. Below the breakpoint the bar and the pager
     * already tuck themselves away as you read, so there would be nothing left
     * for this to hide; iOS Safari also refuses requestFullscreen for anything
     * but a video, which is the one place it would have mattered most.
     */
    var focusMode = { on: false, sidebarWas: false };
    var EDGE = 60;             // how near an edge summons its strip back

    /* A rejected fullscreen promise with nobody listening is an unhandled
       rejection in the console, and it rejects for ordinary reasons: no user
       gesture behind the call, or a browser that simply declines. */
    function settle(promise) { if (promise && promise['catch']) promise['catch'](function () {}); }

    function goFullscreen() {
      var root = document.documentElement;
      var fn = root.requestFullscreen || root.webkitRequestFullscreen;
      if (!fn) return;
      try { settle(fn.call(root)); } catch (e) { /* not available */ }
    }

    function leaveFullscreen() {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) return;
      var fn = document.exitFullscreen || document.webkitExitFullscreen;
      if (!fn) return;
      try { settle(fn.call(document)); } catch (e) { /* not available */ }
    }

    /* Closing the sidebar widens the reading column, which reflows the text: a
       pixel offset does not survive that and the content anchor does. Same
       reason the reader captures and restores around a font-size change. */
    function setFocus(on, anchor) {
      on = !!on;
      if (on === focusMode.on) return;
      if (on && isNarrow()) return;

      /* FIRST, before a single class changes. Everything below resizes the
         reading column -- the sidebar returns, the two strips rejoin the flow
         -- and a paged column re-breaks the moment its width or height moves.
         Captured afterwards, the position would be read off a set of pages
         that were never on screen, and leaving focus mode landed a page early.
         A caller that has ALREADY moved the layout -- settleForWidth, off the
         breakpoint -- is past that point and passes its own. */
      if (anchor === undefined) {
        anchor = current.reader ? current.reader.captureAnchor() : null;
      }

      if (on) {
        closeDropdowns(null);
        focusMode.sidebarWas = drawerOpen();
        setDrawer(false);
      }
      focusMode.on = on;
      el.app.classList.toggle('focus', on);
      tuckPager(on);
      if (!on) setDrawer(focusMode.sidebarWas);

      /* Focus mode BORROWS pages for as long as it runs and hands back what the
         preference asks for; it never writes that preference itself. Read on
         the way out rather than snapshotted on the way in, because 翻頁 stays
         live inside the mode: turning pages off in there wrote '0', and a
         snapshot taken at the door then turned them back on as you left,
         leaving reader, preference and button disagreeing three ways. When the
         preference is already what the reader is doing, the layout still has to
         be re-broken -- the reading box just changed size around it. */
      if (current.reader) {
        var want = on ? true : pagedPref();
        if (want === pagedOn()) current.reader.repaginate(anchor);
        else current.reader.setPaged(want, anchor);
      }
      if (on) goFullscreen(); else leaveFullscreen();
      syncFocus();
      syncPaged();
    }

    function syncFocus() {
      el.toggleFocus.classList.toggle('active', focusMode.on);
      el.toggleFocus.setAttribute('aria-pressed', String(focusMode.on));
      /* Nothing to disable: the button is not shown below the breakpoint at
         all. setFocus refuses there in any case, which is the guard that
         matters -- this only ever dressed the refusal. */
    }

    function pagedOn() {
      return !!(current.reader && current.reader.state.paged);
    }

    function syncPaged() {
      var on = pagedOn();
      el.togglePaged.classList.toggle('active', on);
      el.togglePaged.setAttribute('aria-pressed', String(on));
      /* The class the phone layout keys on, kept in step here as well as in
         applyPaged, because focus mode reaches setPaged directly. */
      el.app.classList.toggle('paged', on);
      /* Nothing scrolls while paginating, so a strip tucked on the way in
         would have no way back. Not in focus mode, which tucks them on
         purpose and calls this immediately afterwards. */
      if (on && !focusMode.on) tuckPager(false);
      /* Keyed on the LAYOUT, not on focus mode: pages can be on without it. A
         pager offering 下一章 while the button advances one page would lie. */
      el.prev.textContent = S(on ? 'pager.prevPage' : 'pager.prev');
      el.next.textContent = S(on ? 'pager.nextPage' : 'pager.next');
    }
    api.syncPaged = syncPaged;

    /* Layout only. The stored preference is written where the reader asks for
       it, so a width change or focus mode can move the layout without
       answering for the reader. */
    function applyPaged(on) {
      if (!current.reader) return;
      if (on === pagedOn()) { syncPaged(); return; }
      /* The class BEFORE the re-render, for the same reason the first one is
         set before create(): on a phone it decides whether the reading box has
         a height, and setPaged measures that box as it breaks the column. */
      el.app.classList.toggle('paged', on);
      var p = current.reader.setPaged(on);
      if (p && p.then) p.then(syncPaged); else syncPaged();
    }

    el.togglePaged.addEventListener('click', function () {
      var want = !pagedOn();
      storePagedPref(want);
      applyPaged(want);
    });

    /* The empty margins either side of the page turn it: the only control a
       paged view needs, and the only one it shows. A click inside the column
       falls through to the reader, where the marks and links live. */
    el.viewer.addEventListener('click', function (ev) {
      if (!pagedOn()) return;
      var box = current.reader.mount.getBoundingClientRect();
      if (ev.clientX < box.left) current.reader.prevPage();
      else if (ev.clientX > box.right) current.reader.nextPage();
    });

    /* Turning pages by touch, which the margin click above cannot do: it needs
       empty space beside the column, and a phone has none -- the mount fills
       the viewer, and the 48px gutter is the gap BETWEEN pages, off screen.

       A swipe rather than zones over the text. The marks and links in the text
       are tapped, and the handler above goes out of its way to let a tap reach
       them; zones would take that back, and a mark near the edge would turn
       the page instead of opening.

       Touches that BEGIN within a thumb's width of either edge are left alone:
       iOS Safari owns that strip for back and forward, and a page turn started
       there leaves the app rather than turning anything. Listeners are passive
       -- nothing scrolls while paginating, so there is nothing to prevent. */
    var EDGE_GUARD = 24, SWIPE_MIN = 45;
    var swipeFrom = null;
    el.viewer.addEventListener('touchstart', function (ev) {
      swipeFrom = null;
      if (!pagedOn() || ev.touches.length !== 1) return;
      var t = ev.touches[0];
      if (t.clientX < EDGE_GUARD || t.clientX > window.innerWidth - EDGE_GUARD) return;
      swipeFrom = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    el.viewer.addEventListener('touchend', function (ev) {
      var from = swipeFrom;
      swipeFrom = null;
      if (!from || !pagedOn() || !current.reader) return;
      var t = ev.changedTouches && ev.changedTouches[0];
      if (!t) return;
      var dx = t.clientX - from.x, dy = t.clientY - from.y;
      /* Short of the threshold it was a tap, and steeper than 45 degrees it
         was a drag down the page -- neither is a page turn. */
      if (Math.abs(dx) < SWIPE_MIN || Math.abs(dy) > Math.abs(dx)) return;
      if (dx < 0) current.reader.nextPage(); else current.reader.prevPage();
    }, { passive: true });

    /* The way back to the chrome without leaving the mode: approach the edge it
       lives on, as a video player does it. Toggling a class to the value it
       already holds costs nothing, so this can run on every move. */
    document.addEventListener('mousemove', function (ev) {
      if (!focusMode.on) return;
      tuckPager(ev.clientY > EDGE && ev.clientY < window.innerHeight - EDGE);
    });

    /* Leaving fullscreen by the browser's own route -- its Esc, or the window
       button -- means leaving the mode, not sitting in it half-applied.
       Both spellings, because goFullscreen and leaveFullscreen both fall back
       to the prefixed calls: a browser that can only ENTER by the webkit route
       would otherwise have no way back out, which is the half-applied state
       this listener exists to prevent. */
    function onFullscreenChange() {
      if (document.fullscreenElement || document.webkitFullscreenElement) return;
      if (focusMode.on) setFocus(false);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    el.toggleFocus.addEventListener('click', function () { setFocus(!focusMode.on); });
    syncFocus();
    api.setFocus = setFocus;
    api.focusOn = function () { return focusMode.on; };

    /* Start collapsed on a narrow screen, and re-settle when the breakpoint
     * is crossed so a drawer left open on mobile does not linger as a
     * half-state on desktop. */
    syncExportLabel();
    /* Crossing the breakpoint only has to clear transient state: the default
     * for each layout already comes from CSS. */
    /* "EPUB" is redundant where the app exports nothing else, and dropping it
       on a phone is what buys the title enough room to be worth showing. */
    /* The bar's button is now a way in rather than the action, so it says the
       same thing at every width; the button that does the work names the
       format, where the format is chosen. */
    function syncExportLabel() {
      el.exportRun.textContent =
        S('panel.export.run', { format: S('format.' + current.format) });
    }

    function settleForWidth() {
      /* The layout has just changed which element scrolls, so the reader is
         holding the wrong one. FIRST, because setFocus and applyPaged below
         both rebuild the scroller from the factory named here -- run last, they
         built it from the previous width's and briefly held a container that
         no longer scrolls. The reader keeps the place itself: capturing here
         would be too late, since the stylesheet has already relaid the page. */
      if (current.reader) current.reader.setScroller(scrollerFor());
      /* Focus mode is a desktop state and its CSS stops applying below the
         breakpoint. Leaving the class on would strand the remembered sidebar
         state with nothing left to restore it.

         An explicit null anchor rather than none: the breakpoint has already
         moved, so there is no live position left to read and the reader should
         fall back to the one it settled on while the old layout was still up. */
      setFocus(false, null);
      closeDropdowns(null);
      tuckPager(false);
      syncExportLabel();
      /* The preference outlives the width. It used to be dropped on the way
         down -- a phone could not paginate -- and restored on the way back up;
         now it simply holds, and the layout either side of the breakpoint
         gives the column a box to break into. */
      applyPaged(pagedPref());
      syncFocus();
      el.sidebar.classList.remove('open');
      el.sidebar.classList.remove('hidden');
      el.backdrop.classList.add('hidden');
      el.toggleSidebar.setAttribute('aria-expanded', String(drawerOpen()));
    }
    if (narrowQuery.addEventListener) narrowQuery.addEventListener('change', settleForWidth);
    else if (narrowQuery.addListener) narrowQuery.addListener(settleForWidth);

    /* Re-settle on resize as well. A frame laid out before it reaches its
     * final width evaluates as narrow at init, and if the media-query change
     * event is missed the sidebar stays collapsed on a wide window. Only acts
     * when the breakpoint side actually changed, so it stays cheap. */
    var wasNarrow = isNarrow();
    /* Column geometry is in pixels, so a resized window has to re-derive it.
       Debounced because a drag fires this continuously and each one re-renders
       the chapter; the reader ignores the call unless it is paginating. */
    var repaginateTimer = null;
    window.addEventListener('resize', function () {
      if (isNarrow() !== wasNarrow) { wasNarrow = isNarrow(); settleForWidth(); }
      if (repaginateTimer) clearTimeout(repaginateTimer);
      repaginateTimer = setTimeout(function () {
        if (current.reader) current.reader.repaginate();
      }, 150);
    });
    $('toggleReport').addEventListener('click', function () {
      el.reportPanel.classList.toggle('hidden');
    });
    current.keys = App.keys.create({
      reader: function () { return current.reader; },
      toggleToc: function () { el.toggleSidebar.click(); },
      toggleSource: function () { el.toggleSource.click(); },
      toggleMarks: function () { if (!el.toggleMarks.disabled) el.toggleMarks.click(); },
      fontBigger: function () { $('fontBigger').click(); },
      fontSmaller: function () { $('fontSmaller').click(); },
      toggleFocus: function () { setFocus(!focusMode.on); }
    });

    /* The label is the table's now, filled by apply() like every other one --
       this was the last piece of interface text written in JS, and the sweep
       that looks for stragglers could never have caught it, "Vim" being Latin
       in both languages. */
    function syncVim() {
      var on = current.keys.isEnabled();
      el.toggleVim.classList.toggle('active', on);
      el.toggleVim.setAttribute('aria-pressed', String(on));
    }
    el.toggleVim.addEventListener('click', function () {
      current.keys.toggle();
      syncVim();
      if (current.keys.isEnabled()) current.keys.showHelp();
    });
    syncVim();

    api.drawerOpen = drawerOpen;
    api.setDrawer = setDrawer;

    populateFontStyles('', current.presetId);
    el.fontStyle.addEventListener('change', function () {
      if (current.reader) current.reader.setFontStyle(this.value);
    });
    /* Coalesced, like the resize that re-paginates. One drag of either slider
       fires `input` about five times, and each one re-renders the whole
       chapter: the five overlapping renders raced over the reader's single
       pending-anchor slot, four of them found it already taken and fell back to
       the top of the chapter, so dragging 行寬 threw the reader out of the
       passage it was meant to be adjusting. Only the last value matters, and
       at 3,000 paragraphs the four discarded renders cost ~95ms of the drag. */
    function slide(fn) {
      var timer = null;
      return function () {
        var value = parseFloat(this.value);
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          timer = null;
          if (current.reader) fn(value);
        }, 120);
      };
    }
    el.lineHeight.addEventListener('input', slide(function (v) {
      current.reader.setLineHeight(v);
    }));
    el.measure.addEventListener('input', slide(function (v) {
      current.reader.setMeasure(v);
    }));

    /* The one place that knows the whole interface.
     *
     * apply() only reaches markup carrying data-i18n, and a good half of the
     * chrome is neither: option lists built in JS, buttons that name their own
     * state, the shelf, the table of contents. Every one of them has to be
     * rebuilt here, and the test walks the interface afterwards looking for
     * anything left in the language we just left. */
    function relabel() {
      App.strings.apply(document);
      populateThemes();
      populatePresets();
      populateAligns();
      populateFormats();
      syncExportLabel();
      syncPaged();
      syncMarksLabel();
      /* Rebuilds the table of contents and the title as well, which is where
         the "no table of contents" line lives. */
      syncSource();
      if (current.book && current.reader) {
        var wasFont = el.fontStyle.value;
        populateFontStyles(bookLanguage(current.book), current.presetId);
        if (wasFont) el.fontStyle.value = wasFont;
      }
      if (current.book) renderReport(current.book, current.fontReport);
      renderBookmarks();
      syncBookmark();
      renderLibrary();
      renderShelf();
      if (!current.reader) document.title = '繁花似錦 — ' + S('app.tagline');
    }

    /* One button, two languages: press it and you are in the other one. Its own
       label is filled by apply() during relabel(), like every other label. */
    el.lang.addEventListener('click', function () {
      App.strings.setLocale(App.strings.locale() === 'zh' ? 'en' : 'zh');
      relabel();
    });

    /* "Publisher" is the default and the honest one: most EPUBs set their own
       alignment, and overriding it unasked is not this reader's business. */
    function populateAligns() {
      var was = el.align.value;
      el.align.textContent = '';
      ['default', 'left', 'justify'].forEach(function (id) {
        var opt = document.createElement('option');
        opt.value = id;
        opt.textContent = S('align.' + id);
        el.align.appendChild(opt);
      });
      if (was) el.align.value = was;
    }
    populateAligns();
    el.align.addEventListener('change', function () {
      if (current.reader) current.reader.setAlign(this.value);
    });

    /* EPUB first: it is what puts the book on a reader, and the rest are for
       getting the text somewhere else. */
    function populateFormats() {
      el.exportFormat.textContent = '';
      ['epub', 'html', 'md', 'txt'].forEach(function (id) {
        var opt = document.createElement('option');
        opt.value = id;
        opt.textContent = S('format.' + id);
        el.exportFormat.appendChild(opt);
      });
      el.exportFormat.value = current.format;
    }
    populateFormats();
    el.exportFormat.addEventListener('change', function () {
      current.format = this.value;
      syncExportLabel();
    });
    el.exportRun.addEventListener('click', doExport);

    el.toggleSource.addEventListener('click', async function () {
      if (!current.reader) return;
      var next = current.reader.state.source === 'original' ? 'converted' : 'original';
      await current.reader.setSource(next);
      syncSource();
    });
    /* One button both ways. The list it feeds is in the sidebar, usually shut,
       so the press has to say what it did somewhere the reader is looking:
       the status line, which sits in the pager beside the position. */
    el.toggleBookmark.addEventListener('click', function () {
      if (!current.reader) return;
      var result = current.reader.toggleBookmark();
      if (!result) return;
      setStatus(S(result.added ? 'bookmark.added' : 'bookmark.removed'));
      setTimeout(function () { setStatus(''); }, 1600);
    });

    $('toggleMarks').addEventListener('click', function () {
      var next = !current.reader.state.showMarks;
      current.reader.setShowMarks(next);
      syncMarksLabel();
    });
    $('fontBigger').addEventListener('click', function () {
      current.reader.setFontScale(Math.min(2.2, current.reader.state.fontScale + 0.1));
    });
    $('fontSmaller').addEventListener('click', function () {
      current.reader.setFontScale(Math.max(0.7, current.reader.state.fontScale - 0.1));
    });

    document.addEventListener('keydown', function (ev) {
      if (!current.reader || !el.landing.classList.contains('hidden')) return;
      if (current.keys && current.keys.helpVisible()) return;
      if (ev.key === 'Escape' && focusMode.on) { setFocus(false); return; }
      /* Not while a control has the keyboard. Arrows are how a range slider and
         a select are operated, and the Aa panel now holds two of the first and
         three of the second: aiming ArrowRight at 行寬 both widened the line and
         turned the page. Same guard vim mode has used all along, borrowed
         rather than retyped. Escape is deliberately above it -- it is the way
         out of focus mode wherever the keyboard happens to be. */
      if (App.keys.inFormField(ev.target)) return;
      if (ev.key === 'ArrowRight' || ev.key === 'PageDown') current.reader.nextPage();
      if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') current.reader.prevPage();
    });
  }

  App.ui = { init: init, loadBuffer: loadBuffer, current: current,
             highlightToc: highlightToc,
             drawerOpen: function () { return el.sidebar && api.drawerOpen(); },
             focusOn: function () { return !!api.focusOn && api.focusOn(); },
             setFocus: function (on) { if (api.setFocus) api.setFocus(on); },
             renderLibrary: renderLibrary, renderShelf: renderShelf,
             setShelfOpen: setShelfOpen, switchToBook: switchToBook };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.App = window.App || {});
