/**
 * Guards the background picker's side of the settings contract, and the tab
 * strip the dialog is laid out with.
 *
 * Five things here fail quietly rather than loudly:
 *
 *   - the background is an *external* field. If it ever leaked into the
 *     settings object, every slider drag would rewrite megabytes of data URI
 *     to storage.
 *   - when one is refused (neither picture nor video, over the size limit, no
 *     room to store it) the page answers without a `record`, and the preview
 *     must keep showing what is really on screen.
 *   - a moving background has to be built as a <video>. An <img> pointed at an
 *     MP4 shows nothing, and shows nothing silently.
 *   - taking the background away must not empty the list of recent ones -
 *     putting back what was just removed is most of what the list is for.
 *   - dropping one *from the list* is the other way about: the strip loses an
 *     entry and the background on screen is not touched.
 *   - a thumbnail and its delete button have to be siblings. A button inside a
 *     button is markup no browser agrees about, and the one that loses is the
 *     one that quietly stops firing.
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
  vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n'), sandbox, { filename: file });
}

const SettingsUI = vm.runInContext('SettingsUI', sandbox);
const Schema = vm.runInContext('Schema', sandbox);

// ---------------------------------------------------------------- harness

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

const LOCAL = { src: 'data:image/png;base64,AAA', name: 'holiday.png', type: 'image' };
const MOVING = { src: 'https://films.example/loop.mp4', name: 'films.example', type: 'video' };
const OLDER = { src: 'data:image/png;base64,CCC', name: 'hills.png', type: 'image' };
const RECENT = [LOCAL, MOVING, OLDER];

const FILE = { name: 'beach.jpg', type: 'image/jpeg', size: 1024 };

/** Whatever the page should answer next, and every payload it was sent. */
const sent = [];
let answer = {};

const container = new El('div');
SettingsUI.mount(container, {
  values: { ...Schema.DEFAULTS, background: { record: LOCAL, recent: RECENT } },
  onChange: async (key, value) => {
    sent.push({ key, value });
    return { value: answer };
  }
});

const field = container.find(el => el.className.includes('bgfield'));
const at = cls => field.find(el => el.className.includes(cls));

const preview = at('bgfield__preview');
const caption = at('bgfield__caption');
const strip = at('bgfield__recent');
const fileInput = field.find(el => el.tagName === 'input' && el.type === 'file');
const removeBtn = field.findAll(el => el.className.includes('btn--danger'))[0];

const chips = () => strip.findAll(el => el.className.includes('bgfield__chip')
  && !el.className.includes('chipmedia'));
const slots = () => strip.findAll(el => el.className.includes('bgfield__slot'));
const forgets = () => strip.findAll(el => el.className.includes('bgfield__forget'));

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
  .map(file => fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n'))
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
check('the file button takes videos as well as pictures',
  fileInput.accept === 'image/*,video/*', fileInput.accept);
check('it offers no search box',
  !field.find(el => el.tagName === 'input' && el.type === 'search'));

// ------------------------------------------------------------- recent ones

check('the recent strip holds one chip per background',
  chips().length === RECENT.length, chips().length + ' chips');
check('the one on screen is marked',
  chips()[0].className.includes('is-on') && !chips()[1].className.includes('is-on'));
check('a moving one is badged, a still one is not',
  Boolean(chips()[1].find(el => el.className.includes('bgfield__badge')))
    && !chips()[0].find(el => el.className.includes('bgfield__badge')));
check('a still one is drawn as an image, a moving one as a video',
  Boolean(chips()[0].find(el => el.tagName === 'img'))
    && Boolean(chips()[1].find(el => el.tagName === 'video')));
check('the preview draws the still picture it was handed as an image',
  Boolean(preview.find(el => el.tagName === 'img')));

// ------------------------------------------------------- deleting from it

check('every recent one offers a way to drop it',
  forgets().length === RECENT.length, forgets().length + ' delete buttons');
check('one slot per entry, so the grid gives them all the same size',
  slots().length === RECENT.length, slots().length + ' slots');
check('the delete button is a sibling of the thumbnail, not inside it',
  slots().every(slot => slot.children.length === 2)
    && chips().every(chip => !chip.find(el => el.className.includes('bgfield__forget'))));
check('and it says which one it drops',
  forgets()[1].attrs['aria-label'].includes('films.example'),
  forgets()[1].attrs['aria-label']);

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
  // Choosing a file asks the page for it, and the page answers with the record
  // and the list it now heads.
  const BEACH = { src: 'data:image/jpeg;base64,BBB', name: 'beach.jpg', type: 'image' };
  answer = { record: BEACH, recent: [BEACH, ...RECENT.slice(0, 2)] };
  fileInput.files = [FILE];
  fileInput.fire('change');
  await settle();

  const call = sent[sent.length - 1];
  check('choosing a file sends it to the page',
    call.key === 'background' && call.value.action === 'file' && call.value.file === FILE,
    String(call.value.action));
  check('the preview shows the picture that took',
    caption.textContent.includes('beach.jpg'), caption.textContent);
  check('the new one heads the recent strip, and is the one marked',
    chips().length === 3 && chips()[0].className.includes('is-on')
      && !chips()[1].className.includes('is-on'),
    chips().length + ' chips');

  // Clicking a recent one names it by address - the page holds the records.
  chips()[1].fire('click');
  await settle();

  check('clicking a recent one asks the page for it by address',
    sent[sent.length - 1].value.action === 'recent'
      && sent[sent.length - 1].value.src === LOCAL.src,
    String(sent[sent.length - 1].value.src));

  // A moving background has to come out as a <video>, in the preview as well
  // as in the strip. Answered with the record alone: the mark has to follow it
  // even when the list itself did not change.
  answer = { record: MOVING };
  chips()[2].fire('click');
  await settle();

  check('a moving background is drawn as a video',
    Boolean(preview.find(el => el.tagName === 'video'))
      && !preview.find(el => el.tagName === 'img'),
    caption.textContent);
  check('and the mark follows it without the list being re-sent',
    chips()[2].className.includes('is-on') && !chips()[0].className.includes('is-on'));

  // A refusal answers with neither, so nothing must budge.
  answer = {};
  removeBtn.fire('click');
  await settle();

  check('remove asks the page to clear',
    sent[sent.length - 1].value.action === 'clear');
  check('a refused change leaves the preview alone',
    caption.textContent.includes('films.example'), caption.textContent);

  // And an accepted clear puts the empty state back - but keeps the list, so
  // what was just taken away is one click from being back.
  answer = { record: null };
  removeBtn.fire('click');
  await settle();

  check('a cleared background empties the preview',
    preview.className.includes('is-empty') && !caption.textContent.includes('films'),
    caption.textContent);
  check('clearing leaves the recent ones alone',
    chips().length === 3 && !chips().some(chip => chip.className.includes('is-on')),
    chips().length + ' chips');
  check('remove hides itself once there is nothing to remove',
    removeBtn.hidden === true, 'hidden=' + removeBtn.hidden);

  // Dropping one from the strip is the mirror of that: the list loses an
  // entry, and what is on screen is not the strip's business.
  answer = { recent: RECENT.slice(1) };
  forgets()[0].fire('click');
  await settle();

  // BEACH heads the strip by now - it was chosen a few steps up.
  check('a delete button asks the page to forget that one by address',
    sent[sent.length - 1].value.action === 'forget'
      && sent[sent.length - 1].value.src === BEACH.src,
    String(sent[sent.length - 1].value.src));
  check('and the strip loses it',
    chips().length === 2 && forgets().length === 2, chips().length + ' chips');
  check('while the preview is left exactly as it was',
    preview.className.includes('is-empty'), caption.textContent);

  // The last one out takes the strip with it rather than leaving a gap where
  // a row of pictures used to be.
  answer = { recent: [] };
  forgets()[0].fire('click');
  await settle();

  check('emptying the list hides the strip',
    strip.hidden === true && chips().length === 0, 'hidden=' + strip.hidden);

  // ---------------------------------------------------------------- report

  let failed = 0;
  for (const result of results) {
    if (!result.pass) failed++;
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
