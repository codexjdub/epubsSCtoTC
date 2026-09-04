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

  /* How WIDE the column is, and what it looks like, is the book's business to
   * work within. WHERE it sits on screen is the reader's.
   *
   * The book's own `body` rule is scoped to :host and appended after this one,
   * so a plain `margin: 0 auto` loses to any book that zeroes its body margins
   * -- and plenty do. This sample book's cover does exactly that, and sat
   * against the left edge of the window while every text chapter was centred.
   *
   * Only the two horizontal margins are forced. Top and bottom stay the book's,
   * along with everything else; the width is already capped by max-width, so a
   * book cannot bleed to the edges either way and nothing it might legitimately
   * want is taken from it. */
  function modeCss(measure) {
    return ':host { writing-mode: horizontal-tb; max-width: ' + measure +
           'em; margin: 0 auto; padding: 1em; }\n' +
           ':host { margin-left: auto !important; margin-right: auto !important; }\n';
  }

  var PAGE_GAP = 48;          // gutter between one page and the next, in px

  /* Paged layout.
   *
   * The text flows into CSS columns exactly one page wide, so turning a page is
   * a horizontal scroll of one column plus its gutter. There is no declarative
   * way to say "one column exactly this wide", so the geometry is computed in
   * pixels here and recomputed on every render -- which is what makes a resize
   * or a font-size change re-paginate rather than smear.
   *
   * The frame is !important because the book's own `body` rule is scoped to
   * :host and lands after this one. That is not hypothetical: this book's cover
   * sets `body { margin: 0; padding: 0 }`, which in scroll mode merely pushes
   * the cover to the left edge and here would take the page geometry apart.
   *
   * Horizontal padding is zero on purpose: with none, the border box and the
   * content box are the same width, so the column pitch is exactly
   * clientWidth -- one number, read the same way by the CSS and by the
   * scroller. The gutter provides the breathing room instead.
   *
   * Vertically it is a share of the SCREEN, counting whatever chrome already
   * stands between the page and the edge -- because that distance is the one
   * the eye actually reads.
   *
   * A fixed 48px looked bounded while the toolbar and the pager framed it, and
   * looked full-height the moment focus mode took them away: on an 800px window
   * the text ran to 48px off the bottom edge with 336px of empty space either
   * side of it. Measuring the share against the page BOX instead over-corrects
   * the other way -- the chrome's 117px then sits on top of the page's own
   * inset, leaving 383px of text in an 800px window. Measured from the screen,
   * both modes hold the same band: the toolbar and pager simply count towards
   * it, and the padding makes up the difference.
   */
  function pagedCss(mount, scale, measure) {
    var parent = mount.parentNode;
    var base = parseFloat(window.getComputedStyle(parent).fontSize) || 16;
    var avail = parent.clientWidth || 600;
    var width = Math.max(240, Math.min(measure * base * scale, avail));
    var col = Math.max(160, width - PAGE_GAP);
    /* The band the page keeps clear of each screen edge, and what the chrome
       already contributes to it. In focus mode the strips are out of the flow,
       so both contributions are zero and the padding carries the whole band. */
    var band = (window.innerHeight || 800) * 0.15;
    var box = parent.getBoundingClientRect();
    var above = Math.max(0, box.top);
    var below = Math.max(0, (window.innerHeight || 800) - box.bottom);
    var padTop = Math.max(PAGE_GAP, Math.round(band - above));
    var padBottom = Math.max(PAGE_GAP, Math.round(band - below));
    return ':host { box-sizing: border-box !important; writing-mode: horizontal-tb; ' +
           'width: ' + Math.round(width) + 'px !important; margin: 0 auto !important; ' +
           'height: 100% !important; overflow: hidden !important; ' +
           'padding: ' + padTop + 'px 0 ' + padBottom + 'px !important; ' +
           'column-width: ' + Math.round(col) + 'px; column-gap: ' + PAGE_GAP + 'px; ' +
           'column-fill: auto; }\n' +
           /* A figure taller than the page would otherwise open a column
              nothing can scroll to the bottom of. */
           ':host img, :host svg { max-height: 88%; }\n';
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
  /* Where a block sits relative to the leading edge, down the page. Shared by
   * both scrolling implementations; the paged one measures across instead, and
   * cannot use a bounding box at all. */
  function verticalMeasure(el, box) {
    var rect = el.getBoundingClientRect();
    if (rect.height <= 0) return null;
    return { size: rect.height, past: box.top - rect.top };
  }

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
      measure: verticalMeasure,
      alignStart: function (el, fraction) {
        el.scrollIntoView({ block: 'start' });
        if (fraction) {
          var rect = el.getBoundingClientRect();
          if (rect.height) element.scrollBy({ top: fraction * rect.height, behavior: 'auto' });
        }
      },
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
      measure: verticalMeasure,
      /* scrollIntoView aligns a block to the top of the WINDOW; the anchor is
       * measured from the top of the READABLE area, which sits below the fixed
       * chrome. Uncorrected, the two disagree by exactly the height of that
       * chrome and every restored position lands underneath it. */
      alignStart: function (el, fraction) {
        el.scrollIntoView({ block: 'start' });
        var chrome = top();
        if (chrome) doc.scrollTop = doc.scrollTop - chrome;
        if (fraction) {
          var rect = el.getBoundingClientRect();
          if (rect.height) window.scrollBy({ top: fraction * rect.height, behavior: 'auto' });
        }
      },
      listen: function (fn) { window.addEventListener('scroll', fn, { passive: true }); },
      unlisten: function (fn) { window.removeEventListener('scroll', fn); }
    };
  }

  /* Pages instead of a scroll.
   *
   * The same interface, reading across instead of down: `top` is the horizontal
   * offset, `extent` is one page, and the content runs sideways. Everything
   * positional assumes the view sits exactly on a column boundary, so every
   * move through here is quantised to whole pages -- land between two and the
   * page shows halves of both.
   */
  function pagedScroller(host) {
    /* The column plus its gutter, and NOT the width asked for in the CSS.
     * Multi-column stretches its columns to fill the box: ask for 560px inside
     * 608 and you get one column of 608, so the distance from one page to the
     * next is the view plus the gutter. Measured on a real chapter, the columns
     * sat at 0, 656, 1312, 1968 in a 608px view -- and the maximum scroll,
     * 1968, is exactly three of those. Using the view width alone put every
     * page after the first out by 48px and left the last one showing halves of
     * two columns. */
    function pitch() { return (host.clientWidth || 1) + PAGE_GAP; }
    function maxLeft() { return Math.max(0, host.scrollWidth - host.clientWidth); }
    /* Floor rather than clamp: the boundary at or below the furthest scroll is
     * always a whole page, where the raw maximum need not be. */
    function lastPage() {
      var p = pitch();
      return Math.floor(maxLeft() / p) * p;
    }
    function snap(value) {
      var p = pitch();
      return Math.max(0, Math.min(lastPage(), Math.round(value / p) * p));
    }
    var api = {
      kind: 'paged',
      element: host,
      top: function () { return host.scrollLeft; },
      setTop: function (value) { host.scrollLeft = snap(value); },
      extent: pitch,
      /* Read the same way as a vertical scroller's: the furthest the leading
         edge can travel, plus the one page still visible from there. Taken raw,
         scrollWidth counts the view rather than the pitch and the progress
         figure runs past 100% on the last page. */
      contentExtent: function () { return lastPage() + pitch(); },
      viewportRect: function () { return host.getBoundingClientRect(); },
      inset: function () { return 0; },
      /* Whole pages, and never none: a vim `j` asks for 64px, which would round
         to no movement at all rather than to the next page. */
      scrollBy: function (delta) {
        if (!delta) return;
        var p = pitch();
        var pages = delta > 0 ? Math.max(1, Math.round(delta / p))
                              : Math.min(-1, Math.round(delta / p));
        host.scrollLeft = snap(snap(host.scrollLeft) + pages * p);
      },
      /* A block straddling a column break has ONE bounding box spanning both
         columns and the gutter -- measured at 1248px across a 600px page -- so
         the fragments have to be read one by one. Each is a page's worth of
         this block, which makes the block's extent its fragment count.
         
         Counted in COLUMNS rather than pixels, because a book is free to indent
         a paragraph: this one indents some by 32px, and measured raw that made
         a block whose page had already been turned look as though it were still
         on screen -- so the anchor named a block two pages back. Rounding to
         the nearest column absorbs any indent smaller than half a page. */
      measure: function (el, box) {
        var rects = el.getClientRects();
        if (!rects.length) return null;
        var offset = Math.round((rects[0].left - box.left) / pitch());
        return { size: rects.length, past: -offset };
      },
      /* Prefer a block that BEGINS on this page. Where a block starts is a
         content point that survives any reflow exactly; a fraction into a block
         that merely REACHES the page has to be requantised against a new
         fragment count, and that requantisation ratchets backwards -- measured
         across five width changes on a real book, it lost two pages and put the
         paragraph being read off screen. Only a page with no block start on it
         at all needs the fraction, and then only until the next one does.
         Returning null hands back to the shared measurement. */
      anchorFor: function (blocks, box) {
        var p = pitch();
        for (var i = 0; i < blocks.length; i++) {
          var rects = blocks[i].getClientRects();
          if (!rects.length) continue;
          var at = Math.round((rects[0].left - box.left) / p);
          if (at === 0) return { index: i, id: blocks[i].id || '', fraction: 0 };
          if (at > 0) break;              // begins later; none begins here
        }
        return null;
      },
      /* The fraction picks which fragment, so a position captured mid-scroll in
         a long block does not throw the reader back to that block's first page
         when the same anchor is restored here. */
      alignStart: function (el, fraction) {
        var rects = el.getClientRects();
        if (!rects.length) return;
        var i = fraction ? Math.min(rects.length - 1, Math.floor(fraction * rects.length)) : 0;
        host.scrollLeft = snap(host.scrollLeft + (rects[i].left - api.viewportRect().left));
      },
      listen: function (fn) { host.addEventListener('scroll', fn, { passive: true }); },
      unlisten: function (fn) { host.removeEventListener('scroll', fn); }
    };
    return api;
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

    /* The language BEFORE conversion: an English book is still English, and
     * conversion retags Chinese ones to the preset's tag anyway. */
    function bookLanguage() {
      var meta = book.metadata || {};
      return (meta.original && meta.original.language) || meta.language;
    }

    /* A comfortable line is not the same NUMBER in both scripts. 38em is about
     * 38 Chinese characters -- inside the 25-40 that CJK typography asks for --
     * and about 81 Latin ones, well past the 45-75 that Latin typography asks
     * for. Measured on a real English book: 38em gave 81 characters to the
     * line, 32em gave 66.
     *
     * Remembered per script for the same reason. Widening the column for a
     * Chinese book says nothing about English ones, and a single shared number
     * is wrong for whichever script it was not chosen for. The Han key keeps the
     * old name, so a width chosen before this split stays with the books it was
     * chosen for. */
    var hanBook = App.readingFonts.isHan(bookLanguage());
    var measureKey = hanBook ? 'measure' : 'measure.latin';

    var state = {
      index: 0,
      fontStyle: App.readingFonts.isValidStyle(pref('fontStyle'))
        ? pref('fontStyle') : App.readingFonts.DEFAULT,
      fontScale: pref('fontScale', 1),
      lineHeight: pref('lineHeight', 1.9),
      /* How wide a line runs, in ems of the reading size -- so it holds its
         character count when the text is enlarged. 38 is about 38 Chinese
         characters, or 70 Latin ones. */
      measure: pref(measureKey, hanBook ? 38 : 32),
      align: pref('align', 'default'),
      /* Off by default. A full-length book produces thousands of marked
       * characters, and most are readings the converter is not actually in
       * doubt about, so underlining them all obscures the text rather than
       * helping. The toggle turns them on when someone wants to review. */
      showMarks: saved.showMarks === true,
      source: saved.source === 'original' ? 'original' : 'converted',
      /* Applied before the first render rather than toggled after it, so a
         reader who prefers pages does not watch the chapter laid out twice.
         Whether pages are POSSIBLE is the caller's judgement -- it knows the
         width, and a phone has no fixed-height box to break them in. */
      paged: !!opts.paged,
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
    /* The CURRENT choice, not the one made when the reader was built. Leaving
     * paged mode has to come back to whichever scroller the width calls for
     * now, and the breakpoint may well have moved since -- open a book narrow,
     * widen the window, use focus mode, and the old code handed back the phone's
     * document scroller on a desktop layout. */
    var scrollerFactory = opts.scroller || null;
    /* Starting paged means starting on the paged scroller. Setting only the
       state left the reader reading a horizontal layout through a vertical
       scroller, which reports the top of the book and never moves. */
    var scroll = state.paged ? pagedScroller(mount) : baseScroller();

    function scrollPosition() { return scroll.top(); }

    function scrollBy(delta) { scroll.scrollBy(delta); }

    function viewportExtent() { return scroll.extent(); }

    function scrollToStart() { scroll.setTop(0); }

    function scrollToEnd() { scroll.setTop(scroll.contentExtent()); }

    /* Glyph region follows the conversion target, so the rendering does not
     * undo what the conversion just did. */
    function fontStack() {
      var preset = book.report && book.report.preset ? book.report.preset.id : 'hk';
      return App.readingFonts.stackFor(state.fontStyle, preset, bookLanguage());
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
    /* Which block, and how far into it -- asked of the scroller, because the
     * answer depends on which way the text flows. Down the page it is a matter
     * of heights and one bounding box; across pages it is a matter of column
     * fragments, and a bounding box is actively wrong there. The anchor SHAPE
     * is the same either way, which is what lets a position survive the move
     * between the two. */
    function captureAnchor() {
      /* A destroyed reader must not answer. Its mount is detached, so the
       * scroll container is gone (parentNode is null) and the anchor it would
       * produce gets written over the book's real saved position. */
      if (!mount.isConnected) return null;
      var blocks = content.children;
      if (!blocks.length) return null;
      var containerRect = scroll.viewportRect();
      /* A scroller may know a steadier way to name this position than "how far
         into the block at the leading edge" -- see the paged one. */
      if (scroll.anchorFor) {
        var preferred = scroll.anchorFor(blocks, containerRect);
        if (preferred) return preferred;
      }
      for (var i = 0; i < blocks.length; i++) {
        var m = scroll.measure(blocks[i], containerRect);
        if (!m || m.size <= 0) continue;
        if (m.past < m.size) {
          return {
            index: i,
            id: blocks[i].id || '',
            fraction: Math.max(0, Math.min(1, m.past / m.size))
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

      scroll.alignStart(el, anchor.fraction || 0);
      return true;
    }

    function emit(name, payload) {
      (state.listeners[name] || []).forEach(function (fn) { fn(payload); });
    }
    function on(name, fn) {
      (state.listeners[name] = state.listeners[name] || []).push(fn);
    }

    /* Merged rather than replaced: the measure is kept per script, so writing
     * the one for this book must not drop the other script's. */
    function persistPrefs() {
      var out = prefs.read() || {};
      out.fontStyle = state.fontStyle;
      out.fontScale = state.fontScale;
      out.lineHeight = state.lineHeight;
      out.align = state.align;
      out[measureKey] = state.measure;
      prefs.write(out);
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
        (state.paged ? pagedCss(mount, state.fontScale, state.measure)
                     : modeCss(state.measure)) +
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
        if (anchor && anchor.scrollIntoView) scroll.alignStart(anchor, 0);
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
      navigated();
      var previous = trail.pop();
      emit('trail', { depth: trail.length });
      if (!previous) return Promise.resolve(null);
      restoreScroll = previous.anchor;
      return show(previous.index);
    }

    function goToPath(path, fragment) {
      navigated();
      var items = spineItems();
      for (var i = 0; i < items.length; i++) {
        if (items[i].item.path === path) return show(i, fragment);
      }
      /* A TOC entry may point into a document that is not itself a spine
       * item; fall back to staying put rather than throwing. */
      emit('missing', { path: path });
      return Promise.resolve(null);
    }

    function next() { navigated(); return show(state.index + 1); }
    function prev() { navigated(); return show(state.index - 1); }

    /* Page turns run off the end of a chapter into the next one, so the book
     * reads as one sequence of pages rather than as a stack of chapters. In
     * scroll mode there are no pages, so these stay the chapter controls they
     * have always been and the callers need not know which mode they are in. */
    function atLastPage() {
      return scroll.top() + scroll.extent() >= scroll.contentExtent() - 2;
    }

    function nextPage() {
      navigated();
      if (scroll.kind !== 'paged') return next();
      if (!atLastPage()) {
        scroll.scrollBy(scroll.extent());
        persist();
        return Promise.resolve(null);
      }
      /* Clamped rather than wrapped: show() clamps the index, so without this
         the last page of the book would re-render the chapter and jump back to
         its first page. */
      if (state.index >= spineItems().length - 1) return Promise.resolve(null);
      return next();
    }

    function prevPage() {
      navigated();
      if (scroll.kind !== 'paged') return prev();
      if (scroll.top() > 2) {
        scroll.scrollBy(-scroll.extent());
        persist();
        return Promise.resolve(null);
      }
      if (state.index === 0) return Promise.resolve(null);
      return prev().then(function (r) { scrollToEnd(); persist(); return r; });
    }

    function baseScroller() {
      return scrollerFactory ? scrollerFactory(mount) : elementScroller(mount.parentNode);
    }

    /* Switching how the text flows is a re-render: the column geometry is
     * written into the chapter's stylesheet. The anchor crosses over because
     * both scrollers speak the same shape. */
    /* `anchor` is for a caller that is about to change the layout around the
     * reader, or has just done so. Capturing here would then measure a page
     * that was never on screen: focus mode reopens the sidebar and puts its
     * two strips back in the flow, and the columns re-break against the new
     * width and height before this function is ever reached. Same failure the
     * breakpoint swap already guards against, and the same remedy -- take the
     * reading position while it still means something. */
    function setPaged(on, anchor) {
      on = !!on;
      if (on === state.paged) return Promise.resolve(null);
      anchor = anchor || captureAnchor();
      state.paged = on;
      scroll.unlisten(onScroll);
      scroll = on ? pagedScroller(mount) : baseScroller();
      scroll.listen(onScroll);
      restoreScroll = anchor;
      return show(state.index);
    }

    /* Column geometry is in pixels, so a resized window has to re-derive it.
     * Cheap to call when nothing is paginated: it does nothing.
     *
     * Takes an anchor for the same reason setPaged does -- a caller that has
     * just resized the reading box around us has already broken the pages the
     * position was read from. */
    function repaginate(anchor) {
      if (!state.paged) return Promise.resolve(null);
      restoreScroll = anchor || captureAnchor();
      return show(state.index);
    }

    /* Anything that reflows the text re-renders the chapter, so capture the
     * anchor first and put it back afterwards -- otherwise changing the font
     * size would throw the reader back to the top of the chapter.
     *
     * A RUN of adjustments maps from where the run began, not from where the
     * last one landed. In pages the position can only be named to the nearest
     * page, so re-reading it from each freshly broken layout compounds that
     * rounding and walks backwards: measured on a real book, five width changes
     * lost two pages and put the paragraph being read off screen. Mapping every
     * change from the same starting position stops the error accumulating.
     *
     * A run is "changes that keep coming", which is exactly what dragging a
     * slider or holding A+ produces. Pause, or navigate, and the next change
     * reads the position afresh -- by then it is the reader's real place in the
     * book again, not an artefact of the last adjustment.
     *
     * Only pages chain. A scrolled anchor names a block AND a fraction of its
     * height, which survives a reflow intact, so re-reading it costs nothing
     * and cannot drift -- while chaining there WOULD be wrong, because the
     * reader can scroll the text by hand between two adjustments and nothing
     * here would hear about it. */
    var RUN_MS = 2500;
    var runAnchor = null;
    var runUntil = 0;

    function navigated() { runAnchor = null; }

    function reflow(mutate) {
      var now = Date.now();
      var chain = state.paged && runAnchor && now < runUntil;
      var anchor = chain ? runAnchor : captureAnchor();
      runAnchor = anchor;
      runUntil = now + RUN_MS;
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
    /* Guarded more widely than the control offers, because a bad value here
       does not merely look wrong -- a zero or negative measure collapses the
       column, and in pages the pitch with it. */
    function setMeasure(v) {
      return reflow(function () {
        var n = parseFloat(v);
        state.measure = isNaN(n) ? 38 : Math.max(16, Math.min(60, n));
      });
    }
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
      nextPage: nextPage,
      prevPage: prevPage,
      setPaged: setPaged,
      repaginate: repaginate,
      setFontStyle: setFontStyle,
      fontStack: fontStack,
      setFontScale: setFontScale,
      setLineHeight: setLineHeight,
      setMeasure: setMeasure,
      setAlign: setAlign,
      setShowMarks: setShowMarks,
      setSource: setSource,
      overrides: function () { return state.overrides; },
      /* Crossing the breakpoint changes which element scrolls, and the reader
       * picked one when it was built. Swapping it beats rebuilding the reader:
       * the listener moves across and the caller puts the position back. */
      setScroller: function (factory) {
        scroll.unlisten(onScroll);
        scrollerFactory = factory || null;
        /* Paged wins: it is the mode the reader is actually in, and the width
           factory knows nothing about it. Leaving focus mode clears it first,
           and comes back through the factory remembered here. */
        scroll = state.paged ? pagedScroller(mount) : baseScroller();
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
      /* Wrapped rather than exposed raw: a move the READER asked for ends the
         run of adjustments, while the same helpers called from inside a
         re-render must not. */
      scrollBy: function (delta) { navigated(); return scrollBy(delta); },
      scrollToStart: function () { navigated(); return scrollToStart(); },
      scrollToEnd: function () { navigated(); return scrollToEnd(); },
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
