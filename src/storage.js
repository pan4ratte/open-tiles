/**
 * Thin persistence layer.
 *
 * Uses WebExtension storage when available (so tiles sync across every open
 * new-tab page and survive restarts) and falls back to localStorage, which
 * makes the page testable by opening src/newtab.html directly in a browser.
 *
 * Keys
 *   tiles      - [{ id, url, title, groupId, icon, iconColor, bg, pad, round,
 *                visits }]
 *                groupId is null when loose; icon is '' when the site's own
 *                is to be looked up; iconColor is '' when it keeps its own
 *                colours; bg is '' for the usual frosted tile; pad is null
 *                when the tile follows the logo padding set for every tile;
 *                round is how far the icon's own corners are taken off, 0 for
 *                the picture as it comes; visits counts opens from this add-on
 *   groups     - [{ id, name }]                 the bar across the top
 *   settings   - see schema.js
 *   activeGroup- id of the group last shown, or null for "All"
 *   background - { src, name, type, savedAt }      the page background
 *                type is 'image' or 'video'; src is a data: URI or an address
 *   bgRecent   - [background & { effects }]  the last few, newest first, so one
 *                can be put back without finding the file again; `effects` is
 *                the { bgBlur, bgDim } that entry was last looked at with
 *   fontCache  - { [family]: { css, savedAt } }     CSS with the woff2 inlined
 *   fontPreviews- { sig, css, savedAt }   one stylesheet holding a tiny letters
 *                and digits cut of every family in the picker, for the specimen
 *                grid; `sig` names the catalogue it was built for, so a changed
 *                list rebuilds itself
 *   iconCache  - { [origin]: { url, data, size, mode, savedAt } }
 *                url is the address the icon was found at; data is the picture
 *                itself as a data: URI when it was small enough to keep, null
 *                when it was tried and could not be
 */
const Store = (() => {
  const TILES = 'tiles';
  const GROUPS = 'groups';
  const ACTIVE_GROUP = 'activeGroup';
  const SETTINGS = 'settings';
  const BACKGROUND = 'background';
  const BG_RECENT = 'bgRecent';
  const FONT_CACHE = 'fontCache';
  const FONT_PREVIEWS = 'fontPreviews';
  const ICON_CACHE = 'iconCache';

  const ext = (typeof browser !== 'undefined' && browser.storage && browser.storage.local)
    || (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
    || null;

  // ------------------------------------------------------------- primitives

  async function get(key) {
    if (ext) {
      const data = await ext.get(key);
      return data ? data[key] : undefined;
    }
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  async function set(key, value) {
    noteOwnWrite(key, value);
    if (ext) {
      await ext.set({ [key]: value });
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
    return value;
  }

  // --------------------------------------------------------------- own writes

  /**
   * Every write here comes straight back through `storage.onChanged` - the API
   * makes no distinction between the page that wrote and the pages that only
   * need telling. Left alone, that echo makes the page treat its own slider
   * drag as somebody else's edit and rebuild itself mid-gesture.
   *
   * So each write leaves the signature of what it wrote behind, and the change
   * feed drops the event that carries it back. A real edit from another new-tab
   * page has a different signature and still gets through.
   *
   * `onChanged` cannot be relied on to fire before or after the write settles,
   * which is why this is a value comparison rather than a flag held over the
   * write.
   */
  const echoes = new Map();

  /** A record's stamp and length - as telling as the whole data URI, for free. */
  const stamp = record => record.savedAt + ':' + record.src.length;

  /**
   * The same for a recent entry, with the effects on the end: those are the
   * one thing about an entry that changes without its stamp or its length
   * doing, so a list that differs only there has to sign differently.
   */
  const stampEntry = entry => stamp(entry)
    + (entry.effects ? ':' + entry.effects.bgBlur + ',' + entry.effects.bgDim : '');

  function signature(key, value) {
    // The picture is megabytes of data URI, and the recent list is several of
    // them. Their stamps and lengths identify them as well as the whole
    // strings would, at none of the cost.
    if (key === BACKGROUND) return value ? stamp(value) : 'null';
    if (key === BG_RECENT) return Array.isArray(value) ? value.map(stampEntry).join('|') : 'null';
    try {
      const json = JSON.stringify(value);
      return json === undefined ? null : json;
    } catch {
      return null;
    }
  }

  function noteOwnWrite(key, value) {
    const sig = signature(key, value);
    if (sig === null) return;

    const queue = echoes.get(key) || [];
    queue.push(sig);
    // A short queue, because a signature that never comes back - a cache key
    // nothing listens for, a write that failed - would otherwise sit here for
    // the life of the page.
    while (queue.length > 4) queue.shift();
    echoes.set(key, queue);
  }

  /** True when this event is the return leg of a write made on this page. */
  function isEcho(key, value) {
    const queue = echoes.get(key);
    if (!queue || !queue.length) return false;

    const at = queue.indexOf(signature(key, value));
    if (at === -1) return false;

    // Anything written before the one that just came back is never coming.
    queue.splice(0, at + 1);
    return true;
  }

  // ------------------------------------------------------------------ tiles

  /**
   * A tile's own picture: a web address, or a small image stored inline. Empty
   * for the usual case, where the site's icon is looked up instead.
   *
   * The cap is per tile and generous for an icon but far short of a
   * photograph - a tile list is rewritten on every drag, so nothing here may
   * be allowed to grow to the size of a background.
   */
  const MAX_ICON = 256 * 1024;

  function sanitizeIcon(raw) {
    if (typeof raw !== 'string') return '';
    const icon = raw.trim();
    if (icon.length > MAX_ICON) return '';
    return /^(https?:\/\/|data:image\/)/i.test(icon) ? icon : '';
  }

  /** A tile's own background: a six-digit hex colour, or '' for the material. */
  function sanitizeColor(raw) {
    if (typeof raw !== 'string') return '';
    const hex = raw.trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(hex) ? hex : '';
  }

  /**
   * A tile's own logo padding, as a percentage of the room inside it, or null
   * where it follows the one setting that governs every tile.
   *
   * Null and zero are different answers here and both are real, so this cannot
   * lean on a falsy check: 0% is "fill the tile", and it has to survive a
   * round trip through storage as something other than "no answer given".
   */
  const MAX_PAD = 40;

  function sanitizePad(raw) {
    const n = Math.round(Number(raw));
    if (raw === null || raw === '' || !Number.isFinite(n)) return null;
    return Math.min(MAX_PAD, Math.max(0, n));
  }

  /**
   * How far a tile's icon has its corners taken off, as a share of its short
   * side: 0 is the picture as it comes, 50 rounds a square one to a circle.
   *
   * Zero rather than null, because there is no setting behind this one to
   * follow - a tile either rounds its icon or it does not.
   */
  const MAX_ROUND = 50;

  function sanitizeRound(raw) {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return 0;
    return Math.min(MAX_ROUND, Math.max(0, n));
  }

  /** Opens counted by this add-on. Never negative, never a fraction. */
  function sanitizeVisits(raw) {
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function sanitizeTiles(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter(t => t && typeof t.url === 'string')
      .map(t => ({
        id: String(t.id || crypto.randomUUID()),
        url: t.url,
        title: typeof t.title === 'string' ? t.title : '',
        // A tile in no group, or in one that has since been deleted, is loose:
        // it shows under "All" and nowhere else.
        groupId: typeof t.groupId === 'string' && t.groupId ? t.groupId : null,
        icon: sanitizeIcon(t.icon),
        iconColor: sanitizeColor(t.iconColor),
        bg: sanitizeColor(t.bg),
        pad: sanitizePad(t.pad),
        round: sanitizeRound(t.round),
        visits: sanitizeVisits(t.visits)
      }));
  }

  async function load() {
    return sanitizeTiles(await get(TILES));
  }

  async function save(list) {
    const clean = sanitizeTiles(list);
    await set(TILES, clean);
    return clean;
  }

  // ----------------------------------------------------------------- groups

  /** A short list of short names - anything longer is somebody's accident. */
  const MAX_GROUPS = 24;

  function sanitizeGroups(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter(g => g && typeof g.name === 'string')
      .slice(0, MAX_GROUPS)
      .map(g => ({
        id: String(g.id || crypto.randomUUID()),
        name: g.name.trim().slice(0, 32) || 'Group'
      }));
  }

  async function loadGroups() {
    return sanitizeGroups(await get(GROUPS));
  }

  async function saveGroups(list) {
    const clean = sanitizeGroups(list);
    await set(GROUPS, clean);
    return clean;
  }

  // ----------------------------------------------------------- active group

  /**
   * Which group was last being looked at. Its own key rather than a setting:
   * it is a place in the page, not a preference, and it is written every time
   * a chip is clicked - which is no reason to rewrite the settings object.
   */
  async function loadActiveGroup() {
    const id = await get(ACTIVE_GROUP);
    return typeof id === 'string' && id ? id : null;
  }

  const saveActiveGroup = id => set(ACTIVE_GROUP, typeof id === 'string' && id ? id : null);

  // --------------------------------------------------------------- settings

  async function loadSettings() {
    return Schema.coerce(await get(SETTINGS));
  }

  async function saveSettings(partial) {
    const next = Schema.coerce({ ...(await loadSettings()), ...partial });
    await set(SETTINGS, next);
    return next;
  }

  async function resetSettings() {
    await set(SETTINGS, { ...Schema.DEFAULTS });
    return { ...Schema.DEFAULTS };
  }

  // ------------------------------------------------------------- background

  /**
   * What a record carrying no `type` of its own is. A data URI says outright;
   * a web address is read off its path.
   */
  const LOOKS_MOVING = /^data:video\/|\.(mp4|webm|ogv|ogg|m4v|mov)(\?|#|$)/i;

  /**
   * A picture or a video, stored inline or named by web address.
   *
   * A data: URI is the offline case and the default; an http(s) address is
   * fetched by the browser on every new tab, which is the cost of naming
   * something that lives somewhere else.
   *
   * `type` is what the page paints from: a still one is a background-image, a
   * moving one is a <video>. Records written before that field existed - and
   * hand-edited backups - are read from their `src` instead, so there is
   * nothing to migrate.
   */
  function sanitizeBackground(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const src = typeof raw.src === 'string' ? raw.src.trim() : '';
    if (!/^(data:(image|video)\/|https?:\/\/)/i.test(src)) return null;

    const type = raw.type === 'video' || raw.type === 'image'
      ? raw.type
      : (LOOKS_MOVING.test(src) ? 'video' : 'image');

    return {
      src,
      name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '',
      type,
      savedAt: Number(raw.savedAt) || Date.now()
    };
  }

  async function loadBackground() {
    return sanitizeBackground(await get(BACKGROUND));
  }

  /** @throws when the picture does not fit in the storage area */
  async function saveBackground(record) {
    const clean = sanitizeBackground(record);
    if (!clean) throw new Error('Unusable image.');
    await set(BACKGROUND, clean);
    return clean;
  }

  async function clearBackground() {
    await set(BACKGROUND, null);
    return null;
  }

  // ------------------------------------------------------ recent backgrounds

  /**
   * The last few backgrounds, newest first, so one can be put back without
   * going to find the file again.
   *
   * Whole records rather than thumbnails: a stored picture *is* its data URI,
   * and there would be nothing to put back from a thumbnail. That makes this
   * the heaviest thing in the storage area, so it is capped twice over - by
   * how many it holds, and by the room they may take between them. One named
   * by web address costs only its address, so a list of those never comes near
   * the ceiling; a list of stored videos reaches it after three or four.
   *
   * Six, because the strip is drawn three across and two down: a row and a
   * half of thumbnails would be a hole in the grid rather than a layout.
   */
  const MAX_RECENT = 6;
  const RECENT_BUDGET = 64 * 1024 * 1024;

  /**
   * An entry as it is kept: the background, plus the Blur and Dim it was last
   * looked at with.
   *
   * The pair rides on the entry rather than in `settings` because there is one
   * of them per wallpaper - a photograph wants dimming where a flat colour
   * does not - and because an entry that falls off the end should take its
   * settings with it rather than leave them behind for nothing.
   *
   * It stays off the `background` record for the opposite reason: that one is
   * megabytes of data URI, and writing it again every time a slider moves is
   * exactly what keeping the picture out of `settings` was for.
   */
  function sanitizeRecentEntry(raw) {
    const record = sanitizeBackground(raw);
    if (!record) return null;
    // Absent rather than defaulted: an entry that has never been looked at
    // under this build should leave the sliders where they are, not haul them
    // back to 0 and 35.
    return raw.effects ? { ...record, effects: Schema.coerceEffects(raw.effects) } : record;
  }

  /** Newest first, no repeats, inside both caps. */
  function sanitizeRecent(list) {
    if (!Array.isArray(list)) return [];

    const out = [];
    let room = RECENT_BUDGET;

    for (const raw of list) {
      const record = sanitizeRecentEntry(raw);
      // The same picture chosen twice is one entry, at the place the newer
      // choice put it.
      if (!record || out.some(kept => kept.src === record.src)) continue;

      room -= record.src.length;
      if (room < 0) break;

      out.push(record);
      if (out.length === MAX_RECENT) break;
    }

    return out;
  }

  async function loadRecentBackgrounds() {
    return sanitizeRecent(await get(BG_RECENT));
  }

  /**
   * Puts `record` at the front, carrying `effects` if any were named.
   *
   * An entry moving back to the front keeps whatever it already had when the
   * caller names nothing, so putting one back does not cost it the pair it was
   * remembered with.
   *
   * @returns the list as it now stands
   */
  async function rememberBackground(record, effects) {
    const clean = sanitizeBackground(record);
    if (!clean) return loadRecentBackgrounds();

    const held = await loadRecentBackgrounds();
    const before = held.find(entry => entry.src === clean.src);
    const carried = effects || (before && before.effects);

    const list = sanitizeRecent([
      carried ? { ...clean, effects: carried } : clean,
      ...held
    ]);
    await set(BG_RECENT, list);
    return list;
  }

  /**
   * Writes `effects` against the entry holding `src`, leaving the order alone.
   *
   * Called as the page moves off a background, so what is remembered against
   * one is what it was last actually looked at with. A `src` that is not in
   * the list - the background was removed from the strip while it was still on
   * screen - is nothing to do, not an error.
   *
   * @returns the list as it now stands
   */
  async function noteRecentEffects(src, effects) {
    const held = await loadRecentBackgrounds();
    const clean = Schema.coerceEffects(effects);

    let changed = false;
    const list = held.map(entry => {
      if (entry.src !== src) return entry;
      const same = entry.effects
        && Schema.EFFECT_KEYS.every(key => entry.effects[key] === clean[key]);
      if (same) return entry;
      changed = true;
      return { ...entry, effects: clean };
    });

    // The list is the heaviest thing here; a write that changes nothing is not
    // worth megabytes, nor the edit it would look like in every other tab.
    if (!changed) return held;
    await set(BG_RECENT, list);
    return list;
  }

  /** Drops the entry holding `src`. @returns the list as it now stands */
  async function forgetRecentBackground(src) {
    const held = await loadRecentBackgrounds();
    const list = held.filter(entry => entry.src !== src);
    if (list.length === held.length) return held;

    await set(BG_RECENT, list);
    return list;
  }

  async function clearRecentBackgrounds() {
    await set(BG_RECENT, []);
    return [];
  }

  // ------------------------------------------------------- generic LRU cache

  function makeCache(key, limit) {
    /**
     * The map, read once and then held.
     *
     * Every tile on the page asks this cache for its icon. Read straight from
     * storage each time, a page of forty tiles reads and parses the whole map
     * forty times over before it can draw the first icon - which is most of
     * why icons used to appear a beat after everything else. Held here, the
     * second tile onwards costs nothing.
     *
     * A write from another new-tab page is not picked up. That is a cache
     * behaving like one: the worst it costs is a lookup done twice.
     */
    let map = null;

    function all() {
      if (!map) map = Promise.resolve(get(key)).then(stored => stored || {}, () => ({}));
      return map;
    }

    /**
     * Writes are coalesced. A cold page resolves its icons one after another,
     * and each entry now carries the picture itself - writing the whole map
     * once per icon would put megabytes through storage while the page is
     * still filling in. The map in memory is what everything reads, so the
     * write is free to lag behind it; a page closed inside the window loses
     * nothing but the chance to skip a lookup next time.
     */
    const WRITE_DELAY = 300;
    let writing = null;

    function scheduleWrite(cache) {
      if (writing) return;
      writing = setTimeout(() => {
        writing = null;
        // A full storage area throws here. There is nothing useful to do
        // about it: the map is still in memory, and this is a cache.
        set(key, cache).catch(() => {});
      }, WRITE_DELAY);
    }

    return {
      async get(id) {
        return (await all())[id];
      },
      /**
       * Drops one entry.
       *
       * A cache normally has no need for this - it evicts by age, and a wrong
       * answer is corrected by putting the right one over it. This is for the
       * case where the question itself has gone: a tile pointed at another
       * site, or deleted, leaves an entry nothing will ever ask for again.
       */
      async drop(id) {
        const cache = await all();
        if (!(id in cache)) return false;

        delete cache[id];
        scheduleWrite(cache);
        return true;
      },
      async put(id, entry) {
        const cache = await all();
        cache[id] = { ...entry, savedAt: Date.now() };

        Object.keys(cache)
          .sort((a, b) => (cache[b].savedAt || 0) - (cache[a].savedAt || 0))
          .slice(limit)
          .forEach(stale => delete cache[stale]);

        scheduleWrite(cache);
        return cache[id];
      },
      async clear() {
        clearTimeout(writing);
        writing = null;
        map = Promise.resolve({});
        await set(key, {});
      }
    };
  }

  /** Inlined webfont stylesheets, keyed by family. */
  const fonts = makeCache(FONT_CACHE, 6);
  /** Resolved site icons, keyed by origin.

     Fewer than the map once held, because an entry is no longer a short string
     but may carry the picture too. Favicons kept this way run a few kilobytes
     each, so the whole map sits comfortably under a megabyte at this limit -
     and the page picture, which is far larger, shares the same storage area. */
  const icons = makeCache(ICON_CACHE, 120);

  async function getFontCss(family) {
    const entry = await fonts.get(family);
    return entry ? entry.css : null;
  }

  const putFontCss = (family, css) => fonts.put(family, { css });

  /**
   * The picker's specimen stylesheet. One value rather than a cache: it is
   * built for the whole catalogue at once, so there is nothing to evict - a
   * `sig` that no longer matches is simply rebuilt over.
   */
  async function getFontPreviews(sig) {
    const entry = await get(FONT_PREVIEWS);
    return entry && entry.sig === sig && entry.css ? entry.css : null;
  }

  const putFontPreviews = (sig, css) => set(FONT_PREVIEWS, { sig, css, savedAt: Date.now() });

  // ------------------------------------------------------------- change feed

  /**
   * Fires when *another* new-tab page changes any of what is stored here. This
   * page's own writes come back through the same feed and are dropped - see
   * `isEcho` above.
   */
  function onExternalChange(handler) {
    const runtime = (typeof browser !== 'undefined' && browser.storage)
      || (typeof chrome !== 'undefined' && chrome.storage)
      || null;
    if (!runtime || !runtime.onChanged) return;

    const READ = [
      [TILES, sanitizeTiles],
      [GROUPS, sanitizeGroups],
      [SETTINGS, Schema.coerce],
      [BACKGROUND, sanitizeBackground],
      [BG_RECENT, sanitizeRecent],
      [ACTIVE_GROUP, id => (typeof id === 'string' && id ? id : null)]
    ];

    runtime.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      READ.forEach(([key, read]) => {
        if (!changes[key]) return;
        const value = read(changes[key].newValue);
        if (!isEcho(key, value)) handler(key, value);
      });
    });
  }

  return {
    load, save,
    loadGroups, saveGroups, MAX_GROUPS,
    loadActiveGroup, saveActiveGroup,
    loadSettings, saveSettings, resetSettings,
    loadBackground, saveBackground, clearBackground,
    loadRecentBackgrounds, rememberBackground, noteRecentEffects,
    forgetRecentBackground, clearRecentBackgrounds, MAX_RECENT,
    getFontCss, putFontCss,
    getFontPreviews, putFontPreviews,
    icons,
    onExternalChange
  };
})();
