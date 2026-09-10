/**
 * Firefox Sync: the same tiles, groups and settings on every computer the
 * reader is signed in to Firefox on.
 *
 * ## What Firefox gives an add-on
 *
 * `storage.sync`. Firefox carries it through the reader's Mozilla account,
 * end-to-end encrypted, whenever they are signed in and have Add-ons ticked in
 * the Sync settings - and keeps it on this computer and nowhere else when they
 * are not. Nothing tells an add-on which of the two it is: there is no API that
 * says whether anybody is signed in. So there is no "signed in" to show here,
 * only what has arrived from other devices, and when.
 *
 * It is small - 100 KB for the whole add-on, 8 KB a key - and it is slow:
 * Firefox sends and fetches about every ten minutes. Firefox for Android keeps
 * it without ever sending it anywhere.
 *
 * ## What travels
 *
 * Tiles, groups, settings and the background, as long as each fits. A picture
 * stored inline is megabytes, so the background travels only when it is one
 * of the packaged ones or a web address, and a tile's own picture only when it
 * is a small one. What cannot travel stays where it is: a computer handed a
 * tile whose picture could not come keeps the one it already had for it, or
 * looks the site's own up.
 *
 * Kept off it altogether: visit counts (every click would be a sync), the
 * group being looked at, the caches, the list of recent backgrounds, and the
 * settings marked `local` in schema.js.
 *
 * ## How two computers agree
 *
 * storage.local stays the page's store, exactly as before; storage.sync is a
 * mailbox beside it. Every record in the mailbox - a tile, a group, a single
 * setting - carries the time it was last changed, and a deletion is a record
 * too, "gone, as of then", so that it can beat an older copy instead of looking
 * like something that has not arrived yet. Two copies of one record meet and
 * the later one wins; two different records never meet at all, so a tile added
 * on each of two computers ends up on both.
 *
 * Which is why nothing here ever *replaces* what is stored locally with what is
 * in the mailbox. The two are merged record by record and the result written
 * back to both. Firefox's own rule for a key changed in two places at once is
 * that the server's copy wins, which on its own would lose the edit made here -
 * but that edit is still in storage.local, and the next merge puts it back.
 *
 * The page writes storage.local as it always has and is told nothing. Changes
 * are found by comparing what is stored with what was stored after the last
 * merge (`seen`, in `syncState`), and stamped when they are found.
 *
 * The order of the tiles is not a list: each tile carries its own position, so
 * moving one tile on one computer and another on another moves both.
 */
const Sync = (() => {
  const t = I18N.t;

  const STORAGE = (typeof browser !== 'undefined' && browser.storage)
    || (typeof chrome !== 'undefined' && chrome.storage)
    || null;
  const MAILBOX = (STORAGE && STORAGE.sync) || null;
  const HERE = (STORAGE && STORAGE.local) || null;
  const RUNTIME = (typeof browser !== 'undefined' && browser.runtime)
    || (typeof chrome !== 'undefined' && chrome.runtime)
    || null;

  /** Where the last merge is remembered, in storage.local. */
  const STATE = 'syncState';

  /** The storage.local keys whose changes are worth a merge. */
  const WATCHED = ['tiles', 'groups', 'settings', 'background'];

  /**
   * Every key written to storage.sync starts with this. A later version that
   * has to lay the mailbox out differently writes under `v2.` beside it, and
   * nothing here ever touches a key it does not recognise.
   */
  const PREFIX = 'v1.';

  /** Tiles are spread over this many keys, since one key holds only 8 KB. */
  const BUCKETS = 32;

  /** Firefox's limits, in bytes of JSON - key and value together. */
  const QUOTA = 102400;
  const PER_KEY = 8192;
  const HEADROOM = 2048;

  /**
   * The longest a tile's own picture, or a background's address, may be and
   * still travel. A pasted SVG or a web address fits; a photograph does not.
   */
  const CARRY = 2048;

  /** How long a deletion is remembered, so a computer that was away hears it. */
  const KEEP_GONE = 90 * 24 * 60 * 60 * 1000;

  /**
   * How long a change waits before it is merged. A change made here waits
   * longer, so a run of them - a slider being dragged - is one merge.
   */
  const DELAY_LOCAL = 1500;
  const DELAY_REMOTE = 300;

  /** What a picture that did not travel is written as, in place of itself. */
  const MARK = '#';

  /** `seen` for a page that has never chosen a background. */
  const UNTOUCHED = '-';

  // ---------------------------------------------------------------- helpers

  /** FNV-1a: small, fast and the same everywhere - which is all it is for. */
  function hashNum(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  const hash = text => hashNum(String(text)).toString(36);

  /**
   * A value as a string that is the same whatever order its keys were written
   * in - two computers build the same record in different orders, and have to
   * agree that it is the same record.
   */
  function canon(value) {
    if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort()
        .filter(key => value[key] !== undefined)
        .map(key => JSON.stringify(key) + ':' + canon(value[key]))
        .join(',') + '}';
    }
    return JSON.stringify(value === undefined ? null : value);
  }

  const norm = text => String(text).trim().toLowerCase();

  const isMark = value => typeof value === 'string' && value.startsWith(MARK);

  /**
   * Enough of a long string to tell it from another, without reading every
   * character of a picture on every merge. It only has to notice that a
   * picture changed: a picture long enough to be sampled never travels, so
   * nothing is ever rebuilt from this.
   */
  function sample(text) {
    if (text.length <= 4096) return text;
    const step = Math.floor(text.length / 2048);
    let out = '';
    for (let i = 0; i < text.length; i += step) out += text[i];
    return out;
  }

  const mark = text => MARK + text.length + '.' + hash(sample(text));

  const carry = text => (text.length <= CARRY ? text : mark(text));

  const encoder = new TextEncoder();

  const bytes = (key, value) => encoder.encode(key + JSON.stringify(value)).length;

  // ---------------------------------------------------------------- records

  /**
   * A record is `[at, value]` - when it was last changed, and what it is now,
   * or null for gone. A third member names the computer that brought it to an
   * empty mailbox when it first joined, for as long as nobody has touched it
   * since - see `fold`.
   */
  const rec = (at, value, brought) => (brought ? [at, value, brought] : [at, value]);

  const isRec = r => Array.isArray(r) && r.length >= 2 && Number.isFinite(r[0]);

  const sameRec = (a, b) => Boolean(a && b) && a[0] === b[0] && canon(a[1]) === canon(b[1]);

  /**
   * Whether two lists hold the same things. A merge that changed nothing
   * hands back the very objects it was given, so that is looked for first -
   * the whole comparison reads every tile's picture.
   */
  const sameList = (a, b) => (a.length === b.length && a.every((item, i) => item === b[i]))
    || canon(a) === canon(b);

  /**
   * Which of two copies of one record stands. The later one; at the same
   * moment, a deletion over a record; and past that the larger by its text,
   * which says nothing about either except that every computer will pick the
   * same one.
   */
  function later(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    if (a[0] !== b[0]) return a[0] > b[0] ? a : b;
    if ((a[1] === null) !== (b[1] === null)) return a[1] === null ? a : b;
    return canon(a) >= canon(b) ? a : b;
  }

  const placeOf = r => (r && r[1] && Number.isFinite(r[1].o) ? r[1].o : undefined);

  /** The ids of what is still there, in order. */
  const arrange = map => Object.keys(map)
    .filter(id => map[id][1])
    .sort((a, b) => (placeOf(map[a]) - placeOf(map[b])) || (a < b ? -1 : a > b ? 1 : 0));

  /** The furthest position anything in these holds. */
  function highest(...maps) {
    let top = 0;
    maps.forEach(map => Object.values(map).forEach(r => {
      const at = placeOf(r);
      if (at > top) top = at;
    }));
    return top;
  }

  /**
   * The mailbox's contents, as one document:
   *
   *   s  { [setting]: record }
   *   g  { [group id]: record of { n: name, o: position } }
   *   t  { [tile id]: record of the tile - see tileForm }
   *   b  record of the background, or null for one never chosen
   */
  const blank = () => ({ s: {}, g: {}, t: {}, b: null });

  const isEmpty = doc => !doc.b
    && ![doc.s, doc.g, doc.t].some(map => Object.keys(map).length);

  // ------------------------------------------------------------------ forms

  /**
   * A tile as it travels: short keys, and nothing that is only its default,
   * because 100 KB is the whole allowance. `visits` stays behind.
   */
  function tileForm(tile) {
    const v = { u: tile.url };
    if (tile.title) v.n = tile.title;
    if (tile.groupId) v.g = tile.groupId;
    if (tile.icon) v.i = carry(tile.icon);
    if (tile.iconColor) v.c = tile.iconColor;
    if (tile.bg) v.b = tile.bg;
    if (tile.pad !== null && tile.pad !== undefined) v.p = tile.pad;
    if (tile.round) v.r = tile.round;
    if (typeof tile.showLabel === 'boolean') v.l = tile.showLabel;
    if (tile.archivedAt) v.a = tile.archivedAt;
    return v;
  }

  /**
   * A tile back from its travelling form. `mine` is the copy this computer
   * already holds, if any: the visit count is always its, and so is the
   * picture when the one on the record could not come.
   */
  function tileFrom(id, v, mine) {
    return {
      id,
      url: v.u,
      title: v.n || '',
      groupId: v.g || null,
      icon: isMark(v.i) ? (mine ? mine.icon : '') : (v.i || ''),
      iconColor: v.c || '',
      bg: v.b || '',
      pad: v.p === undefined ? null : v.p,
      round: v.r || 0,
      showLabel: typeof v.l === 'boolean' ? v.l : null,
      visits: mine ? mine.visits : 0,
      archivedAt: v.a || 0
    };
  }

  const groupForm = group => ({ n: group.name });

  /**
   * The background as it travels. A picture stored inline is written as a
   * mark - its time and its length - which says that it changed without
   * saying what to.
   */
  function bgForm(record) {
    if (!record) return null;
    const plain = !/^data:/i.test(record.src) && record.src.length <= CARRY;
    return {
      s: plain ? record.src : MARK + (record.savedAt || 0) + '.' + record.src.length,
      n: record.name || '',
      y: record.type
    };
  }

  /** The two things a computer joining can mean by a tile: where and what. */
  const tileKey = v => norm(v.u).replace(/\/+$/, '') + '\n' + (v.g || '') + '\n' + (v.a ? 1 : 0);

  // ------------------------------------------------------------- positions

  /** The indices of the longest strictly rising run through `values`. */
  function rising(values) {
    const tails = [];
    const prev = new Array(values.length).fill(-1);
    values.forEach((value, i) => {
      if (!Number.isFinite(value)) return;
      let lo = 0;
      let hi = tails.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (values[tails[mid]] < value) lo = mid + 1;
        else hi = mid;
      }
      if (lo) prev[i] = tails[lo - 1];
      tails[lo] = i;
    });

    const keep = new Set();
    for (let i = tails.length ? tails[tails.length - 1] : -1; i !== -1; i = prev[i]) keep.add(i);
    return keep;
  }

  /**
   * Where each of `ids` should sit, given where each sat before (`had`),
   * moving as few of them as possible: the longest run that is still in order
   * keeps its places and the rest are fitted in between. Dragging one tile
   * moves one tile's record, which is what lets two computers each move one.
   *
   * `after` is where anything with no neighbour to go by starts from.
   */
  function positions(ids, had, after) {
    const known = ids.map(had);
    const keep = rising(known);
    const out = [];

    let i = 0;
    while (i < ids.length) {
      if (keep.has(i)) {
        out.push(known[i]);
        i++;
        continue;
      }
      let j = i;
      while (j < ids.length && !keep.has(j)) j++;

      const count = j - i;
      const lo = i ? out[i - 1] : null;
      const hi = j < ids.length ? known[j] : null;
      for (let k = 1; k <= count; k++) {
        out.push(lo === null && hi === null ? after + k
          : hi === null ? lo + k
            : lo === null ? hi - (count + 1 - k)
              : lo + (hi - lo) * k / (count + 1));
      }
      i = j;
    }

    // Halved too often: the gaps are down to the last digits a number holds,
    // so the whole list is spaced out again. It costs a record per tile, once.
    const cramped = out.some((at, k) => k && !(at - out[k - 1] > 1e-9));
    return cramped ? ids.map((id, k) => after + k + 1) : out;
  }

  // ------------------------------------------------------------------ stamp

  /**
   * What is stored here, as a document: every record this computer has not
   * changed since the last merge exactly as the merge left it, and every one
   * it has, stamped `now`.
   *
   * A record never seen before is this computer's own contribution. When it
   * is joining, that is everything it held before sync was switched on, and it
   * is stamped `fresh`: the moment of joining when the mailbox was empty, and
   * nothing at all when it was not - so the settings already in the account
   * stand, and what this computer brings is added to them rather than laid
   * over them. A setting new in this version is the same case, and weak for
   * the same reason: a default is not an edit.
   */
  function stamp(here, state, now, { joining, fresh, brought, after }) {
    const base = state.doc;
    const seen = state.seen;
    const doc = blank();

    if (here.settings) {
      Schema.SYNCED.forEach(key => {
        const value = here.settings[key];
        if (seen.s[key] === canon(value)) {
          if (base.s[key]) doc.s[key] = base.s[key];
        } else {
          doc.s[key] = rec(seen.s[key] === undefined ? (joining ? fresh : 0) : now, value);
        }
      });
    }
    // Carried on untouched: a setting a newer version wrote on another
    // computer, and every setting while this one has never saved its own.
    Object.entries(base.s).forEach(([key, r]) => {
      if (!(key in doc.s)) doc.s[key] = r;
    });

    const list = (items, formOf, baseMap, seenMap, from) => {
      const out = {};
      const at = positions(items.map(item => item.id), id => placeOf(baseMap[id]), from);

      items.forEach((item, k) => {
        const form = formOf(item);
        const before = baseMap[item.id];
        const value = { ...form, o: at[k] };

        if (before && before[1] && seenMap[item.id] === canon(form) && before[1].o === at[k]) {
          out[item.id] = before;
        } else if (seenMap[item.id] !== undefined || before) {
          out[item.id] = rec(now, value);
        } else {
          out[item.id] = rec(joining ? fresh : now, value, brought);
        }
      });

      // Something the last merge held and this computer no longer does was
      // deleted here - as long as it ever reached this computer to be deleted.
      Object.entries(baseMap).forEach(([id, r]) => {
        if (id in out) return;
        out[id] = r[1] !== null && id in seenMap ? rec(now, null) : r;
      });
      return out;
    };

    doc.t = list(here.tiles, tileForm, base.t, seen.t, after.t);
    doc.g = list(here.groups, groupForm, base.g, seen.g, after.g);

    if (here.background === undefined) {
      doc.b = base.b;
    } else {
      const form = bgForm(here.background);
      doc.b = seen.b === canon(form) ? base.b : rec(seen.b === undefined ? fresh : now, form);
    }

    return doc;
  }

  // ------------------------------------------------------------------ merge

  function mergeMaps(x, y) {
    const out = {};
    new Set([...Object.keys(x), ...Object.keys(y)]).forEach(key => {
      out[key] = later(x[key], y[key]);
    });
    return out;
  }

  function merge(x, y) {
    return {
      s: mergeMaps(x.s, y.s),
      g: mergeMaps(x.g, y.g),
      t: mergeMaps(x.t, y.t),
      b: later(x.b, y.b)
    };
  }

  /**
   * Two computers switched on at about the same time each find the mailbox
   * empty, and each fill it with what it has - which, for two computers that
   * were set up alike, is the same tiles twice. `welcome` cannot catch that:
   * neither of them had anything to be welcomed into.
   *
   * So what each of them brought is tagged with where it came from, and here
   * the plainly identical - a group of the same name, a tile for the same site
   * in the same group - are folded into one: the one with the smaller id, on
   * every computer alike. The other becomes a deletion stamped the same
   * moment, which beats it wherever the two meet.
   *
   * A pair at a time, and only across two computers: two of the same brought
   * by one computer were two there already, and one of them is still a
   * second tile when the other computer had only one. The deletion a fold
   * leaves says where it came from and what it was folded into, so that a
   * later merge knows that pair is already made - and so that anything filed
   * under a folded group can be found the group that stayed.
   *
   * @returns {Object<string, string>} every id folded away, to the one it
   *   was folded into
   */
  function fold(map, keyOf) {
    const moved = {};
    const took = new Map();
    const tookBy = id => took.get(id) || took.set(id, new Set()).get(id);

    Object.entries(map).forEach(([id, r]) => {
      if (r[1] !== null || !r[2] || !r[3]) return;
      tookBy(r[3]).add(r[2]);
      moved[id] = r[3];
    });

    const kept = new Map();
    Object.keys(map).sort().forEach(id => {
      const r = map[id];
      if (!r[1] || !r[2]) return;

      const key = keyOf(r[1]);
      const others = kept.get(key) || [];
      const twin = others.find(other => other.from !== r[2] && !tookBy(other.id).has(r[2]));
      if (!twin) {
        others.push({ id, from: r[2] });
        kept.set(key, others);
        return;
      }

      tookBy(twin.id).add(r[2]);
      map[id] = [r[0], null, r[2], twin.id];
      moved[id] = twin.id;
    });

    return moved;
  }

  /**
   * What every computer does to a merged document before using it, so that
   * all of them arrive at the same one: old deletions forgotten, what two of
   * them brought folded together, and no more groups than the page has room
   * for.
   */
  function tidy(doc, now) {
    // A fold is never forgotten: it is one record per duplicate, and without
    // it the next merge would pair what is left all over again.
    const cutoff = now - KEEP_GONE;
    [doc.t, doc.g].forEach(map => Object.keys(map).forEach(id => {
      const r = map[id];
      if (r[1] === null && !r[2] && r[0] > 0 && r[0] < cutoff) delete map[id];
    }));

    const moved = fold(doc.g, v => norm(v.n));
    Object.keys(doc.t).forEach(id => {
      const r = doc.t[id];
      if (r[1] && moved[r[1].g]) doc.t[id] = [r[0], { ...r[1], g: moved[r[1].g] }, ...r.slice(2)];
    });
    fold(doc.t, tileKey);

    arrange(doc.g).slice(Store.MAX_GROUPS).forEach(id => {
      doc.g[id] = [doc.g[id][0], null];
    });

    return doc;
  }

  /**
   * A computer joining an account that already has tiles in it, holding some
   * of the same ones itself - two computers that were set up alike before
   * there was sync. What it holds that the account already has is not added
   * a second time: a group of the same name is the account's group, and a
   * tile for the same site in the same group is the account's tile, which
   * keeps this one's visit count and, if its own could not travel, its
   * picture.
   */
  function welcome(here, remote) {
    const byName = new Map();
    Object.keys(remote.g).sort().forEach(id => {
      const v = remote.g[id][1];
      if (v && !byName.has(norm(v.n))) byName.set(norm(v.n), id);
    });

    // Anything the account already holds under its own id - a computer
    // switching sync back on, say - is simply itself, whatever else it
    // resembles.
    const moved = {};
    const groups = here.groups.filter(group => {
      const twin = remote.g[group.id] ? null : byName.get(norm(group.name));
      if (!twin) return true;
      moved[group.id] = twin;
      return false;
    });

    const byKey = new Map();
    Object.keys(remote.t).sort().forEach(id => {
      const v = remote.t[id][1];
      if (v && !byKey.has(tileKey(v))) byKey.set(tileKey(v), id);
    });

    // One tile here for each of the account's: a second one for the same site
    // is a second tile, and is kept.
    const inherit = {};
    const tiles = [];
    here.tiles.forEach(tile => {
      const mine = moved[tile.groupId] ? { ...tile, groupId: moved[tile.groupId] } : tile;
      const twin = remote.t[tile.id] ? null : byKey.get(tileKey(tileForm(mine)));
      if (twin && !(twin in inherit)) inherit[twin] = mine;
      else tiles.push(mine);
    });

    return { here: { ...here, tiles, groups }, inherit };
  }

  // ----------------------------------------------------------------- unpack

  /**
   * The merged document as what storage.local holds. A record the merge left
   * as this computer had it keeps this computer's own copy, the parts that do
   * not travel and all; anything else is built from the record.
   */
  function unpack(doc, stamped, here, now, inherit) {
    const tilesHere = new Map(here.tiles.map(tile => [tile.id, tile]));
    const tiles = arrange(doc.t).map(id => {
      const r = doc.t[id];
      const mine = tilesHere.get(id);
      return mine && sameRec(stamped.t[id], r) ? mine : tileFrom(id, r[1], mine || inherit[id]);
    });

    const groupsHere = new Map(here.groups.map(group => [group.id, group]));
    const groups = arrange(doc.g).map(id => {
      const r = doc.g[id];
      const mine = groupsHere.get(id);
      return mine && sameRec(stamped.g[id], r) ? mine : { id, name: r[1].n };
    });

    let settings = here.settings;
    const arrived = Schema.SYNCED.filter(key => doc.s[key] && !sameRec(stamped.s[key], doc.s[key]));
    if (arrived.length) {
      settings = Schema.coerce({
        ...(here.settings || Schema.DEFAULTS),
        ...Object.fromEntries(arrived.map(key => [key, doc.s[key][1]]))
      });
    }

    let background = here.background;
    if (doc.b && !sameRec(stamped.b, doc.b)) {
      const v = doc.b[1];
      if (v === null) {
        background = null;
      } else if (!isMark(v.s) && canon(bgForm(background)) !== canon(v)) {
        background = { src: v.s, name: v.n, type: v.y, savedAt: now };
      }
    }

    return { tiles, groups, settings, background };
  }

  /** What storage.local holds, as `stamp` will next compare it. */
  function look(local) {
    const seen = { s: {}, t: {}, g: {}, b: UNTOUCHED };
    // Never having saved any is having the defaults: changing one of them
    // later is an edit to that one, not to all of them.
    const settings = local.settings || Schema.DEFAULTS;
    Schema.SYNCED.forEach(key => { seen.s[key] = canon(settings[key]); });
    local.tiles.forEach(tile => { seen.t[tile.id] = canon(tileForm(tile)); });
    local.groups.forEach(group => { seen.g[group.id] = canon(groupForm(group)); });
    if (local.background !== undefined) seen.b = canon(bgForm(local.background));
    return seen;
  }

  // ---------------------------------------------------------------- mailbox

  /** The mailbox's keys, read as one document. Anything malformed is skipped. */
  function fromMailbox(raw) {
    const doc = blank();
    const read = (target, source, fits) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) return;
      Object.entries(source).forEach(([key, r]) => {
        if (isRec(r) && (r[1] === null || fits(r[1]))) target[key] = later(target[key], r);
      });
    };
    const placed = v => v && typeof v === 'object' && Number.isFinite(v.o);

    read(doc.s, raw[PREFIX + 's'], () => true);
    read(doc.g, raw[PREFIX + 'g'], v => placed(v) && typeof v.n === 'string');
    for (let i = 0; i < BUCKETS; i++) {
      read(doc.t, raw[PREFIX + 't' + i], v => placed(v) && typeof v.u === 'string');
    }

    const b = raw[PREFIX + 'b'];
    if (isRec(b) && (b[1] === null || (b[1] && typeof b[1].s === 'string'))) doc.b = b;
    return doc;
  }

  /** A document as the mailbox's keys: tiles by their id's bucket. */
  function toMailbox(doc) {
    const box = {};
    if (Object.keys(doc.s).length) box[PREFIX + 's'] = doc.s;
    if (Object.keys(doc.g).length) box[PREFIX + 'g'] = doc.g;
    if (doc.b) box[PREFIX + 'b'] = doc.b;

    Object.entries(doc.t).forEach(([id, r]) => {
      const key = PREFIX + 't' + (hashNum(id) % BUCKETS);
      (box[key] ||= {})[id] = r;
    });
    return box;
  }

  function fits(box) {
    let total = 0;
    for (const [key, value] of Object.entries(box)) {
      const size = bytes(key, value);
      if (size > PER_KEY) return false;
      total += size;
    }
    return total <= QUOTA - HEADROOM;
  }

  /** The same document with every tile's own picture left at home. */
  function lighten(doc) {
    const tiles = {};
    Object.entries(doc.t).forEach(([id, r]) => {
      const v = r[1];
      tiles[id] = v && typeof v.i === 'string' && /^data:/i.test(v.i)
        ? [r[0], { ...v, i: mark(v.i) }, ...r.slice(2)]
        : r;
    });
    return { ...doc, t: tiles };
  }

  /** Writes the keys that differ from what the mailbox holds, and no others. */
  async function post(box, raw) {
    const changed = {};
    Object.entries(box).forEach(([key, value]) => {
      if (canon(value) !== canon(raw[key])) changed[key] = value;
    });
    const gone = Object.keys(raw).filter(key => key.startsWith(PREFIX) && !(key in box));

    if (Object.keys(changed).length) await MAILBOX.set(changed);
    if (gone.length) await MAILBOX.remove(gone);
  }

  // -------------------------------------------------------------- the merge

  function readState(raw) {
    const ok = raw && typeof raw === 'object' && raw.doc && raw.seen;
    return {
      doc: ok ? { ...blank(), ...raw.doc } : blank(),
      seen: ok ? { s: {}, t: {}, g: {}, b: UNTOUCHED, ...raw.seen } : { s: {}, t: {}, g: {} },
      joined: Boolean(ok && raw.joined),
      device: ok && typeof raw.device === 'string' ? raw.device : '',
      lastRemote: ok && Number(raw.lastRemote) || 0,
      error: ok && typeof raw.error === 'string' ? raw.error : ''
    };
  }

  /**
   * The background, held rather than read each time: it can be megabytes, and
   * every change to it arrives through `onChanged` anyway, value and all.
   */
  let bgHeld = null;

  async function reconcile() {
    const got = await HERE.get(['tiles', 'groups', 'settings', STATE]);
    const settings = got.settings === undefined ? undefined : Schema.coerce(got.settings);

    if (!(settings || Schema.DEFAULTS).sync) {
      // Switched off, this computer forgets it ever merged, so that switching
      // it back on is joining again - bringing what it has, and taking what
      // the account has, rather than deleting from the account everything
      // that was deleted here in the meantime.
      if (got[STATE] !== undefined) await HERE.remove(STATE);
      remember(null);
      return;
    }

    if (!bgHeld) {
      bgHeld = Store.heldBackground() || { value: (await HERE.get('background')).background };
    }
    const bgRead = bgHeld;

    const here = {
      tiles: Store.sanitize('tiles', got.tiles),
      groups: Store.sanitize('groups', got.groups),
      settings,
      background: bgRead.value === undefined ? undefined : Store.sanitize('background', bgRead.value)
    };

    const state = readState(got[STATE]);
    const raw = await MAILBOX.get(null);
    const remote = fromMailbox(raw);
    const now = Date.now();
    const joining = !state.joined;
    const empty = isEmpty(remote);
    const device = state.device || hash(now + ':' + Math.random());

    let start = here;
    let inherit = {};
    if (joining && !empty) ({ here: start, inherit } = welcome(here, remote));

    const stamped = stamp(start, state, now, {
      joining,
      fresh: joining && empty ? now : 0,
      brought: joining && empty ? device : undefined,
      after: { t: highest(remote.t, state.doc.t), g: highest(remote.g, state.doc.g) }
    });

    let merged = tidy(merge(stamped, remote), now);
    let box = toMailbox(merged);
    let full = false;
    if (!fits(box)) {
      merged = lighten(merged);
      box = toMailbox(merged);
      full = !fits(box);
    }

    const next = unpack(merged, stamped, start, now, inherit);
    const writes = WATCHED.filter(key => {
      if (key === 'background') return next.background !== here.background;
      if (key === 'settings') return canon(next.settings) !== canon(here.settings);
      return !sameList(next[key], here[key]);
    });

    if (writes.length) {
      // Another new tab may have written since this one read. What it wrote
      // has not been through the merge, and writing over it would lose it -
      // so this merge is dropped and the next one starts from what is there.
      const again = await HERE.get(['tiles', 'groups', 'settings']);
      const moved = ['tiles', 'groups', 'settings']
        .some(key => canon(again[key]) !== canon(got[key]));
      if (moved || bgHeld !== bgRead) {
        soon(delays.remote);
        return;
      }

      for (const key of writes) next[key] = await Store.adopt(key, next[key]);
      if (writes.includes('background')) bgHeld = { value: next.background };
    }

    let error = full ? 'full' : '';
    if (!full) {
      try {
        await post(box, raw);
      } catch (err) {
        const said = String((err && err.message) || err);
        error = /quota/i.test(said) ? 'full' : said;
      }
    }

    const saved = {
      doc: merged,
      seen: look(next),
      joined: true,
      device,
      lastRemote: writes.length ? now : state.lastRemote,
      error
    };
    if (canon(saved) !== canon(got[STATE])) await HERE.set({ [STATE]: saved });
    remember(saved);
  }

  // --------------------------------------------------------------- running

  let started = false;
  let timer = null;
  let due = Infinity;
  let chain = Promise.resolve();
  let busy = 0;
  let delays = { local: DELAY_LOCAL, remote: DELAY_REMOTE };

  /**
   * One merge at a time across every open new tab: two of them merging at
   * once would each write what the other had not seen.
   */
  function exclusive(fn) {
    const locks = typeof navigator !== 'undefined' && navigator.locks;
    return locks && locks.request ? locks.request('opentiles-sync', fn) : fn();
  }

  /** Runs a merge now, after any already under way. */
  function now() {
    busy++;
    chain = chain
      .then(() => exclusive(reconcile))
      .catch(err => remember({ ...(last || {}), error: String((err && err.message) || err) }))
      .finally(() => { busy--; });
    return chain;
  }

  /** Runs a merge in `delay` ms, unless one is already due sooner. */
  function soon(delay) {
    const at = Date.now() + delay;
    if (timer && at >= due) return;
    clearTimeout(timer);
    due = at;
    timer = setTimeout(() => {
      timer = null;
      due = Infinity;
      now();
    }, delay);
  }

  /** Resolves once nothing is waiting to run and nothing is running. */
  async function idle() {
    while (timer || busy) {
      await chain;
      await new Promise(resolve => setTimeout(resolve, delays.local + 5));
    }
  }

  /**
   * Starts listening. Every open new tab runs this; which one merges a given
   * change does not matter, since they all merge the same way.
   *
   * @param {{onStatus?: () => void, delays?: {local:number, remote:number}}} options
   *   `onStatus` is called when what `status()` says has changed
   */
  function start(options = {}) {
    if (started || !MAILBOX || !HERE || !STORAGE.onChanged) return Promise.resolve();
    started = true;
    onStatus = options.onStatus || null;
    if (options.delays) delays = options.delays;

    STORAGE.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        if (Object.keys(changes).some(key => key.startsWith(PREFIX))) soon(delays.remote);
        return;
      }
      if (area !== 'local') return;

      if ('background' in changes) bgHeld = { value: changes.background.newValue };
      if (STATE in changes) remember(changes[STATE].newValue || null);
      if (WATCHED.some(key => key in changes)) soon(delays.local);
    });

    if (RUNTIME && RUNTIME.getPlatformInfo) {
      Promise.resolve(RUNTIME.getPlatformInfo())
        .then(info => {
          android = Boolean(info && info.os === 'android');
          remember(last);
        })
        .catch(() => {});
    }

    return now();
  }

  // ---------------------------------------------------------------- status

  let last = null;
  let android = false;
  let onStatus = null;
  let told = '';

  function remember(state) {
    last = state;
    const said = canon(status());
    if (said === told) return;
    told = said;
    if (onStatus) onStatus();
  }

  /**
   * What the settings window says about sync: `when`, the last time anything
   * arrived from another computer, and `line`, anything that needs saying
   * under the switch.
   *
   * @returns {{when: string, line: ?{kind: string, text: string}}}
   */
  function status() {
    const when = last && last.lastRemote
      ? new Date(last.lastRemote).toLocaleString([], {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      })
      : t('sync_never');

    let line = null;
    if (android) line = { kind: 'info', text: t('sync_android') };
    else if (last && last.error === 'full') line = { kind: 'error', text: t('sync_full') };
    else if (last && last.error) line = { kind: 'error', text: t('sync_failed', last.error) };

    return { when, line };
  }

  return {
    start, now, idle, status,
    PREFIX, BUCKETS, CARRY,
    // The workings, for the tests.
    hash, canon, positions, stamp, merge, tidy, welcome, unpack, look,
    tileForm, tileFrom, fromMailbox, toMailbox, fits
  };
})();
