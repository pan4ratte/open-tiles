/**
 * Guards reading a backup written by another new-tab add-on.
 *
 * What can go quietly wrong here:
 *
 *   - a group id of `0` is falsy. Speed Dial 2's default group *is* 0, and the
 *     group sanitizer reads `String(g.id || crypto.randomUUID())` - so a bare
 *     number there hands the group a fresh random id and every tile pointing
 *     at it comes loose. That is 18 tiles off this file's first page, and it
 *     looks like the import merely "lost the grouping".
 *   - the order collapses. Over there each dial is numbered inside its group;
 *     here there is one flat list that a group filter reads through. Sort it
 *     wrong and every page comes out shuffled.
 *   - a foreign file's handful of preferences get treated as a whole settings
 *     object, and importing one silently resets everything it never mentioned.
 *   - what could not be carried over goes unmentioned, and somebody finds out
 *     a week later that their icons are not the ones they picked.
 *
 * Runs the real schema.js, importers.js and storage.js - the sanitizers
 * included, because "does the converted file survive being saved" is most of
 * the question.
 *
 *   node test/importers.test.js [path/to/src]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '..', 'src');

// ------------------------------------------------------- fake extension area

function makeArea() {
  const disk = {};
  return {
    disk,
    local: {
      async get(key) { return key in disk ? { [key]: disk[key] } : {}; },
      async set(pairs) { Object.assign(disk, pairs); }
    },
    onChanged: { addListener() {} }
  };
}

const area = makeArea();

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  crypto: { randomUUID: () => 'random-' + Math.random().toString(36).slice(2) },
  URL,
  browser: { storage: { local: area.local, onChanged: area.onChanged } }
};
vm.createContext(sandbox);

for (const file of ['i18n.js', 'schema.js', 'importers.js', 'storage.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n'), sandbox, { filename: file });
}

const Importers = vm.runInContext('Importers', sandbox);
const Schema = vm.runInContext('Schema', sandbox);
const Store = vm.runInContext('Store', sandbox);

// ------------------------------------------------------------------ harness

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

/** A small Speed Dial 2 file, shaped exactly like the real thing. */
const SD2 = {
  dials: [
    // Deliberately out of order, and with `home` (group 0) in the middle.
    { id: 11, title: 'Design B', url: 'https://b.example', thumbnail: 'https://b/i.png',
      position: 1, idgroup: 1, visits: 4, ts_created: 1 },
    { id: 10, title: 'Design A', url: 'https://a.example', thumbnail: 'https://a/i.png',
      position: 0, idgroup: 1, visits: 0, ts_created: 1 },
    { id: 20, title: 'Home Second', url: 'https://home2.example', thumbnail: '',
      position: 5, idgroup: 0, visits: 2, ts_created: 1 },
    { id: 21, title: 'Home First', url: 'https://home1.example', thumbnail: 'data:image/png;base64,AAA',
      position: 0, idgroup: 0, visits: 9, ts_created: 1 },
    // Two dials sharing a position: file order has to break the tie.
    { id: 30, title: 'Tie One', url: 'https://tie1.example', thumbnail: '',
      position: 3, idgroup: 1, visits: 0, ts_created: 1 },
    { id: 31, title: 'Tie Two', url: 'https://tie2.example', thumbnail: '',
      position: 3, idgroup: 1, visits: 0, ts_created: 1 },
    // A dial in a group the file never declares.
    { id: 40, title: 'Orphan', url: 'https://orphan.example', thumbnail: '',
      position: 0, idgroup: 77, visits: 0, ts_created: 1 },
    // And one with nothing usable in it.
    { id: 41, title: 'Broken', url: null, thumbnail: '', position: 0, idgroup: 0, visits: 0 }
  ],
  groups: [
    // Out of order on purpose: `position` is what decides, not file order.
    { id: 1, title: 'design', position: 2, color: '' },
    { id: 0, title: 'home', position: 0 }
  ],
  preferences: {
    columns: 6,
    spacing: 16,
    maxWidth: 1195,
    openInNewTab: 0,
    showAddButton: false,
    keepActiveGroup: 1,
    orderBy: 'manual',
    bookmarks: { showTitle: true, showVisits: false, thumbnailRatio: 0.8, shadow: 'none' },
    theme: {
      font: 'default',
      fontSize: 100,
      theme: 'auto',
      dark: { backgroundImage: 'https://pictures.example/photo.jpg' },
      light: { backgroundImage: '' }
    }
  }
};

// ------------------------------------------------------------------ detection

check('an unknown document is not claimed', Importers.read({ hello: 'world' }) === null);
check('a Tiles backup is not claimed by a foreign importer',
  Importers.read({ format: 'tiles-backup', tiles: [] }) === null);
check('junk is not claimed',
  Importers.read(null) === null && Importers.read([1, 2, 3]) === null);

const out = Importers.read(SD2);
check('a Speed Dial 2 file is recognised', out && out.source === 'Speed Dial 2',
  out && out.source);

// -------------------------------------------------------------------- groups

const groups = out.sections.groups;
check('groups come across in their own position order',
  groups.map(g => g.name).join(' > ') === 'home > design',
  groups.map(g => g.name).join(' > '));
check('the default group keeps an id that survives being falsy',
  groups[0].id === 'g0', groups[0].id);

// --------------------------------------------------------------------- tiles

const tiles = out.sections.tiles;
const titles = tiles.map(t => t.title).join(', ');

check('a dial with no usable url is dropped',
  !tiles.some(t => t.title === 'Broken'), titles);
check('tiles are laid out group by group, in position order',
  titles === 'Home First, Home Second, Design A, Design B, Tie One, Tie Two, Orphan',
  titles);
check('dials sharing a position keep their file order',
  tiles.findIndex(t => t.title === 'Tie One') < tiles.findIndex(t => t.title === 'Tie Two'));
check('every tile points at a group that exists, or at none',
  tiles.every(t => !t.groupId || groups.some(g => g.id === t.groupId)));
check('a dial in an undeclared group comes across loose',
  tiles.find(t => t.title === 'Orphan').groupId === null);
check('the default group’s tiles stay in it',
  tiles.filter(t => t.groupId === 'g0').length === 2,
  tiles.filter(t => t.groupId === 'g0').length + ' in g0');

// ----------------------------------------------------------------- settings

const settings = out.sections.settings;
check('columns and spacing come over', settings.columns === 6 && settings.gap === 16,
  JSON.stringify(settings));
check('a logo ratio becomes the padding around one', settings.logoPad === 20,
  String(settings.logoPad));
check('"auto" becomes "system"', settings.theme === 'system', settings.theme);
check('showTitle becomes showLabels', settings.showLabels === true);
check('openInNewTab becomes a boolean', settings.openInNewTab === false,
  typeof settings.openInNewTab);
check('the other add-on’s "default" font is not imported as a family',
  !('font' in settings), String(settings.font));
check('settings this add-on has no field for are left out',
  !('maxWidth' in settings) && !('fontSize' in settings) && !('shadow' in settings),
  Object.keys(settings).join(', '));
check('an order this add-on does not have is not invented',
  !('tileOrder' in settings), String(settings.tileOrder));
check('a foreign file’s settings are marked partial, so they merge',
  out.partialSettings === true);

check('every imported setting is one the schema knows',
  Object.keys(settings).every(key => key in Schema.DEFAULTS),
  Object.keys(settings).filter(key => !(key in Schema.DEFAULTS)).join(', ') || 'all known');

// ------------------------------------------------ icons, visits, background

check('a saved thumbnail becomes the tile’s own icon',
  tiles.find(t => t.title === 'Design A').icon === 'https://a/i.png',
  tiles.find(t => t.title === 'Design A').icon);
check('an inline thumbnail comes across as it is',
  tiles.find(t => t.title === 'Home First').icon.startsWith('data:image/'));
check('a dial with no thumbnail asks for the usual lookup',
  tiles.find(t => t.title === 'Tie One').icon === '');
check('visit counts come across', tiles.find(t => t.title === 'Home First').visits === 9,
  String(tiles.find(t => t.title === 'Home First').visits));

check('a background named by address comes across',
  out.sections.background.src === 'https://pictures.example/photo.jpg',
  out.sections.background && out.sections.background.src);
check('it is captioned with its host',
  out.sections.background.name === 'pictures.example', out.sections.background.name);

check('the add button preference comes across', settings.showAddButton === false);
check('keeping the open group comes across', settings.keepGroup === true);
check('showVisits comes across', settings.showVisits === false,
  String(settings.showVisits));

// ------------------------------------------------------ what could not come

check('the time-of-day split is reported as dropped', out.dropped.stats === false,
  String(out.dropped.stats));
check('group colours are reported as dropped', out.dropped.colours === 0,
  String(out.dropped.colours));

// ------------------------------------------------- surviving the sanitizers

(async () => {
  // The real test of the ids: everything goes through the same calls the page
  // saves with, and the tiles must still be attached to their groups after.
  const savedGroups = await Store.saveGroups(out.sections.groups);
  const savedTiles = await Store.save(out.sections.tiles);

  check('groups survive being saved with their ids intact',
    savedGroups.map(g => g.id).join() === 'g0,g1', savedGroups.map(g => g.id).join());
  check('no tile is orphaned by the round trip through storage',
    savedTiles.filter(t => t.groupId && !savedGroups.some(g => g.id === t.groupId)).length === 0);
  check('the grouping is the same after saving as before',
    savedTiles.filter(t => t.groupId === 'g0').length === 2
      && savedTiles.filter(t => t.groupId === 'g1').length === 4,
    savedTiles.map(t => t.groupId).join());
  check('icons and visit counts survive being saved',
    savedTiles.find(t => t.title === 'Design A').icon === 'https://a/i.png'
      && savedTiles.find(t => t.title === 'Home First').visits === 9);
  check('the order is the same after saving as before',
    savedTiles.map(t => t.title).join() === tiles.map(t => t.title).join());

  // ------------------------------------------------- what an icon may be

  /* An icon arrives from a file somebody else wrote, so the scheme is not a
     detail: `javascript:` in a tile's icon would be a link the page paints. */
  const iconOf = async raw => (await Store.save([
    { id: 'x', url: 'https://x.example', icon: raw }
  ]))[0].icon;

  check('an https icon is kept', await iconOf('https://x/i.png') === 'https://x/i.png');
  check('an inline picture is kept',
    await iconOf('data:image/png;base64,AAA') === 'data:image/png;base64,AAA');
  check('a javascript: icon is refused', await iconOf('javascript:alert(1)') === '',
    JSON.stringify(await iconOf('javascript:alert(1)')));
  check('a data: URI that is not a picture is refused',
    await iconOf('data:text/html,<script>') === '');
  check('a file: icon is refused', await iconOf('file:///etc/passwd') === '');
  check('a relative path is refused', await iconOf('/icons/x.png') === '');
  check('an icon too big to sit on a tile record is refused',
    await iconOf('data:image/png;base64,' + 'A'.repeat(300 * 1024)) === '');
  check('a missing icon reads as none', await iconOf(undefined) === '');

  const bgOf = async raw => (await Store.save([
    { id: 'x', url: 'https://x.example', bg: raw }
  ]))[0].bg;

  check('a six-digit hex background is kept', await bgOf('#34C759') === '#34c759',
    await bgOf('#34C759'));
  check('a three-digit hex is refused', await bgOf('#abc') === '');
  check('a named colour is refused', await bgOf('red') === '');
  check('a colour function is refused', await bgOf('rgb(1,2,3)') === '');
  check('something that is not a colour at all is refused',
    await bgOf('url(evil.png)') === '');
  check('no background reads as none', await bgOf(undefined) === '');

  const visitsOf = async raw => (await Store.save([
    { id: 'x', url: 'https://x.example', visits: raw }
  ]))[0].visits;

  check('a visit count survives', await visitsOf(12) === 12);
  check('a negative count is refused', await visitsOf(-5) === 0);
  check('a fractional count is floored', await visitsOf(3.7) === 3);
  check('a count that is not a number reads as none', await visitsOf('lots') === 0);

  const savedSettings = await Store.saveSettings(out.sections.settings);
  check('a merged import leaves settings it never mentioned alone',
    savedSettings.accent === Schema.DEFAULTS.accent
      && savedSettings.tileSize === Schema.DEFAULTS.tileSize
      && savedSettings.columns === 6,
    'accent=' + savedSettings.accent + ' columns=' + savedSettings.columns);

  // ----------------------------------------------------------------- report

  let failed = 0;
  for (const result of results) {
    if (!result.pass) failed++;
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
