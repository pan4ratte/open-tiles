/**
 * Guards the background picker's side of the settings contract, and the tab
 * strip the dialog is laid out with.
 *
 * Three things here fail quietly rather than loudly:
 *
 *   - the picture is an *external* field. If it ever leaked into the settings
 *     object, every slider drag would rewrite megabytes of data URI to storage.
 *   - when a picture is refused (not an image, over the size limit, no room to
 *     store it) the page answers without a `record`, and the preview must keep
 *     showing what is really on screen.
 *   - every section's controls have to exist whichever tab is open, or the
 *     page's own lookups - and these tests - find nothing.
 *
 * Runs the real schema.js + settings.js against the DOM shim.
 *
 *   node test/background.test.js [path/to/src]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const { El, document } = require('./dom-shim');

const SRC = process.argv[2] || path.join(__dirname, '..', 'src');

const sandbox = {
  document,
  console,
  setTimeout,
  clearTimeout,
  Icons: { create: () => new El('svg') },
  Fonts: { SUGGESTED: ['Inter'], stackFor: name => name || 'system-ui' }
};
vm.createContext(sandbox);

for (const file of ['schema.js', 'settings.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), sandbox, { filename: file });
}

const SettingsUI = vm.runInContext('SettingsUI', sandbox);
const Schema = vm.runInContext('Schema', sandbox);

// ---------------------------------------------------------------- harness

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

const LOCAL = { src: 'data:image/png;base64,AAA', name: 'holiday.png' };
const FILE = { name: 'beach.jpg', type: 'image/jpeg', size: 1024 };

/** Whatever the page should answer next, and every payload it was sent. */
const sent = [];
let answer = {};

const container = new El('div');
SettingsUI.mount(container, {
  values: { ...Schema.DEFAULTS, background: LOCAL },
  onChange: async (key, value) => {
    sent.push({ key, value });
    return { value: answer };
  }
});

const field = container.find(el => el.className.includes('bgfield'));
const at = cls => field.find(el => el.className.includes(cls));

const preview = at('bgfield__preview');
const caption = at('bgfield__caption');
const fileInput = field.find(el => el.tagName === 'input' && el.type === 'file');
const removeBtn = field.findAll(el => el.className.includes('btn--danger'))[0];

// ------------------------------------------------------------- the contract

check('the picture is not a stored setting',
  !('background' in Schema.DEFAULTS),
  'DEFAULTS keys: ' + Object.keys(Schema.DEFAULTS).length);

check('coerce drops a picture that strays into settings',
  !('background' in Schema.coerce({ background: LOCAL })));

check('the dim and blur sliders are stored settings',
  Schema.DEFAULTS.bgBlur === 0 && Schema.DEFAULTS.bgDim === 35);

// ------------------------------------------------------------ what is gone

const source = ['schema.js', 'settings.js', 'backgrounds.js', 'newtab.js', 'storage.js']
  .map(file => fs.readFileSync(path.join(SRC, file), 'utf8'))
  .join('\n');

check('no trace of Unsplash is left', !/unsplash/i.test(source),
  (source.match(/unsplash/ig) || []).length + ' mention(s)');

check('the row limit is gone', !Schema.FIELDS.some(f => f.key === 'rows'));
check('the hint line is gone', !Schema.FIELDS.some(f => f.key === 'showHint'));

// ---------------------------------------------------------------- the field

check('the picker rendered', Boolean(field));
check('it shows the picture it was handed',
  caption.textContent.includes('holiday.png'), caption.textContent);
check('it offers a file input', Boolean(fileInput));
check('it offers no search box',
  !field.find(el => el.tagName === 'input' && el.type === 'search'));

// ------------------------------------------------------------------- tabs

const tabs = container.findAll(el => el.tagName === 'button' && el.className.includes('tab'));
const panels = container.findAll(el => el.tagName === 'section'
  && el.className.includes('panel'));

check('one tab per section',
  tabs.length === Schema.SECTIONS.length, tabs.length + ' tabs');
check('one panel per section',
  panels.length === Schema.SECTIONS.length, panels.length + ' panels');
check('the first tab starts open',
  tabs[0].className.includes('is-on') && panels[0].hidden === false);
check('the rest start closed',
  panels.slice(1).every(panel => panel.hidden === true));

const missing = Schema.STORED
  .filter(f => f.type !== 'segmented' && !container.find(el => el.id === 'set-' + f.key))
  .map(f => f.key);
check('every control is built, open tab or not', missing.length === 0,
  missing.join(', ') || 'all there');

tabs[2].fire('click');
check('clicking a tab opens its panel and closes the last',
  panels[2].hidden === false && panels[0].hidden === true
    && tabs[2].className.includes('is-on') && !tabs[0].className.includes('is-on'));

// ---------------------------------------------------------------- the round trip

/** Lets the commit round trip (two awaits deep) settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

(async () => {
  // Choosing a file asks the page for it, and the page answers with the record.
  answer = { record: { src: 'data:image/jpeg;base64,BBB', name: 'beach.jpg' } };
  fileInput.files = [FILE];
  fileInput.fire('change');
  await settle();

  const call = sent[sent.length - 1];
  check('choosing a file sends it to the page',
    call.key === 'background' && call.value.action === 'file' && call.value.file === FILE,
    String(call.value.action));
  check('the preview shows the picture that took',
    caption.textContent.includes('beach.jpg'), caption.textContent);

  // A refusal answers without a record, so the preview must not budge.
  answer = {};
  removeBtn.fire('click');
  await settle();

  check('remove asks the page to clear',
    sent[sent.length - 1].value.action === 'clear');
  check('a refused change leaves the preview alone',
    caption.textContent.includes('beach.jpg'), caption.textContent);

  // And an accepted clear puts the empty state back.
  answer = { record: null };
  removeBtn.fire('click');
  await settle();

  check('a cleared picture empties the preview',
    preview.className.includes('is-empty') && !caption.textContent.includes('beach'),
    caption.textContent);
  check('remove hides itself once there is nothing to remove',
    removeBtn.hidden === true, 'hidden=' + removeBtn.hidden);

  // ---------------------------------------------------------------- report

  let failed = 0;
  for (const result of results) {
    if (!result.pass) failed++;
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
