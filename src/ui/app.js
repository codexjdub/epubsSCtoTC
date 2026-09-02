/* Application shell: drop a book in, read it converted, export if wanted. */
(function (App) {
  'use strict';

  var el = {};
  var api = {};      // internals exposed for tests
  var lastViewerScroll = 0;
  var current = { buffer: null, filename: '', book: null, reader: null, presetId: 'hk', punctuation: false };

  function $(id) { return document.getElementById(id); }
  function S(key, vars) { return App.strings.get(key, vars); }
  function isNarrowScreen() { return window.matchMedia('(max-width: 700px)').matches; }

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
      return App.reader.documentScroller(function () {
        var bar = document.querySelector('.topbar');
        return bar ? bar.offsetHeight : 0;
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
      p.textContent = 'This book has no table of contents.';
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
    document.title = (book.metadata.title || filename) + ' — 繁花似錦';

    var reader = App.reader.create(el.viewer, book, { scroller: scrollerFor() });
    current.reader = reader;

    /* Chapter count plus how far through the book, which the index alone does
       not tell you when chapters differ in length by an order of magnitude. */
    var pos = { index: 0, total: 0 };
    function renderPosition() {
      var pct = current.reader ? current.reader.progress() : null;
      el.position.textContent = (pos.index + 1) + ' / ' + pos.total +
        (pct === null ? '' : ' · ' + Math.round(pct * 100) + '%');
    }

    reader.on('chapter', function (e) {
      reader.state.path = e.path;
      pos.index = e.index;
      pos.total = e.total;
      /* A new chapter starts at the top, so the pager belongs on screen. */
      if (api.tuckPager) api.tuckPager(false);
      lastViewerScroll = 0;
      renderPosition();
      el.prev.disabled = e.index === 0;
      el.next.disabled = e.index === e.total - 1;
      highlightToc(e.path);
    });
    reader.on('progress', renderPosition);
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
    el.align.value = reader.state.align;
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
      name.textContent = entry.title || '(untitled)';
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
      drop.title = 'Remove from this device';
      drop.setAttribute('aria-label', 'Remove ' + (entry.title || 'book'));
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

    var used = await App.library.usage();
    el.libraryNote.textContent = books.length + ' book' + (books.length === 1 ? '' : 's') +
      ' stored in this browser' +
      (used.used ? ', using ' + formatSize(used.used) : '') +
      '. They never leave this device.';
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
        return formatSize(entry.size) + (entry.id === id ? ' · reading now' : '');
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
    el.exportBtn.disabled = true;
    setStatus(S('status.exporting'));
    try {
      /* Covers the archive write, which is the slow part on a large book.
         The passes before it are fast enough not to need their own reporting. */
      var summary = await App.export.buildFile(current.book, {
        overrides: current.reader ? current.reader.overrides() : {},
        punctuation: current.punctuation
      }, function (fraction) {
        setStatus(S('status.exporting.pct', { pct: Math.round(fraction * 100) }));
      });
      App.export.download(summary.blob, App.export.filenameFor(current.book));
      setStatus(S('status.exported', { name: App.export.filenameFor(current.book) }) +
                (summary.overrides ? S('status.exported.corrections', { n: summary.overrides }) : '') +
                (summary.fontsStripped.length
                  ? S('status.exported.fonts', { n: summary.fontsStripped.length }) : ''));
    } catch (e) {
      showError(S('error.export', { message: e.message }));
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
    el.shelfPanel = $('shelfPanel');
    el.shelfList = $('shelfList');
    el.shelfNote = $('shelfNote');
    el.toggleShelf = $('toggleShelf');
    el.openNew = $('openNew');
    el.sidebar = $('sidebar');
    el.prev = $('prev');
    el.pager = document.querySelector('.pager');
    el.topbar = document.querySelector('.topbar');
    el.back = $('back');
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
    el.align = $('align');
    el.toggleSidebar = $('toggleSidebar');
    el.aaBtn = $('aaBtn');
    el.aaPanel = $('aaPanel');
    el.convBtn = $('convBtn');
    el.convPanel = $('convPanel');
    el.backdrop = $('drawerBackdrop');
    el.toggleMarks = $('toggleMarks');
    el.banner = $('originalBanner');

    App.strings.apply(document);

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

    function onThemeChange(value) {
      var applied = App.theme.apply(value);
      el.theme.value = applied;
      el.themeLanding.value = applied;
    }
    el.theme.addEventListener('change', function () { onThemeChange(this.value); });
    el.themeLanding.addEventListener('change', function () { onThemeChange(this.value); });

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
      { btn: el.convBtn, panel: el.convPanel }
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
    [el.aaPanel, el.convPanel].forEach(function (panel) {
      panel.addEventListener('click', function (ev) {
        if (ev.target.localName !== 'button') return;
        if (ev.target.hasAttribute('data-keep-open')) return;
        closeDropdowns(null);
      });
    });

    api.closeDropdowns = closeDropdowns;

    el.preset.addEventListener('change', function () { current.presetId = el.preset.value; });
    /* One setting with a control in two places -- the landing page and the
     * reader bar, beside the Export button it actually affects -- kept in
     * step the same way the preset and theme selectors are. */
    function onPunctChange(on) {
      current.punctuation = on;
      el.punct.checked = on;
      el.punctTop.checked = on;
    }
    el.punct.addEventListener('change', function () { onPunctChange(this.checked); });
    el.punctTop.addEventListener('change', function () { onPunctChange(this.checked); });

    /* Changing the target re-converts from the ORIGINAL bytes: conversion
     * rewrites entries in place, so re-running it on an already-converted
     * book would compound the changes. */
    el.presetTop.addEventListener('change', function () {
      current.presetId = el.presetTop.value;
      el.preset.value = current.presetId;
      if (current.buffer) loadBuffer(current.buffer, current.filename);
    });

    el.back.addEventListener('click', function () { current.reader.back(); });
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
      el.toggleSidebar.setAttribute('aria-expanded', String(open));
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
      if (!isNarrow()) { tuckPager(false); return; }
      var at = readingScroll();
      var delta = at.top - lastViewerScroll;
      if (Math.abs(delta) < 8) return;          /* ignore jitter and bounce */
      lastViewerScroll = at.top;
      tuckPager(at.top + at.visible >= at.full - 8 ? false : delta > 0);
    }
    el.viewer.addEventListener('scroll', onReadingScroll, { passive: true });
    window.addEventListener('scroll', onReadingScroll, { passive: true });

    api.tuckPager = tuckPager;

    /* Start collapsed on a narrow screen, and re-settle when the breakpoint
     * is crossed so a drawer left open on mobile does not linger as a
     * half-state on desktop. */
    syncExportLabel();
    var narrowQuery = window.matchMedia('(max-width: 700px)');
    /* Crossing the breakpoint only has to clear transient state: the default
     * for each layout already comes from CSS. */
    /* "EPUB" is redundant where the app exports nothing else, and dropping it
       on a phone is what buys the title enough room to be worth showing. */
    function syncExportLabel() {
      el.exportBtn.textContent = S(isNarrow() ? 'bar.export.short' : 'bar.export');
    }

    function settleForWidth() {
      closeDropdowns(null);
      tuckPager(false);
      syncExportLabel();
      /* The layout has just changed which element scrolls, so the reader is
         holding the wrong one. It keeps the place itself: capturing here would
         be too late, since the stylesheet has already relaid the page. */
      if (current.reader) current.reader.setScroller(scrollerFor());
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
    window.addEventListener('resize', function () {
      if (isNarrow() !== wasNarrow) { wasNarrow = isNarrow(); settleForWidth(); }
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
      fontSmaller: function () { $('fontSmaller').click(); }
    });

    function syncVim() {
      var on = current.keys.isEnabled();
      el.toggleVim.classList.toggle('active', on);
      el.toggleVim.textContent = on ? 'Vim ?' : 'Vim';
      el.toggleVim.setAttribute('aria-pressed', String(on));
    }
    el.toggleVim.addEventListener('click', function () {
      current.keys.toggle();
      syncVim();
      if (current.keys.isEnabled()) current.keys.showHelp();
    });
    syncVim();

    api.drawerOpen = drawerOpen;

    populateFontStyles('', current.presetId);
    el.fontStyle.addEventListener('change', function () {
      if (current.reader) current.reader.setFontStyle(this.value);
    });
    el.lineHeight.addEventListener('input', function () {
      if (current.reader) current.reader.setLineHeight(parseFloat(this.value));
    });

    /* "Publisher" is the default and the honest one: most EPUBs set their own
       alignment, and overriding it unasked is not this reader's business. */
    ['default', 'left', 'justify'].forEach(function (id) {
      var opt = document.createElement('option');
      opt.value = id;
      opt.textContent = S('align.' + id);
      el.align.appendChild(opt);
    });
    el.align.addEventListener('change', function () {
      if (current.reader) current.reader.setAlign(this.value);
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
             setShelfOpen: setShelfOpen, switchToBook: switchToBook };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.App = window.App || {});
