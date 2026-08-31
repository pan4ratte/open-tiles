/**
 * Guards the seam between the code and the words it says.
 *
 * Translation is the kind of thing that breaks quietly: nothing throws when a
 * key is misspelt, when `_locales/en` is a build behind the table it came
 * from, or when a sentence creeps back into the markup. The page carries on
 * and says the wrong thing, or nothing, in one language and not the others.
 *
 * What can quietly go wrong here:
 *
 *   - a key is asked for that no message has. `t` answers with the key itself,
 *     so a button reads `btn_save` - visible, but only to somebody running
 *     that language.
 *   - `_locales/en/messages.json` drifts from `src/i18n.js`. The two are one
 *     source and a generator; forgetting to run it ships the old English to
 *     Firefox and to every translator who starts from that file, while the
 *     page opened off disk shows the new.
 *   - a message that is filled in is asked for with nothing to fill it, so a
 *     bare `$1` reaches the screen.
 *   - a sentence goes back into `newtab.html` or into a module, where no
 *     translation can reach it.
 *   - a key stops being asked for anywhere and stays in the table, so every
 *     translator goes on translating a string nobody will ever read.
 *
 *   node test/i18n.test.js [path/to/src]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = process.argv[2] || path.join(ROOT, 'src');

const read = file => fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');

const I18N = require(path.join(SRC, 'i18n.js'));
const { MESSAGES } = I18N;

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

const MODULES = fs.readdirSync(SRC).filter(f => f.endsWith('.js'));
const html = read('newtab.html');

// --------------------------------------------------------------- the keys

/* messages.json allows letters, digits, underscores and @ in a key, and
   nothing else - a key with a dash or a dot in it is dropped on the floor by
   Firefox with no complaint at all. */
const badly = Object.keys(MESSAGES).filter(key => !/^[A-Za-z0-9_@]+$/.test(key));
check('every key is one Firefox will accept', badly.length === 0, badly.join(', '));

const empty = Object.entries(MESSAGES).filter(([, text]) => !String(text).trim());
check('no message is empty', empty.length === 0, empty.map(([k]) => k).join(', '));

// ------------------------------------------------- what the code asks for

/**
 * Every string handed to `t` or `I18N.plural`, wherever it sits in the call:
 * plenty of them are chosen by a ternary inside the brackets, so the argument
 * list is walked rather than matched.
 */
function asked(source) {
  const keys = [];
  const call = /(^|[^\w.$])(?:I18N\.)?(t|plural)\(/g;

  let m;
  while ((m = call.exec(source))) {
    let at = call.lastIndex;
    let depth = 1;
    // Walk to the bracket that closes this call, stepping over strings so a
    // bracket inside one does not end it early.
    while (at < source.length && depth) {
      const c = source[at];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === "'" || c === '"' || c === '`') {
        const quote = c;
        at++;
        while (at < source.length && source[at] !== quote) {
          at += source[at] === '\\' ? 2 : 1;
        }
      }
      at++;
    }

    // A string with a `+` after it is half of a key being built - `t('color_'
    // + key)` - and the whole of it is checked further down instead.
    const args = source.slice(call.lastIndex, at - 1);
    [...args.matchAll(/'([^'\\\n]+)'(\s*\+)?/g)]
      .forEach(hit => { if (!hit[2]) keys.push(hit[1]); });
  }
  return keys;
}

const wanted = new Map();
MODULES.forEach(file => {
  if (file === 'i18n.js') return;
  asked(read(file)).forEach(key => {
    if (!wanted.has(key)) wanted.set(key, file);
  });
});

[...html.matchAll(/data-i18n(?:-title|-label|-placeholder)?="([^"]+)"/g)]
  .forEach(m => { if (!wanted.has(m[1])) wanted.set(m[1], 'newtab.html'); });

const unknown = [...wanted].filter(([key]) => !(key in MESSAGES));
check('every key the code asks for is in the table',
  unknown.length === 0,
  unknown.map(([key, file]) => key + ' (' + file + ')').join(', ')
    || wanted.size + ' keys asked for, all present');

// ------------------------------------------------ and what it never asks for

/* A key can also be reached by name rather than by literal - `t('color_' +
   key)`, and the weights the same way. Whatever prefix is built that way
   covers every key under it. */
const built = new Set();
MODULES.forEach(file => {
  [...read(file).matchAll(/'([a-z][A-Za-z0-9_]*_?)'\s*\+/g)]
    .forEach(m => built.add(m[1]));
});

const everything = MODULES.map(read).join('\n') + html;
const dead = Object.keys(MESSAGES).filter(key => {
  if (key.startsWith('ext')) return false;              // Firefox reads these
  if ([...built].some(prefix => key.startsWith(prefix) && prefix.length > 3)) return false;
  return !everything.includes("'" + key + "'") && !everything.includes('"' + key + '"');
});
check('no message is left in the table that nothing asks for',
  dead.length === 0, dead.join(', '));

// --------------------------------------------------------- the fillings

/* A message written with `$1` needs something to put there. Asked for with an
   empty argument list, it reaches the screen with the `$1` still in it. */
const bare = [];
MODULES.forEach(file => {
  const source = read(file);
  Object.entries(MESSAGES).forEach(([key, text]) => {
    if (!/\$\d/.test(text)) return;
    if (new RegExp("t\\('" + key + "'\\s*\\)").test(source)) bare.push(key + ' (' + file + ')');
  });
});
check('nothing asks for a message it has no values for', bare.length === 0, bare.join(', '));

const holes = Object.entries(MESSAGES).filter(([, text]) => {
  const used = [...String(text).matchAll(/\$(\d)/g)].map(m => Number(m[1]));
  // $2 without a $1 means the caller's arguments and the message disagree
  // about which is which.
  return used.length && Math.max(...used) !== new Set(used).size;
});
check('a message numbers its values from one, without a gap',
  holes.length === 0, holes.map(([k]) => k).join(', '));

// ------------------------------------------------------ nothing left behind

/* A sentence in the markup is a sentence no translation reaches. Text nodes
   are checked rather than attributes, and the <title> is allowed: it is what
   the tab says before a single script has run, and I18N.apply replaces it. */
const stray = [...html.matchAll(/>([^<>]*[A-Za-z]{3}[^<>]*)</g)]
  .map(m => m[1].trim())
  .filter(text => text && !text.startsWith('<!--') && text !== 'New Tab');
check('no sentence is left loose in the markup', stray.length === 0, stray.join(' | '));

const attrs = [...html.matchAll(/\s(title|aria-label|placeholder)="([^"]*[A-Za-z]{3}[^"]*)"/g)];
check('no title, label or placeholder is written in the markup',
  attrs.length === 0, attrs.map(m => m[1] + '="' + m[2] + '"').join(', '));

// --------------------------------------------------------- the load order

/* schema.js asks for every one of its labels as it is evaluated, so the table
   has to be on the page before it. */
const order = ['i18n.js', 'schema.js', 'settings.js', 'newtab.js']
  .map(file => html.indexOf('src="' + file + '"'));
check('i18n.js is loaded before anything that asks it for a word',
  order[0] > -1 && order.every((at, i) => i === 0 || at > order[0]),
  order.join(' < '));

// ------------------------------------------------------- against _locales

const EN = path.join(ROOT, '_locales', 'en', 'messages.json');
const built_en = fs.existsSync(EN) ? JSON.parse(fs.readFileSync(EN, 'utf8')) : null;

check('_locales/en has been generated', built_en !== null,
  built_en ? Object.keys(built_en).length + ' messages' : 'run node tools/build-locales.js');

if (built_en) {
  const missing = Object.keys(MESSAGES).filter(key => !(key in built_en));
  const extra = Object.keys(built_en).filter(key => !(key in MESSAGES));
  const changed = Object.keys(MESSAGES).filter(key =>
    built_en[key] && built_en[key].message !== String(MESSAGES[key]).replace(/\$(?!\d)/g, '$$$$'));

  check('_locales/en is in step with the table',
    !missing.length && !extra.length && !changed.length,
    [
      missing.length ? 'missing: ' + missing.join(', ') : '',
      extra.length ? 'stale: ' + extra.join(', ') : '',
      changed.length ? 'changed: ' + changed.join(', ') : ''
    ].filter(Boolean).join(' | ')
      || Object.keys(built_en).length + ' messages, word for word');

  const undeclared = Object.entries(built_en).filter(([, entry]) => {
    const most = [...entry.message.matchAll(/\$(\d)/g)]
      .reduce((high, m) => Math.max(high, Number(m[1])), 0);
    return most && Object.keys(entry.placeholders || {}).length !== most;
  });
  check('every substitution is declared, the way a platform expects',
    undeclared.length === 0, undeclared.map(([k]) => k).join(', '));
}

// ------------------------------------------------------- the manifest

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

check('the manifest names a default locale, so Firefox reads _locales at all',
  manifest.default_locale === 'en', String(manifest.default_locale));

check('the add-on names itself out of the table too',
  manifest.name === '__MSG_extName__' && manifest.description === '__MSG_extDescription__',
  manifest.name + ' / ' + manifest.description);

// ------------------------------------------------------- filling in

check('a value is put where the message asks for it',
  I18N.t('group_full', 24) === 'That is as many groups as there is room for (24).',
  I18N.t('group_full', 24));

check('a key nothing has is answered with itself rather than with nothing',
  I18N.t('no_such_message_anywhere') === 'no_such_message_anywhere');

check('one thing and more than one get different words',
  I18N.plural(1, 'restore_tile', 'restore_tiles') === '1 tile'
    && I18N.plural(4, 'restore_tile', 'restore_tiles') === '4 tiles',
  I18N.plural(1, 'restore_tile', 'restore_tiles') + ' / '
    + I18N.plural(4, 'restore_tile', 'restore_tiles'));

check('a list is joined by the language, not by a comma in the code',
  I18N.list(['3 groups', '12 tiles', 'your settings'])
    === '3 groups, 12 tiles and your settings',
  I18N.list(['3 groups', '12 tiles', 'your settings']));

check('a list of one is left as it is, and a list of none says so',
  I18N.list(['the background']) === 'the background' && I18N.list([]) === 'nothing');

// -------------------------------------------- and once Firefox has a language

/*
 * The whole point of the arrangement: a `_locales/<code>/messages.json` wins
 * over the English compiled in. Firefox is stubbed rather than run, because
 * what is being checked is which of the two answers is preferred - and the
 * awkward case is a key that language has not translated yet, which arrives as
 * the empty string and has to fall through rather than empty the label.
 */
const vm = require('vm');

function withFirefox(getMessage) {
  const box = { browser: { i18n: { getMessage, getUILanguage: () => 'de' } }, console };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'i18n.js'), 'utf8'), box, 'i18n.js');
  return vm.runInContext('I18N', box);
}

const german = withFirefox((key, subs) =>
  ({ btn_save: 'Sichern', group_full: 'Nur Platz für $1 Gruppen.' }[key] || '')
    .replace(/\$(\d)/g, (whole, n) => (subs || [])[Number(n) - 1] ?? whole));

check('a translated message is the one that reaches the page',
  german.t('btn_save') === 'Sichern', german.t('btn_save'));

check('and it is filled in the same way',
  german.t('group_full', 24) === 'Nur Platz für 24 Gruppen.', german.t('group_full', 24));

check('a key that language has not reached yet falls back to English',
  german.t('btn_cancel') === 'Cancel', german.t('btn_cancel'));

check('an add-on API that throws is no reason for the page to have no words',
  withFirefox(() => { throw new Error('nope'); }).t('btn_save') === 'Save');

// ------------------------------------------------------------------ report

let failed = 0;
results.forEach(({ name, pass, detail }) => {
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  (' + detail + ')' : ''));
});
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);
