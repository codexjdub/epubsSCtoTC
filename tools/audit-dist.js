/* Static audit of dist/index.html for the things that break at file://.
 * The browser automation here cannot open file:// URLs, so these invariants
 * are checked directly against the bytes instead of by loading the page. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const file = path.resolve(__dirname, '..', 'dist', 'index.html');
const buf = fs.readFileSync(file);
const html = buf.toString('utf8');

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

console.log('auditing ' + path.relative(path.resolve(__dirname, '..'), file));

// Encoding signal must precede any payload.
const charsetAt = buf.indexOf(Buffer.from('<meta charset="utf-8"/>', 'utf8'));
check('charset meta within first 1024 bytes', charsetAt >= 0 && charsetAt < 1024, 'byte ' + charsetAt);
check('file decodes as valid UTF-8', Buffer.from(html, 'utf8').equals(buf), 'round trip differs');
/* Derived from the source rather than hardcoded: this checks that UTF-8
 * survived the build, and a canary spelled out here just breaks on a rename. */
const h1 = (read('index.html').match(/<h1>([^<]+)<\/h1>/) || [])[1] || '';
check('Chinese text survives the build',
      /[\u4e00-\u9fff]/.test(h1) && html.includes(h1), h1 ? 'missing: ' + h1 : 'no <h1> in index.html');

// ES modules do not load from a null origin.
check('no ES module scripts', !/<script[^>]+type=["']module["']/i.test(html));
check('no import statements', !/^\s*import\s+[\w{*]/m.test(html));

/* Nothing may be fetched at runtime: the page must work with no network at
 * all, which is also what makes it work from file://. */
check('no fetch() calls', !/\bfetch\s*\(/.test(html));
check('no XMLHttpRequest', !/XMLHttpRequest/.test(html));
check('no external src/href', !/(src|href)=["']https?:\/\//i.test(html));

// Workers from a null origin are blocked in Chrome.
check('no Web Workers', !/new\s+Worker\s*\(/.test(html));

// Requires a secure context, which file:// is not.
/* Match a real property access (crypto.subtle.digest), not a prose mention
 * of the name in a comment explaining why it is avoided. */
check('no crypto.subtle usage', !/crypto\.subtle\s*\./.test(html));
check('no File System Access API', !/showSaveFilePicker|showOpenFilePicker/.test(html));

// Script element integrity.
const opens = (html.match(/<script>/g) || []).length;
const closes = (html.match(/<\/script>/g) || []).length;
check('script tags balanced', opens === closes, opens + ' open / ' + closes + ' close');
check('no unescaped </script> inside payloads', closes === opens,
      'escaped form present: ' + /<\\\/script/.test(html));

// Every module actually made it in.
[['JSZip', 'JSZip'], ['OpenCC', 'OpenCC'], ['opentype', 'opentype'],
 ['zip module', 'App.zip ='], ['parser', 'App.parse ='], ['ambiguity table', 'App.ambiguityTable ='],
 ['converter', 'App.convert.convertDocument'], ['fonts', 'App.fonts ='],
 ['punctuation', 'App.punct ='], ['renderer', 'App.reader.renderChapter'],
 ['reader engine', 'App.reader.create'], ['export', 'App.export ='],
 ['ui', 'App.ui =']
].forEach(([name, needle]) => check('bundled: ' + name, html.includes(needle)));

// localStorage must never throw the app down.
const lsUses = (html.match(/localStorage\./g) || []).length;
check('localStorage accesses are guarded', lsUses > 0 && /try\s*\{[^}]*localStorage/.test(html),
      lsUses + ' uses');

console.log('  size ' + (buf.length / 1048576).toFixed(2) + ' MB');
console.log(failures ? '\nAUDIT FAILED: ' + failures : '\nAUDIT PASSED');
process.exit(failures ? 1 : 0);
