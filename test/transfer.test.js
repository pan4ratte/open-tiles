/**
 * Guards the backup file: what goes into one, what is allowed back out of one,
 * and the pair of buttons that drive it.
 *
 * What can go quietly wrong here:
 *
 *   - "absent" and `null` collapse into each other. A file that says nothing
 *     about the background must leave the picture alone; one that says `null`
 *     must take it away. Get that backwards and importing a settings-only
 *     backup wipes a picture nobody asked it to touch.
 *   - the blob URL is revoked while the browser is still reading it, and the
 *     download silently produces nothing.
 *   - `backup` leaks into the settings object, and every slider drag starts
 *     rewriting a field that has no value.
 *   - an import re-mounts the dialog from inside its own commit, throwing away
 *     the row that was waiting to report how it went - so the restore lands
 *     with no word of what happened.
 *
 * Runs the real schema.js, importers.js, transfer.js and settings.js against
 * the DOM shim.
 *
 *   node test/transfer.test.js [path/to/src]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const { El, document } = require('./dom-shim');

const SRC = process.argv[2] || path.join(__dirname, '..', 'src');

// --------------------------------------------------------------- fake browser

/** Every object URL handed out, and every one handed back. */
const handedOut = [];
const revoked = [];

/** A file whose `text` is what a reader gets; anything else fails to read. */
const fileOf = (text, size) => ({ name: 'backup.json', size: size || 100, text });

const sandbox = {
  document,
  console,
  setTimeout,
  clearTimeout,
  Blob: class Blob {
    constructor(parts, options) { this.parts = parts; this.type = options && options.type; }
    get text() { return this.parts.join(''); }
  },
  URL: {
    createObjectURL(blob) {
      const url = 'blob:tiles/' + handedOut.length;
      handedOut.push({ url, blob });
      return url;
    },
    revokeObjectURL(url) { revoked.push(url); }
  },
  FileReader: class FileReader {
    readAsText(file) {
      setTimeout(() => {
        if (typeof file.text !== 'string') return this.onerror();
        this.result = file.text;
        this.onload();
      }, 0);
    }
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

for (const file of ['i18n.js', 'schema.js', 'importers.js', 'transfer.js', 'settings.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n'), sandbox, { filename: file });
}

const Transfer = vm.runInContext('Transfer', sandbox);
const Schema = vm.runInContext('Schema', sandbox);
const SettingsUI = vm.runInContext('SettingsUI', sandbox);

// ------------------------------------------------------------------ harness

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

const STATE = {
  settings: { ...Schema.DEFAULTS, accent: '#ff9500', columns: 6 },
  tiles: [{
    id: 't1', url: 'https://example.com', title: 'Example', groupId: 'g1',
    icon: 'https://example.com/logo.svg', visits: 17
  }],
  groups: [{ id: 'g1', name: 'Work' }],
  background: { src: 'data:image/png;base64,AAA', name: 'holiday.png', savedAt: 1 }
};

// ------------------------------------------------------------- the envelope

const doc = Transfer.build(STATE);

check('a document names itself', doc.format === 'tiles-backup' && doc.version === 1,
  doc.format + ' v' + doc.version);
check('it is stamped with when it was written',
  typeof doc.savedAt === 'string' && !Number.isNaN(Date.parse(doc.savedAt)), doc.savedAt);
check('it carries every section it was handed',
  Transfer.SECTIONS.every(name => name in doc), Object.keys(doc).join(', '));
check('the settings travel whole',
  doc.settings.accent === '#ff9500' && doc.settings.columns === 6);

const partial = Transfer.build({ settings: STATE.settings });
check('a section it was not handed is left out of the file',
  !('tiles' in partial) && !('background' in partial), Object.keys(partial).join(', '));
check('a null background is written, because it means "take it away"',
  'background' in Transfer.build({ background: null }));

check('the filename is date-stamped',
  Transfer.filename(new Date(2026, 7, 26)) === 'tiles-backup-2026-08-26.json',
  Transfer.filename(new Date(2026, 7, 26)));

// ------------------------------------------------------------------ the field

check('backup is not a stored setting', !('backup' in Schema.DEFAULTS));
check('coerce drops it if it strays into settings',
  !('backup' in Schema.coerce({ backup: 'x' })));

const sent = [];
const container = new El('div');
SettingsUI.mount(container, {
  values: { ...Schema.DEFAULTS, background: null },
  status: { backup: { kind: 'ok', text: 'Restored 1 tile.' } },
  onChange: async (key, value) => {
    sent.push({ key, value });
    return { value: null };
  }
});

const field = container.find(el => el.className.includes('backupfield'));
const buttons = field ? field.findAll(el => el.tagName === 'button') : [];
const picker = field ? field.find(el => el.tagName === 'input' && el.type === 'file') : null;

check('the field rendered', Boolean(field));
check('it offers two buttons', buttons.length === 2,
  buttons.map(b => b.textContent).join(' / '));
check('it offers a file input for the import', Boolean(picker));
check('the import only accepts JSON',
  Boolean(picker) && picker.accept.includes('json'), picker && picker.accept);

const backupRow = container.find(el => el.dataset && el.dataset.field === 'backup');
const line = backupRow && backupRow.find(el => el.className.includes('status') && !el.hidden);
check('a status handed to the mount lands under its field',
  Boolean(line) && line.textContent.includes('Restored 1 tile.'),
  line ? line.textContent : 'no line shown');

const untouched = container.find(el => el.dataset && el.dataset.field === 'reset')
  .find(el => el.className.includes('status'));
check('and nowhere else', untouched.hidden === true);

// -------------------------------------------------------------- the round trip

/** Lets a commit round trip (two awaits deep) settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

(async () => {
  buttons[0].fire('click');
  await settle();
  check('the first button asks the page to export',
    sent[0] && sent[0].key === 'backup' && sent[0].value.action === 'export',
    sent[0] && sent[0].value.action);

  const FILE = fileOf('{}');
  picker.files = [FILE];
  picker.fire('change');
  await settle();

  const last = sent[sent.length - 1];
  check('picking a file asks the page to import it',
    last.value.action === 'import' && last.value.file === FILE, last.value.action);
  check('the picker is cleared, so the same file can be chosen twice',
    picker.value === '', JSON.stringify(picker.value));

  // ------------------------------------------------------------- downloading

  const name = Transfer.save(STATE);
  const written = handedOut[handedOut.length - 1];

  check('saving hands the browser a blob', handedOut.length === 1, name);
  check('it is offered as JSON', written.blob.type === 'application/json', written.blob.type);
  check('under the dated filename', name === Transfer.filename(), name);

  const link = document.body.find(el => el.tagName === 'a');
  check('the link takes itself back out of the document', link === null);
  check('the blob URL outlives the click', revoked.length === 0,
    revoked.length + ' revoked');

  const round = JSON.parse(written.blob.text);
  check('what was written parses back to what went in',
    JSON.stringify(round.tiles) === JSON.stringify(STATE.tiles)
      && round.background.name === 'holiday.png');

  // ---------------------------------------------------------------- reading

  const reject = async (label, file, expect) => {
    try {
      await Transfer.read(file);
      check(label, false, 'it was accepted');
    } catch (err) {
      check(label, err.message.includes(expect), err.message);
    }
  };

  await reject('a file that is not JSON is refused', fileOf('hello'), 'valid JSON');
  await reject('another program’s JSON is refused',
    fileOf('{"format":"other"}'), 'not a backup file this add-on can read');
  await reject('a bare array is refused', fileOf('[1,2,3]'),
    'not a backup file this add-on can read');
  await reject('an empty backup is refused',
    fileOf(JSON.stringify({ format: 'tiles-backup', version: 1 })), 'nothing in it');
  await reject('an unreadable file is refused', { name: 'x', size: 10 }, 'could not be read');
  await reject('an oversized file is refused before it is read',
    fileOf('{}', Transfer.MAX_FILE + 1), 'too large');

  const back = await Transfer.read(fileOf(Transfer.serialize(STATE)));
  check('a real backup comes back whole',
    Transfer.SECTIONS.every(name => name in back.sections),
    Object.keys(back.sections).join(', '));
  check('its tiles survive the trip',
    back.sections.tiles[0].url === 'https://example.com');
  check('a tile’s own icon and visit count survive the trip',
    back.sections.tiles[0].icon === 'https://example.com/logo.svg'
      && back.sections.tiles[0].visits === 17,
    back.sections.tiles[0].icon + ' / ' + back.sections.tiles[0].visits);
  check('its version comes back with it', back.version === Transfer.VERSION);
  check('one of ours is not a foreign file',
    back.source === null && back.partialSettings === false, String(back.source));

  // A file another add-on wrote comes in through the same call and comes out
  // as the same sections - see importers.js.
  const foreign = await Transfer.read(fileOf(JSON.stringify({
    dials: [{ id: 1, title: 'A', url: 'https://a.example', position: 0, idgroup: 0 }],
    groups: [{ id: 0, title: 'home', position: 0 }],
    preferences: { columns: 6 }
  })));
  check('a Speed Dial 2 file is read by the same call',
    foreign.source === 'Speed Dial 2', String(foreign.source));
  check('and comes out as ordinary sections',
    foreign.sections.tiles[0].url === 'https://a.example'
      && foreign.sections.groups[0].name === 'home');
  check('its settings are marked partial, so they merge rather than replace',
    foreign.partialSettings === true);

  const some = await Transfer.read(fileOf(Transfer.serialize({ groups: STATE.groups })));
  check('a partial backup reports only what it holds',
    Object.keys(some.sections).join() === 'groups', Object.keys(some.sections).join());

  // A file from a build this one has never heard of still gives up its parts:
  // everything in it is re-sanitized downstream anyway.
  const ahead = await Transfer.read(fileOf(JSON.stringify({
    format: 'tiles-backup', version: 99, tiles: [], somethingNew: true
  })));
  check('a newer file is read for the parts this build understands',
    'tiles' in ahead.sections && !('somethingNew' in ahead.sections),
    Object.keys(ahead.sections).join());

  // ----------------------------------------------------------------- report

  let failed = 0;
  for (const result of results) {
    if (!result.pass) failed++;
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
