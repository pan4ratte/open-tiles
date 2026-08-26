/**
 * Guards the three things that make the page feel settled while it is being
 * used, rather than correct only once it has been reloaded.
 *
 * What can go quietly wrong here:
 *
 *   - `storage.onChanged` reports a page's own writes back to it. Every setting
 *     changed here would then look like an edit made somewhere else, and the
 *     page would rebuild itself - grid, dialog and all - in the middle of the
 *     drag that caused it. The slider slips out from under the pointer and the
 *     pane jumps to the top. That is the bug this file exists for.
 *   - a section written as subsections stops handing out a flat `fields` list,
 *     and every default, lookup and validation built on it quietly empties.
 *   - the accent falls back to <input type="color">, which opens the operating
 *     system's own dialog instead of the picker in this add-on.
 *
 * Runs the real schema.js, storage.js and settings.js against the DOM shim and
 * a stand-in for browser.storage.local.
 *
 *   node test/live.test.js [path/to/src]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const { El, document } = require('./dom-shim');

const SRC = process.argv[2] || path.join(__dirname, '..', 'src');
const read = file => fs.readFileSync(path.join(SRC, file), 'utf8');

// ------------------------------------------------------------------ harness

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

/** Lets a write, and the change event chasing it, settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

// ------------------------------------------------------- fake extension area

/**
 * Stands in for browser.storage.local, including the part that matters: the
 * change event is dispatched *after* the write's promise has resolved, which
 * is what defeats any attempt to hold a flag over the write itself.
 */
function makeArea() {
  const disk = {};
  const listeners = [];

  return {
    listeners,
    local: {
      async get(key) {
        return key in disk ? { [key]: disk[key] } : {};
      },
      async set(pairs) {
        const changes = {};
        Object.entries(pairs).forEach(([key, value]) => {
          changes[key] = { oldValue: disk[key], newValue: value };
          disk[key] = value;
        });
        // Late, and in a task of its own - as the browser does it.
        setTimeout(() => listeners.forEach(fn => fn(changes, 'local')), 0);
      }
    },
    onChanged: { addListener: fn => listeners.push(fn) },
    /** A write from another new-tab page: it never went through this Store. */
    foreign(key, value) {
      const changes = { [key]: { oldValue: disk[key], newValue: value } };
      disk[key] = value;
      setTimeout(() => listeners.forEach(fn => fn(changes, 'local')), 0);
    }
  };
}

const area = makeArea();

const sandbox = {
  console,
  document,
  setTimeout,
  clearTimeout,
  crypto: { randomUUID: () => 'id-' + Math.random().toString(36).slice(2) },
  browser: { storage: { local: area.local, onChanged: area.onChanged } },
  Icons: { create: () => new El('svg') },
  Fonts: { SUGGESTED: ['Inter'], stackFor: name => name || 'system-ui' }
};
vm.createContext(sandbox);

for (const file of ['schema.js', 'storage.js', 'settings.js']) {
  vm.runInContext(read(file), sandbox, { filename: file });
}

const Schema = vm.runInContext('Schema', sandbox);
const Store = vm.runInContext('Store', sandbox);
const SettingsUI = vm.runInContext('SettingsUI', sandbox);

// -------------------------------------------------------- the reload bug

const heard = [];
Store.onExternalChange((key, value) => heard.push({ key, value }));

(async () => {
  check('the page is listening for changes made elsewhere', area.listeners.length === 1);

  // A slider drag: the settings are written over and over in quick succession.
  for (const size of [120, 124, 128, 132]) {
    await Store.saveSettings({ tileSize: size });
  }
  await settle();

  check('a run of its own writes is not reported back as an outside change',
    heard.length === 0, heard.map(h => h.key).join(', ') || 'nothing heard');

  // The same for everything else the page writes.
  await Store.save([{ url: 'https://example.com', title: 'Example' }]);
  await Store.saveGroups([{ id: 'g1', name: 'Work' }]);
  await Store.saveBackground({ src: 'data:image/png;base64,AAA', name: 'a.png' });
  await Store.clearBackground();
  await settle();

  check('nor are its writes of tiles, groups or the picture',
    heard.length === 0, heard.map(h => h.key).join(', ') || 'nothing heard');

  // And now somebody else's edit, which must still get through.
  area.foreign('settings', { ...Schema.DEFAULTS, tileSize: 200 });
  await settle();

  check('an edit made in another new tab page still arrives',
    heard.length === 1 && heard[0].key === 'settings' && heard[0].value.tileSize === 200,
    JSON.stringify(heard.map(h => h.key)));

  // Including one that happens to be the value this page wrote a while back:
  // the echo it was matched against has already been spent.
  heard.length = 0;
  await Store.saveSettings({ tileSize: 132 });
  await settle();
  area.foreign('settings', { ...Schema.DEFAULTS, tileSize: 132 });
  await settle();

  check('a matching value is only ever swallowed once',
    heard.length === 1 && heard[0].value.tileSize === 132,
    heard.length + ' heard');

  heard.length = 0;
  area.foreign('tiles', [{ id: 'x', url: 'https://other.example', title: 'Other' }]);
  area.foreign('groups', [{ id: 'g9', name: 'Theirs' }]);
  await settle();

  check('so do their tiles and groups',
    heard.length === 2 && heard[0].key === 'tiles' && heard[1].key === 'groups',
    heard.map(h => h.key).join(', '));

  // ------------------------------------------------------ recent backgrounds

  // What a record is has to survive the round trip, because the two kinds are
  // painted by different elements: a video read back as a picture is a blank
  // page with nothing to explain it.
  const stored = await Store.saveBackground(
    { src: 'data:video/mp4;base64,AAAA', name: 'loop.mp4', type: 'video' });
  check('a video keeps its type through storage', stored.type === 'video', stored.type);

  check('a record written before the type existed is read off its address',
    (await Store.saveBackground({ src: 'https://films.example/loop.mp4' })).type === 'video');
  check('and a stored picture still reads as one',
    (await Store.saveBackground({ src: 'data:image/png;base64,AAA' })).type === 'image');

  const remembered = key => ({ src: 'data:image/png;base64,' + key, name: key, type: 'image' });
  /** One pick, and the moment the browser takes to report it back. */
  const pick = async key => { await Store.rememberBackground(remembered(key)); await settle(); };
  const listed = async () => (await Store.loadRecentBackgrounds()).map(r => r.name).join('');

  heard.length = 0;
  await Store.clearRecentBackgrounds();
  for (const key of ['A', 'B', 'C']) await pick(key);

  check('the newest background heads the recent list', await listed() === 'CBA', await listed());

  await pick('A');
  check('choosing one again moves it up rather than repeating it',
    await listed() === 'ACB', await listed());

  for (const key of ['D', 'E', 'F', 'G']) await pick(key);
  const capped = await Store.loadRecentBackgrounds();
  check('the list stops at its ceiling, dropping the oldest',
    capped.length === Store.MAX_RECENT && await listed() === 'GFEDA',
    capped.length + ': ' + await listed());

  check('none of that came back as somebody else’s edit',
    heard.length === 0, heard.map(h => h.key).join(', ') || 'nothing heard');

  area.foreign('bgRecent', [remembered('Z')]);
  await settle();
  check('but another new tab page picking a background does arrive',
    heard.length === 1 && heard[0].key === 'bgRecent' && heard[0].value[0].name === 'Z',
    heard.map(h => h.key).join(', '));

  // ------------------------------------------------------------ subsections

  const layout = Schema.SECTIONS.find(section => section.id === 'layout');

  check('Layout and Tiles are one section now',
    Boolean(layout) && !Schema.SECTIONS.some(s => s.id === 'tiles'),
    Schema.SECTIONS.map(s => s.id).join(', '));

  check('it is split into subsections rather than one long list',
    layout.groups.length === 2
      && layout.groups.every(group => Boolean(group.label)),
    layout.groups.map(g => g.label).join(', '));

  check('every setting from both is still there',
    ['columns', 'tileSize', 'gap', 'tileShape', 'logoPad', 'showLabels',
     'openInNewTab', 'deepIcons'].every(key => layout.fields.some(f => f.key === key)),
    layout.fields.map(f => f.key).join(', '));

  check('a section written as a plain list still reports one group',
    Schema.SECTIONS.find(s => s.id === 'header').groups.length === 1);

  check('the flat field list still carries every default',
    Schema.FIELDS.length === Schema.SECTIONS.flatMap(s => s.fields).length
      && Schema.DEFAULTS.tileShape === 'square' && Schema.DEFAULTS.columns === 'auto');

  // ------------------------------------------------------- the accent picker

  const sent = [];
  const container = new El('div');
  SettingsUI.mount(container, {
    values: { ...Schema.DEFAULTS, background: null },
    onChange: async (key, value) => {
      sent.push({ key, value });
      return { value };
    }
  });

  const panel = container.find(el => el.id === 'panel-layout');
  const boxes = panel.findAll(el => el.className === 'box');
  const subtitles = panel.findAll(el => el.className === 'panel__subtitle');

  check('the layout panel draws a box per subsection',
    boxes.length === 2 && subtitles.length === 2,
    boxes.length + ' boxes, ' + subtitles.length + ' headings');

  check('each box is under its own heading',
    subtitles.map(el => el.textContent).join(',') === 'Grid,Tiles',
    subtitles.map(el => el.textContent).join(','));

  const well = container.find(el => el.id === 'set-accent');

  check('the accent is a button of ours, not a colour input',
    Boolean(well) && well.tagName === 'button', well && well.tagName);

  check('nothing hands the accent to the platform picker',
    !read('settings.js').includes("type = 'color'"));

  const picker = container.find(el => el.className === 'picker');
  check('the picker is not in the page until it is opened', picker === null);

  // Opening it needs a body and a window to hang the dismiss handlers on, and
  // the shim has neither - the popover itself is checked in a browser. What is
  // checkable here is that it is built and wired the way it says it is.
  check('the picker offers the system accents',
    read('settings.js').includes("['#007aff', 'Blue']"));

  check('and a square, a hue strip and a hex field for anything else',
    ['picker__area', 'picker__hue', 'picker__hex']
      .every(cls => read('settings.js').includes(cls)));

  check('a hex it does not understand is refused rather than stored',
    Schema.coerce({ accent: 'nonsense' }).accent === '#007aff');

  // ---------------------------------------------------------------- report

  let failed = 0;
  for (const result of results) {
    if (!result.pass) failed++;
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
