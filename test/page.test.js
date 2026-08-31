/**
 * Two things the page does before and around a tile: the outline it stands
 * behind while it loads, and what its right-click menu offers.
 *
 * What can quietly go wrong here:
 *
 *   - the loading screen becomes something the script builds. The whole point
 *     of it is the moment before any script has run, so it has to be in the
 *     markup; built later it would arrive at the same time as the page it was
 *     meant to cover.
 *   - it is hidden rather than removed, or the real content is left hidden
 *     behind it - either way the page ends up with two of everything, or none.
 *   - "Open in new tab" opens a tab that can reach back into this one, or
 *     opens the wrong tile, or forgets that opening one is a visit.
 *
 * The menu builders are lifted out of the real newtab.js and run here against
 * stubs, the way the wheel handler is in groupswitch.test.js.
 *
 *   node test/page.test.js [path/to/src]
 */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '..', 'src');
/* Line endings normalised: the markers below are written with plain newlines,
   and on a CRLF checkout they would match nothing - the test would then fail
   on the line endings rather than on the code. */
const read = file => fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');

const js = read('newtab.js');
const css = read('newtab.css');
const html = read('newtab.html');

// ------------------------------------------------------------------ harness

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

// ------------------------------------------------------------ loading screen

check('the page starts out loading',
  /<body class="[^"]*\bis-loading\b/.test(html),
  (html.match(/<body[^>]*>/) || [''])[0]);

check('the outline is in the markup, not built by the script',
  html.includes('id="skeleton"') && !js.includes("createElement('span')  // skeleton"),
  html.includes('id="skeleton"') ? 'in newtab.html' : 'missing');

// Real .tile elements: the outline is then the shape a tile actually takes -
// its size, its corner and its material - rather than a guess at it.
const ghosts = (html.match(/class="tile tile--ghost"/g) || []).length;
check('it draws its blocks as tiles with nothing in them',
  ghosts >= 6, ghosts + ' of them');

check('and a block where the clock goes',
  html.includes('skeleton__clock') && css.includes('.skeleton__clock'));

check('the clock block is the size of the line it stands for',
  /\.skeleton__clock\s*\{[^}]*height:\s*clamp\(56px, 8\.5vw, 86px\)/.test(css),
  /* The same clamp .page__clock sets its type from. */
  /font-size: calc\(clamp\(56px, 8\.5vw, 86px\)/.test(css) ? 'matches the clock' : 'clock has moved');

check('it takes no box of its own, so the rows are the page’s own',
  /\.skeleton\s*\{\s*display: contents;\s*\}/.test(css));

check('the real page is out of the way while it shows',
  ['#header', '#grid', '#empty', '.groupbar', '.toolbar']
    .every(sel => css.includes('body.is-loading ' + sel)));

check('it is held back for a moment, so a quick profile never sees it',
  /animation: skeleton-in [^;]*\b\d+ms both/.test(css),
  (css.match(/animation: skeleton-in [^;]*/) || [''])[0].trim());

// Removed rather than hidden: nothing on this page ever loads a second time,
// and an outline left in the markup is one more thing to keep hidden.
check('and taken off the page for good once the page is up',
  /classList\.remove\('is-loading'\)/.test(js)
    && /getElementById\('skeleton'\)/.test(js) && /skeleton\.remove\(\)/.test(js));

check('the outline goes after the page it was standing in for is drawn',
  js.indexOf("classList.remove('is-loading')") > js.indexOf('    renderGroups();\n    render();'));

// ---------------------------------------------------------------- the menus

/*
 * Lifted whole out of newtab.js: the page's menu, the tile's menu, and the
 * one thing the tile's menu does that the page cannot do for itself.
 */
const from = '  function pageItems() {';
const to = '      ...pageItems()\n    ];\n  }';

const start = js.indexOf(from);
const end = js.indexOf(to, start);
if (start < 0 || end < 0) throw new Error('the menu builders have moved - update this test');
const block = js.slice(start, end + to.length);

const SEPARATOR = Symbol('separator');
const opened = [];
const counted = [];

const TILES = [
  { id: 'a', url: 'https://example.com/one', title: 'One', visits: 3 },
  { id: 'b', url: 'https://example.com/two', title: 'Two', visits: 0 }
];

const build = new Function(
  'tiles', 'window', 'countVisit', 'openTileModal', 'openGroupModal',
  'openSettings', 'deleteTile', 'SEPARATOR', 't',
  block + '\n; return { pageItems, tileItems, openTileInNewTab };');

const { pageItems, tileItems, openTileInNewTab } = build(
  TILES,
  { open: (url, target, features) => opened.push({ url, target, features }) },
  id => counted.push(id),
  () => {}, () => {}, () => {}, () => {},
  SEPARATOR,
  // The menu's labels come out of the message table, so the real one answers
  // here: a stub would let a label be renamed in one place and not the other.
  require(path.join(SRC, 'i18n.js')).t
);

const items = tileItems('a');
const labels = items.filter(item => item !== SEPARATOR).map(item => item.label);

check('the tile menu offers opening it in a new tab',
  labels.includes('Open in new tab'), labels.join(', '));

// First, because it is what the tile is for - everything else on the menu is
// something done *to* the tile rather than with it.
check('and offers it first',
  labels[0] === 'Open in new tab', labels[0]);

check('it is drawn with the icon that means "leaves this page"',
  items[0].icon === 'external-link', items[0].icon);

check('the page menu, which has no tile, does not offer it',
  !pageItems().filter(item => item !== SEPARATOR)
    .some(item => item.label === 'Open in new tab'),
  pageItems().filter(item => item !== SEPARATOR).map(item => item.label).join(', '));

check('everything the menu offered before is still there',
  ['Edit tile', 'Delete tile', 'Add tile', 'New group', 'Settings']
    .every(label => labels.includes(label)),
  labels.join(', '));

// -------------------------------------------------------------- opening one

opened.length = 0;
counted.length = 0;
items[0].run();

check('running it opens that tile’s address in a tab of its own',
  opened.length === 1 && opened[0].url === 'https://example.com/one'
    && opened[0].target === '_blank',
  JSON.stringify(opened));

// The tiles themselves carry rel="noopener noreferrer"; a tab opened from the
// menu is the same tab and has no more business reaching back than that one.
check('and the page it opens cannot reach back into this one',
  opened[0].features.includes('noopener') && opened[0].features.includes('noreferrer'),
  opened[0].features);

check('opening one from the menu is a visit, the way clicking it is',
  counted.length === 1 && counted[0] === 'a', counted.join(', '));

// The menu is built fresh every time it opens, but a tile can still go while
// it is up - another new tab page deleting one, say.
opened.length = 0;
counted.length = 0;
openTileInNewTab('gone');

check('a tile that has since gone opens nothing, and counts nothing',
  opened.length === 0 && counted.length === 0,
  JSON.stringify(opened) + ' / ' + counted.join(', '));

opened.length = 0;
tileItems('b')[0].run();
check('the menu opens the tile it was asked about, not the first one',
  opened.length === 1 && opened[0].url === 'https://example.com/two',
  JSON.stringify(opened));

// ------------------------------------------------------------------ report

let failed = 0;
for (const result of results) {
  if (!result.pass) failed++;
  console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
