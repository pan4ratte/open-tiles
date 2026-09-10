/**
 * Guards Firefox Sync: the same tiles, groups and settings on every computer.
 *
 * Sync is the one part of the add-on that can lose somebody's tiles on a
 * computer they are not even looking at, and it would do it quietly - the
 * page that did the damage looks perfectly fine. So the checks here run
 * several computers at once, each with the real i18n.js, schema.js, storage.js
 * and sync.js in a sandbox of its own, and a stand-in for the Firefox Sync
 * server between them that behaves the way Firefox documents: every so often
 * each computer takes what changed on the server - the server's copy winning
 * over one changed here - and sends what changed here.
 *
 * What can quietly go wrong here:
 *
 *   - a computer that has only just been set up sends its empty page and
 *     wipes the account.
 *   - two computers each change something before they next hear from each
 *     other, and one of the changes is lost.
 *   - two computers set up alike before there was sync end up with every tile
 *     twice.
 *   - something that cannot travel (a large picture) is re-sent forever, each
 *     computer "correcting" the other in turn - a loop that never shows on
 *     the page and eats the allowance.
 *   - the allowance runs out and the merge throws instead of saying so.
 *   - a setting that belongs to one computer - the site-access permission,
 *     or the switch for sync itself - is carried to the others.
 *
 *   node test/sync.test.js [path/to/src]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const { El, document } = require('./dom-shim');

const SRC = process.argv[2] || path.join(__dirname, '..', 'src');
const read = file => fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');

// ------------------------------------------------------------------ harness

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const clone = value => (value === undefined ? undefined : structuredClone(value));

/** One clock for every computer, so their times can be compared - and so a test can move it. */
const clock = { now: Date.parse('2026-09-01T09:00:00Z') };
const DAY = 24 * 60 * 60 * 1000;

const QUOTA = 102400;
const PER_KEY = 8192;
const size = (key, value) => Buffer.byteLength(key + JSON.stringify(value));

/**
 * A storage area. The sync one enforces Firefox's quota the way Firefox does,
 * by refusing the whole write, and remembers which keys were changed here
 * since this computer last synced.
 */
function makeArea(name, disk, fire, counts, dirty) {
  function pick(keys) {
    if (keys === null || keys === undefined) return clone(disk);
    const out = {};
    (Array.isArray(keys) ? keys : [keys]).forEach(key => {
      if (key in disk) out[key] = clone(disk[key]);
    });
    return out;
  }

  return {
    async get(keys) {
      return pick(keys);
    },
    async set(pairs) {
      if (dirty) {
        const after = { ...disk, ...pairs };
        const sizes = Object.entries(after).map(([key, value]) => size(key, value));
        if (sizes.some(n => n > PER_KEY) || sizes.reduce((a, b) => a + b, 0) > QUOTA) {
          throw new Error('QuotaExceededError: storage.sync API call exceeded its quota limitations.');
        }
      }
      const changes = {};
      Object.entries(pairs).forEach(([key, value]) => {
        changes[key] = { oldValue: clone(disk[key]), newValue: clone(value) };
        disk[key] = clone(value);
        counts[name] = (counts[name] || 0) + 1;
        counts[name + ':' + key] = (counts[name + ':' + key] || 0) + 1;
        if (dirty) dirty.add(key);
      });
      fire(changes, name);
    },
    async remove(keys) {
      const changes = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(key => {
        if (!(key in disk)) return;
        changes[key] = { oldValue: clone(disk[key]), newValue: undefined };
        delete disk[key];
        counts[name] = (counts[name] || 0) + 1;
        if (dirty) dirty.add(key);
      });
      fire(changes, name);
    }
  };
}

/** A computer: its own storage, its own copy of the add-on's modules. */
function makeDevice(label, { os = 'win' } = {}) {
  const listeners = [];
  const fire = (changes, area) => {
    if (!Object.keys(changes).length) return;
    setTimeout(() => listeners.forEach(fn => fn(changes, area)), 0);
  };

  const local = {};
  const mailbox = { disk: {}, dirty: new Set(), known: new Map() };
  const counts = {};

  const sandbox = {
    console,
    document,
    setTimeout,
    clearTimeout,
    TextEncoder,
    crypto: { randomUUID: () => label + '-' + Math.random().toString(36).slice(2, 10) },
    __now: () => ++clock.now,
    browser: {
      storage: {
        local: makeArea('local', local, fire, counts, null),
        sync: makeArea('sync', mailbox.disk, fire, counts, mailbox.dirty),
        onChanged: { addListener: fn => listeners.push(fn) }
      },
      runtime: { getPlatformInfo: async () => ({ os }) }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext('Date.now = () => __now();', sandbox);
  for (const file of ['i18n.js', 'schema.js', 'storage.js', 'sync.js']) {
    vm.runInContext(read(file), sandbox, { filename: file });
  }

  const device = {
    label,
    local,
    mailbox,
    counts,
    fire,
    Schema: vm.runInContext('Schema', sandbox),
    Store: vm.runInContext('Store', sandbox),
    Sync: vm.runInContext('Sync', sandbox),
    start() {
      return device.Sync.start({ delays: { local: 5, remote: 5 } });
    }
  };
  return device;
}

/** The Firefox Sync server: per key, the latest copy, and a counter to order them. */
function makeCloud() {
  const server = new Map();
  let version = 0;

  return {
    server,
    get version() { return version; },
    /** One sync of one computer: take what is new on the server, then send what is new here. */
    sync(device) {
      const box = device.mailbox;
      const incoming = {};

      for (const [key, entry] of server) {
        if ((box.known.get(key) || 0) >= entry.version) continue;
        incoming[key] = { oldValue: clone(box.disk[key]), newValue: clone(entry.value) };
        if (entry.value === undefined) delete box.disk[key];
        else box.disk[key] = clone(entry.value);
        box.known.set(key, entry.version);
        box.dirty.delete(key);
      }

      for (const key of box.dirty) {
        const entry = { value: clone(box.disk[key]), version: ++version };
        server.set(key, entry);
        box.known.set(key, entry.version);
      }
      box.dirty.clear();

      device.fire(incoming, 'sync');
    }
  };
}

/** Lets every computer finish whatever merging it has been set off on. */
async function quiet(devices) {
  for (let pass = 0; pass < 3; pass++) {
    await wait(15);
    for (const device of devices) await device.Sync.idle();
  }
}

/** Some rounds of Firefox syncing every computer in turn. */
async function rounds(cloud, devices, n = 4) {
  await quiet(devices);
  for (let i = 0; i < n; i++) {
    for (const device of devices) {
      cloud.sync(device);
      await quiet(devices);
    }
  }
}

/** Everything that should be the same everywhere, as one string. */
function view(device) {
  const { local, Schema } = device;
  const tiles = (local.tiles || []).map(tile => [
    tile.id, tile.url, tile.title, tile.groupId, tile.iconColor, tile.bg,
    tile.pad, tile.round, tile.showLabel, tile.archivedAt
  ]);
  const groups = (local.groups || []).map(group => [group.id, group.name]);
  const settings = Schema.coerce(local.settings);
  const synced = Schema.SYNCED.map(key => [key, settings[key]]);
  const bg = local.background === undefined ? 'untouched'
    : local.background && [local.background.src, local.background.name];
  return JSON.stringify({ tiles, groups, synced, bg });
}

const urls = device => (device.local.tiles || []).map(tile => tile.url);

function tile(id, url, extra = {}) {
  return { id, url, title: url.replace(/^https?:\/\//, ''), groupId: null, icon: '', ...extra };
}

const bytesOf = device => Object.entries(device.mailbox.disk)
  .reduce((sum, [key, value]) => sum + size(key, value), 0);

// ------------------------------------------------------------------ the scenarios

(async () => {
  // ----------------------------------------------- a new computer is filled in

  {
    const cloud = makeCloud();
    const a = makeDevice('a');
    const b = makeDevice('b');

    await a.Store.saveGroups([{ id: 'g-work', name: 'Work' }, { id: 'g-news', name: 'News' }]);
    await a.Store.save([
      tile('t1', 'https://github.com', { groupId: 'g-work' }),
      tile('t2', 'https://en.wikipedia.org'),
      tile('t3', 'https://lobste.rs', { groupId: 'g-news', iconColor: '#ff6600' })
    ]);
    await a.Store.saveSettings({ theme: 'dark', accent: '#ff2d55', deepIcons: false });
    await a.Store.saveBackground({ src: 'backgrounds/susk-i.jpg', name: 'Susk _i', type: 'image' });

    await a.start();
    await b.start();
    const beforeA = view(a);
    await rounds(cloud, [a, b]);

    check('a computer set up from nothing gets every tile, in order',
      urls(b).join(' ') === urls(a).join(' ') && urls(b).length === 3, urls(b).join(' '));
    check('and the groups, and which tile is in which',
      JSON.stringify(b.local.groups) === JSON.stringify(a.local.groups)
        && b.local.tiles[0].groupId === 'g-work' && b.local.tiles[2].iconColor === '#ff6600');
    check('and the settings',
      b.local.settings.theme === 'dark' && b.local.settings.accent === '#ff2d55');
    check('and a packaged background',
      b.local.background && b.local.background.src === 'backgrounds/susk-i.jpg',
      JSON.stringify(b.local.background));
    check('an empty computer joining takes nothing away from the account',
      view(a) === beforeA);
    check('the two now agree on everything', view(a) === view(b));
    check('the site-access permission is not carried: it is granted per computer',
      a.local.settings.deepIcons === false && b.local.settings.deepIcons === true);
    check('what arrived is said to have arrived, and when',
      b.Sync.status().when !== b.Sync.status().when.replace(/\d/g, '')
        && a.Sync.status().line === null,
      b.Sync.status().when);

    // ------------------------------------------ an edit on either side lands

    const tilesB = clone(b.local.tiles);
    tilesB[0].title = 'Code';                                  // renamed
    tilesB.splice(1, 1);                                        // deleted
    const moved = tilesB.pop();                                 // moved to the front
    tilesB.unshift(moved);
    tilesB.push(tile('t4', 'https://news.ycombinator.com'));    // added
    await b.Store.save(tilesB);
    await a.Store.saveSettings({ ...a.local.settings, accent: '#34c759' });
    await rounds(cloud, [a, b]);

    check('a rename, a deletion, a move and a new tile all reach the other computer',
      urls(a).join(' ') === 'https://lobste.rs https://github.com https://news.ycombinator.com'
        && a.local.tiles[1].title === 'Code',
      urls(a).join(' '));
    check('while a change made there at the same time comes back the other way',
      b.local.settings.accent === '#34c759' && view(a) === view(b));

    // ---------------------------------------------- the same moment, twice over

    await a.Store.save([...clone(a.local.tiles), tile('tx', 'https://example.org/a')]);
    await b.Store.save([...clone(b.local.tiles), tile('ty', 'https://example.org/b')]);
    await rounds(cloud, [a, b]);

    check('a tile added on each computer before they next speak ends up on both',
      urls(a).includes('https://example.org/a') && urls(a).includes('https://example.org/b')
        && view(a) === view(b),
      urls(a).join(' '));

    const orderA = clone(a.local.tiles);
    orderA.push(orderA.shift());                                // first to last, on a
    await a.Store.save(orderA);
    const orderB = clone(b.local.tiles);
    const lastB = orderB.splice(orderB.length - 2, 1)[0];       // another to the front, on b
    orderB.unshift(lastB);
    await b.Store.save(orderB);
    await rounds(cloud, [a, b]);

    check('two tiles moved on two computers at once are both where they were put',
      a.local.tiles[0].id === lastB.id
        && a.local.tiles[a.local.tiles.length - 1].id === orderA[orderA.length - 1].id
        && view(a) === view(b),
      a.local.tiles.map(tl => tl.id).join(' '));

    const editB = clone(b.local.tiles).map(tl => (tl.id === 't1' ? { ...tl, title: 'Older edit' } : tl));
    await b.Store.save(editB);
    await quiet([a, b]);
    await a.Store.save(clone(a.local.tiles).filter(tl => tl.id !== 't1'));
    await rounds(cloud, [a, b]);

    check('a deletion made after an edit elsewhere wins over it',
      !urls(a).includes('https://github.com') && !urls(b).includes('https://github.com'));

    // ----------------------------------------------------- what stays behind

    const writes = () => (a.counts.sync || 0) + (b.counts.sync || 0);
    const before = writes();
    const visited = clone(a.local.tiles);
    visited[0].visits = 41;
    await a.Store.save(visited);
    await rounds(cloud, [a, b]);

    check('a visit counted is not a sync', writes() === before, (writes() - before) + ' writes');
    check('and each computer keeps its own count',
      a.local.tiles[0].visits === 41 && b.local.tiles.find(tl => tl.id === visited[0].id).visits === 0);

    // -------------------------------------------------------- switched off

    await b.Store.saveSettings({ ...b.local.settings, sync: false });
    await quiet([a, b]);
    await a.Store.saveSettings({ ...a.local.settings, theme: 'light' });
    await b.Store.save([...clone(b.local.tiles), tile('tz', 'https://only-on-b.example')]);
    await rounds(cloud, [a, b]);

    check('switched off, a computer takes nothing from the account',
      b.local.settings.theme === 'dark', b.local.settings.theme);
    check('and sends nothing to it', !urls(a).includes('https://only-on-b.example'));
    check('and forgets it ever merged, so that switching back on is joining again',
      b.local.syncState === undefined);
    check('the switch itself stays on the computer it was flipped on',
      a.local.settings.sync === true);

    await b.Store.saveSettings({ ...b.local.settings, sync: true });
    await rounds(cloud, [a, b]);

    check('switched back on, what it gathered meanwhile is added to the account',
      urls(a).includes('https://only-on-b.example'));
    check('and the account\'s settings are what it comes back to',
      b.local.settings.theme === 'light' && view(a) === view(b));

    // --------------------------------------------------------- nothing churns

    const settled = { sync: writes(), local: (a.counts.local || 0) + (b.counts.local || 0) };
    await rounds(cloud, [a, b], 3);
    check('once two computers agree, nothing more is written anywhere',
      writes() === settled.sync
        && (a.counts.local || 0) + (b.counts.local || 0) === settled.local,
      (writes() - settled.sync) + ' to the mailbox, '
        + ((a.counts.local || 0) + (b.counts.local || 0) - settled.local) + ' to storage.local');

    // ------------------------------------------------- deletions are forgotten

    const gone = a.local.tiles[0].id;
    await a.Store.save(clone(a.local.tiles).slice(1));
    await rounds(cloud, [a, b]);
    const holds = device => JSON.stringify(device.mailbox.disk).includes('"' + gone + '"');
    const heldAtFirst = holds(a);
    clock.now += 91 * DAY;
    await a.Store.saveSettings({ ...a.local.settings, gap: 20 });
    await rounds(cloud, [a, b]);

    check('a deletion is remembered, and forgotten once every computer has had months to hear it',
      heldAtFirst && !holds(a) && !holds(b));
  }

  // ------------------------------------------- two computers set up alike

  for (const race of [false, true]) {
    const cloud = makeCloud();
    const a = makeDevice('a');
    const b = makeDevice('b');

    await a.Store.saveGroups([{ id: 'a-work', name: 'Work' }]);
    await a.Store.save([
      tile('a1', 'https://github.com', { groupId: 'a-work' }),
      tile('a2', 'https://en.wikipedia.org/')
    ]);
    await a.Store.saveSettings({ theme: 'dark' });

    await b.Store.saveGroups([{ id: 'b-work', name: 'work ' }, { id: 'b-home', name: 'Home' }]);
    await b.Store.save([
      tile('b1', 'https://github.com', { groupId: 'b-work', visits: 7 }),
      tile('b2', 'https://en.wikipedia.org'),
      tile('b3', 'https://news.example', { groupId: 'b-home' })
    ]);
    await b.Store.saveSettings({ theme: 'light' });

    await a.start();
    if (!race) {
      // Firefox has already brought the account down to b by the time the
      // add-on is switched on there - the usual order of things.
      await rounds(cloud, [a]);
      cloud.sync(b);
      await quiet([b]);
    }
    await b.start();
    await rounds(cloud, [a, b]);

    const how = race ? 'both switched on before either heard from the other'
      : 'one joining an account the other already filled';
    check(how + ': no tile is there twice',
      urls(a).length === 3 && urls(b).length === 3 && view(a) === view(b),
      urls(a).join(' '));
    check(how + ': one Work group, and the other groups kept',
      a.local.groups.length === 2 && a.local.groups.some(g => g.name === 'Home'),
      JSON.stringify(a.local.groups));
    check(how + ': the tiles that were filed under Work still are',
      a.local.tiles.filter(tl => tl.url === 'https://github.com')
        .every(tl => a.local.groups.find(g => g.id === tl.groupId)));
    if (!race) {
      check('the account\'s settings win over the ones a joining computer brings',
        b.local.settings.theme === 'dark');
      check('a tile folded into the account\'s keeps this computer\'s visits',
        b.local.tiles.find(tl => tl.url === 'https://github.com').visits === 7);
    }
  }

  // -------------------------------------------------------- one computer's own

  {
    // Two tiles for one site in one group, both brought by the same computer:
    // somebody made them, and no other computer is involved in the decision.
    const cloud = makeCloud();
    const a = makeDevice('a');
    const b = makeDevice('b');
    await a.Store.save([tile('x1', 'https://twice.example'), tile('x2', 'https://twice.example')]);
    await a.start();
    await b.start();
    await rounds(cloud, [a, b]);
    check('two of the same that one computer already had are both kept',
      urls(a).length === 2 && view(a) === view(b));

    await b.Store.saveSettings({ ...b.local.settings, sync: false });
    await quiet([a, b]);
    await b.Store.saveSettings({ ...b.local.settings, sync: true });
    await rounds(cloud, [a, b]);
    check('and still both after sync is switched off and on again',
      urls(a).length === 2 && urls(b).length === 2 && view(a) === view(b), urls(b).join(' '));
  }

  for (const race of [false, true]) {
    // One computer had the site once, the other twice: the pair is one tile,
    // and the second of the two is a second tile.
    const cloud = makeCloud();
    const a = makeDevice('a');
    const b = makeDevice('b');
    await a.Store.save([tile('a1', 'https://github.com')]);
    await b.Store.save([tile('b1', 'https://github.com'), tile('b2', 'https://github.com')]);
    await a.start();
    if (!race) {
      await rounds(cloud, [a]);
      cloud.sync(b);
      await quiet([b]);
    }
    await b.start();
    await rounds(cloud, [a, b]);
    check((race ? 'switched on together' : 'joining') + ': a site one computer had twice is still there twice',
      urls(a).length === 2 && view(a) === view(b), urls(a).join(' '));
  }

  // ------------------------------------------------------- pictures that stay

  {
    const cloud = makeCloud();
    const a = makeDevice('a');
    const b = makeDevice('b');

    const small = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const big = 'data:image/png;base64,' + 'A'.repeat(20000);
    await a.Store.save([
      tile('p1', 'https://small.example', { icon: small }),
      tile('p2', 'https://big.example', { icon: big })
    ]);
    const photo = 'data:image/jpeg;base64,' + 'B'.repeat(50000);
    await a.Store.saveBackground({ src: photo, name: 'holiday.jpg', type: 'image' });

    await a.start();
    await b.start();
    await rounds(cloud, [a, b]);

    const onB = id => b.local.tiles.find(tl => tl.id === id);
    check('a small picture of a tile\'s own travels with it', onB('p1').icon === small);
    check('a large one stays home, and the tile arrives looking its site up',
      onB('p2').icon === '' && a.local.tiles[1].icon === big);
    check('a photograph for a background stays home too',
      b.local.background === undefined && a.local.background.src === photo);
    check('nothing that big ever reaches the mailbox', bytesOf(a) < 8000, bytesOf(a) + ' bytes');

    // b gives the same tile a large picture of its own; a still cannot have it.
    const other = 'data:image/png;base64,' + 'C'.repeat(20000);
    await b.Store.save(clone(b.local.tiles).map(tl => (tl.id === 'p2' ? { ...tl, icon: other } : tl)));
    await rounds(cloud, [a, b]);

    const settled = (a.counts.sync || 0) + (b.counts.sync || 0) + (a.counts.local || 0) + (b.counts.local || 0);
    await rounds(cloud, [a, b], 3);
    const after = (a.counts.sync || 0) + (b.counts.sync || 0) + (a.counts.local || 0) + (b.counts.local || 0);

    check('each computer keeps its own large picture for a tile',
      a.local.tiles[1].icon === big && onB('p2').icon === other);
    check('and they do not go on "correcting" each other about it',
      after === settled, (after - settled) + ' writes after they settled');
  }

  // ------------------------------------------------------------ the allowance

  {
    const cloud = makeCloud();
    const a = makeDevice('a');
    const b = makeDevice('b');

    // Every picture small enough to travel alone, and far too many together.
    const icon = n => 'data:image/svg+xml,' + String(n).padStart(4, '0') + 'x'.repeat(1900);
    await a.Store.save(Array.from({ length: 60 }, (_, n) => tile('i' + n, 'https://site' + n + '.example', { icon: icon(n) })));
    await a.start();
    await b.start();
    await rounds(cloud, [a, b]);

    check('when the pictures will not all fit, the tiles go without them',
      urls(b).length === 60 && b.local.tiles.every(tl => tl.icon === '')
        && a.local.tiles.every((tl, n) => tl.icon === icon(n)) && a.Sync.status().line === null,
      bytesOf(a) + ' bytes');

    const c = makeDevice('c');
    await c.Store.save(Array.from({ length: 1200 }, (_, n) =>
      tile('many' + n, 'https://a-rather-long-address-for-a-site.example/number/' + n)));
    let threw = null;
    try {
      await c.start();
    } catch (err) {
      threw = err;
    }
    const said = c.Sync.status().line;

    check('when the tiles themselves will not fit, the merge says so rather than throwing',
      !threw && said && said.kind === 'error' && said.text === c.Sync.status().line.text,
      threw ? threw.message : JSON.stringify(said));
    check('and writes nothing Firefox would refuse', !(c.counts.sync > 0), String(c.counts.sync));
    check('and keeps every tile on the computer it is on', urls(c).length === 1200);
  }

  // ------------------------------------------------------------ too many groups

  {
    const cloud = makeCloud();
    const a = makeDevice('a');
    const b = makeDevice('b');
    await a.Store.saveGroups(Array.from({ length: 20 }, (_, n) => ({ id: 'ga' + n, name: 'A' + n })));
    await b.Store.saveGroups(Array.from({ length: 20 }, (_, n) => ({ id: 'gb' + n, name: 'B' + n })));
    await a.start();
    await b.start();
    await rounds(cloud, [a, b]);

    check('two computers\' groups together are held to what the page has room for',
      a.local.groups.length === a.Store.MAX_GROUPS && view(a) === view(b),
      a.local.groups.length + ' groups');
  }

  // ------------------------------------------------ from a newer version

  {
    const cloud = makeCloud();
    const a = makeDevice('a');
    cloud.server.set('v1.s', { value: { futureThing: [clock.now, 'on'] }, version: 1 });
    cloud.server.set('v2.everything', { value: { whatever: true }, version: 2 });
    await a.start();
    await rounds(cloud, [a]);

    check('a setting only a newer version knows is carried on for it',
      cloud.server.get('v1.s').value.futureThing
        && cloud.server.get('v1.s').value.futureThing[1] === 'on');
    check('and a key a newer version lays out differently is left alone',
      cloud.server.get('v2.everything').value.whatever === true);
  }

  // ---------------------------------------------- the page hears it too

  {
    const cloud = makeCloud();
    const a = makeDevice('a');
    const b = makeDevice('b');
    const heard = [];
    b.Store.onExternalChange(key => heard.push(key));

    await a.Store.save([tile('h1', 'https://heard.example')]);
    await a.start();
    await b.start();
    await rounds(cloud, [a, b]);

    check('the new tab that merged a change redraws from it like every other',
      heard.includes('tiles'), heard.join(', ') || 'nothing heard');
  }

  // --------------------------------------------------------------- Android

  {
    const phone = makeDevice('phone', { os: 'android' });
    await phone.start();
    await quiet([phone]);
    const line = phone.Sync.status().line;
    check('Firefox for Android is said not to sync, rather than left looking broken',
      line && line.kind === 'info' && /Android/.test(line.text), JSON.stringify(line));
  }

  // --------------------------------------------------------- positions

  {
    const { positions } = makeDevice('p').Sync;
    const had = { a: 1, b: 2, c: 3, d: 4 };
    const moved = positions(['a', 'c', 'd', 'b'], id => had[id], 0);
    check('moving one tile gives only that tile a new place',
      moved[0] === 1 && moved[1] === 3 && moved[2] === 4 && moved[3] > 4, moved.join(', '));

    let ids = ['first', 'last'];
    const at = { first: 1, last: 2 };
    for (let n = 0; n < 80; n++) {
      ids = [ids[0], 'n' + n, ...ids.slice(1)];
      const next = positions(ids, id => at[id], 0);
      ids.forEach((id, k) => { at[id] = next[k]; });
    }
    const values = ids.map(id => at[id]);
    check('tiles pushed into the same gap over and over still come out in order',
      values.every((v, k) => !k || v > values[k - 1]), values.slice(0, 4).join(', '));
  }

  // ------------------------------------------------------- the settings window

  {
    const sandbox = {
      console, document, setTimeout, clearTimeout,
      crypto: { randomUUID: () => 'id' },
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
    for (const file of ['i18n.js', 'schema.js', 'settings.js']) {
      vm.runInContext(read(file), sandbox, { filename: file });
    }
    const Schema = vm.runInContext('Schema', sandbox);
    const SettingsUI = vm.runInContext('SettingsUI', sandbox);

    check('the switch and the site-access permission are the settings that stay home',
      ['sync', 'deepIcons'].every(key => key in Schema.DEFAULTS && !Schema.SYNCED.includes(key))
        && Schema.SYNCED.length === Object.keys(Schema.DEFAULTS).length - 2);

    const body = new El('div');
    SettingsUI.mount(body, {
      values: { ...Schema.DEFAULTS, syncStatus: '11 Sep, 14:05' },
      status: { sync: { kind: 'info', text: 'Something to know' } },
      onChange: async (key, value) => ({ value })
    });
    const row = key => body.find(el => el.dataset && el.dataset.field === key);
    const value = row('syncStatus') && row('syncStatus').find(el => el.className === 'row__value');
    check('the status row shows what the page handed it',
      value && value.textContent === '11 Sep, 14:05');
    const line = row('sync') && row('sync').find(el => /status--info/.test(el.className || ''));
    check('and a line under the switch can be neither good news nor bad',
      line && !line.hidden && line.textContent.includes('Something to know'));

    const off = new El('div');
    SettingsUI.mount(off, {
      values: { ...Schema.DEFAULTS, sync: false, syncStatus: 'x' },
      onChange: async (key, value) => ({ value })
    });
    const hidden = off.find(el => el.dataset && el.dataset.field === 'syncStatus');
    check('with sync off there is no status to show', hidden && hidden.hidden === true);
  }

  // --------------------------------------------------------------- wiring

  {
    const html = read('newtab.html');
    const js = read('newtab.js');
    const at = file => html.indexOf('src="' + file + '"');
    check('sync.js is loaded after the store it writes through, and before the page',
      at('storage.js') > -1 && at('sync.js') > at('storage.js') && at('newtab.js') > at('sync.js'));
    check('the page starts it after it is listening for changes, which is how it hears what arrives',
      js.indexOf('Sync.start(') > js.indexOf('Store.onExternalChange('));
    const manifest = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'manifest.json'), 'utf8'));
    check('the add-on keeps the id Firefox Sync files its data under',
      manifest.browser_specific_settings.gecko.id === 'open-tiles@pan4ratte.github.io'
        && manifest.permissions.includes('storage'));
  }

  // ------------------------------------------------------------------ report

  let failed = 0;
  results.forEach(r => {
    if (!r.pass) failed++;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
  });
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
