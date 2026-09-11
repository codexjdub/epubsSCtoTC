/* Reading themes.
 *
 * "system" removes the data-theme attribute entirely so the OS preference
 * governs; every other choice stamps the attribute and wins over it.
 * The choice is app-wide, not per-book.
 */
(function (App) {
  'use strict';

  var KEY = 'epub-tc:theme';
  var DEFAULT = 'green';

  /* Control labels are Chinese throughout; the prose that explains the tool
   * stays English. These appear in both the landing page and the reader. */
  /* Labels live in ui/strings.js; these carry the key. */
  var THEMES = [
    { id: 'system', labelKey: 'theme.system' },
    { id: 'light',  labelKey: 'theme.light'  },
    { id: 'sepia',  labelKey: 'theme.sepia'  },
    { id: 'green',  labelKey: 'theme.green'  },
    { id: 'slate',  labelKey: 'theme.slate'  },
    { id: 'grey',   labelKey: 'theme.grey'   },
    { id: 'dark',   labelKey: 'theme.dark'   },
    /* The only theme whose colours are not all in the stylesheet: the landing
       page takes a wash from the cover of whatever you read last, painted by
       paintWash() in ui/app.js. The palette there is what it falls back to
       with no books, and what the reader uses either way -- the wash lives
       inside #landing and goes off screen with it. */
    { id: 'cover',  labelKey: 'theme.cover'  }
  ];

  function isValid(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return true;
    return false;
  }

  function stored() {
    try {
      var v = window.localStorage.getItem(KEY);
      return isValid(v) ? v : DEFAULT;
    } catch (e) { return 'system'; }
  }

  function apply(id) {
    if (!isValid(id)) id = DEFAULT;
    /* Every theme stamps an attribute, "system" included: bare :root carries
     * the default palette so the page paints correctly before scripts run. */
    document.documentElement.setAttribute('data-theme', id);
    try { window.localStorage.setItem(KEY, id); } catch (e) { /* ignore */ }
    return id;
  }

  function current() {
    return document.documentElement.getAttribute('data-theme') || DEFAULT;
  }

  /* What the theme actually resolves to right now, for callers that need to
   * know whether they are on a light or dark ground. */
  function resolved() {
    var id = current();
    if (id !== 'system') return id;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark' : 'light';
  }

  App.theme = {
    THEMES: THEMES,
    apply: apply,
    stored: stored,
    current: current,
    resolved: resolved,
    isValid: isValid,
    DEFAULT: DEFAULT,
    init: function () { return apply(stored()); }
  };

  App.theme.init();
})(window.App = window.App || {});
