/**
 * Guards the tile-group feature end to end, and the wiring under it.
 *
 * What can go quietly wrong here:
 *
 *   - a tile's `groupId` is dropped on the way through storage, which silently
 *     empties every group the next time the page loads.
 *   - a field with a `when` (the status-bar-only options) shows for a setting
 *     it does not apply to, or never shows at all.
 *   - the page reaches for an element the markup no longer has - moving the
 *     reset button into the dialog is exactly the sort of edit that leaves a
 *     `getElementById` pointing at nothing, and it throws on load.
 *
 * Runs the real schema.js, settings.js and storage.js - no browser.
 *
 *   node test/groups.test.js [path/to/src]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const { El, document } = require('./dom-shim');

const SRC = process.argv[2] || path.join(__dirname, '..', 'src');
/* Source is read with its line endings normalised. Several checks below find
   a run of code by its first and last lines and lift what is between them,
   and those markers are written here with plain newlines - on a checkout with
   CRLF endings they would match nothing and the test would fail on the line
   endings rather than on the code. */
const read = file => fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');

// ------------------------------------------------------------------ sandbox

/** localStorage, which is the fallback storage.js uses outside an extension. */
const disk = {};
let ids = 0;

const sandbox = {
  document,
  console,
  setTimeout,
  clearTimeout,
  crypto: { randomUUID: () => 'id-' + (++ids) },
  localStorage: {
    getItem: key => (key in disk ? disk[key] : null),
    setItem: (key, value) => { disk[key] = String(value); }
  },
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

for (const file of ['schema.js', 'settings.js', 'storage.js']) {
  vm.runInContext(read(file), sandbox, { filename: file });
}

const SettingsUI = vm.runInContext('SettingsUI', sandbox);
const Schema = vm.runInContext('Schema', sandbox);
const Store = vm.runInContext('Store', sandbox);

// ------------------------------------------------------------------ harness

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

// ------------------------------------------------------------- the markup

const js = read('newtab.js');
const html = read('newtab.html');

const wanted = [...js.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
const missing = wanted.filter(id => !html.includes('id="' + id + '"'));

check('every element the page reaches for is in the markup',
  missing.length === 0, missing.join(', ') || wanted.length + ' ids, all present');

check('the reset button has left the dialog footer',
  !html.includes('btnResetSettings'));

check('reset is a field in a section instead',
  Schema.SECTIONS.some(s => s.fields.some(f => f.key === 'reset' && f.type === 'action')));

check('reset stores nothing',
  !('reset' in Schema.DEFAULTS));

// ------------------------------------------------------------ the settings

const groupKeys = [
  'groupStyle', 'groupShow', 'groupAlign', 'groupEdge', 'groupFloat', 'showAllGroup'
];
check('every group setting has a default',
  groupKeys.every(key => key in Schema.DEFAULTS),
  JSON.stringify(groupKeys.map(k => Schema.DEFAULTS[k])));

check('the block floats until told otherwise',
  Schema.DEFAULTS.groupStyle === 'floating' && Schema.DEFAULTS.groupShow === 'always');

check('a nonsense value falls back to the default',
  Schema.coerce({ groupAlign: 'sideways' }).groupAlign === 'center');

check('"All" is shown out of the box - hiding it is the choice, not the default',
  Schema.DEFAULTS.showAllGroup === true);

check('the floating block starts at the top, where it has always been',
  Schema.DEFAULTS.groupFloat === 'top');

check('all three placements are offered',
  ['top', 'tiles', 'bottom'].every(value =>
    Schema.coerce({ groupFloat: value }).groupFloat === value));

/*
 * Taking "All" away moves the page into the first group, so both halves of
 * that have to happen: the chips are rebuilt, and the grid is rebuilt from
 * wherever the chips left the page. Reading them off the page rather than
 * running it, because the sets are what the change handler dispatches on.
 */
const rebuildsGroups = (js.match(/REBUILDS_GROUPS = new Set\(\[([^\]]*)\]/) || [])[1] || '';
const rebuildsGrid = (js.match(/REBUILDS_GRID = new Set\(\[([\s\S]*?)\]\)/) || [])[1] || '';

check('hiding "All" rebuilds the chips',
  rebuildsGroups.includes("'showAllGroup'"), rebuildsGroups.trim());

check('and the grid, since the page has moved into a group',
  rebuildsGrid.includes("'showAllGroup'"), rebuildsGrid.replace(/\s+/g, ' ').trim());

check('the chips are settled before the grid is drawn from them',
  js.indexOf('if (REBUILDS_GROUPS.has(key)) renderGroups();')
    < js.indexOf('if (REBUILDS_GRID.has(key)) render();'));

check('the page never sits on "All" while "All" is not on show',
  /function settleActiveGroup\(\) \{[\s\S]*?settings\.showAllGroup \|\| activeGroup/.test(js));

check('and the block is drawn from that, not from around it',
  /function renderGroups\(\) \{\s*settleActiveGroup\(\);/.test(js));

check('the line the gesture walks leaves "All" out with the chip',
  /function groupOrder\(\)[\s\S]*?settings\.showAllGroup \? \[null, \.\.\.ids\] : ids/.test(js));

// ---------------------------------------------------------------- storage

(async () => {
  const saved = await Store.save([
    { url: 'https://work.example', title: 'Work', groupId: 'g1' },
    { url: 'https://loose.example', title: 'Loose' },
    { url: 'https://odd.example', title: 'Odd', groupId: 42 }
  ]);

  check('a tile keeps the group it was put in', saved[0].groupId === 'g1');
  check('a tile with no group reads back as loose', saved[1].groupId === null);
  check('a groupId that is not a string is dropped', saved[2].groupId === null);

  const reloaded = await Store.load();
  check('the group survives a round trip through storage',
    reloaded[0].groupId === 'g1', JSON.stringify(reloaded[0]));

  const groups = await Store.saveGroups([
    { name: '  Work  ' },
    { name: '' },
    { id: 'keep-me', name: 'Play' },
    'not a group'
  ]);

  check('group names are trimmed', groups[0].name === 'Work', JSON.stringify(groups[0]));
  check('a nameless group still gets a name', groups[1].name === 'Group');
  check('an id that was given is kept', groups[2].id === 'keep-me');
  check('anything that is not a group is dropped', groups.length === 3, groups.length + ' kept');

  const many = await Store.saveGroups(
    Array.from({ length: Store.MAX_GROUPS + 5 }, (_, i) => ({ name: 'g' + i }))
  );
  check('there is a ceiling on how many groups there can be',
    many.length === Store.MAX_GROUPS, many.length + ' kept');

  // ------------------------------------------------------- the dialog rows

  const sent = [];
  let answer = null;

  const container = new El('div');
  SettingsUI.mount(container, {
    values: { ...Schema.DEFAULTS, background: null },
    onChange: async (key, value) => {
      sent.push({ key, value });
      return { value: answer === null ? value : answer };
    }
  });

  const rowFor = key => container.find(el => el.dataset && el.dataset.field === key);
  const itemFor = (key, value) => rowFor(key)
    .find(el => el.dataset && el.dataset.value === value);

  check('the group settings all rendered',
    groupKeys.every(key => Boolean(rowFor(key))),
    groupKeys.filter(key => !rowFor(key)).join(', ') || 'all there');

  check('an option with no icon carries its label',
    itemFor('groupStyle', 'bar').textContent === 'Status bar',
    itemFor('groupStyle', 'bar').textContent);

  check('the status-bar options are out of sight while the block floats',
    rowFor('groupAlign').hidden === true && rowFor('groupEdge').hidden === true);

  check('but the placement a floating block has is on show',
    rowFor('groupFloat').hidden === false);

  check('and it reads in places, not in edges',
    itemFor('groupFloat', 'tiles').textContent === 'Above the tiles',
    itemFor('groupFloat', 'tiles').textContent);

  check('the options that always apply are on show',
    rowFor('groupStyle').hidden === false && rowFor('groupShow').hidden === false);

  answer = 'bar';
  itemFor('groupStyle', 'bar').fire('click');
  await new Promise(resolve => setTimeout(resolve, 0));

  check('switching to a status bar sends the change',
    sent.some(call => call.key === 'groupStyle' && call.value === 'bar'),
    JSON.stringify(sent[sent.length - 1] || null));

  check('and brings out the options that only apply to a bar',
    rowFor('groupAlign').hidden === false && rowFor('groupEdge').hidden === false);

  check('while the floating placement goes away - a bar has edges, not places',
    rowFor('groupFloat').hidden === true);

  answer = 'floating';
  itemFor('groupStyle', 'floating').fire('click');
  await new Promise(resolve => setTimeout(resolve, 0));

  check('going back to floating puts them away again',
    rowFor('groupAlign').hidden === true && rowFor('groupEdge').hidden === true);

  check('and brings the placement back',
    rowFor('groupFloat').hidden === false);

  // ---------------------------------------------------------- reset button

  const reset = container.find(el => el.id === 'set-reset');
  check('the reset control is a button', Boolean(reset) && reset.tagName === 'button');

  answer = null;
  reset.fire('click');
  await new Promise(resolve => setTimeout(resolve, 0));

  check('clicking it asks the page to reset',
    sent[sent.length - 1].key === 'reset',
    JSON.stringify(sent[sent.length - 1]));

  // ---------------------------------------------------------------- report

  let failed = 0;
  for (const result of results) {
    if (!result.pass) failed++;
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
