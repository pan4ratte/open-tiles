/**
 * The search: what it matches, and where it puts itself.
 *
 * What can quietly go wrong here:
 *
 *   - the folding is dropped or half done, so a search is suddenly case
 *     sensitive, or "cafe" stops finding Café. Neither throws; the tile is
 *     simply not there, which reads as the tile having gone.
 *   - the address stops being searched, or the name does. Half the field's
 *     job goes with it and nothing says so.
 *   - a word typed second stops having to be found, so every extra word makes
 *     the answer wider instead of narrower.
 *   - the field and the chips stop being the two halves of one block: both on
 *     screen at once, or the one being put away still drawn - `display: flex`
 *     in the stylesheet outranks the browser's own rule for [hidden], so the
 *     one being hidden has to be told again.
 *   - the search reaches only the group being read, which is the one thing it
 *     is there not to do.
 *
 * The matcher is lifted out of the real newtab.js and run here against stubs,
 * the way the menu builders are in page.test.js.
 *
 *   node test/search.test.js [path/to/src]
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

// ----------------------------------------------------------- the matcher

/* Lifted whole out of newtab.js: the folding, and the answer it is asked for.
   `query` is the one thing they read that is not their own - the page holds it
   in a variable the field writes, and here it is handed in, one build per
   search. */
const from = '  const fold = text => String(text)';
const to = '    return query.split(/\\s+/).every(word => hay.includes(word));\n  }';

const start = js.indexOf(from);
const end = js.indexOf(to, start);
if (start < 0 || end < 0) throw new Error('the matcher has moved - update this test');
const block = js.slice(start, end + to.length);

// The page's own, which is what a tile with no name of its own shows.
const defaultTitle = url => new URL(url).hostname.replace(/^www\./, '');

const build = new Function('defaultTitle', 'query',
  block + '\n; return { fold, matchesQuery };');

const { fold } = build(defaultTitle, '');

const TILES = {
  github: { title: 'GitHub', url: 'https://github.com/' },
  news: { title: 'Hacker News', url: 'https://news.ycombinator.com/' },
  mdn: { title: '', url: 'https://developer.mozilla.org/en-US/docs/Web/CSS' },
  cafe: { title: 'Café Central', url: 'https://cafe-central.at/' }
};

/** The tiles a search finds, by the name this test knows them under. */
function found(typed) {
  const { matchesQuery } = build(defaultTitle, fold(typed.trim()));
  return Object.entries(TILES)
    .filter(([, tile]) => matchesQuery(tile))
    .map(([name]) => name)
    .join(', ') || '(none)';
}

check('a name is searched', found('hacker') === 'news', found('hacker'));

check('and so is the address', found('ycombinator') === 'news', found('ycombinator'));

check('capitals make no difference either way',
  found('GITHUB') === 'github' && found('github') === 'github');

/* Somebody thinking of the site as "cafe" has to find it, and on a keyboard
   that cannot easily make the accent it is the only way they will. */
check('the marks over letters are folded away',
  found('cafe') === 'cafe', found('cafe'));

check('and typing them still works',
  found('Café') === 'cafe', found('Café'));

/* An address is mostly one long word, and a match that had to start one would
   never find a path inside it. */
check('a match may be anywhere in the word, not only at its front',
  found('hub') === 'github', found('hub'));

check('a tile with no name of its own is found by the host standing in for it',
  found('developer.mozilla') === 'mdn', found('developer.mozilla'));

check('every word has to be found, so a second word narrows the answer',
  found('css docs') === 'mdn', found('css docs'));

check('and the words may be found in either half, in any order',
  found('mdn') === '(none)' && found('docs mozilla') === 'mdn',
  found('docs mozilla'));

check('a word nothing carries finds nothing',
  found('github zzz') === '(none)', found('github zzz'));

check('runs of space between words are not words of their own',
  found('css   docs') === 'mdn', found('css   docs'));

// ------------------------------------------------- reaching past the group

/* The reason to type at all is not remembering which group a tile was filed
   in, so the group filter is asked only when nothing is typed. */
const view = js.slice(js.indexOf('function tilesInView()'));

check('a search is asked before the group is',
  /const shown = query\s*\n\s*\? here\.filter\(matchesQuery\)/.test(view),
  'and the group filter is the else');

/* An archived tile is not on the page, so a search of the page must not turn
   one up - and taking the archive off after the search would do exactly that. */
check('and the archive comes off before either of them',
  /const here = tiles\.filter\(onPage\);/.test(view)
    && view.indexOf('const here =') < view.indexOf('const shown ='),
  'a tile that has been put away is not something a search can find');

check('the field emptying puts the group that was being read back',
  view.includes(': activeGroup'),
  'query is the whole condition, so an empty one falls through to the group');

// --------------------------------------------------------- the two halves

check('the field lives inside the block, where the chips are',
  /<nav class="groupbar"[\s\S]*?id="search"[\s\S]*?<\/nav>/.test(html),
  'the block is what knows where it stands - a pill, a bar, or set in the page');

check('both halves are drawn the same way, so the field arrives where the chips were',
  /class="groupbar__inner groupbar__search"/.test(html));

/* `display: flex` on .groupbar__inner outranks the browser's own [hidden]
   rule, so the half being put away would go on being drawn. */
check('the half being put away is actually put away',
  css.includes('.groupbar__inner[hidden] { display: none; }'));

check('one of the two is always the one on screen',
  /groupChips\.hidden = true;[\s\S]{0,80}searchBar\.hidden = false;/.test(js)
    && /searchBar\.hidden = true;[\s\S]{0,80}groupChips\.hidden = false;/.test(js));

/* With no groups and the + turned off the block holds nothing and is taken off
   the page - but a search is something in it, whether or not a group has ever
   been made. */
check('a search brings the block back even when there are no chips for it',
  /function settleGroupBar\(\) \{\s*\n\s*groupBar\.hidden = !searching\(\)/.test(js));

check('and the chips ask that same question rather than answering it again',
  (js.match(/settleGroupBar\(\)/g) || []).length >= 3,
  'renderGroups, and both ends of the search');

// ------------------------------------------------------------ the way out

check('Escape closes the search, after every dialog standing in front of it',
  /closeDialog\(modal\);\s*\n(\s*\/\/[^\n]*\n)*\s*else closeSearch\(\);/.test(js),
  'a search is what the page is showing, not something over it');

check('the button says whether it is on',
  html.includes('id="btnSearch"') && html.includes('aria-pressed="false"')
    && js.includes("btnSearch.setAttribute('aria-pressed', 'true')")
    && js.includes("btnSearch.setAttribute('aria-pressed', 'false')"));

check('and the stylesheet draws that state',
  css.includes('.toolbar .toolbtn[aria-pressed="true"]'));

/* Turning the gear off used to take the whole corner with it, which would now
   take the search with it too. */
check('either button can be taken off the page without the other',
  css.includes('body.no-toolbar #btnSettings { display: none; }')
    && css.includes('body.no-search #btnSearch { display: none; }'),
  'two settings, two buttons');

check('the field is never wider than the block that holds it',
  /\.search__field \{[\s\S]*?flex: 0 1 220px/.test(css)
    && /\.search__field \{[\s\S]*?min-width: 0/.test(css),
  'a status bar hands its row the whole window; the field must not take it');

// ------------------------------------------------------------------ report

let failed = 0;
for (const result of results) {
  if (!result.pass) failed++;
  console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
