/* EPUB container read/write.
 *
 * The one rule that breaks readers if violated: the `mimetype` entry must be
 * the first record in the archive and stored uncompressed. JSZip preserves
 * insertion order, so we add it first with {compression:'STORE'}.
 */
(function (App) {
  'use strict';

  var TEXT_RE = /^(text\/|application\/(xhtml\+xml|x-dtbncx\+xml|oebps-package\+xml|xml|json|javascript))/;

  function dirname(path) {
    var i = path.lastIndexOf('/');
    return i < 0 ? '' : path.slice(0, i + 1);
  }

  /* Resolve an OPF-relative href against a base directory, normalising `..`
   * and `.` segments. Returns a zip-style path with no leading slash. */
  function resolve(baseDir, href) {
    var clean = String(href).split('#')[0].split('?')[0];
    if (!clean) return '';
    if (clean.charAt(0) === '/') clean = clean.slice(1);
    var parts = (baseDir + clean).split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p === '' || p === '.') continue;
      if (p === '..') { out.pop(); continue; }
      out.push(p);
    }
    return out.join('/');
  }

  function fragmentOf(href) {
    var i = String(href).indexOf('#');
    return i < 0 ? '' : href.slice(i + 1);
  }

  /* Manifest hrefs may be percent-encoded while zip entry names are literal
   * (href="ch%201.xhtml" vs entry "ch 1.xhtml"). Try both spellings. */
  function lookup(zip, path) {
    var f = zip.file(path);
    if (f) return f;
    try {
      var dec = decodeURIComponent(path);
      if (dec !== path && (f = zip.file(dec))) return f;
    } catch (e) { /* malformed escape - fall through */ }
    try {
      var enc = encodeURI(path);
      if (enc !== path && (f = zip.file(enc))) return f;
    } catch (e) { /* ignore */ }
    return null;
  }

  function isText(mediaType, path) {
    if (mediaType && TEXT_RE.test(mediaType)) return true;
    return /\.(x?html|htm|xml|ncx|opf|css|js|json|txt)$/i.test(path || '');
  }

  async function open(data) {
    var zip = await JSZip.loadAsync(data);
    if (!zip.file('META-INF/container.xml')) {
      throw new Error('Not an EPUB: META-INF/container.xml is missing.');
    }
    return zip;
  }

  /* DRM and IDPF font obfuscation both announce themselves here. Font
   * obfuscation is recoverable (see convert/fonts.js); real DRM is not. */
  async function inspectEncryption(zip) {
    var f = zip.file('META-INF/encryption.xml');
    if (!f) return { encrypted: false, obfuscatedFonts: [], drm: false };
    var xml = await f.async('string');
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    var refs = doc.getElementsByTagNameNS('*', 'CipherReference');
    var methods = doc.getElementsByTagNameNS('*', 'EncryptionMethod');
    var algos = [];
    for (var i = 0; i < methods.length; i++) {
      algos.push(methods[i].getAttribute('Algorithm') || '');
    }
    var OBFUSCATION = [
      'http://www.idpf.org/2008/embedding',
      'http://ns.adobe.com/pdf/enc#RC'
    ];
    var obfuscated = [], drm = false;
    for (var j = 0; j < refs.length; j++) {
      var uri = refs[j].getAttribute('URI') || '';
      var algo = algos[j] || algos[0] || '';
      if (OBFUSCATION.indexOf(algo) >= 0) {
        obfuscated.push({ path: decodeURIComponent(uri), algorithm: algo });
      } else {
        drm = true;
      }
    }
    return { encrypted: true, obfuscatedFonts: obfuscated, drm: drm };
  }

  /* Load the whole container. Text entries are read eagerly because the
   * conversion pass rewrites them; binaries stay lazy so we don't hold a
   * decoded copy of every image alongside the compressed one. */
  async function readEntries(zip) {
    var entries = new Map();
    var names = Object.keys(zip.files);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var zf = zip.files[name];
      if (zf.dir) continue;
      var entry = { path: name, zipObj: zf, text: null, mediaType: null, isText: false };
      entries.set(name, entry);
    }
    return entries;
  }

  async function loadText(entry) {
    if (entry.text === null) entry.text = await entry.zipObj.async('string');
    return entry.text;
  }

  async function loadBytes(entry) {
    return entry.zipObj.async('uint8array');
  }

  /* Rebuild the archive. `entries` is the live Map; anything with a non-null
   * `text` is written from that string, everything else is copied through. */
  async function write(entries, onProgress) {
    var zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

    var list = Array.from(entries.values()).filter(function (e) {
      return e.path !== 'mimetype';
    });

    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var data = e.text !== null ? e.text : await loadBytes(e);
      zip.file(e.path, data, { compression: 'DEFLATE', compressionOptions: { level: 6 } });
    }

    return zip.generateAsync(
      { type: 'blob', mimeType: 'application/epub+zip' },
      onProgress ? function (m) { onProgress(m.percent / 100); } : undefined
    );
  }

  App.zip = {
    open: open,
    readEntries: readEntries,
    inspectEncryption: inspectEncryption,
    loadText: loadText,
    loadBytes: loadBytes,
    write: write,
    dirname: dirname,
    resolve: resolve,
    fragmentOf: fragmentOf,
    lookup: lookup,
    isText: isText
  };
})(window.App = window.App || {});
