/* container.xml -> OPF -> manifest / spine / metadata, plus the TOC from
 * either toc.ncx (EPUB 2) or the nav document (EPUB 3).
 *
 * Real-world EPUBs are inconsistent about namespace prefixes, so every lookup
 * here is namespace-agnostic via getElementsByTagNameNS('*', name).
 */
(function (App) {
  'use strict';

  var Z = App.zip;
  var EPUB_NS = 'http://www.idpf.org/2007/ops';

  function tags(root, name) {
    return Array.prototype.slice.call(root.getElementsByTagNameNS('*', name));
  }

  function parseXml(text, label) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    var err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error('Malformed XML in ' + label + ': ' + err.textContent.trim().split('\n')[0]);
    return doc;
  }

  /* Content documents are supposed to be well-formed XHTML, but plenty of real
   * EPUBs are not: unclosed tags, raw & in text, stray attributes. Parsing
   * those strictly and skipping them means a chapter ships SIMPLIFIED inside an
   * otherwise-converted book, which is worse than repairing it. So fall back to
   * the HTML parser, which is designed to recover from exactly this.
   *
   * The HTML parser puts elements in the XHTML namespace, so every
   * namespace-agnostic lookup here keeps working, and serialising the result
   * as XML emits well-formed markup -- the round trip repairs the document.
   *
   * Only content documents get this. The OPF and NCX are genuine XML formats
   * where silently accepting broken markup would hide a real problem. */
  function parseContentDocument(text, label) {
    try {
      return { doc: parseXml(text, label), recovered: false, error: '' };
    } catch (e) {
      var doc = new DOMParser().parseFromString(text, 'text/html');
      if (!doc || !doc.documentElement) throw e;
      return { doc: doc, recovered: true, error: e.message };
    }
  }

  async function findOpfPath(zip) {
    var text = await Z.lookup(zip, 'META-INF/container.xml').async('string');
    var doc = parseXml(text, 'META-INF/container.xml');
    var roots = tags(doc, 'rootfile');
    for (var i = 0; i < roots.length; i++) {
      var mt = roots[i].getAttribute('media-type');
      var fp = roots[i].getAttribute('full-path');
      if (fp && (!mt || mt === 'application/oebps-package+xml')) return fp;
    }
    throw new Error('container.xml declares no OPF rootfile.');
  }

  function readMetadata(pkg) {
    var meta = { title: '', creator: '', language: '', identifier: '', publisher: '', description: '' };
    var md = tags(pkg, 'metadata')[0];
    if (!md) return meta;

    ['title', 'creator', 'language', 'identifier', 'publisher', 'description'].forEach(function (k) {
      var el = tags(md, k)[0];
      if (el) meta[k] = (el.textContent || '').trim();
    });

    /* The package's unique-identifier points at a specific dc:identifier by id.
     * That exact string is the key material for IDPF font de-obfuscation, so
     * take it verbatim rather than assuming the first identifier wins. */
    var uidRef = pkg.getAttribute('unique-identifier');
    if (uidRef) {
      var ids = tags(md, 'identifier');
      for (var i = 0; i < ids.length; i++) {
        if (ids[i].getAttribute('id') === uidRef) {
          meta.identifier = (ids[i].textContent || '').trim();
          break;
        }
      }
    }
    return meta;
  }

  function readManifest(pkg, opfDir) {
    var manifest = new Map();
    var node = tags(pkg, 'manifest')[0];
    if (!node) throw new Error('OPF has no <manifest>.');
    tags(node, 'item').forEach(function (item) {
      var id = item.getAttribute('id');
      var href = item.getAttribute('href');
      if (!id || !href) return;
      manifest.set(id, {
        id: id,
        href: href,
        path: Z.resolve(opfDir, href),
        mediaType: item.getAttribute('media-type') || '',
        properties: (item.getAttribute('properties') || '').split(/\s+/).filter(Boolean)
      });
    });
    return manifest;
  }

  function readSpine(pkg, manifest) {
    var node = tags(pkg, 'spine')[0];
    if (!node) throw new Error('OPF has no <spine>.');
    var spine = [];
    tags(node, 'itemref').forEach(function (ref) {
      var idref = ref.getAttribute('idref');
      var item = manifest.get(idref);
      if (item) {
        spine.push({ idref: idref, item: item, linear: ref.getAttribute('linear') !== 'no' });
      }
    });
    return {
      items: spine,
      tocId: node.getAttribute('toc') || '',
      direction: node.getAttribute('page-progression-direction') || ''
    };
  }

  /* EPUB 2: nested <navPoint> under <navMap>, ordered by playOrder when present. */
  function tocFromNcx(doc, baseDir) {
    function walk(parent) {
      var out = [];
      var children = Array.prototype.slice.call(parent.childNodes);
      children.forEach(function (el) {
        if (el.nodeType !== 1 || el.localName !== 'navPoint') return;
        var label = tags(el, 'navLabel')[0];
        var content = tags(el, 'content')[0];
        var src = content ? content.getAttribute('src') || '' : '';
        out.push({
          label: label ? (label.textContent || '').trim() : '',
          href: src,
          path: src ? Z.resolve(baseDir, src) : '',
          fragment: Z.fragmentOf(src),
          children: walk(el)
        });
      });
      return out;
    }
    var navMap = tags(doc, 'navMap')[0];
    return navMap ? walk(navMap) : [];
  }

  /* EPUB 3: <nav epub:type="toc"> containing nested <ol><li><a>. */
  function tocFromNav(doc, baseDir) {
    var navs = tags(doc, 'nav');
    var toc = null;
    for (var i = 0; i < navs.length; i++) {
      var type = navs[i].getAttributeNS(EPUB_NS, 'type') || navs[i].getAttribute('epub:type') || '';
      if (type.split(/\s+/).indexOf('toc') >= 0) { toc = navs[i]; break; }
    }
    if (!toc) toc = navs[0];
    if (!toc) return [];

    function walkList(ol) {
      var out = [];
      Array.prototype.slice.call(ol.childNodes).forEach(function (li) {
        if (li.nodeType !== 1 || li.localName !== 'li') return;
        var anchor = null, sublist = null;
        Array.prototype.slice.call(li.childNodes).forEach(function (kid) {
          if (kid.nodeType !== 1) return;
          if (!anchor && (kid.localName === 'a' || kid.localName === 'span')) anchor = kid;
          if (!sublist && kid.localName === 'ol') sublist = kid;
        });
        var src = anchor ? anchor.getAttribute('href') || '' : '';
        out.push({
          label: anchor ? (anchor.textContent || '').trim() : '',
          href: src,
          path: src ? Z.resolve(baseDir, src) : '',
          fragment: Z.fragmentOf(src),
          children: sublist ? walkList(sublist) : []
        });
      });
      return out;
    }

    var list = tags(toc, 'ol')[0];
    return list ? walkList(list) : [];
  }

  /* EPUB 3 marks the cover with properties="cover-image"; EPUB 2 points at it
   * with <meta name="cover" content="<manifest id>">. Both turn up in the
   * wild, including in EPUB 3 files that kept the old meta for compatibility,
   * so both are tried. */
  function findCoverPath(pkg, manifest) {
    var found = null;
    manifest.forEach(function (item) {
      if (!found && item.properties.indexOf('cover-image') >= 0) found = item;
    });
    if (!found) {
      var md = tags(pkg, 'metadata')[0];
      var metas = md ? tags(md, 'meta') : [];
      for (var i = 0; i < metas.length; i++) {
        if ((metas[i].getAttribute('name') || '').toLowerCase() !== 'cover') continue;
        var ref = metas[i].getAttribute('content');
        if (ref && manifest.get(ref)) { found = manifest.get(ref); break; }
      }
    }
    return found && /^image\//.test(found.mediaType) ? found.path : '';
  }

  async function readToc(book) {
    var navItem = null;
    book.manifest.forEach(function (item) {
      if (!navItem && item.properties.indexOf('nav') >= 0) navItem = item;
    });

    if (navItem) {
      var navEntry = book.entries.get(navItem.path);
      if (navEntry) {
        /* The nav document is an XHTML content document, so it gets the same
         * repair as a chapter. Parsing it strictly meant one stray & in a
         * chapter label stopped the whole book from opening. */
        var doc = parseContentDocument(await Z.loadText(navEntry), navItem.path).doc;
        var tree = tocFromNav(doc, Z.dirname(navItem.path));
        if (tree.length) return { tree: tree, source: 'nav', path: navItem.path };
      }
    }

    var ncxItem = book.spine.tocId ? book.manifest.get(book.spine.tocId) : null;
    if (!ncxItem) {
      book.manifest.forEach(function (item) {
        if (!ncxItem && item.mediaType === 'application/x-dtbncx+xml') ncxItem = item;
      });
    }
    if (ncxItem) {
      var ncxEntry = book.entries.get(ncxItem.path);
      if (ncxEntry) {
        /* The NCX is a genuine XML format, so it is still parsed strictly --
         * but a broken one costs the reader its table of contents, not the
         * book. */
        try {
          var ncxDoc = parseXml(await Z.loadText(ncxEntry), ncxItem.path);
          return { tree: tocFromNcx(ncxDoc, Z.dirname(ncxItem.path)), source: 'ncx', path: ncxItem.path };
        } catch (e) { /* no usable TOC */ }
      }
    }

    return { tree: [], source: 'none', path: '' };
  }

  async function load(data) {
    var contentId = Z.contentKey(data);
    var zip = await Z.open(data);
    var encryption = await Z.inspectEncryption(zip);
    if (encryption.drm) {
      throw new Error('This EPUB is DRM-protected and cannot be converted.');
    }

    var entries = await Z.readEntries(zip);
    var opfPath = await findOpfPath(zip);
    var opfEntry = entries.get(opfPath);
    if (!opfEntry) throw new Error('OPF declared at ' + opfPath + ' is not present in the archive.');

    var opfDoc = parseXml(await Z.loadText(opfEntry), opfPath);
    var pkg = tags(opfDoc, 'package')[0];
    if (!pkg) throw new Error('OPF has no <package> element.');

    var opfDir = Z.dirname(opfPath);
    var manifest = readManifest(pkg, opfDir);

    var book = {
      zip: zip,
      contentId: contentId,
      entries: entries,
      encryption: encryption,
      opfPath: opfPath,
      opfDir: opfDir,
      opfDoc: opfDoc,
      version: pkg.getAttribute('version') || '2.0',
      metadata: readMetadata(pkg),
      manifest: manifest,
      spine: readSpine(pkg, manifest),
      coverPath: findCoverPath(pkg, manifest)
    };

    /* Tag entries with their declared media type so the converter and the
     * reader can tell markup from images without re-deriving it. */
    manifest.forEach(function (item) {
      var e = entries.get(item.path);
      if (e) {
        e.mediaType = item.mediaType;
        e.isText = Z.isText(item.mediaType, item.path);
      }
    });

    var toc = await readToc(book);
    book.toc = toc.tree;
    book.tocSource = toc.source;
    book.tocPath = toc.path;
    return book;
  }

  App.parse = { load: load, parseXml: parseXml, parseContentDocument: parseContentDocument,
                tags: tags, findOpfPath: findOpfPath, findCoverPath: findCoverPath };
})(window.App = window.App || {});
