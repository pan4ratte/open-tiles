/**
 * Thin persistence layer.
 *
 * Uses WebExtension storage when available (so tiles sync across every open
 * new-tab page and survive restarts) and falls back to localStorage, which
 * makes the page testable by opening src/newtab.html directly in a browser.
 *
 * Keys
 *   tiles      - [{ id, url, title, groupId }]  groupId is null when loose
 *   groups     - [{ id, name }]                 the bar across the top
 *   settings   - see schema.js
 *   background - { src, name, savedAt }            the page background
 *   fontCache  - { [family]: { css, savedAt } }     CSS with the woff2 inlined
 *   iconCache  - { [origin]: { url, size, source, savedAt } }
 */
const Store = (() => {
  const TILES = 'tiles';
  const GROUPS = 'groups';
  const SETTINGS = 'settings';
  const BACKGROUND = 'background';
  const FONT_CACHE = 'fontCache';
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

  function signature(key, value) {
    // The picture is megabytes of data URI. Its stamp and length identify it
    // as well as the whole string would, at none of the cost.
    if (key === BACKGROUND) return value ? value.savedAt + ':' + value.src.length : 'null';
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
        groupId: typeof t.groupId === 'string' && t.groupId ? t.groupId : null
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

  /** Only a stored data: URI is ever painted onto the page. */
  function sanitizeBackground(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const src = typeof raw.src === 'string' ? raw.src : '';
    if (!/^data:image\//i.test(src)) return null;

    return {
      src,
      name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '',
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

  // ------------------------------------------------------- generic LRU cache

  function makeCache(key, limit) {
    return {
      async get(id) {
        const cache = (await get(key)) || {};
        return cache[id];
      },
      async put(id, entry) {
        const cache = (await get(key)) || {};
        cache[id] = { ...entry, savedAt: Date.now() };

        Object.keys(cache)
          .sort((a, b) => (cache[b].savedAt || 0) - (cache[a].savedAt || 0))
          .slice(limit)
          .forEach(stale => delete cache[stale]);

        await set(key, cache);
        return cache[id];
      },
      async clear() {
        await set(key, {});
      }
    };
  }

  /** Inlined webfont stylesheets, keyed by family. */
  const fonts = makeCache(FONT_CACHE, 6);
  /** Resolved site icons, keyed by origin. */
  const icons = makeCache(ICON_CACHE, 300);

  async function getFontCss(family) {
    const entry = await fonts.get(family);
    return entry ? entry.css : null;
  }

  const putFontCss = (family, css) => fonts.put(family, { css });

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
      [BACKGROUND, sanitizeBackground]
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
    loadSettings, saveSettings, resetSettings,
    loadBackground, saveBackground, clearBackground,
    getFontCss, putFontCss,
    icons,
    onExternalChange
  };
})();
