/* Persistent library.
 *
 * Books are kept in IndexedDB so they can be reopened without dropping the
 * file again. Reading position and character overrides already persist per
 * book in localStorage, keyed the same way, so a reopened book lands where it
 * was left.
 *
 * Gated on a real origin. IndexedDB at file:// is unreliable -- a local file is
 * an opaque origin in Chrome and Safari is stricter still -- so rather than
 * write to storage that may silently vanish, the library simply does not offer
 * itself there. Everything else in the app works unchanged.
 *
 * Nothing leaves the browser: this is the same device, the same profile.
 */
(function (App) {
  'use strict';

  var DB_NAME = 'epub-tc';
  var STORE = 'books';
  var VERSION = 1;
  var MAX_BYTES = 60 * 1024 * 1024;   // refuse to silently swallow huge files

  function available() {
    return (location.protocol === 'http:' || location.protocol === 'https:') &&
           typeof indexedDB !== 'undefined';
  }

  function reason() {
    if (available()) return '';
    if (typeof indexedDB === 'undefined') return 'This browser has no IndexedDB.';
    return 'Saving books needs the page to be served; a local file cannot store them reliably.';
  }

  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB unavailable')); };
      req.onblocked = function () { reject(new Error('IndexedDB is blocked by another tab')); };
    });
  }

  function tx(db, mode, fn) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(STORE, mode);
      var store = t.objectStore(STORE);
      var result;
      try { result = fn(store); } catch (e) { reject(e); return; }
      t.oncomplete = function () {
        /* Unwrap the IDBRequest properly. Testing `result.result !== undefined`
         * fell through to the request object on a key miss, which then got
         * handed to put() and threw DataCloneError. */
        var isRequest = typeof IDBRequest !== 'undefined' && result instanceof IDBRequest;
        resolve(isRequest ? result.result : result);
      };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error || new Error('transaction aborted')); };
    });
  }

  /* Same identity the reader uses for its saved position, so the two agree. */
  function idFor(book) {
    return App.reader.hashKey(book);
  }

  async function list() {
    if (!available()) return [];
    var db = await open();
    var rows = await tx(db, 'readonly', function (store) { return store.getAll(); });
    db.close();
    return (rows || []).map(function (r) {
      return { id: r.id, title: r.title, creator: r.creator, language: r.language,
               size: r.size, addedAt: r.addedAt, lastOpenedAt: r.lastOpenedAt };
    }).sort(function (a, b) { return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0); });
  }

  async function save(book, bytes, filename) {
    if (!available()) return { saved: false, reason: reason() };
    if (bytes.byteLength > MAX_BYTES) {
      return { saved: false, reason: 'Too large to save (' +
        Math.round(bytes.byteLength / 1048576) + ' MB); it will still open normally.' };
    }
    var record = {
      id: idFor(book),
      title: book.metadata.original ? book.metadata.original.title : book.metadata.title,
      creator: book.metadata.creator || '',
      language: book.metadata.language || '',
      filename: filename || '',
      size: bytes.byteLength,
      bytes: bytes,
      addedAt: Date.now(),
      lastOpenedAt: Date.now()
    };
    try {
      var db = await open();
      var existing = await tx(db, 'readonly', function (s) { return s.get(record.id); });
      if (existing && existing.addedAt) record.addedAt = existing.addedAt;
      await tx(db, 'readwrite', function (s) { return s.put(record); });
      db.close();
      return { saved: true, id: record.id };
    } catch (e) {
      return { saved: false, reason: e.message };
    }
  }

  async function load(id) {
    if (!available()) return null;
    var db = await open();
    var row = await tx(db, 'readonly', function (s) { return s.get(id); });
    if (row && row.bytes) {
      row.lastOpenedAt = Date.now();
      await tx(db, 'readwrite', function (s) { return s.put(row); });
    }
    db.close();
    return row && row.bytes ? row.bytes : null;
  }

  async function remove(id) {
    if (!available()) return;
    var db = await open();
    await tx(db, 'readwrite', function (s) { return s.delete(id); });
    db.close();
  }

  /* Browsers may evict IndexedDB under storage pressure. This asks for
   * exemption; the user grants it or not, and either way the app works. */
  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  async function usage() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        var e = await navigator.storage.estimate();
        return { used: e.usage || 0, quota: e.quota || 0 };
      }
    } catch (e) { /* ignore */ }
    return { used: 0, quota: 0 };
  }

  App.library = {
    available: available, reason: reason, list: list, save: save, load: load,
    remove: remove, requestPersistence: requestPersistence, usage: usage,
    idFor: idFor, MAX_BYTES: MAX_BYTES, DB_NAME: DB_NAME
  };
})(window.App = window.App || {});
