/* Reading themes.
 *
 * "system" removes the data-theme attribute entirely so the OS preference
 * governs; every other choice stamps the attribute and wins over it.
 * The choice is app-wide, not per-book.
 */
(function (App) {
  'use strict';

  var KEY = 'epub-tc:theme';

  var THEMES = [
    { id: 'system', label: 'System' },
    { id: 'light',  label: 'Light'  },
    { id: 'sepia',  label: 'Sepia'  },
    { id: 'green',  label: 'Green'  },
    { id: 'slate',  label: 'Slate'  },
    { id: 'grey',   label: 'Grey'   },
    { id: 'dark',   label: 'Dark'   }
  ];

  function isValid(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return true;
    return false;
  }

  function stored() {
    try {
      var v = window.localStorage.getItem(KEY);
      return isValid(v) ? v : 'system';
    } catch (e) { return 'system'; }
  }

  function apply(id) {
    if (!isValid(id)) id = 'system';
    if (id === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', id);
    try { window.localStorage.setItem(KEY, id); } catch (e) { /* ignore */ }
    return id;
  }

  function current() {
    return document.documentElement.getAttribute('data-theme') || 'system';
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
    init: function () { return apply(stored()); }
  };

  App.theme.init();
})(window.App = window.App || {});
