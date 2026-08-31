/**
 * Writes `_locales/en/messages.json` from the English in `src/i18n.js`.
 *
 * English is written once, in the table in `src/i18n.js`, because that table
 * is also the fallback the page runs on where `browser.i18n` is not there to
 * ask - a page opened straight off disk. This turns it into the file Firefox,
 * addons.mozilla.org and every translation platform expect, which is what a
 * translator copies to start a language.
 *
 * Run it after changing any message:
 *
 *   node tools/build-locales.js
 *
 * `test/i18n.test.js` fails if the two have drifted apart, so a forgotten run
 * is caught rather than shipped.
 *
 * Only English is generated. Every other `_locales/<code>/messages.json` is
 * written by hand or by a translation platform and is never touched here.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_locales', 'en', 'messages.json');

const { MESSAGES } = require(path.join(ROOT, 'src', 'i18n.js'));

/**
 * The comment sitting above a key in `i18n.js`, handed on as the message's
 * `description` - which is the one place a translation platform shows a
 * translator what a string is for. Written back rather than kept only in the
 * source, because a translator never opens the source.
 *
 * A block of `//` lines directly above the key is taken whole; a section rule
 * (`// ----`) is not a note about the key under it and is dropped.
 */
function describe(source, key) {
  const at = source.search(new RegExp('^\\s{4}' + key + ':', 'm'));
  if (at < 0) return '';

  const lines = source.slice(0, at).split('\n');
  const note = [];
  for (let i = lines.length - 2; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('//')) break;
    const text = line.slice(2).trim();
    if (/^-{3,}/.test(text)) break;
    note.unshift(text);
  }
  return note.join(' ');
}

/** How many `$n` a message uses, which is how many it has to declare. */
function placeholders(text) {
  const most = [...text.matchAll(/\$(\d)/g)]
    .reduce((high, m) => Math.max(high, Number(m[1])), 0);
  if (!most) return null;

  const out = {};
  for (let n = 1; n <= most; n++) out['n' + n] = { content: '$' + n };
  return out;
}

const source = fs.readFileSync(path.join(ROOT, 'src', 'i18n.js'), 'utf8');

const messages = {};
Object.entries(MESSAGES).forEach(([key, text]) => {
  // A lone `$` means itself in messages.json and has to be doubled; `$1` and
  // friends are substitutions and are left alone.
  const entry = { message: text.replace(/\$(?!\d)/g, '$$$$') };

  const note = describe(source, key);
  if (note) entry.description = note;

  const holes = placeholders(text);
  if (holes) entry.placeholders = holes;

  messages[key] = entry;
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(messages, null, 2) + '\n', 'utf8');

console.log('wrote ' + path.relative(ROOT, OUT) + ' - '
  + Object.keys(messages).length + ' messages');
