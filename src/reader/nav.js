/* Reader engine: spine state, shadow-root mounting, link interception,
 * reading-position memory, and the tap-to-flip override model. */
(function (App) {
  'use strict';

  var Z = App.zip;

  var BASE_CSS =
    ':host { display: block; background: transparent; }\n' +
    ':host, :host * { color: var(--fg, inherit) !important; ' +
    'background-color: transparent !important; }\n' +
    'img, svg, image { max-width: 100%; height: auto; }\n' +
    'a { color: inherit; }\n' +
    '.amb-mark { border-bottom: 1px dotted currentColor; cursor: pointer; opacity: .95; }\n' +
    '.amb-mark:hover { background-color: rgba(127,127,127,.25) !important; }\n' +
    '.amb-mark[data-overridden="1"] { border-bottom-style: solid; }\n';

  /* Reader-mode font override. The book's own embedded faces are usually
   * subset to the simplified glyphs it originally used, so after conversion
   * they cannot render half the text. In the reader we control the rendering
   * and simply do not use them; the export path strips them instead. */
  function fontCss(family, scale, lineHeight) {
    return ':host, :host * { font-family: ' + family + ' !important; }\n' +
           ':host { font-size: ' + scale + 'em; line-height: ' + lineHeight + '; }\n';
  }

  /* Overriding the publisher, which is what an alignment control is for --
   * every reader that offers one does exactly this. Restricted to <p> so a
   * centred title or a right-aligned attribution is left as the book set it. */
  function alignCss(align) {
    if (align !== 'left' && align !== 'justify') return '';
    return ':host p { text-align: ' + align + ' !important; }\n';
  }

  function modeCss() {
    return ':host { writing-mode: horizontal-tb; max-width: 38em; margin: 0 auto; padding: 1em; }\n';
  }

  function hashKey(book) {
    /* Content identity when we have it. The metadata seed is only a fallback
     * for books assembled without going through parse.load, and carries the
     * collision risk that motivated contentId in the first place. */
    if (book.contentId) return 'epub-tc:' + book.contentId;
    var seed = (book.metadata.identifier || book.metadata.title || 'book') + ':' + book.entries.size;
    var h = 5381;
    for (var i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
    return 'epub-tc:' + (h >>> 0).toString(36);
  }

  /* localStorage is unreliable at file:// (Safari in particular blocks it),
   * so every access degrades to in-memory state rather than throwing. */
  function createStore(key) {
    var memory = {};
    function read() {
      try {
        var raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : {};
      } catch (e) { return memory; }
    }
    function write(value) {
      memory = value;
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
    return { read: read, write: write };
  }

  /* Typography is about the reader's eyes, not about the book, so it lives in
   * one global record the way the theme and the vim setting already do.
   * Keeping it per book meant every new book reset the font size. */
  var PREFS_KEY = 'epub-tc:reading';

  /* The one object that knows what scrolls.
   *
   * Everything positional reads through it: the reading anchor, the progress
   * figure, the vim motions, the chrome that tucks away. It is an object
   * rather than a handful of helpers so the answer can change -- having the
   * DOCUMENT scroll instead of an inner element is what lets a mobile browser
   * collapse its own chrome, and that swap should be one implementation, not
   * ten call sites.
   *
   * viewportRect is deliberately separate from the element itself. For an
   * element scroller they are the same box; for a document scroller they are
   * not, and reading the element's rect there returns the whole page.
   */
  function elementScroller(element) {
    return {
      kind: 'element',
      element: element,
      top: function () { return element.scrollTop; },
      setTop: function (value) { element.scrollTop = value; },
      extent: function () { return element.clientHeight; },
      contentExtent: function () { return element.scrollHeight; },
      viewportRect: function () { return element.getBoundingClientRect(); },
      /* scrollIntoView already aligns to this element's own top, so nothing
       * needs correcting. Not the same number as viewportRect().top, which is
       * where the element sits in the window. */
      inset: function () { return 0; },
      scrollBy: function (delta) { element.scrollBy({ top: delta, behavior: 'auto' }); },
      listen: function (fn) { element.addEventListener('scroll', fn, { passive: true }); },
      unlisten: function (fn) { element.removeEventListener('scroll', fn); }
    };
  }

  /* The document as the scroller.
   *
   * Only this makes a mobile browser collapse its own chrome: browsers watch
   * the root scroller, and an inner overflow container is invisible to them.
   *
   * `inset` is the height of any fixed chrome across the top. It matters
   * because the anchor is measured from the top of the READABLE area, not the
   * top of the window -- get it wrong and every restored position sits that
   * far under the bar. Capture and restore both read it, so they agree.
   */
  function documentScroller(inset) {
    var doc = document.scrollingElement || document.documentElement;
    function top() { return inset ? inset() : 0; }
    return {
      kind: 'document',
      element: doc,
      top: function () { return doc.scrollTop; },
      setTop: function (value) { doc.scrollTop = value; },
      extent: function () { return window.innerHeight - top(); },
      contentExtent: function () { return doc.scrollHeight; },
      /* The visible window, inset by the chrome -- NOT the element's own rect,
       * which for the document is the whole page. */
      viewportRect: function () {
        return {
          top: top(), left: 0,
          right: window.innerWidth, bottom: window.innerHeight,
          width: window.innerWidth, height: window.innerHeight - top()
        };
      },
      /* Here it is real: scrollIntoView aligns to the window, and the readable
       * area starts below the fixed chrome. */
      inset: function () { return top(); },
      scrollBy: function (delta) { window.scrollBy({ top: delta, behavior: 'auto' }); },
      listen: function (fn) { window.addEventListener('scroll', fn, { passive: true }); },
      unlisten: function (fn) { window.removeEventListener('scroll', fn); }
    };
  }

  function create(host, book, opts) {
    opts = opts || {};
    var resources = App.reader.createResourceMap(book);
    var store = createStore(hashKey(book));
    var prefs = createStore(PREFS_KEY);
    var saved = store.read();
    /* Falls back to whatever this book had stored, so a reader who already set
     * a size keeps it the first time they open a book after this change. */
    var savedPrefs = prefs.read();
    function pref(name, fallback) {
      return savedPrefs[name] !== undefined ? savedPrefs[name]
           : saved[name] !== undefined ? saved[name] : fallback;
    }

    var state = {
      index: 0,
      fontStyle: App.readingFonts.isValidStyle(pref('fontStyle'))
        ? pref('fontStyle') : App.readingFonts.DEFAULT,
      fontScale: pref('fontScale', 1),
      lineHeight: pref('lineHeight', 1.9),
      align: pref('align', 'default'),
      /* Off by default. A full-length book produces thousands of marked
       * characters, and most are readings the converter is not actually in
       * doubt about, so underlining them all obscures the text rather than
       * helping. The toggle turns them on when someone wants to review. */
      showMarks: saved.showMarks === true,
      source: saved.source === 'original' ? 'original' : 'converted',
      overrides: saved.overrides || {},
      listeners: {}
    };

    var restoreScroll = null;
    /* The last anchor that was worth keeping. Capturing on demand is too late
     * when the breakpoint moves: the stylesheet has already relaid the page,
     * so the outgoing scroller measures a layout that no longer exists and
     * reports the top of the book. */
    var lastAnchor = null;
    var mount = document.createElement('div');
    mount.className = 'reader-mount';
    host.appendChild(mount);
    var shadow = mount.attachShadow({ mode: 'open' });
    var styleEl = document.createElement('style');
    var content = document.createElement('div');
    shadow.appendChild(styleEl);
    shadow.appendChild(content);

    /* The content expands the shadow host and the surrounding container
     * scrolls it. Reading the wrong element silently does nothing -- it is why
     * saved positions were always 0 -- so nothing here names an element
     * directly; it all goes through the scroller. Captured once, so teardown
     * can still detach its listener after the mount is gone. */
    /* Which one is the caller's decision: app.js knows the breakpoint and the
     * height of its own chrome. Defaults to the element, so anything creating
     * a reader without an opinion behaves as it always did. */
    var scroll = opts.scroller ? opts.scroller(mount) : elementScroller(mount.parentNode);

    function scrollPosition() { return scroll.top(); }

    function scrollBy(delta) { scroll.scrollBy(delta); }

    function viewportExtent() { return scroll.extent(); }

    function scrollToStart() { scroll.setTop(0); }

    function scrollToEnd() { scroll.setTop(scroll.contentExtent()); }

    /* Glyph region follows the conversion target, so the rendering does not
     * undo what the conversion just did. */
    function fontStack() {
      var preset = book.report && book.report.preset ? book.report.preset.id : 'hk';
      /* The language BEFORE conversion: an English book is still English, and
       * conversion retags Chinese ones to the preset's tag anyway. */
      var meta = book.metadata || {};
      var language = (meta.original && meta.original.language) || meta.language;
      return App.readingFonts.stackFor(state.fontStyle, preset, language);
    }

    /* Reading position as a content anchor rather than a pixel offset.
     *
     * A raw scrollTop is only meaningful for the exact layout that produced
     * it. Changing the font size, line height, typeface, theme or window
     * width -- all of which this reader invites -- reflows the text and leaves
     * that number pointing somewhere else entirely.
     *
     * Instead: remember which block was at the leading edge and how far into
     * it we had read. Both survive reflow.
     */
    function blockSize(rect) { return rect.height; }

    /* How far the leading edge has moved past this block's start. */
    function scrolledPast(rect, containerRect) {
      return containerRect.top - rect.top;
    }

    /* scrollIntoView aligns a block to the top of the WINDOW; the anchor is
     * measured from the top of the READABLE area, which sits below any fixed
     * chrome. Uncorrected, the two disagree by exactly the height of that
     * chrome and every restored position lands underneath it. */
    function alignToReadableTop(el) {
      el.scrollIntoView({ block: 'start' });
      var inset = scroll.inset ? scroll.inset() : 0;
      if (inset) scroll.setTop(scroll.top() - inset);
    }

    function captureAnchor() {
      /* A destroyed reader must not answer. Its mount is detached, so the
       * scroll container is gone (parentNode is null) and the anchor it would
       * produce gets written over the book's real saved position. */
      if (!mount.isConnected) return null;
      var blocks = content.children;
      if (!blocks.length) return null;
      var containerRect = scroll.viewportRect();
      for (var i = 0; i < blocks.length; i++) {
        var rect = blocks[i].getBoundingClientRect();
        var size = blockSize(rect);
        if (size <= 0) continue;
        var past = scrolledPast(rect, containerRect);
        if (past < size) {
          return {
            index: i,
            id: blocks[i].id || '',
            fraction: Math.max(0, Math.min(1, past / size))
          };
        }
      }
      return { index: blocks.length - 1, id: '', fraction: 1 };
    }

    function restoreAnchor(anchor) {
      if (!anchor || !content.children.length) return false;
      var el = null;
      if (anchor.id) {
        try {
          el = content.querySelector('#' + (window.CSS && CSS.escape
            ? CSS.escape(anchor.id) : anchor.id));
        } catch (e) { el = null; }
      }
      if (!el) el = content.children[anchor.index] || null;
      if (!el) return false;

      alignToReadableTop(el);
      var offset = (anchor.fraction || 0) * blockSize(el.getBoundingClientRect());
      if (offset) scrollBy(offset);
      return true;
    }

    function emit(name, payload) {
      (state.listeners[name] || []).forEach(function (fn) { fn(payload); });
    }
    function on(name, fn) {
      (state.listeners[name] = state.listeners[name] || []).push(fn);
    }

    function persistPrefs() {
      prefs.write({
        fontStyle: state.fontStyle,
        fontScale: state.fontScale,
        lineHeight: state.lineHeight,
        align: state.align
      });
    }

    function persist() {
      persistPrefs();
      var here = captureAnchor();
      if (here) lastAnchor = here;
      store.write({
        index: state.index,
        showMarks: state.showMarks,
        source: state.source,
        anchor: lastAnchor,
        overrides: state.overrides
      });
    }

    /* How far through the BOOK, not the chapter list.
     *
     * The spine index is a poor proxy: chapters vary by an order of magnitude,
     * so "3 / 42" says nothing about how much is left. Weight each chapter by
     * its character count with tags stripped -- computed once, from text that
     * is already in memory after conversion. */
    var weights = null;
    var totalChars = 0;

    function chapterWeights() {
      if (weights) return weights;
      var items = spineItems();
      weights = [];
      totalChars = 0;
      for (var i = 0; i < items.length; i++) {
        var entry = book.entries.get(items[i].item.path);
        var text = entry && typeof entry.text === 'string' ? entry.text : '';
        var n = text.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length;
        weights.push({ start: totalChars, size: n });
        totalChars += n;
      }
      return weights;
    }

    /* null when the weights are unusable -- an unconverted book has no text in
     * memory to count, and a fabricated percentage would be worse than none. */
    function progress() {
      var w = chapterWeights();
      if (!totalChars) return null;
      var cur = w[state.index] || { start: 0, size: 0 };
      var span = scroll.contentExtent() - scroll.extent();
      var frac = span > 0 ? Math.min(1, Math.max(0, scroll.top() / span)) : 0;
      return Math.min(1, (cur.start + cur.size * frac) / totalChars);
    }

    function spineItems() {
      return book.spine.items.filter(function (s) { return s.linear !== false; });
    }

    /* Overrides recorded in an earlier session (or an earlier chapter) are
     * replayed onto freshly rendered marks. */
    function applyOverrides(root) {
      var marks = root.querySelectorAll('.amb-mark');
      for (var i = 0; i < marks.length; i++) {
        var key = marks[i].getAttribute('data-key');
        var choice = state.overrides[key];
        if (choice && choice !== marks[i].textContent) {
          marks[i].textContent = choice;
          marks[i].setAttribute('data-chosen', choice);
          marks[i].setAttribute('data-overridden', '1');
        }
      }
    }

    function cycleMark(el) {
      /* Array.from, not split(''): some candidate lists contain astral
       * characters -- 岁 offers 歲 嵗 𡻕 -- and splitting by code unit would
       * cycle through half a surrogate pair, writing a lone surrogate into
       * the text, into the saved overrides, and into the exported file. */
      var candidates = Array.from(el.getAttribute('data-candidates') || '');
      if (candidates.length < 2) return;
      var current = el.textContent;
      var next = candidates[(candidates.indexOf(current) + 1) % candidates.length];
      var key = el.getAttribute('data-key');
      state.overrides[key] = next;

      /* Same context, same decision -- everywhere it is currently rendered.
       * Matched in JS rather than with an attribute selector: the key is
       * built from arbitrary book text, which cannot be safely interpolated
       * into a CSS selector. */
      var all = content.querySelectorAll('.amb-mark');
      for (var i = 0; i < all.length; i++) {
        if (all[i].getAttribute('data-key') !== key) continue;
        all[i].textContent = next;
        all[i].setAttribute('data-chosen', next);
        all[i].setAttribute('data-overridden', '1');
      }
      persist();
      emit('override', { key: key, chosen: next, source: el.getAttribute('data-source') });
    }

    /* The scroll container outlives this reader -- it is the viewer element,
     * reused for every book -- so the listener has to come back off in
     * destroy(). Left attached, each replaced reader keeps persisting against
     * its own store from a detached mount. */
    var scrollTimer = null;
    function onScroll() {
      emit('progress', { fraction: progress() });
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(persist, 400);
    }
    scroll.listen(onScroll);

    shadow.addEventListener('click', function (ev) {
      var path = ev.composedPath ? ev.composedPath() : [ev.target];
      for (var i = 0; i < path.length; i++) {
        var el = path[i];
        if (!el || el.nodeType !== 1) continue;

        if (el.classList && el.classList.contains('amb-mark')) {
          ev.preventDefault();
          cycleMark(el);
          return;
        }

        if (el.localName === 'a' && el.getAttribute('href')) {
          var href = el.getAttribute('href');
          ev.preventDefault();
          if (/^(https?:|mailto:)/i.test(href)) {
            emit('external', { href: href });
          } else {
            var current = spineItems()[state.index];
            var target = Z.resolve(Z.dirname(current.item.path), href);
            pushTrail();
            goToPath(target, Z.fragmentOf(href));
          }
          return;
        }
      }
    });

    function styleFor(chapterCss) {
      return BASE_CSS +
        fontCss(fontStack(), state.fontScale, state.lineHeight) +
        modeCss() +
        alignCss(state.align) +
        (state.showMarks ? '' : '.amb-mark { border-bottom: none; }\n') +
        chapterCss;
    }

    async function show(index, fragment) {
      var items = spineItems();
      if (!items.length) throw new Error('This book has no readable spine items.');
      state.index = Math.max(0, Math.min(index, items.length - 1));

      var rendered = await App.reader.renderChapter(
        book, items[state.index].item, resources,
        { showMarks: state.showMarks, stripFontFace: true, source: state.source }
      );

      styleEl.textContent = styleFor(rendered.css);
      content.textContent = '';
      var imported = document.importNode(rendered.body, true);
      while (imported.firstChild) content.appendChild(imported.firstChild);

      if (state.source === 'converted') applyOverrides(content);

      if (fragment) {
        var anchor = content.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(fragment) : fragment));
        /* A footnote target lands under the bar otherwise, like any anchor. */
        if (anchor && anchor.scrollIntoView) alignToReadableTop(anchor);
      } else if (restoreScroll) {
        var pending = restoreScroll;
        restoreScroll = null;
        if (!restoreAnchor(pending)) scrollToStart();
      } else {
        scrollToStart();
      }

      persist();
      emit('chapter', {
        index: state.index,
        total: items.length,
        path: rendered.path,
        markCount: rendered.markCount,
        progress: progress()
      });
      return rendered;
    }

    /* Following a link inside the text -- a footnote, a cross-reference --
     * used to be one-way: you landed there with nothing to bring you back.
     * The position is captured before the jump, not after. */
    var trail = [];

    function pushTrail() {
      trail.push({ index: state.index, anchor: captureAnchor() });
      if (trail.length > 50) trail.shift();
      emit('trail', { depth: trail.length });
    }

    function back() {
      var previous = trail.pop();
      emit('trail', { depth: trail.length });
      if (!previous) return Promise.resolve(null);
      restoreScroll = previous.anchor;
      return show(previous.index);
    }

    function goToPath(path, fragment) {
      var items = spineItems();
      for (var i = 0; i < items.length; i++) {
        if (items[i].item.path === path) return show(i, fragment);
      }
      /* A TOC entry may point into a document that is not itself a spine
       * item; fall back to staying put rather than throwing. */
      emit('missing', { path: path });
      return Promise.resolve(null);
    }

    function next() { return show(state.index + 1); }
    function prev() { return show(state.index - 1); }

    /* Anything that reflows the text re-renders the chapter, so capture the
     * anchor first and put it back afterwards -- otherwise changing the font
     * size would throw the reader back to the top of the chapter. */
    function reflow(mutate) {
      var anchor = captureAnchor();
      mutate();
      restoreScroll = anchor;
      return show(state.index);
    }

    function setFontStyle(id) {
      return reflow(function () {
        state.fontStyle = App.readingFonts.isValidStyle(id) ? id : App.readingFonts.DEFAULT;
      });
    }
    function setFontScale(scale) { return reflow(function () { state.fontScale = scale; }); }
    function setLineHeight(v) { return reflow(function () { state.lineHeight = v; }); }
    function setAlign(v) {
      return reflow(function () {
        state.align = (v === 'left' || v === 'justify') ? v : 'default';
      });
    }
    function setShowMarks(v) { state.showMarks = v; return show(state.index); }

    /* 'converted' or 'original'. The original is rendered from the text kept
     * aside before conversion, so switching costs no re-parse of the file. */
    function setSource(which) {
      state.source = which === 'original' ? 'original' : 'converted';
      return show(state.index);
    }

    return {
      state: state,
      mount: mount,
      shadow: shadow,
      content: content,
      on: on,
      show: show,
      goToPath: goToPath,
      next: next,
      prev: prev,
      setFontStyle: setFontStyle,
      fontStack: fontStack,
      setFontScale: setFontScale,
      setLineHeight: setLineHeight,
      setAlign: setAlign,
      setShowMarks: setShowMarks,
      setSource: setSource,
      overrides: function () { return state.overrides; },
      /* Crossing the breakpoint changes which element scrolls, and the reader
       * picked one when it was built. Swapping it beats rebuilding the reader:
       * the listener moves across and the caller puts the position back. */
      setScroller: function (factory) {
        scroll.unlisten(onScroll);
        scroll = factory ? factory(mount) : elementScroller(mount.parentNode);
        scroll.listen(onScroll);
        if (lastAnchor) restoreAnchor(lastAnchor);
        return scroll.kind;
      },
      scrollerKind: function () { return scroll.kind; },
      progress: progress,
      back: back,
      trailDepth: function () { return trail.length; },
      resume: function () {
        restoreScroll = saved.anchor || null;
        return show(saved.index || 0);
      },
      captureAnchor: captureAnchor,
      restoreAnchor: restoreAnchor,
      scrollBy: scrollBy,
      scrollToStart: scrollToStart,
      scrollToEnd: scrollToEnd,
      viewportExtent: viewportExtent,
      scrollPosition: scrollPosition,
      destroy: function () {
        scroll.unlisten(onScroll);
        if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = null; }
        resources.revokeAll();
        mount.remove();
      }
    };
  }

  App.reader = App.reader || {};
  App.reader.create = create;
  App.reader.hashKey = hashKey;
  App.reader.alignCss = alignCss;
  App.reader.elementScroller = elementScroller;
  App.reader.documentScroller = documentScroller;
})(window.App = window.App || {});
