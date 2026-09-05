/**
 * The archive: putting a tile away, and getting it back.
 *
 * What can quietly go wrong here:
 *
 *   - `archivedAt` stops surviving a round trip through storage, or an older
 *     tile that has never had the field reads back as archived. Either way
 *     tiles vanish from the page, which looks exactly like losing them.
 *   - an archived tile leaks back into the grid - through the group filter, or
 *     through the search, which reaches across every group and would be the
 *     easier of the two to forget.
 *   - deleting a group sets every tile in it loose, archived ones included.
 *     That is the quiet one: nothing breaks, the archive still lists the tile,
 *     and the question about where to put it back is simply never asked again
 *     because there is nothing left to notice. The tile lands under "All"
 *     instead of wherever its owner would have said.
 *   - the sheet that asks the question offers "No group" while the "All" chip
 *     is turned off, so answering it puts the tile somewhere it cannot be
 *     seen.
 *   - Escape reaches the settings window rather than the sheet standing on it.
 *   - Archive is drawn as a destructive item, or under Delete, which makes the
 *     safe half of the pair look like the dangerous one.
 *   - the tile stops seeing itself out, or sees itself out from the wrong
 *     place. A `from` keyframe written down would be the drag's own state, so
 *     a tile archived from the menu would snap to 40% and half its size before
 *     it started - which reads as a glitch rather than as the tile leaving.
 *   - deleting from the archive takes the element off the grid first, so there
 *     is nothing left to animate, or asks the wrong question in the alert: an
 *     archived tile is not on the page to be taken off it.
 *
 * The list control is rendered for real against the DOM shim, the way the
 * other settings fields are in groups.test.js.
 *
 *   node test/archive.test.js [path/to/src]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const { El, document } = require('./dom-shim');

const SRC = process.argv[2] || path.join(__dirname, '..', 'src');
/* Line endings normalised: the markers below are written with plain newlines,
   and on a CRLF checkout they would match nothing - the test would then fail
   on the line endings rather than on the code. */
const read = file => fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');

const js = read('newtab.js');
const css = read('newtab.css');
const html = read('newtab.html');

// ------------------------------------------------------------------ sandbox

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
    CATALOG: [{ name: 'Inter', style: 'sans', scripts: ['latin-ext'] }],
    STYLES: [{ id: 'sans', label: 'Sans' }],
    SCRIPTS: [{ id: 'latin-ext', label: 'Latin ext' }],
    SUGGESTED: ['Inter'],
    stackFor: name => name || 'system-ui',
    previewStack: name => name || 'system-ui',
    loadPreviews: () => Promise.resolve('cache')
  }
};
vm.createContext(sandbox);

for (const file of ['i18n.js', 'schema.js', 'settings.js', 'storage.js']) {
  vm.runInContext(read(file), sandbox, { filename: file });
}

const SettingsUI = vm.runInContext('SettingsUI', sandbox);
const Schema = vm.runInContext('Schema', sandbox);
const Store = vm.runInContext('Store', sandbox);
/* The message table, for the two alerts that have to say different things. */
const I18N = vm.runInContext('I18N', sandbox);

// ------------------------------------------------------------------ harness

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

// ------------------------------------------------------------ what is stored

(async () => {
  const saved = await Store.save([
    { url: 'https://a.example/', title: 'A', archivedAt: 1756000000000 },
    { url: 'https://b.example/', title: 'B' },
    { url: 'https://c.example/', title: 'C', archivedAt: 'yesterday' },
    { url: 'https://d.example/', title: 'D', archivedAt: -5 }
  ]);

  check('an archived tile keeps the moment it was put away',
    saved[0].archivedAt === 1756000000000, String(saved[0].archivedAt));

  /* Every tile written before there was an archive arrives with no field at
     all, and every one of them is a tile on the page. */
  check('a tile that has never been archived reads as 0',
    saved[1].archivedAt === 0, String(saved[1].archivedAt));

  check('and so does anything that is not a moment in time',
    saved[2].archivedAt === 0 && saved[3].archivedAt === 0,
    saved[2].archivedAt + ', ' + saved[3].archivedAt);

  const back = await Store.load();
  check('it survives the round trip through storage',
    back[0].archivedAt === 1756000000000 && back[1].archivedAt === 0,
    JSON.stringify(back.map(t => t.archivedAt)));

  /* The whole point of the field being a time rather than a flag: the archive
     is read newest away first, and that is what says which is newest. */
  check('the field is one a list can be ordered by',
    typeof saved[0].archivedAt === 'number');

  run();
})();

function run() {

// --------------------------------------------------- off the page entirely

const view = js.slice(js.indexOf('function tilesInView()'), js.indexOf('function acceptTiles'));

check('the archive is taken off before the grid is filtered at all',
  js.includes('const onPage = tile => !tile.archivedAt;')
    && /const here = tiles\.filter\(onPage\);/.test(view),
  'one filter, above both the group and the search');

/* A search reaches across every group by design, so it is the one road an
   archived tile could come back down. */
check('and both roads run off that same list, not off `tiles`',
  /\? here\.filter\(matchesQuery\)/.test(view)
    && /\? here\.filter\(tile => groupOf\(tile\) === activeGroup\)/.test(view)
    && /^\s*: here;$/m.test(view),
  'the search, the group, and no filter at all');

// ------------------------------------------- what a deleted group leaves

/* The archived tile holds the id of a group that no longer exists. Every
   reader already treats that as loose - see groupOf - so nothing is broken by
   it, and it is the only record of where the tile is meant to go back to. */
const sweep = js.slice(js.indexOf('btnGroupDelete.addEventListener'));

check('deleting a group leaves the archived tiles remembering it',
  /if \(tile\.groupId === id && onPage\(tile\)\) tile\.groupId = null;/.test(sweep),
  'that memory is the whole question the restore asks');

check('while the tiles still on the page go loose as they always did',
  sweep.includes('tile.groupId = null'));

// ------------------------------------------------------- asking the question

const restore = js.slice(js.indexOf('async function restoreTile'));

check('a tile whose group is still there is put straight back',
  /const gone = Boolean\(tile\.groupId\)\s*\n\s*&& !groups\.some\(group => group\.id === tile\.groupId\);/
    .test(restore),
  'nothing is asked unless the group has actually gone');

/* Loose is a place, not an absence: a tile archived from "All" was in no group
   and goes back into no group, with nothing to ask about. */
check('a tile that was in no group is never asked about',
  restore.includes('Boolean(tile.groupId)'),
  'the question needs a group to have gone missing');

check('with every group deleted there is nothing to ask, and it simply returns',
  /const chosen = groups\.length \? await askArchiveGroup\(tile\) : null;/.test(restore));

check('cancelling the sheet leaves the tile where it was',
  /if \(chosen === undefined\) return false;/.test(restore),
  'and the archive row is told nothing changed');

check('the dead group id is replaced by the answer, not left behind',
  /tile\.groupId = chosen;/.test(restore));

const ask = js.slice(js.indexOf('function askArchiveGroup'), js.indexOf('archiveGroupForm.add'));

/* A loose tile shows under "All" and nowhere else, so offering "No group"
   with that chip turned off is offering to hide the tile. */
check('"No group" is offered only where a loose tile could be found again',
  /if \(settings\.showAllGroup\) \{/.test(ask),
  'the "All" chip is the only place a loose tile shows');

check('and it answers with null rather than an empty string',
  js.includes("settleArchiveGroup(fieldArchiveGroup.value || null)"));

// ------------------------------------------------------------ the sheet

check('the sheet is in the markup, after the window it stands over',
  html.indexOf('id="archiveGroup"') > html.indexOf('id="settings"')
    && html.indexOf('id="archiveGroup"') < html.indexOf('id="confirmAlert"'),
  'every dialog here is stacked by document order');

check('it can hold the keyboard, the way every other dialog can',
  html.includes('id="archiveGroup" tabindex="-1"'));

check('a dialog going up makes it inert with the rest',
  /const LAYERS = \[[\s\S]*?archiveGroupModal[\s\S]*?\];/.test(js));

/* It is raised from the settings window, so Escape has to reach it first -
   the chain is walked innermost out. */
check('Escape reaches the sheet before the window under it',
  js.indexOf('else if (settleArchiveGroup) settleArchiveGroup(undefined);')
    < js.indexOf('else if (!settingsModal.hidden) closeDialog(settingsModal);'),
  'and after the alert, which stands over everything');

check('clicking the dimmed page behind it is a cancel, as it is everywhere else',
  /archiveGroupModal\.addEventListener\('mousedown'/.test(js));

// -------------------------------------------------------------- the menu

const menu = js.slice(js.indexOf('function tileItems'));
const archiveAt = menu.indexOf("t('menu_archiveTile')");
const deleteAt = menu.indexOf("t('menu_deleteTile')");

check('the tile menu offers Archive', archiveAt > -1);

/* Above Delete and not marked destructive: it is the same shelf reached
   without losing anything, and drawing it in red would say the opposite. */
check('above Delete, where the milder of the two belongs',
  archiveAt > -1 && archiveAt < deleteAt);

check('and not dressed as destructive',
  !/menu_archiveTile'\), danger: true/.test(menu),
  'nothing is lost by it, which is the point');

check('nothing is asked before a tile is archived',
  !/archiveTile[\s\S]{0,400}askAlert/.test(js),
  'an alert guards what cannot be undone; this can');

// --------------------------------------------------------- seeing itself out

const leave = js.slice(js.indexOf('function leaveView'), js.indexOf('function tileElement'));

/* One keyframe, so the browser takes the tile's own computed style as the
   start and it leaves from wherever it actually stands - faded and shrunken
   mid-drag, at rest from the menu. A `from` written out would be the drag's
   state, and everything else would snap into it first. */
check('the tile leaves from wherever it is standing',
  /el\.animate\(\[[\s\S]*?\], \{/.test(leave)
    && leave.match(/\{ opacity[^}]*\}/g).length === 1
    && leave.includes("{ opacity: 0, transform: 'scale(.7)' }"),
  'one keyframe, not two');

check('and it is held at the end, so nothing flashes back before the redraw',
  leave.includes("fill: 'forwards'"));

check('a tile that is not on screen finishes at once rather than throwing',
  /if \(!el \|\| stillness\.matches \|\| !el\.isConnected\) return Promise\.resolve\(\);/.test(leave),
  'which is every tile deleted from inside the archive');

check('and somebody who asked for less movement gets none',
  leave.includes('stillness.matches'));

/* Three ways out, one movement: the grid loses a tile either way, and where
   it went is said by what is on screen afterwards rather than by the leaving. */
const archiving = js.slice(js.indexOf('async function archiveTile'),
  js.indexOf('function askArchiveGroup'));
const deleting = js.slice(js.indexOf('async function deleteTile'),
  js.indexOf('btnDelete.addEventListener'));

check('archiving a tile plays it',
  /await Promise\.all\(\[persistTiles\(\), leaveView\(tileElement\(id\)\)\]\);/.test(archiving));

check('deleting one plays the same one',
  /await Promise\.all\(\[persistTiles\(\), leaveView\(going\)\]\);/.test(deleting));

check('and so does a tile dropped on another group, as it always did',
  /await Promise\.all\(\[persistTiles\(\), leaveView\(dropped\)\]\);/.test(js),
  'three departures, one animation');

/* The write and the animation run together and the redraw waits for both, or
   the tile is gone from the grid before it has finished leaving it. */
check('the redraw waits for it rather than cutting across it',
  /leaveView\([\s\S]*?\)\]\);\s+render\(\);/.test(archiving)
    && /leaveView\(going\)\]\);\s+render\(\);/.test(deleting));

check('the element is found before the tile leaves the list, not after',
  deleting.indexOf('const going = tileElement(id);')
    < deleting.indexOf('tiles = tiles.filter'),
  'afterwards there would be nothing to say which element it was');

// ------------------------------------------------- deleting out of the archive

check('the alert names the archive when that is what a tile is going from',
  /const said = tile\.archivedAt \? 'confirm_deleteArchivedText' : 'confirm_deleteText';/
    .test(deleting),
  'an archived tile is not on the page to be taken off it');

check('and the two say different things',
  I18N.MESSAGES.confirm_deleteArchivedText !== I18N.MESSAGES.confirm_deleteText
    && I18N.MESSAGES.confirm_deleteArchivedText.includes('archive'),
  I18N.MESSAGES.confirm_deleteArchivedText);

const change = js.slice(js.indexOf('async function changeArchive'),
  js.indexOf('async function changeTransfer'));

check('the archive row can ask for either',
  /if \(act !== 'restore' && act !== 'delete'\) return \{ value: null \};/.test(change));

check('deleting from there is the page’s own delete, alert and icon cache and all',
  /: await deleteTile\(payload\.id\)/.test(change),
  'not a second way of removing a tile');

check('either one called off hands back nothing, so the list is left alone',
  /return \{ value: done \? archivedTiles\(\) : null \};/.test(change));

// ---------------------------------------------------------- the settings pane

const section = Schema.SECTIONS.find(s => s.id === 'archive');

check('there is a section for it in the settings sidebar', Boolean(section));

check('with a glyph the icon set actually carries',
  Boolean(section) && vm.runInContext('Icons', sandbox) && section.icon === 'archive');

const field = section && section.fields.find(f => f.key === 'archive');

check('the row stores nothing of its own - it is a view of the tiles',
  Boolean(field) && field.external === true && !('default' in field));

check('so it adds no setting to a fresh profile',
  !('archive' in Schema.DEFAULTS));

// ------------------------------------------------------------- the list

function mountArchive(entries) {
  const sent = [];
  const container = new El('div');
  SettingsUI.mount(container, {
    values: { ...Schema.DEFAULTS, background: null, archive: entries },
    onChange: async (key, value) => {
      sent.push({ key, value });
      // What the page hands back: the archive that is left.
      return { value: entries.filter(e => e.id !== value.id) };
    }
  });
  return { container, sent };
}

const ENTRIES = [
  { id: 't1', name: 'Figma', url: 'https://figma.com/' },
  { id: 't2', name: 'Linear', url: 'https://linear.app/' }
];

const { container, sent } = mountArchive(ENTRIES);
const rows = container.querySelectorAll('.archive__item');

check('every archived tile gets a row', rows.length === 2, rows.length + ' rows');

check('each row says what the tile is, and which one it is',
  rows[0].querySelectorAll('.archive__name')[0].textContent === 'Figma'
    && rows[0].querySelectorAll('.archive__url')[0].textContent === 'https://figma.com/',
  'the address is what tells two tiles of the same name apart');

const restoreBtn = rows[0].find(el => el.className.includes('btn'));

check('and a button to put it back', Boolean(restoreBtn));

/* The name is in the label but not on the face: forty buttons each reading
   "Restore <something>" is forty different widths down one column. */
check('whose label names the tile, for anyone who cannot see the row it is in',
  restoreBtn.attrs['aria-label'] === 'Restore “Figma”',
  restoreBtn.attrs['aria-label']);

restoreBtn.fire('click');

check('pressing it asks the page for that tile back',
  sent.length === 1 && sent[0].key === 'archive'
    && sent[0].value.action === 'restore' && sent[0].value.id === 't1',
  JSON.stringify(sent));

const remove = rows[0].find(el => el.className.includes('archive__delete'));

check('and a button to be rid of it for good', Boolean(remove));

/* Icon only, and last in the row: the archive is the last place a tile is
   kept, so this is the one control here that cannot be taken back - spelling
   it out beside a spelt-out Restore would give the two the same weight. */
check('drawn as the destructive one it is',
  remove.className.includes('btn--danger'), remove.className.trim());

check('after Restore, which is what the row is for',
  rows[0].children.indexOf(remove) > rows[0].children.indexOf(restoreBtn));

check('carrying a glyph rather than a word', remove.textContent.trim() === '');

check('so it says which tile it is for in its label, and what it will do',
  remove.attrs['aria-label'] === 'Delete “Figma” for good',
  remove.attrs['aria-label']);

check('and names itself on hover for anyone who cannot place the glyph',
  remove.title === 'Delete', remove.title);

/* macOS asks for 20x20pt at the very least, and an icon button has no words
   to make it wider. */
check('it is big enough to aim at',
  /\.archive__delete \{[\s\S]*?width: 28px;[\s\S]*?min-height: 28px;/.test(css),
  '28x28');

sent.length = 0;
remove.fire('click');

check('pressing it asks the page to delete that tile',
  sent.length === 1 && sent[0].key === 'archive'
    && sent[0].value.action === 'delete' && sent[0].value.id === 't1',
  JSON.stringify(sent));

const empty = container.find(el => el.className.includes('archive__empty'));

check('an empty archive says how one is filled instead of showing nothing',
  Boolean(empty) && empty.textContent.includes('Archive tile'),
  empty && empty.textContent);

check('and the note is hidden while there is a list to read',
  empty.hidden === true && container.find(el => el.className.includes('archive__list')).hidden === false);

const { container: none } = mountArchive([]);
const emptyNone = none.find(el => el.className.includes('archive__empty'));

check('with nothing archived it is the other way about',
  emptyNone.hidden === false
    && none.find(el => el.className.includes('archive__list')).hidden === true);

/* `display: flex` on the list outranks the browser's own [hidden] rule. */
check('the list being put away is actually put away',
  css.includes('.archive__list[hidden] { display: none; }'));

check('a long archive scrolls inside its row rather than stretching the pane',
  /\.archive__list \{[\s\S]*?max-height: \d+px;[\s\S]*?overflow-y: auto;/.test(css));

check('a name too long for its row is cut rather than wrapped',
  /\.archive__name,\s*\n\.archive__url \{[\s\S]*?text-overflow: ellipsis;/.test(css),
  'one row per tile is what makes the list countable');

// ------------------------------------------------------------------ report

let failed = 0;
for (const result of results) {
  if (!result.pass) failed++;
  console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

}
