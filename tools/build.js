/* Inline every asset into one self-contained dist/index.html. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', 'index.html');

const SCRIPTS = [
  'vendor/jszip.min.js',
  'vendor/opencc-cn2t.js',
  'vendor/opentype.min.js',
  'src/epub/zip.js',
  'src/epub/parse.js',
  'src/convert/ambiguity-table.js',
  'src/convert/text.js',
  'src/convert/book.js',
  'src/convert/fonts.js',
  'src/convert/punct.js',
  'src/reader/render.js',
  'src/reader/fonts.js',
  'src/reader/nav.js',
  'src/reader/keys.js',
  'src/export/write.js',
  'src/llm/disambiguate.js',
  'src/ui/strings.js',
  'src/ui/theme.js',
  'src/ui/library.js',
  'src/ui/app.js'
];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/* A literal </script> inside inlined JS would close the element early. */
function escapeScript(js) {
  return js.replace(/<\/script/gi, '<\\/script');
}

const source = read('index.html');
const css = read('src/ui/style.css');

// Body markup, taken from the dev page so the two cannot drift apart.
const bodyMatch = source.match(/<body>([\s\S]*?)<script/i);
if (!bodyMatch) throw new Error('Could not find the body markup in index.html');
const body = bodyMatch[1].trim();

const titleMatch = source.match(/<title>([\s\S]*?)<\/title>/i);
const title = titleMatch ? titleMatch[1] : 'EPUB converter';

const head = [
  '<!DOCTYPE html>',
  '<html lang="zh-Hant">',
  '<head>',
  '<meta charset="utf-8"/>',                    // must stay first
  '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
  '<title>' + title + '</title>',
  '<style>',
  css,
  '</style>',
  '</head>',
  '<body>',
  body
].join('\n');

const scripts = SCRIPTS.map(rel =>
  '<script>/* ' + rel + ' */\n' + escapeScript(read(rel)) + '\n</script>'
).join('\n');

const html = head + '\n' + scripts + '\n</body>\n</html>\n';

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html, 'utf8');

// ---- verify the invariants the build exists to protect ----
const buf = fs.readFileSync(out);
const charsetAt = buf.indexOf(Buffer.from('<meta charset="utf-8"/>', 'utf8'));
if (charsetAt < 0) throw new Error('charset meta missing from the build output');
if (charsetAt >= 1024) {
  throw new Error('charset meta at byte ' + charsetAt + ', must be within the first 1024');
}
const scriptOpens = (html.match(/<script>/g) || []).length;
const scriptCloses = (html.match(/<\/script>/g) || []).length;
if (scriptOpens !== scriptCloses) {
  throw new Error('unbalanced script tags: ' + scriptOpens + ' open, ' + scriptCloses + ' close');
}

console.log('built ' + path.relative(root, out));
console.log('  size            ' + (buf.length / 1048576).toFixed(2) + ' MB');
console.log('  charset at byte ' + charsetAt + ' (must be < 1024)');
console.log('  script blocks   ' + scriptOpens);
