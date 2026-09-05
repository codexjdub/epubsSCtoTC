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

  /* When each book was last opened, kept OUT of the book's own record.
   *
   * IndexedDB has no partial update: put() replaces the whole object, and the
   * object carries the entire EPUB. Stamping a timestamp on it therefore wrote
   * the book again -- and WebKit does not reclaim the overwritten copy
   * promptly, so on a phone the stored size climbed by a book on every open
   * and never came back down. Measured against a 382KB book reported as
   * 17.2MB, and confirmed by the one test that separates the two: refreshing
   * without opening the book did not move it, opening it did.
   *
   * A timestamp does not need to live beside the bytes. It is small, it
   * changes often, and losing it costs a sort order and a "3 days ago". */
  var OPENED_KEY = 'epub-tc:opened';
  var openedMemory = null;

  function openedMap() {
    if (openedMemory) return openedMemory;
    try {
      var raw = window.localStorage.getItem(OPENED_KEY);
      openedMemory = raw ? JSON.parse(raw) : {};
    } catch (e) { openedMemory = {}; }
    return openedMemory;
  }

  /* Remembered in memory before the write, so a browser that refuses storage
     still sorts the shelf correctly for this session -- the same shape the
     reader's own preferences use. */
  function markOpened(id) {
    var map = openedMap();
    map[id] = Date.now();
    try { window.localStorage.setItem(OPENED_KEY, JSON.stringify(map)); }
    catch (e) { /* ignore */ }
  }

  function forgetOpened(id) {
    var map = openedMap();
    if (!(id in map)) return;
    delete map[id];
    try { window.localStorage.setItem(OPENED_KEY, JSON.stringify(map)); }
    catch (e) { /* ignore */ }
  }

  async function list() {
    if (!available()) return [];
    var db = await open();
    var rows = await tx(db, 'readonly', function (store) { return store.getAll(); });
    db.close();
    /* lastOpenedAt is overlaid from the map rather than read off the record,
       so the shelf subtitle and this sort go on working unchanged. Rows saved
       before the map existed still carry their own, which is the fallback. */
    var opened = openedMap();
    return (rows || []).map(function (r) {
      return { id: r.id, title: r.title, creator: r.creator, language: r.language,
               size: r.size, addedAt: r.addedAt,
               lastOpenedAt: opened[r.id] || r.lastOpenedAt,
               cover: r.cover || null, coverType: r.coverType || '' };
    }).sort(function (a, b) { return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0); });
  }

  async function save(book, bytes, filename) {
    if (!available()) return { saved: false, reason: reason() };
    if (bytes.byteLength > MAX_BYTES) {
      return { saved: false, reason: 'Too large to save (' +
        Math.round(bytes.byteLength / 1048576) + ' MB); it will still open normally.' };
    }
    /* Stored with the book so the shelf can show it without reopening the
     * archive. A missing or unreadable cover is not worth failing a save. */
    var cover = null, coverType = '';
    if (book.coverPath && book.entries.has(book.coverPath)) {
      try {
        var ce = book.entries.get(book.coverPath);
        cover = await App.zip.loadBytes(ce);
        coverType = ce.mediaType || 'image/jpeg';
      } catch (e) { cover = null; coverType = ''; }
    }

    var record = {
      id: idFor(book),
      cover: cover,
      coverType: coverType,
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
      /* Already here, so there is nothing to write. The id is a content hash:
         a row under it holds these exact bytes. This runs on EVERY open --
         reopening from the shelf comes through here too -- and re-putting the
         record wrote the whole EPUB again for no change at all. */
      if (existing && existing.bytes) {
        db.close();
        markOpened(record.id);
        return { saved: true, id: record.id };
      }
      if (existing && existing.addedAt) record.addedAt = existing.addedAt;
      await tx(db, 'readwrite', function (s) { return s.put(record); });
      db.close();
      markOpened(record.id);
      return { saved: true, id: record.id };
    } catch (e) {
      return { saved: false, reason: e.message };
    }
  }

  async function load(id) {
    if (!available()) return null;
    var db = await open();
    var row = await tx(db, 'readonly', function (s) { return s.get(id); });
    db.close();
    if (row && row.bytes) markOpened(id);
    return row && row.bytes ? row.bytes : null;
  }

  async function remove(id) {
    if (!available()) return;
    var db = await open();
    await tx(db, 'readwrite', function (s) { return s.delete(id); });
    db.close();
    forgetOpened(id);
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

  App.library = {
    available: available, reason: reason, list: list, save: save, load: load,
    remove: remove, requestPersistence: requestPersistence,
    idFor: idFor, MAX_BYTES: MAX_BYTES, DB_NAME: DB_NAME
  };
})(window.App = window.App || {});
