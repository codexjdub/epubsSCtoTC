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

/* The script list is written twice -- once in index.html for development, once
   in tools/build.js for the bundle -- and only one of them is exercised
   locally. Adding a module to index.html and forgetting build.js leaves
   localhost working perfectly while the deployed page fails on the missing
   global, which is the wrong way round for a mistake to hide. */
const devScripts = (read('index.html').match(/<script src="[^"]+"/g) || [])
  .map(tag => tag.slice('<script src="'.length, -1));
const bundled = (() => {
  const src = read('tools/build.js');
  const list = src.match(/const SCRIPTS = \[([\s\S]*?)\];/);
  return list ? (list[1].match(/'([^']+)'/g) || []).map(q => q.slice(1, -1)) : [];
})();
check('the dev page and the bundle load the same scripts, in the same order',
      devScripts.length > 0 && devScripts.join('|') === bundled.join('|'),
      'index.html: ' + devScripts.length + ', build.js: ' + bundled.length + ' -> ' +
      (devScripts.filter(x => !bundled.includes(x)).concat(
        bundled.filter(x => !devScripts.includes(x))).join(', ') || 'order differs'));

/* A label key with no entry renders as the key itself -- deliberate, so it is
   visible rather than blank, but nothing stops one shipping. */
const usedKeys = [...new Set((read('index.html')
  .match(/data-i18n(?:-title)?="[^"]+"/g) || [])
  .map(a => a.slice(a.indexOf('"') + 1, -1)))];
const definedKeys = new Set((read('src/ui/strings.js').match(/^\s*'[a-z][\w.]*':/gm) || [])
  .map(k => k.trim().slice(1, k.trim().indexOf(':') - 1)));
const unknownKeys = usedKeys.filter(k => !definedKeys.has(k));
check('every label key in the markup exists in the table',
      usedKeys.length > 0 && unknownKeys.length === 0,
      unknownKeys.length ? unknownKeys.join(', ') : 'no data-i18n attributes found');

/* Braces must balance. A stray `}` is not a loud failure in CSS: the parser
   discards it and quietly drops the rule that follows, so the stylesheet still
   loads and one rule simply never applies. That is not hypothetical either --
   a `}` left behind when a media block was deleted swallowed
   `.bar-panel label.range` for weeks, and the only symptom was two sliders
   sitting a couple of pixels from their labels. */
{
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  /* Comments AND string literals: `content: '}'` is legal CSS and would count
     as a closing brace, which could either mask a real stray one or invent a
     failure that is not there. */
  const bare = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
  let depth = 0, stray = 0;
  for (const ch of bare) {
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth < 0) { stray++; depth = 0; } }
  }
  check('stylesheet braces balance', stray === 0 && depth === 0,
        stray ? stray + ' stray closing brace(s)' : depth + ' block(s) left open');
}

/* Comment delimiters must balance too. An unbalanced close is as silent as a
   stray brace and worse to spot: everything after it, up to the next one, is
   parsed as CSS, so an edit that lands its text after a comment has already
   ended turns the prose into a rule and the parser drops what follows. Not
   hypothetical: it happened while writing the ribbon rule in style.css, and
   the brace check sailed through, because nothing about it is unbalanced.

   Writing this comment did it a second time, in JavaScript -- quoting the
   delimiter inside a block comment ends the block comment. Hence the wording
   here, which never spells either one out. */
{
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  const opens = (css.match(/\/\*/g) || []).length;
  const closes = (css.match(/\*\//g) || []).length;
  check('stylesheet comments balance', opens === closes,
        opens + ' opened, ' + closes + ' closed');
  /* And no declaration outside a rule. Keyed on the semicolon, not the colon:
     an at-rule prelude like `@media (max-width: 340px)` has one of those and
     is perfectly legal. This is the weaker of the two checks -- the accident
     above carried no semicolon and only the delimiter count caught it -- but
     it is the one that catches a declaration left stranded by a deleted
     selector. */
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0, orphan = '';
  for (const part of bare.split(/([{}])/)) {
    if (part === '{') depth++;
    else if (part === '}') depth--;
    else if (depth === 0 && part.includes(';') && part.trim()) orphan = part.trim().slice(0, 60);
  }
  check('no declarations outside a rule', !orphan, orphan);
}

/* The one breakpoint, spelled in two languages that cannot share a constant.
   JS names it as max-width, the phone block matches, and the focus block takes
   the complement -- so the two numbers must stay exactly one apart. A drift of
   a single pixel opens a width where the desktop layout is on screen while the
   script still calls it a phone: focus mode accepted, its CSS not applying. */
{
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  const cssMax = new Set(
    [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map(m => +m[1]));
  const mins = [...css.matchAll(/@media\s*\(min-width:\s*(\d+)px\)/g)].map(m => +m[1]);
  /* Only the script's own copies. The stylesheet is allowed other breakpoints
     -- 420px trims the title on a small phone and has nothing to do with the
     layout split -- but the script must know exactly one. */
  const js = new Set(
    [...html.matchAll(/matchMedia\(\s*['"]\(max-width:\s*(\d+)px\)['"]\s*\)/g)]
      .concat([...html.matchAll(/NARROW\s*=\s*['"]\(max-width:\s*(\d+)px\)['"]/g)])
      .map(m => +m[1]));
  check('the script knows exactly one breakpoint',
        js.size === 1, 'max-width values in the script: ' + [...js].join(', '));
  const narrow = [...js][0];
  check('and the stylesheet has a block for it',
        cssMax.has(narrow), narrow + 'px has no @media block');
  check('and every min-width block takes its exact complement',
        mins.every(v => v === narrow + 1),
        'expected ' + (narrow + 1) + ', found ' + (mins.join(', ') || 'none'));
}

/* Responsive overrides must stay LAST in the stylesheet. A media query adds no
   specificity, so whether it wins is decided by source order alone -- a plain
   rule written below one silently beats it. That is not hypothetical: a
   `.topbar { position: relative }` sitting 260 lines below the phone layout
   beat its `position: fixed`, and the bar animated correctly while the reading
   column never grew. */
const styleBlock = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const lastMedia = styleBlock.lastIndexOf('@media (max-width');
let trailing = '';
if (lastMedia >= 0) {
  let depth = 0;
  let end = styleBlock.length;
  for (let i = lastMedia; i < styleBlock.length; i++) {
    if (styleBlock[i] === '{') depth++;
    else if (styleBlock[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  trailing = styleBlock.slice(end).replace(/\/\*[\s\S]*?\*\//g, '').trim();
}
check('responsive overrides are last in the stylesheet',
      lastMedia >= 0 && trailing === '',
      trailing ? trailing.split('\n')[0].slice(0, 60) + ' …' : 'no width media query found');

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
