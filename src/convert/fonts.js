/* Embedded font handling.
 *
 * Chinese EPUBs very often embed a font SUBSET containing only the simplified
 * glyphs the book originally used. Convert the text and a large fraction of
 * the characters have no glyph, so they render as tofu or fall back mid
 * paragraph. This module measures that and strips faces that can no longer
 * carry the text.
 */
(function (App) {
  'use strict';

  var Z = App.zip;

  /* ---- SHA-1 ------------------------------------------------------------ */

  /* Implemented here rather than via crypto.subtle: SubtleCrypto requires a
   * secure context, and file:// is not one. The shipped app must work from a
   * double-clicked file, so the hash cannot depend on it. */
  function sha1(bytes) {
    var ml = bytes.length;
    var withOne = new Uint8Array(((ml + 8) >> 6 << 6) + 64);
    withOne.set(bytes);
    withOne[ml] = 0x80;
    var bitLen = ml * 8;
    var dv = new DataView(withOne.buffer);
    dv.setUint32(withOne.length - 4, bitLen >>> 0, false);
    dv.setUint32(withOne.length - 8, Math.floor(bitLen / 4294967296), false);

    var h = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    var w = new Int32Array(80);

    function rol(n, s) { return (n << s) | (n >>> (32 - s)); }

    for (var off = 0; off < withOne.length; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4, false);
      for (i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
      for (i = 0; i < 80; i++) {
        var f, k;
        if (i < 20)      { f = (b & c) | (~b & d);          k = 0x5A827999; }
        else if (i < 40) { f = b ^ c ^ d;                   k = 0x6ED9EBA1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
        else             { f = b ^ c ^ d;                   k = 0xCA62C1D6; }
        var tmp = (rol(a, 5) + f + e + k + w[i]) | 0;
        e = d; d = c; c = rol(b, 30); b = a; a = tmp;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0;
      h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0;
    }

    var out = new Uint8Array(20);
    for (var j = 0; j < 5; j++) {
      out[j * 4]     = (h[j] >>> 24) & 0xff;
      out[j * 4 + 1] = (h[j] >>> 16) & 0xff;
      out[j * 4 + 2] = (h[j] >>> 8) & 0xff;
      out[j * 4 + 3] = h[j] & 0xff;
    }
    return out;
  }

  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0xd800 || c >= 0xe000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else {
        var cp = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(++i) & 0x3ff));
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
    }
    return new Uint8Array(out);
  }

  /* ---- de-obfuscation ---------------------------------------------------- */

  var IDPF_ALGO = 'http://www.idpf.org/2008/embedding';

  /* IDPF: SHA-1 of the unique identifier with all whitespace removed, XORed
   * over the first 1040 bytes. Adobe: the identifier's hex digits as 16 bytes,
   * XORed over the first 1024. */
  function idpfKey(identifier) {
    return sha1(utf8Bytes(String(identifier).replace(/\s+/g, '')));
  }

  function adobeKey(identifier) {
    var hex = String(identifier).replace(/^urn:uuid:/i, '').replace(/[^0-9a-f]/gi, '');
    if (hex.length < 32) return null;
    var key = new Uint8Array(16);
    for (var i = 0; i < 16; i++) key[i] = parseInt(hex.substr(i * 2, 2), 16);
    return key;
  }

  function deobfuscate(bytes, algorithm, identifier) {
    var key, span;
    if (algorithm === IDPF_ALGO) { key = idpfKey(identifier); span = 1040; }
    else { key = adobeKey(identifier); span = 1024; }
    if (!key) return bytes;
    var out = bytes.slice();
    var n = Math.min(span, out.length);
    for (var i = 0; i < n; i++) out[i] ^= key[i % key.length];
    return out;
  }

  /* ---- coverage ---------------------------------------------------------- */

  function collectFontFaces(css) {
    var faces = [];
    var re = /@font-face\s*\{([^}]*)\}/gi;
    var m;
    while ((m = re.exec(css))) {
      var block = m[1];
      var family = (block.match(/font-family\s*:\s*([^;]+)/i) || [])[1] || '';
      var srcs = [];
      var urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
      var u;
      while ((u = urlRe.exec(block))) srcs.push(u[2]);
      faces.push({
        raw: m[0],
        family: family.trim().replace(/^['"]|['"]$/g, ''),
        srcs: srcs
      });
    }
    return faces;
  }

  /* Which characters the book actually needs after conversion. */
  function requiredCharacters(book) {
    var chars = new Set();
    book.entries.forEach(function (entry) {
      if (entry.text === null || !/xhtml|html/i.test(entry.mediaType || '')) return;
      var body = entry.text.replace(/<[^>]*>/g, '');
      for (var i = 0; i < body.length; i++) {
        var ch = body.charAt(i);
        if (ch.charCodeAt(0) > 0x2000) chars.add(ch);
      }
    });
    return chars;
  }

  async function analyze(book, opts) {
    opts = opts || {};
    var threshold = opts.threshold === undefined ? 0.98 : opts.threshold;
    var needed = requiredCharacters(book);
    var results = [];

    var obfuscated = new Map();
    (book.encryption.obfuscatedFonts || []).forEach(function (f) {
      obfuscated.set(f.path, f.algorithm);
    });

    var cssEntries = [];
    book.entries.forEach(function (entry) {
      if (/css/i.test(entry.mediaType || '') || /\.css$/i.test(entry.path)) cssEntries.push(entry);
    });

    for (var c = 0; c < cssEntries.length; c++) {
      var entry = cssEntries[c];
      var css = await Z.loadText(entry);
      var faces = collectFontFaces(css);
      var dir = Z.dirname(entry.path);

      for (var f = 0; f < faces.length; f++) {
        var face = faces[f];
        for (var s = 0; s < face.srcs.length; s++) {
          var src = face.srcs[s];
          if (/^(data:|https?:)/i.test(src)) continue;
          var path = Z.resolve(dir, src);
          var fontEntry = book.entries.get(path);
          if (!fontEntry) continue;

          var record = {
            cssPath: entry.path, path: path, family: face.family, raw: face.raw,
            obfuscated: obfuscated.has(path), parsed: false,
            covered: 0, total: needed.size, coverage: 0, missingSample: [], ok: false,
            error: ''
          };

          try {
            var bytes = await Z.loadBytes(fontEntry);
            if (record.obfuscated) {
              bytes = deobfuscate(bytes, obfuscated.get(path), book.metadata.identifier);
            }
            var font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
            record.parsed = true;

            var covered = 0;
            needed.forEach(function (ch) {
              if (font.charToGlyphIndex(ch) > 0) covered++;
              else if (record.missingSample.length < 12) record.missingSample.push(ch);
            });
            record.covered = covered;
            record.coverage = needed.size ? covered / needed.size : 1;
            record.ok = record.coverage >= threshold;
          } catch (e) {
            /* An unparseable face is reported as such rather than as a
             * coverage failure -- the two have different causes. */
            record.error = e && e.message ? e.message : String(e);
          }

          results.push(record);
        }
      }
    }
    return results;
  }

  /* Remove the @font-face blocks whose fonts cannot carry the converted text,
   * plus any now-dangling font-family references to them. */
  async function stripInsufficient(book, analysis) {
    var byCss = new Map();
    analysis.forEach(function (r) {
      if (r.ok) return;
      if (!byCss.has(r.cssPath)) byCss.set(r.cssPath, []);
      byCss.get(r.cssPath).push(r);
    });

    var stripped = [];
    for (var pair of byCss) {
      var cssPath = pair[0], records = pair[1];
      var entry = book.entries.get(cssPath);
      if (!entry) continue;
      var css = await Z.loadText(entry);
      records.forEach(function (r) {
        css = css.split(r.raw).join('');
        if (r.family) {
          /* Drop the family from any font stack that names it, leaving the
           * remaining fallbacks intact. */
          var famRe = new RegExp('(font-family\\s*:[^;}]*)' +
            r.family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*,?\\s*', 'gi');
          css = css.replace(famRe, '$1');
          css = css.replace(/font-family\s*:\s*(['"]?)\1\s*;/gi, '');
        }
        stripped.push(r.path);
      });
      entry.text = css;
    }
    return stripped;
  }

  App.fonts = {
    analyze: analyze,
    stripInsufficient: stripInsufficient,
    collectFontFaces: collectFontFaces,
    requiredCharacters: requiredCharacters,
    deobfuscate: deobfuscate,
    idpfKey: idpfKey,
    adobeKey: adobeKey,
    sha1: sha1,
    IDPF_ALGO: IDPF_ALGO
  };
})(window.App = window.App || {});
