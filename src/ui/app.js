/* Application shell: drop a book in, read it converted, export if wanted. */
(function (App) {
  'use strict';

  var el = {};
  var api = {};      // internals exposed for tests
  var current = { buffer: null, filename: '', book: null, reader: null, presetId: 'hk', punctuation: false };

  function $(id) { return document.getElementById(id); }

  function show(node, visible) { node.classList.toggle('hidden', !visible); }

  function setStatus(text) { el.status.textContent = text || ''; }

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
        a.textContent = label || '(untitled)';
        a.href = '#';
        a.dataset.path = n.path;
        a.dataset.fragment = n.fragment || '';
        a.addEventListener('click', function (ev) {
          ev.preventDefault();
          reader.goToPath(n.path, n.fragment);
          if (window.matchMedia('(max-width: 700px)').matches) {
            el.sidebar.classList.remove('open');
            el.backdrop.classList.add('hidden');
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
      p.textContent = 'This book has no table of contents.';
      el.toc.appendChild(p);
      return;
    }
    el.toc.appendChild(list(book.toc));
  }

  function titleFor(book, useOriginal) {
    var meta = useOriginal && book.metadata.original ? book.metadata.original : book.metadata;
    return meta.title || current.filename;
  }

  /* Re-label the chrome for whichever text is on screen. */
  function syncMarksLabel() {
    if (!el.toggleMarks || !current.reader) return;
    el.toggleMarks.textContent = current.reader.state.showMarks ? 'Hide marks' : 'Show marks';
    el.toggleMarks.classList.toggle('active', current.reader.state.showMarks);
  }

  function syncSource() {
    var original = current.reader && current.reader.state.source === 'original';
    el.toggleSource.textContent = original ? '轉換後' : '原文';
    el.toggleSource.classList.toggle('active', original);
    el.banner.classList.toggle('hidden', !original);
    el.toggleMarks.disabled = original;
    el.exportBtn.disabled = false;
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
    row('Target', r.preset.label + ' (' + r.preset.lang + ')');
    row('Documents converted', String(r.documents));
    row('Text nodes changed', String(r.changedNodes));
    row('Ambiguous characters marked', String(r.markCount));
    if (r.unalignedNodes) row('Nodes left unmarked', String(r.unalignedNodes) + ' (length changed)');

    el.reportBody.textContent = '';
    el.reportBody.appendChild(dl);

    function notice(text, ok) {
      var d = document.createElement('div');
      d.className = 'notice' + (ok ? ' ok' : '');
      d.textContent = text;
      el.reportBody.appendChild(d);
    }

    if (r.markCount) {
      notice('Dotted underlines mark characters with more than one traditional form. ' +
             'Click one to cycle through the alternatives — the choice applies to every ' +
             'occurrence in the same wording, and is carried into the exported file.', true);
    }

    (fontReport || []).forEach(function (f) {
      if (f.error) {
        notice('Embedded font ' + f.path + ' could not be read (' + f.error + '); it will be dropped on export.');
      } else if (!f.ok) {
        notice('Embedded font "' + (f.family || f.path) + '" covers only ' +
               Math.round(f.coverage * 100) + '% of the converted text' +
               (f.missingSample.length ? ' (missing e.g. ' + f.missingSample.join(' ') + ')' : '') +
               '. It will be dropped on export so the text stays readable.');
      } else {
        notice('Embedded font "' + (f.family || f.path) + '" covers the converted text.', true);
      }
    });

    if (book.encryption.obfuscatedFonts.length) {
      notice(book.encryption.obfuscatedFonts.length + ' embedded font(s) are obfuscated; ' +
             'they were decoded before checking coverage.', true);
    }

    var images = 0;
    book.manifest.forEach(function (i) { if (/^image\//.test(i.mediaType)) images++; });
    if (images) {
      notice(images + ' image(s) in this book. Any text drawn inside an image cannot be ' +
             'converted and will still read as simplified.');
    }

    r.warnings.forEach(function (w) { notice(w); });

    if (!App.llm.available()) {
      notice('LLM disambiguation is off. ' + App.llm.reason(), true);
    }
  }

  /* ---- loading ---- */

  async function loadBuffer(buffer, filename) {
    clearError();
    setStatus('Reading ' + filename + '…');

    if (current.reader) { current.reader.destroy(); current.reader = null; }

    var book;
    try {
      book = await App.parse.load(buffer);
    } catch (e) {
      setStatus('');
      showError(e.message);
      return;
    }

    setStatus('Converting…');
    await new Promise(function (r) { setTimeout(r, 0); });   // let the status paint

    try {
      await App.convert.book(book, current.presetId, function (fraction, path) {
        setStatus('Converting… ' + Math.round(fraction * 100) + '%');
      });
    } catch (e) {
      setStatus('');
      showError('Conversion failed: ' + e.message);
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
    document.title = (book.metadata.title || filename) + ' — 簡繁轉換';

    var reader = App.reader.create(el.viewer, book);
    current.reader = reader;

    reader.on('chapter', function (e) {
      reader.state.path = e.path;
      el.position.textContent = (e.index + 1) + ' / ' + e.total;
      el.prev.disabled = e.index === 0;
      el.next.disabled = e.index === e.total - 1;
      highlightToc(e.path);
    });
    reader.on('external', function (e) {
      setStatus('External link not opened: ' + e.href);
    });
    reader.on('missing', function (e) {
      setStatus('That entry points outside the reading order (' + e.path + ').');
    });

    buildToc(book, reader, reader.state.source === 'original');
    setSidebarTab('toc');
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
    el.fontStyle.value = reader.state.fontStyle;
    syncMarksLabel();
    el.lineHeight.value = reader.state.lineHeight;
    syncSource();
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
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' days ago';
    return new Date(ts).toLocaleDateString();
  }

  async function openFromLibrary(entry, row) {
    clearError();
    row.classList.add('busy');
    setStatus('Opening ' + entry.title + '…');
    try {
      var bytes = await App.library.load(entry.id);
      if (!bytes) throw new Error('that book is no longer stored');
      await loadBuffer(bytes, entry.title);
    } catch (e) {
      setStatus('');
      showError('Could not open it: ' + e.message);
    }
    row.classList.remove('busy');
  }

  async function renderLibrary() {
    if (!App.library.available()) { show(el.library, false); return; }

    var books = [];
    try { books = await App.library.list(); } catch (e) { books = []; }
    if (!books.length) { show(el.library, false); return; }

    el.libraryList.textContent = '';
    books.forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'library-row';

      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'open';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = entry.title || '(untitled)';
      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = formatSize(entry.size) +
        (entry.lastOpenedAt ? ' · ' + formatWhen(entry.lastOpenedAt) : '');
      open.appendChild(name);
      open.appendChild(meta);
      open.addEventListener('click', function () { openFromLibrary(entry, row); });

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '×';
      remove.title = 'Remove from this device';
      remove.setAttribute('aria-label', 'Remove ' + (entry.title || 'book'));
      remove.addEventListener('click', async function (ev) {
        ev.stopPropagation();
        await App.library.remove(entry.id);
        await renderLibrary();
      });

      row.appendChild(open);
      row.appendChild(remove);
      el.libraryList.appendChild(row);
    });

    var used = await App.library.usage();
    el.libraryNote.textContent = books.length + ' book' + (books.length === 1 ? '' : 's') +
      ' stored in this browser' +
      (used.used ? ', using ' + formatSize(used.used) : '') +
      '. They never leave this device.';
    show(el.library, true);
  }

  /* ---- the shelf, inside the reader ----
   *
   * The sidebar carries two panels: the book's table of contents, and the
   * cached books. Switching between books is just loading stored bytes back
   * through the ordinary open path, so the target book converts with the
   * currently selected preset and lands at its own saved position.
   */
  function setSidebarTab(which) {
    var shelf = which === 'shelf';
    el.toc.classList.toggle('hidden', shelf);
    el.shelf.classList.toggle('hidden', !shelf);
    el.tabToc.classList.toggle('active', !shelf);
    el.tabShelf.classList.toggle('active', shelf);
    el.tabToc.setAttribute('aria-selected', String(!shelf));
    el.tabShelf.setAttribute('aria-selected', String(shelf));
    if (shelf) renderShelf();
  }

  async function switchToBook(entry) {
    if (current.book && App.library.idFor(current.book) === entry.id) {
      setSidebarTab('toc');
      return;
    }
    setStatus('Opening ' + entry.title + '…');
    try {
      var bytes = await App.library.load(entry.id);
      if (!bytes) throw new Error('that book is no longer stored');
      await loadBuffer(bytes, entry.title);
      setSidebarTab('toc');
    } catch (e) {
      setStatus('');
      showError('Could not open it: ' + e.message);
    }
  }

  async function renderShelf() {
    if (!el.shelf) return;
    if (!App.library.available()) {
      el.shelfList.textContent = '';
      el.shelfNote.textContent = App.library.reason();
      return;
    }

    var books = [];
    try { books = await App.library.list(); } catch (e) { books = []; }
    var currentId = current.book ? App.library.idFor(current.book) : null;

    el.shelfList.textContent = '';
    books.forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'shelf-row' + (entry.id === currentId ? ' current' : '');

      var pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'pick';
      var t = document.createElement('span');
      t.className = 't';
      t.textContent = entry.title || '(untitled)';
      var sub = document.createElement('span');
      sub.className = 's';
      sub.textContent = formatSize(entry.size) +
        (entry.id === currentId ? ' · reading now' : '');
      pick.appendChild(t);
      pick.appendChild(sub);
      pick.addEventListener('click', function () { switchToBook(entry); });

      var drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'drop';
      drop.textContent = '×';
      drop.title = 'Remove from this device';
      drop.setAttribute('aria-label', 'Remove ' + (entry.title || 'book'));
      drop.addEventListener('click', async function (ev) {
        ev.stopPropagation();
        await App.library.remove(entry.id);
        await renderShelf();
        await renderLibrary();
      });

      row.appendChild(pick);
      row.appendChild(drop);
      el.shelfList.appendChild(row);
    });

    el.shelfNote.textContent = books.length
      ? books.length + ' book' + (books.length === 1 ? '' : 's') + ' cached on this device.'
      : 'No books cached yet. Books you open are kept here.';
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
    el.exportBtn.disabled = true;
    setStatus('Building EPUB…');
    try {
      var summary = await App.export.buildFile(current.book, {
        overrides: current.reader ? current.reader.overrides() : {},
        punctuation: current.punctuation
      });
      App.export.download(summary.blob, App.export.filenameFor(current.book));
      setStatus('Exported ' + App.export.filenameFor(current.book) +
                (summary.overrides ? ' with ' + summary.overrides + ' manual correction(s)' : '') +
                (summary.fontsStripped.length ? ', ' + summary.fontsStripped.length + ' font(s) dropped' : ''));
    } catch (e) {
      showError('Export failed: ' + e.message);
      setStatus('');
    }
    el.exportBtn.disabled = false;
  }

  /* ---- wiring ---- */

  function init() {
    el.landing = $('landing');
    el.chrome = $('chrome');
    el.dropzone = $('dropzone');
    el.fileInput = $('fileInput');
    el.preset = $('preset');
    el.presetTop = $('presetTop');
    el.punct = $('punct');
    el.library = $('library');
    el.libraryList = $('libraryList');
    el.libraryNote = $('libraryNote');
    el.status = $('status');
    el.error = $('error');
    el.title = $('bookTitle');
    el.viewer = $('viewer');
    el.toc = $('toc');
    el.shelf = $('shelf');
    el.shelfList = $('shelfList');
    el.shelfNote = $('shelfNote');
    el.tabToc = $('tabToc');
    el.tabShelf = $('tabShelf');
    el.sidebar = $('sidebar');
    el.prev = $('prev');
    el.next = $('next');
    el.position = $('position');
    el.exportBtn = $('exportBtn');
    el.reportPanel = $('reportPanel');
    el.reportBody = $('reportBody');
    el.theme = $('theme');
    el.themeLanding = $('themeLanding');
    el.toggleSource = $('toggleSource');
    el.toggleVim = $('toggleVim');
    el.fontStyle = $('fontStyle');
    el.lineHeight = $('lineHeight');
    el.toggleSidebar = $('toggleSidebar');
    el.moreBtn = $('moreBtn');
    el.topbarMore = $('topbarMore');
    el.backdrop = $('drawerBackdrop');
    el.toggleMarks = $('toggleMarks');
    el.banner = $('originalBanner');

    App.theme.THEMES.forEach(function (t) {
      [el.theme, el.themeLanding].forEach(function (select) {
        var opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.label;
        select.appendChild(opt);
      });
    });
    el.theme.value = App.theme.current();
    el.themeLanding.value = App.theme.current();

    function onThemeChange(value) {
      var applied = App.theme.apply(value);
      el.theme.value = applied;
      el.themeLanding.value = applied;
    }
    el.theme.addEventListener('change', function () { onThemeChange(this.value); });
    el.themeLanding.addEventListener('change', function () { onThemeChange(this.value); });

    App.convert.PRESETS.forEach(function (p) {
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

    el.dropzone.addEventListener('click', function () { el.fileInput.click(); });
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
    el.tabToc.addEventListener('click', function () { setSidebarTab('toc'); });
    el.tabShelf.addEventListener('click', function () { setSidebarTab('shelf'); });

    el.preset.addEventListener('change', function () { current.presetId = el.preset.value; });
    el.punct.addEventListener('change', function () { current.punctuation = el.punct.checked; });

    /* Changing the target re-converts from the ORIGINAL bytes: conversion
     * rewrites entries in place, so re-running it on an already-converted
     * book would compound the changes. */
    el.presetTop.addEventListener('change', function () {
      current.presetId = el.presetTop.value;
      el.preset.value = current.presetId;
      if (current.buffer) loadBuffer(current.buffer, current.filename);
    });

    el.prev.addEventListener('click', function () { current.reader.prev(); });
    el.next.addEventListener('click', function () { current.reader.next(); });
    el.exportBtn.addEventListener('click', doExport);

    /* Below the breakpoint the sidebar is an overlay drawer, so its open
     * state has to drive a backdrop too. Above it, the backdrop stays out of
     * the way and the sidebar is just shown or collapsed as before. */
    function isNarrow() {
      return window.matchMedia('(max-width: 700px)').matches;
    }

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
    }

    function drawerOpen() {
      return isNarrow()
        ? el.sidebar.classList.contains('open')
        : !el.sidebar.classList.contains('hidden');
    }

    function setMore(open) {
      el.topbarMore.classList.toggle('open', open);
      el.moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    $('toggleSidebar').addEventListener('click', function () {
      setDrawer(!drawerOpen());
      setMore(false);
    });
    el.backdrop.addEventListener('click', function () { setDrawer(false); });

    el.moreBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      setMore(!el.topbarMore.classList.contains('open'));
    });
    /* Any action inside the menu closes it, as does a tap anywhere outside. */
    el.topbarMore.addEventListener('click', function (ev) {
      if (ev.target.localName === 'button') setMore(false);
    });
    document.addEventListener('click', function (ev) {
      if (!el.topbarMore.contains(ev.target) && ev.target !== el.moreBtn) setMore(false);
    });

    /* Start collapsed on a narrow screen, and re-settle when the breakpoint
     * is crossed so a drawer left open on mobile does not linger as a
     * half-state on desktop. */
    var narrowQuery = window.matchMedia('(max-width: 700px)');
    /* Crossing the breakpoint only has to clear transient state: the default
     * for each layout already comes from CSS. */
    function settleForWidth() {
      setMore(false);
      el.sidebar.classList.remove('open');
      el.sidebar.classList.remove('hidden');
      el.backdrop.classList.add('hidden');
    }
    if (narrowQuery.addEventListener) narrowQuery.addEventListener('change', settleForWidth);
    else if (narrowQuery.addListener) narrowQuery.addListener(settleForWidth);

    /* Re-settle on resize as well. A frame laid out before it reaches its
     * final width evaluates as narrow at init, and if the media-query change
     * event is missed the sidebar stays collapsed on a wide window. Only acts
     * when the breakpoint side actually changed, so it stays cheap. */
    var wasNarrow = isNarrow();
    window.addEventListener('resize', function () {
      if (isNarrow() !== wasNarrow) { wasNarrow = isNarrow(); settleForWidth(); }
    });
    $('toggleReport').addEventListener('click', function () {
      el.reportPanel.classList.toggle('hidden');
    });
    $('toggleVertical').addEventListener('click', function () {
      var next = current.reader.state.mode === 'vertical' ? 'scroll' : 'vertical';
      this.textContent = next === 'vertical' ? '橫書' : '直書';
      current.reader.setMode(next);
    });
    current.keys = App.keys.create({
      reader: function () { return current.reader; },
      toggleToc: function () { el.toggleSidebar.click(); },
      toggleVertical: function () { $('toggleVertical').click(); },
      toggleSource: function () { el.toggleSource.click(); },
      toggleMarks: function () { if (!el.toggleMarks.disabled) el.toggleMarks.click(); },
      fontBigger: function () { $('fontBigger').click(); },
      fontSmaller: function () { $('fontSmaller').click(); }
    });

    function syncVim() {
      var on = current.keys.isEnabled();
      el.toggleVim.classList.toggle('active', on);
      el.toggleVim.textContent = on ? 'Vim ?' : 'Vim';
    }
    el.toggleVim.addEventListener('click', function () {
      current.keys.toggle();
      syncVim();
      if (current.keys.isEnabled()) current.keys.showHelp();
    });
    syncVim();

    api.drawerOpen = drawerOpen;

    App.readingFonts.STYLES.forEach(function (f) {
      var opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.label;
      opt.title = f.note;
      el.fontStyle.appendChild(opt);
    });
    el.fontStyle.addEventListener('change', function () {
      if (current.reader) current.reader.setFontStyle(this.value);
    });
    el.lineHeight.addEventListener('input', function () {
      if (current.reader) current.reader.setLineHeight(parseFloat(this.value));
    });

    el.toggleSource.addEventListener('click', async function () {
      if (!current.reader) return;
      var next = current.reader.state.source === 'original' ? 'converted' : 'original';
      await current.reader.setSource(next);
      syncSource();
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
      if (ev.key === 'ArrowRight' || ev.key === 'PageDown') current.reader.next();
      if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') current.reader.prev();
    });
  }

  App.ui = { init: init, loadBuffer: loadBuffer, current: current,
             drawerOpen: function () { return el.sidebar && api.drawerOpen(); },
             renderLibrary: renderLibrary, renderShelf: renderShelf,
             setSidebarTab: setSidebarTab, switchToBook: switchToBook };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.App = window.App || {});
