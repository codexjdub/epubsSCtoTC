/* Optional vim-style navigation for the reader.
 *
 * Off by default; the choice is remembered. When disabled, the plain arrow
 * keys still work, so nothing is taken away by leaving this off.
 */
(function (App) {
  'use strict';

  var KEY = 'epub-tc:vim';
  var LINE = 64;              // one "line" of scrolling, in pixels

  /* Keystrokes on the left, a label KEY on the right -- the descriptions live
   * in the strings table like every other label, and the overlay is filled from
   * it each time it opens. */
  var BINDINGS = [
    ['j', 'keys.scrollFwd'],
    ['k', 'keys.scrollBack'],
    ['d', 'keys.halfFwd'],
    ['u', 'keys.halfBack'],
    ['f  /  Space', 'keys.pageFwd'],
    ['b', 'keys.pageBack'],
    ['gg', 'keys.chapterStart'],
    ['G', 'keys.chapterEnd'],
    ['n  /  ]  /  L', 'keys.nextChapter'],
    ['p  /  [  /  H', 'keys.prevChapter'],
    ['t', 'keys.toc'],
    ['o', 'keys.source'],
    ['m', 'keys.marks'],
    ['+  /  -', 'keys.fontSize'],
    ['z', 'keys.focus'],
    ['?', 'keys.help'],
    ['Esc', 'keys.closeHelp'],
    ['3j', 'keys.counts']
  ];

  function stored() {
    try { return window.localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }

  function store(on) {
    try { window.localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  /* Typing in a form control must never be swallowed as a command. */
  function inFormField(target) {
    if (!target) return false;
    var name = target.localName;
    return name === 'input' || name === 'select' || name === 'textarea' ||
           target.isContentEditable;
  }

  function buildHelp() {
    var overlay = document.createElement('div');
    overlay.className = 'keyhelp hidden';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Keyboard shortcuts');

    var panel = document.createElement('div');
    panel.className = 'keyhelp-panel';
    overlay.appendChild(panel);
    overlay.addEventListener('click', function () { overlay.classList.add('hidden'); });
    return overlay;
  }

  /* Filled every time it opens rather than once at startup. This overlay is the
   * one piece of chrome built entirely in JS with no markup to relabel, and the
   * interface language can change while the app is running. */
  function fillHelp(overlay) {
    var panel = overlay.firstChild;
    panel.textContent = '';

    var h = document.createElement('h2');
    h.textContent = App.strings.get('keys.title');
    panel.appendChild(h);

    var dl = document.createElement('dl');
    BINDINGS.forEach(function (pair) {
      var dt = document.createElement('dt');
      dt.textContent = pair[0];
      var dd = document.createElement('dd');
      dd.textContent = App.strings.get(pair[1]);
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    panel.appendChild(dl);

    var note = document.createElement('p');
    note.textContent = App.strings.get('keys.close');
    panel.appendChild(note);
  }

  function create(actions) {
    var enabled = stored();
    var pendingG = false;
    var count = '';
    var help = buildHelp();
    document.body.appendChild(help);

    function reader() { return actions.reader(); }

    function takeCount(fallback) {
      var n = count ? parseInt(count, 10) : (fallback || 1);
      count = '';
      return n > 0 ? n : 1;
    }

    function halfPage() { return Math.round(reader().viewportExtent() / 2); }
    function fullPage() { return Math.round(reader().viewportExtent() * 0.9); }

    /* What one j or k is worth. Paginated text has no lines to move by -- the
       smallest step there IS a page -- and asking for 64px anyway threw the
       count away: the scroller rounds a sub-page delta up to one page, so 3j
       and 13j both turned a single page while the help went on promising that
       counts repeat. d/u/f/b never had the problem, being fractions of the
       viewport already, which is the pitch once paginated. */
    function lineStep() {
      var r = reader();
      return r.scrollerKind() === 'paged' ? r.viewportExtent() : LINE;
    }

    function helpVisible() { return !help.classList.contains('hidden'); }
    function setHelp(on) {
      if (on) fillHelp(help);
      help.classList.toggle('hidden', !on);
    }

    function handle(ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (inFormField(ev.target)) return;

      var k = ev.key;

      if (helpVisible()) {
        if (k === 'Escape' || k === '?') { setHelp(false); ev.preventDefault(); }
        return;
      }
      if (!enabled) return;

      var r = reader();
      if (!r) return;

      // Digits accumulate a count, except a leading 0.
      if (k >= '0' && k <= '9' && !(k === '0' && !count)) {
        count += k;
        ev.preventDefault();
        return;
      }

      if (pendingG && k !== 'g') pendingG = false;

      switch (k) {
        case 'j': r.scrollBy(lineStep() * takeCount()); break;
        case 'k': r.scrollBy(-lineStep() * takeCount()); break;
        /* Rounded so the motions are exactly reversible: a fractional delta
         * gets rounded by the browser on the way in, and d/u pairs would
         * otherwise drift a pixel per cycle. */
        case 'd': r.scrollBy(halfPage() * takeCount()); break;
        case 'u': r.scrollBy(-halfPage() * takeCount()); break;
        case 'f': case ' ': r.scrollBy(fullPage() * takeCount()); break;
        case 'b': r.scrollBy(-fullPage() * takeCount()); break;
        case 'g':
          if (pendingG) { pendingG = false; r.scrollToStart(); }
          else { pendingG = true; ev.preventDefault(); return; }
          break;
        case 'G': r.scrollToEnd(); break;
        case 'n': case ']': case 'L': count = ''; r.next(); break;
        case 'p': case '[': case 'H': count = ''; r.prev(); break;
        case 't': count = ''; actions.toggleToc(); break;
        case 'o': count = ''; actions.toggleSource(); break;
        case 'm': count = ''; actions.toggleMarks(); break;
        case '+': case '=': count = ''; actions.fontBigger(); break;
        case '-': count = ''; actions.fontSmaller(); break;
        case 'z': count = ''; actions.toggleFocus(); break;
        case '?': count = ''; setHelp(true); break;
        default:
          count = '';
          return;                       // not ours; leave it alone
      }
      ev.preventDefault();
    }

    document.addEventListener('keydown', handle);

    return {
      isEnabled: function () { return enabled; },
      set: function (on) { enabled = !!on; store(enabled); count = ''; pendingG = false; return enabled; },
      toggle: function () { return this.set(!enabled); },
      showHelp: function () { setHelp(true); },
      helpVisible: helpVisible,
      BINDINGS: BINDINGS,
      _handle: handle
    };
  }

  App.keys = { create: create, stored: stored, BINDINGS: BINDINGS, LINE: LINE };
})(window.App = window.App || {});
