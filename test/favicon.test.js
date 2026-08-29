/**
 * Guards how sharp a tile's icon comes out.
 *
 * What can go quietly wrong here - and did, which is why this file exists:
 *
 *   - probing stops at the first icon that clears the bar, and the bar is set
 *     below what a tile actually needs. A site publishing both a 180px
 *     apple-touch-icon and a 512px one hands over the 180, and nothing
 *     anywhere reports a problem: the tile is simply soft.
 *   - a vector is rasterized on the way into the cache. An SVG kept as a
 *     bitmap is the one case where keeping the picture makes it worse than
 *     not keeping it, and it is then held in that state for a month.
 *   - the kept copy is redrawn smaller than the tile will draw it.
 *   - a better lookup ships and nobody sees it, because every origin already
 *     has a cached answer that stays fresh for thirty days. That is what REV
 *     is for.
 *
 * Runs the real favicons.js against stand-ins for the network, for <img>
 * probing and for storage - no browser. Deep lookup is left out of it: it
 * needs an HTML parser, and everything tested here sits underneath it.
 *
 *   node test/favicon.test.js [path/to/src]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '..', 'src');
/* Source is read with its line endings normalised. Several checks below find
   a run of code by its first and last lines and lift what is between them,
   and those markers are written here with plain newlines - on a checkout with
   CRLF endings they would match nothing and the test would fail on the line
   endings rather than on the code. */
const read = file => fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');

const source = read('favicons.js');

// ------------------------------------------------------------------ harness

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

/**
 * A constant out of the source, `40 * 1024` and all.
 *
 * The multiplier is the difference between a byte count and a kilobyte one,
 * and dropping it makes a size test pass without ever reaching the branch it
 * was written to cover.
 */
function number(text, name) {
  const hit = text.match(new RegExp(name + String.raw` = (\d+)(\s*\*\s*(\d+))?`));
  if (!hit) throw new Error(name + ' is no longer in favicons.js');
  return Number(hit[1]) * (hit[3] ? Number(hit[3]) : 1);
}

// ------------------------------------------------------------- the network

/** url -> pixel size, for whatever the site is pretending to publish. */
let published = {};
/** url -> byte length of the file behind it. */
let weights = {};
/** Everything asked for, so a test can see what was probed and in what order. */
let asked = [];
/** Requests whose options said to go past the browser's cache. */
let reloaded = [];

class FakeImage {
  set src(url) {
    if (!url) return;
    asked.push(url);
    const size = published[url];
    // A tick later, the way a real load answers.
    setTimeout(() => {
      if (size === undefined) {
        if (this.onerror) this.onerror();
        return;
      }
      // Firefox reports 0 for an SVG with no intrinsic size; favicons.js is
      // meant to score it as a vector rather than measure it.
      this.naturalWidth = /\.svg/.test(url) ? 0 : size;
      this.naturalHeight = this.naturalWidth;
      if (this.onload) this.onload();
    }, 0);
  }
}

const blobFor = url => ({
  size: weights[url] === undefined ? 1000 : weights[url],
  type: /\.svg/.test(url) ? 'image/svg+xml' : 'image/png',
  url
});

async function fakeFetch(url, opts = {}) {
  asked.push(url);
  if (opts.cache === 'reload') reloaded.push(url);
  if (published[url] === undefined) return { ok: false };
  return {
    ok: true,
    url,
    async text() { return ''; },
    async blob() { return blobFor(url); }
  };
}

// -------------------------------------------------------------- the sandbox

const stored = new Map();

/** What the canvas said it wrote, so a test can tell a redraw from a keep. */
let drawnAt = null;

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  // A vm context has no URL of its own, and resolve() gives up without one.
  URL,
  Image: FakeImage,
  fetch: fakeFetch,
  AbortController: class { constructor() { this.signal = {}; } abort() {} },
  FileReader: class {
    readAsDataURL(blob) {
      // Stands in for the real thing byte for byte: what matters to the tests
      // is the type it carries and that it was not redrawn.
      this.result = `data:${blob.type};base64,` + 'A'.repeat(Math.ceil(blob.size * 4 / 3));
      setTimeout(() => this.onload(), 0);
    }
  },
  createImageBitmap: async blob => ({ width: 512, height: 512, close() {}, blob }),
  document: {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
      toDataURL(type) {
        drawnAt = Math.max(this.width, this.height);
        return `data:${type === 'image/webp' ? 'image/webp' : 'image/png'};base64,AAAA`;
      }
    })
  },
  Store: {
    icons: {
      async get(id) { return stored.get(id); },
      async put(id, entry) {
        stored.set(id, { ...entry, savedAt: Date.now() });
        return stored.get(id);
      },
      async clear() { stored.clear(); }
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'favicons.js' });

const Favicons = vm.runInContext('Favicons', sandbox);

function reset() {
  published = {};
  weights = {};
  asked = [];
  reloaded = [];
  drawnAt = null;
  stored.clear();
}

// ---------------------------------------------------------- the numbers

const KEEP_DIM = number(source, 'KEEP_DIM');
const GOOD_SIZE = number(source, 'GOOD_SIZE');
const KEEP_MAX = number(source, 'KEEP_MAX');
const KEEP_DIRECT = number(source, 'KEEP_DIRECT');
const REV = number(source, 'REV');

// A tile is at most 200px wide less its inset, on a screen that may be 2x.
const NEEDED = 344;

check('the kept copy is redrawn no smaller than the largest tile draws it',
  KEEP_DIM >= NEEDED, `${KEEP_DIM}px kept, ${NEEDED}px needed`);

check('probing does not stop before it has something that size either',
  GOOD_SIZE * 2 >= NEEDED, `stops at ${GOOD_SIZE}px, doubled for a 2x screen`);

check('there is room to store what that redraw produces',
  KEEP_MAX > KEEP_DIRECT, `${KEEP_MAX} to keep, ${KEEP_DIRECT} kept whole`);

check('a revision is stamped on what is cached', REV >= 2, String(REV));

// --------------------------------------------------------------- the waves

const waves = source.slice(source.indexOf('const WAVES'), source.indexOf('const ICON_RELS'));
const firstWave = waves.slice(0, waves.indexOf('],'));

check('the first wave asks for a vector before anything else',
  firstWave.includes('/favicon.svg'), firstWave.replace(/\s+/g, ' ').trim());

check('and for the large bitmaps, not only the small ones',
  firstWave.includes('/android-chrome-512x512.png'),
  firstWave.replace(/\s+/g, ' ').trim());

check('the 32px fallbacks are left for the last wave',
  !firstWave.includes('favicon-32x32'), firstWave.replace(/\s+/g, ' ').trim());

// ------------------------------------------------------------------- run

(async () => {
  // ------------------------------------- the largest one wins, not the first

  reset();
  // A site with both: the 180 sits in wave one, the 512 in wave two.
  published['https://a.example/apple-touch-icon.png'] = 180;
  published['https://a.example/android-chrome-512x512.png'] = 512;
  weights['https://a.example/android-chrome-512x512.png'] = 90 * 1024;

  let found = await Favicons.resolve('https://a.example/page');
  check('a 512px icon is preferred to the 180px one found first',
    found && found.size === 512, JSON.stringify(found && found.size));

  // ------------------------------------------- and probing goes on to find it

  reset();
  published['https://b.example/apple-touch-icon.png'] = 180;
  published['https://b.example/icon-512x512.png'] = 512;

  found = await Favicons.resolve('https://b.example/page');
  check('finding a 180px icon is not good enough to stop looking',
    asked.some(url => url.includes('icon-512x512')),
    `${asked.length} addresses tried`);
  check('so the larger one further down is the one that wins',
    found && found.size === 512, JSON.stringify(found && found.size));

  // ---------------------------------------------- a vector beats a big bitmap

  reset();
  published['https://c.example/favicon.svg'] = 0;
  published['https://c.example/android-chrome-512x512.png'] = 512;
  weights['https://c.example/favicon.svg'] = 4 * 1024;

  found = await Favicons.resolve('https://c.example/page');
  check('a vector is taken over even the largest bitmap',
    found && found.url.startsWith('data:image/svg+xml'), String(found && found.url).slice(0, 40));

  // ------------------------------------------ and is never redrawn to keep it

  reset();
  // Over KEEP_DIRECT, which is what used to send it through the canvas.
  published['https://d.example/favicon.svg'] = 0;
  weights['https://d.example/favicon.svg'] = KEEP_DIRECT + 4000;

  found = await Favicons.resolve('https://d.example/page');
  check('an SVG too big to keep whole is still not rasterized',
    drawnAt === null, drawnAt === null ? 'never drawn' : `redrawn at ${drawnAt}px`);
  check('it is kept as the vector it is',
    found && found.url.startsWith('data:image/svg+xml'),
    String(found && found.url).slice(0, 40));

  // An SVG past what storage will hold is not kept at all - and the tile then
  // loads the address, which is the vector too.
  reset();
  published['https://e.example/favicon.svg'] = 0;
  weights['https://e.example/favicon.svg'] = KEEP_MAX * 2;

  found = await Favicons.resolve('https://e.example/page');
  check('one past that is left as an address rather than redrawn',
    found && found.url === 'https://e.example/favicon.svg' && drawnAt === null,
    String(found && found.url));

  // -------------------------------------- a bitmap is redrawn, and at KEEP_DIM

  reset();
  published['https://f.example/android-chrome-512x512.png'] = 512;
  weights['https://f.example/android-chrome-512x512.png'] = 90 * 1024;

  found = await Favicons.resolve('https://f.example/page');
  check('a bitmap too big to keep whole is redrawn at the kept size',
    drawnAt === KEEP_DIM, `redrawn at ${drawnAt}px, KEEP_DIM is ${KEEP_DIM}`);

  // --------------------------------------------------- what the cache serves

  reset();
  published['https://g.example/favicon.png'] = 400;
  weights['https://g.example/favicon.png'] = 2000;

  await Favicons.resolve('https://g.example/page');
  const entry = stored.get('https://g.example');
  check('what is cached carries the revision it was found by',
    entry && entry.rev === REV, JSON.stringify(entry && entry.rev));

  asked = [];
  await Favicons.resolve('https://g.example/page');
  check('a fresh entry is served without asking the network again',
    asked.length === 0, `${asked.length} addresses tried`);

  // The point of the revision: an answer found by an older build is looked up
  // again rather than served for the rest of its month.
  stored.set('https://g.example', { ...entry, rev: REV - 1 });
  asked = [];
  await Favicons.resolve('https://g.example/page');
  check('one found by an older build is looked up again',
    asked.length > 0, `${asked.length} addresses tried`);

  // ------------------------------------------------------ looking again

  reset();
  published['https://h.example/favicon.png'] = 300;
  weights['https://h.example/favicon.png'] = 2000;

  await Favicons.resolve('https://h.example/page');
  asked = [];
  reloaded = [];

  found = await Favicons.resolve('https://h.example/page', { force: true });
  check('forcing goes back to the network even with a fresh answer cached',
    asked.length > 0, `${asked.length} addresses tried`);
  check('and asks past the browser cache for what it fetches',
    reloaded.length > 0, `${reloaded.length} of them past the cache`);
  check('an ordinary lookup does not',
    !reloaded.some(url => !asked.includes(url)), 'only the forced one');

  // ------------------------------------------------- nothing to be found

  reset();
  found = await Favicons.resolve('https://i.example/page');
  check('a site with no icon anywhere reports none rather than throwing',
    found === null, JSON.stringify(found));

  check('and that is remembered too, so it is not retried on every new tab',
    stored.has('https://i.example'));

  // ---------------------------------------------------------------- report

  let failed = 0;
  for (const result of results) {
    if (!result.pass) failed++;
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
