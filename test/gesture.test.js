/**
 * Guards the user-gesture chain behind the "Deep icon lookup" toggle.
 *
 * Firefox only honours permissions.request() while it is still handling user
 * input. That window closes at the first `await`, and it never opens at all for
 * a checkbox's `change` event - both mistakes fail silently at runtime, showing
 * up only as a permission that is never granted.
 *
 * So this runs the real schema.js + settings.js against a small DOM shim and
 * checks the chain click -> onChange -> changeDeepIcons -> permissions.request
 * is unbroken and free of awaits.
 *
 *   node test/gesture.test.js [path/to/src]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '..', 'src');

// ---------------------------------------------------------------- DOM shim

const { El, document } = require('./dom-shim');

const sandbox = {
  document,
  console,
  setTimeout,
  clearTimeout,
  Icons: { create: () => new El('svg') },
  Fonts: {
    CATALOG: [
      { name: 'Inter', style: 'sans', scripts: ['latin-ext', 'cyrillic'] },
      { name: 'Roboto', style: 'sans', scripts: ['latin-ext', 'greek'] },
      { name: 'Lora', style: 'serif', scripts: ['latin-ext'] }
    ],
    STYLES: [{ id: 'sans', label: 'Sans' }, { id: 'serif', label: 'Serif' }],
    SCRIPTS: [{ id: 'latin-ext', label: 'Latin ext' }, { id: 'greek', label: 'Greek' }],
    SUGGESTED: ['Inter', 'Roboto', 'Lora'],
    stackFor: name => name || 'system-ui',
    previewStack: name => name || 'system-ui',
    loadPreviews: () => Promise.resolve('cache')
  }
};
vm.createContext(sandbox);

for (const file of ['i18n.js', 'schema.js', 'settings.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n'), sandbox, { filename: file });
}

// A top-level `const` in a vm script lands in the context's lexical scope
// rather than on the sandbox object, so reach it by evaluating the name.
const SettingsUI = vm.runInContext('SettingsUI', sandbox);
const Schema = vm.runInContext('Schema', sandbox);

// ---------------------------------------------------------------- harness

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

const container = new El('div');
const calls = [];
let resolveOnChange;
let turn = 'synchronous';

SettingsUI.mount(container, {
  // `background` is external - the page passes it in beside the settings.
  values: { ...Schema.DEFAULTS, background: null },
  onChange: (key, value) => {
    calls.push({ key, value, turn });
    return new Promise(resolve => { resolveOnChange = resolve; });
  }
});

// ------------------------------------------------------ the toggle's event

const toggle = container.find(el => el.id === 'set-deepIcons');
if (!toggle) throw new Error('deepIcons control not found - did its key change?');

check('deep-icon toggle listens to click',
  Boolean(toggle.listeners.click), Object.keys(toggle.listeners).join(', ') || 'none');
check('deep-icon toggle does not listen to change',
  !toggle.listeners.change, Object.keys(toggle.listeners).join(', ') || 'none');

const plain = container.find(el => el.id === 'set-showLabels');
check('a plain toggle still uses change',
  Boolean(plain && plain.listeners.change),
  plain ? Object.keys(plain.listeners).join(', ') : 'control not found');

// ------------------------------------------------------ the gesture window

toggle.checked = true;
toggle.fire('click');
// Anything running past this line is already outside the user-input window.
turn = 'after an await';

check('onChange runs during the click',
  calls.length === 1 && calls[0].turn === 'synchronous',
  calls.length ? `ran in the "${calls[0].turn}" turn` : 'never ran');
check('onChange receives deepIcons=true',
  calls.length === 1 && calls[0].key === 'deepIcons' && calls[0].value === true,
  JSON.stringify(calls[0] || null));

if (resolveOnChange) resolveOnChange({ value: true });

// ------------------------------------- the hops the DOM shim cannot execute

/** Source between `from` and the first `to` that follows it. */
function sliceBetween(source, from, to) {
  const start = source.indexOf(from);
  if (start < 0) return null;
  const end = source.indexOf(to, start);
  if (end < 0) return null;
  return source.slice(start + from.length, end);
}

/** The `await` that immediately precedes the call is the expected one. */
function awaitsBefore(slice) {
  return (slice.replace(/await\s*$/, '').match(/\bawait\b/g) || []).length;
}

function checkNoAwait(name, file, from, to) {
  const slice = sliceBetween(fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n'), from, to);
  if (slice === null) {
    check(name, false, `could not find ${from} ... ${to} in ${file}`);
    return;
  }
  const count = awaitsBefore(slice);
  check(name, count === 0, count === 0 ? 'clean' : `${count} await(s) before the call`);
}

checkNoAwait('changeDeepIcons awaits nothing before requesting',
  'newtab.js', 'async function changeDeepIcons', 'Favicons.requestSiteAccess()');

checkNoAwait('requestSiteAccess awaits nothing before permissions.request',
  'favicons.js', 'async function requestSiteAccess', 'perms.request(');

// ---------------------------------------------------------------- report

let failed = 0;
for (const result of results) {
  if (!result.pass) failed++;
  console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
