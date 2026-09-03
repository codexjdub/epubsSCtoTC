/* Optional vim-style navigation for the reader.
 *
 * Off by default; the choice is remembered. When disabled, the plain arrow
 * keys still work, so nothing is taken away by leaving this off.
 */
(function (App) {
  'use strict';

  var KEY = 'epub-tc:vim';
  var LINE = 64;              // one "line" of scrolling, in pixels

  var BINDINGS = [
    ['j', 'Scroll forward'],
    ['k', 'Scroll back'],
    ['d', 'Half page forward'],
    ['u', 'Half page back'],
    ['f  /  Space', 'Page forward'],
    ['b', 'Page back'],
    ['gg', 'Start of chapter'],
    ['G', 'End of chapter'],
    ['n  /  ]  /  L', 'Next chapter'],
    ['p  /  [  /  H', 'Previous chapter'],
    ['t', 'Toggle table of contents'],
    ['o', 'Toggle original / converted'],
    ['m', 'Toggle ambiguity marks'],
    ['+  /  -', 'Font size'],
    ['z', 'Focus mode (desktop)'],
    ['?', 'This help'],
    ['Esc', 'Close help'],
    ['3j', 'Counts work: repeat 3 times']
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

    var h = document.createElement('h2');
    h.textContent = 'Vim navigation';
    panel.appendChild(h);

    var dl = document.createElement('dl');
    BINDINGS.forEach(function (pair) {
      var dt = document.createElement('dt');
      dt.textContent = pair[0];
      var dd = document.createElement('dd');
      dd.textContent = pair[1];
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    panel.appendChild(dl);

    var note = document.createElement('p');
    note.textContent = 'Press ? or Esc to close.';
    panel.appendChild(note);

    overlay.appendChild(panel);
    overlay.addEventListener('click', function () { overlay.classList.add('hidden'); });
    return overlay;
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

    function helpVisible() { return !help.classList.contains('hidden'); }
    function setHelp(on) { help.classList.toggle('hidden', !on); }

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
        case 'j': r.scrollBy(LINE * takeCount()); break;
        case 'k': r.scrollBy(-LINE * takeCount()); break;
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
