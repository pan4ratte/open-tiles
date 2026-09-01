/**
 * Guards the seam between the READMEs and the interface they describe.
 *
 * A document goes stale without a sound. `README.md` spent this release telling
 * people to turn on **Switch groups by scrolling**, a control that had been
 * renamed to **Switch groups by gesture** - nothing failed, the sentence simply
 * sent readers looking for something that was not there. A second README in
 * another language doubles every way that can happen.
 *
 * What can quietly go wrong here:
 *
 *   - a README quotes a control by a name the interface no longer uses, or
 *     never used. Bolded text is how both of them point at the interface, so
 *     bolded text is what is checked against the message table.
 *   - a section is added to one README and not the other, so whoever reads the
 *     translation is missing a feature rather than reading about it in their
 *     own language.
 *   - the two stop linking to each other, which is the only way either is found.
 *
 * A bolded run that is not ours - a product name, a Firefox button, the author -
 * is listed in NOT_OURS below. Adding to that list is the way to say "this is
 * not a control"; it is deliberately a list rather than a guess.
 *
 *   node test/docs.test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

/**
 * The READMEs, and the locale each one quotes the interface from. Adding a
 * language means adding a line here and nothing else.
 */
const READMES = [
  { file: 'README.md', locale: 'en', other: 'README.ru.md' },
  { file: 'README.ru.md', locale: 'ru', other: 'README.md' }
];

/** Bolded runs that are not controls, so are not looked up in the messages. */
const NOT_OURS = new Set([
  '+',                             // the add tile, drawn rather than named
  'Inter', 'Speed Dial 2',         // other people's names
  'Lucide',
  'pan4ratte',                     // the author
  'English', 'Русский',            // the language switcher
  'Load Temporary Add-on…',        // Firefox's own button, in its own words
  'Загрузить временное дополнение…'
]);

/* `Export…` in the message table is `**Export**` in prose - the ellipsis says a
   dialog follows, which is a fact about the button rather than about the name.
   Both sides are trimmed of it before they are compared. */
const bare = text => text.replace(/[…]+$/, '').replace(/\.\.\.$/, '').trim();

/** The heading levels of a document, in order: `['#', '##', '###', …]`. */
const shape = source => [...source.matchAll(/^(#{1,6})[ \t]+\S/gm)].map(m => m[1]);

// ------------------------------------------------- each one against its locale

const docs = new Map();

READMES.forEach(({ file, locale, other }) => {
  if (!fs.existsSync(path.join(ROOT, file))) {
    check(file + ' exists', false, 'missing');
    return;
  }
  const source = read(file);
  docs.set(file, source);

  const messages = JSON.parse(read(path.join('_locales', locale, 'messages.json')));
  const said = new Set(Object.values(messages).map(entry => bare(entry.message)));

  const quoted = [...source.matchAll(/\*\*([^*\n]+)\*\*/g)]
    .map(m => bare(m[1]))
    .filter(text => !NOT_OURS.has(text) && !NOT_OURS.has(text + '…'));

  const strangers = [...new Set(quoted)].filter(text => !said.has(text));
  check(file + ' quotes controls the interface actually has',
    strangers.length === 0,
    strangers.length
      ? strangers.map(t => '"' + t + '" is in no ' + locale + ' message').join(', ')
      : quoted.length + ' quoted, all present');

  check(file + ' links to ' + other, source.includes('(' + other + ')'));
});

// ------------------------------------------------------- and against each other

const [first, second] = READMES;
if (docs.has(first.file) && docs.has(second.file)) {
  const shapes = [shape(docs.get(first.file)), shape(docs.get(second.file))];

  check('both READMEs have the same sections, in the same order',
    shapes[0].join(' ') === shapes[1].join(' '),
    shapes[0].length + ' vs ' + shapes[1].length + ' heading(s)');

  /* Not a translation check - nothing here can read Russian - but a length that
     has drifted by more than half is a section quietly dropped rather than a
     language being terser than English. */
  const lengths = [docs.get(first.file).length, docs.get(second.file).length];
  const ratio = Math.max(...lengths) / Math.min(...lengths);
  check('and neither is a fraction of the other', ratio < 1.5,
    lengths.join(' vs ') + ' characters, ' + ratio.toFixed(2) + '×');
}

// ------------------------------------------------------------------ report

let failed = 0;
results.forEach(({ name, pass, detail }) => {
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  (' + detail + ')' : ''));
});
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);
