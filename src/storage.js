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
    if (ext) {
      await ext.set({ [key]: value });
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
    return value;
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

  /** Fires when another new-tab page changes any of what is stored here. */
  function onExternalChange(handler) {
    const runtime = (typeof browser !== 'undefined' && browser.storage)
      || (typeof chrome !== 'undefined' && chrome.storage)
      || null;
    if (!runtime || !runtime.onChanged) return;
    runtime.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[TILES]) handler(TILES, sanitizeTiles(changes[TILES].newValue));
      if (changes[GROUPS]) handler(GROUPS, sanitizeGroups(changes[GROUPS].newValue));
      if (changes[SETTINGS]) handler(SETTINGS, Schema.coerce(changes[SETTINGS].newValue));
      if (changes[BACKGROUND]) {
        handler(BACKGROUND, sanitizeBackground(changes[BACKGROUND].newValue));
      }
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
