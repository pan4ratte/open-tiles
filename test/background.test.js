/**
 * Guards the background picker's side of the settings contract.
 *
 * Three things here fail quietly rather than loudly:
 *
 *   - the picture is an *external* field. If it ever leaked into the settings
 *     object, every slider drag would rewrite megabytes of data URI to storage.
 *   - the dialog is a <form>, so an un-prevented Enter in the search box
 *     submits it and the dialog closes instead of searching.
 *   - when a picture is refused (too large, no room, Unsplash down) the page
 *     answers without a `record`, and the preview must keep showing what is
 *     really on screen rather than the picture that did not take.
 *
 * Runs the real schema.js + settings.js against the DOM shim.
 *
 *   node test/background.test.js [path/to/src]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const { El, event, document } = require('./dom-shim');

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

const PHOTO = {
  id: 'abc',
  thumb: 'https://images.unsplash.com/thumb.jpg',
  full: 'https://images.unsplash.com/full.jpg',
  alt: 'a quiet street',
  downloadLocation: 'https://api.unsplash.com/photos/abc/download',
  credit: { name: 'Ada Lovelace', userUrl: 'https://unsplash.com/@ada', photoUrl: 'https://unsplash.com/photos/abc' }
};

const LOCAL = { kind: 'local', src: 'data:image/png;base64,AAA', name: 'holiday.png', credit: null };

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
const all = cls => field.findAll(el => el.className.includes(cls));

const preview = at('bgfield__preview');
const caption = at('bgfield__caption');
const query = field.find(el => el.tagName === 'input' && el.type === 'search');
const removeBtn = field.findAll(el => el.className.includes('btn--danger'))[0];

// ------------------------------------------------------------- the contract

check('the picture is not a stored setting',
  !('background' in Schema.DEFAULTS),
  'DEFAULTS keys: ' + Object.keys(Schema.DEFAULTS).length);

check('coerce drops a picture that strays into settings',
  !('background' in Schema.coerce({ background: LOCAL })));

check('the dim and blur sliders are stored settings',
  Schema.DEFAULTS.bgBlur === 0 && Schema.DEFAULTS.bgDim === 35);

// ---------------------------------------------------------------- the field

check('the picker rendered', Boolean(field));
check('it shows the picture it was handed',
  caption.textContent.includes('holiday.png'), caption.textContent);
check('it offers a file input',
  Boolean(field.find(el => el.tagName === 'input' && el.type === 'file')));

// ------------------------------------------------------------------- Enter

const enter = event('keydown', { key: 'Enter' });
query.value = 'mountains';
query.fire('keydown', enter);

check('Enter in the search box is swallowed, not submitted',
  enter.defaultPrevented, 'defaultPrevented=' + enter.defaultPrevented);
check('Enter searches for what was typed',
  sent.length === 1 && sent[0].key === 'background'
    && sent[0].value.action === 'search' && sent[0].value.query === 'mountains',
  JSON.stringify(sent[0] || null));

const other = event('keydown', { key: 'a' });
query.fire('keydown', other);
check('another key is left alone', !other.defaultPrevented);

// ---------------------------------------------------------------- the round trip

/** Lets the commit round trip (two awaits deep) settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

(async () => {
  // A search comes back with photos to choose from.
  answer = { results: [PHOTO, PHOTO, PHOTO] };
  field.find(el => el.className.includes('bgfield__search'))
    .find(el => el.className.includes('btn')).fire('click');
  await settle();

  const hits = all('bgfield__hit');
  check('every result is offered', hits.length === 3, hits.length + ' shown');

  // Choosing one asks the page for it, and the page answers with the record.
  answer = { record: { kind: 'unsplash', src: 'data:image/jpeg;base64,BBB', name: PHOTO.alt, credit: PHOTO.credit } };
  hits[0].fire('click');
  await settle();

  const photoCall = sent[sent.length - 1];
  check('choosing a result sends the photo',
    photoCall.value.action === 'photo' && photoCall.value.photo.id === 'abc',
    JSON.stringify(photoCall.value.action));
  check('the preview credits the photographer',
    caption.textContent.includes('Ada Lovelace'), caption.textContent);

  // A refusal answers without a record, so the preview must not budge.
  answer = {};
  removeBtn.fire('click');
  await settle();

  check('remove asks the page to clear',
    sent[sent.length - 1].value.action === 'clear');
  check('a refused change leaves the preview alone',
    caption.textContent.includes('Ada Lovelace'), caption.textContent);

  // And an accepted clear puts the empty state back.
  answer = { record: null };
  removeBtn.fire('click');
  await settle();

  check('a cleared picture empties the preview',
    preview.className.includes('is-empty') && !caption.textContent.includes('Ada'),
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
