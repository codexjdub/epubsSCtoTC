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

  function modeCss(mode) {
    if (mode === 'vertical') {
      return ':host { writing-mode: vertical-rl; text-orientation: upright; ' +
             'height: 100%; overflow-x: auto; overflow-y: hidden; ' +
             'column-width: 18em; column-gap: 3em; padding: 1em 0; }\n' +
             ':host img { max-height: 60vh; }\n';
    }
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

  function create(host, book, opts) {
    opts = opts || {};
    var resources = App.reader.createResourceMap(book);
    var store = createStore(hashKey(book));
    var saved = store.read();

    var state = {
      index: 0,
      mode: saved.mode || opts.mode || 'scroll',
      fontStyle: App.readingFonts.isValidStyle(saved.fontStyle)
        ? saved.fontStyle : App.readingFonts.DEFAULT,
      fontScale: saved.fontScale || 1,
      lineHeight: saved.lineHeight || 1.9,
      showMarks: saved.showMarks !== false,
      source: saved.source === 'original' ? 'original' : 'converted',
      overrides: saved.overrides || {},
      listeners: {}
    };

    var restoreScroll = null;
    var mount = document.createElement('div');
    mount.className = 'reader-mount';
    host.appendChild(mount);
    var shadow = mount.attachShadow({ mode: 'open' });
    var styleEl = document.createElement('style');
    var content = document.createElement('div');
    shadow.appendChild(styleEl);
    shadow.appendChild(content);

    /* Which element actually scrolls, and along which axis.
     *
     * In scroll mode the content expands the shadow host and the surrounding
     * container scrolls vertically. In vertical mode :host carries
     * overflow-x, so the host itself scrolls horizontally. Using the wrong
     * one silently does nothing -- it is why saved positions were always 0. */
    function scroller() {
      return state.mode === 'vertical'
        ? { el: mount, axis: 'left' }
        : { el: mount.parentNode, axis: 'top' };
    }

    function scrollPosition() {
      var s = scroller();
      return s.axis === 'top' ? s.el.scrollTop : s.el.scrollLeft;
    }

    function setScrollPosition(value) {
      var s = scroller();
      if (s.axis === 'top') s.el.scrollTop = value;
      else s.el.scrollLeft = value;
    }

    /* Positive delta always means "further along in reading order", whichever
     * way the text actually flows. */
    function scrollBy(delta) {
      var s = scroller();
      if (s.axis === 'top') s.el.scrollBy({ top: delta, behavior: 'auto' });
      else s.el.scrollBy({ left: -delta, behavior: 'auto' });
    }

    function viewportExtent() {
      var s = scroller();
      return s.axis === 'top' ? s.el.clientHeight : s.el.clientWidth;
    }

    function scrollToStart() {
      var s = scroller();
      if (s.axis === 'top') s.el.scrollTop = 0;
      else s.el.scrollLeft = s.el.scrollWidth;
    }

    function scrollToEnd() {
      var s = scroller();
      if (s.axis === 'top') s.el.scrollTop = s.el.scrollHeight;
      else s.el.scrollLeft = -s.el.scrollWidth;
    }

    /* Glyph region follows the conversion target, so the rendering does not
     * undo what the conversion just did. */
    function fontStack() {
      var preset = book.report && book.report.preset ? book.report.preset.id : 'hk';
      return App.readingFonts.stackFor(state.fontStyle, preset);
    }

    function emit(name, payload) {
      (state.listeners[name] || []).forEach(function (fn) { fn(payload); });
    }
    function on(name, fn) {
      (state.listeners[name] = state.listeners[name] || []).push(fn);
    }

    function persist() {
      store.write({
        index: state.index,
        mode: state.mode,
        fontStyle: state.fontStyle,
        fontScale: state.fontScale,
        lineHeight: state.lineHeight,
        showMarks: state.showMarks,
        source: state.source,
        scrollTop: scrollPosition(),
        overrides: state.overrides
      });
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
      var candidates = (el.getAttribute('data-candidates') || '').split('');
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

    var scrollTimer = null;
    mount.parentNode.addEventListener('scroll', function () {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(persist, 400);
    }, { passive: true });

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
            goToPath(target, Z.fragmentOf(href));
          }
          return;
        }
      }
    });

    function styleFor(chapterCss) {
      return BASE_CSS +
        fontCss(fontStack(), state.fontScale, state.lineHeight) +
        modeCss(state.mode) +
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
        if (anchor && anchor.scrollIntoView) anchor.scrollIntoView();
      } else if (typeof restoreScroll === 'number') {
        setScrollPosition(restoreScroll);
        restoreScroll = null;
      } else {
        scrollToStart();
      }

      persist();
      emit('chapter', {
        index: state.index,
        total: items.length,
        path: rendered.path,
        markCount: rendered.markCount
      });
      return rendered;
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

    function setMode(mode) { state.mode = mode; return show(state.index); }

    function next() { return show(state.index + 1); }
    function prev() { return show(state.index - 1); }

    function setFontStyle(id) {
      state.fontStyle = App.readingFonts.isValidStyle(id) ? id : App.readingFonts.DEFAULT;
      return show(state.index);
    }
    function setFontScale(scale) { state.fontScale = scale; return show(state.index); }
    function setLineHeight(v) { state.lineHeight = v; return show(state.index); }
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
      setMode: setMode,
      setFontStyle: setFontStyle,
      fontStack: fontStack,
      setFontScale: setFontScale,
      setLineHeight: setLineHeight,
      setShowMarks: setShowMarks,
      setSource: setSource,
      overrides: function () { return state.overrides; },
      resume: function () {
        restoreScroll = typeof saved.scrollTop === 'number' ? saved.scrollTop : null;
        return show(saved.index || 0);
      },
      scrollBy: scrollBy,
      scrollToStart: scrollToStart,
      scrollToEnd: scrollToEnd,
      viewportExtent: viewportExtent,
      scrollPosition: scrollPosition,
      destroy: function () { resources.revokeAll(); mount.remove(); }
    };
  }

  App.reader = App.reader || {};
  App.reader.create = create;
  App.reader.hashKey = hashKey;
  App.reader.scopeModeCss = modeCss;
})(window.App = window.App || {});
