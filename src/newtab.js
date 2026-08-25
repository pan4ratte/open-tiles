(() => {
  'use strict';

  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const header = document.getElementById('header');
  const clock = document.getElementById('clock');
  const dateLine = document.getElementById('date');

  const modal = document.getElementById('modal');
  const form = document.getElementById('tileForm');
  const modalTitle = document.getElementById('modalTitle');
  const modalError = document.getElementById('modalError');
  const fieldUrl = document.getElementById('fieldUrl');
  const fieldTitle = document.getElementById('fieldTitle');
  const btnCancel = document.getElementById('btnCancel');
  const btnDelete = document.getElementById('btnDelete');

  const settingsModal = document.getElementById('settings');
  const settingsForm = document.getElementById('settingsForm');
  const settingsBody = document.getElementById('settingsBody');
  const btnSettings = document.getElementById('btnSettings');
  const btnSettingsClose = document.getElementById('btnSettingsClose');
  const btnResetSettings = document.getElementById('btnResetSettings');

  /** @type {{id:string,url:string,title:string}[]} */
  let tiles = [];
  /** @type {object} see schema.js */
  let settings = { ...Schema.DEFAULTS };
  /** @type {?{src:string,name:string,savedAt:number}} page picture */
  let background = null;
  /** id of the tile currently open in the modal, or null when adding */
  let editingId = null;
  /** element being dragged, or null */
  let dragEl = null;
  /** whether the add-on currently holds access to all sites (deep icon lookup).
   *  Cached because the permission request must not be preceded by an await. */
  let siteAccessGranted = false;
  /** bumped on every render so late icon lookups can tell they are stale */
  let renderToken = 0;

  // ---------------------------------------------------------------- helpers

  const TILE_COLORS = [
    '#5b8cff', '#e0625f', '#3fae7a', '#c77dff',
    '#f0913a', '#39b5c7', '#d4517f', '#7c86f5'
  ];

  function colorFor(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
    return TILE_COLORS[Math.abs(hash) % TILE_COLORS.length];
  }

  /** Accepts "example.com" as well as a full URL; returns null when unusable. */
  function normalizeUrl(raw) {
    const value = raw.trim();
    if (!value) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : 'https://' + value;
    let url;
    try {
      url = new URL(withScheme);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return null;
    return url.href;
  }

  function defaultTitle(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  // ---------------------------------------------------------- applying settings

  function applySettings() {
    const root = document.documentElement;

    root.dataset.theme = settings.theme;
    root.style.setProperty('--accent', settings.accent);
    root.style.setProperty('--tile-size', settings.tileSize + 'px');
    root.style.setProperty('--gap', settings.gap + 'px');
    root.style.setProperty('--bg-blur', settings.bgBlur + 'px');
    root.style.setProperty('--bg-dim', settings.bgDim / 100);

    const fixedColumns = settings.columns !== 'auto';
    grid.classList.toggle('is-fixed-columns', fixedColumns);
    if (fixedColumns) root.style.setProperty('--columns', settings.columns);

    document.body.classList.toggle('no-labels', !settings.showLabels);

    clock.hidden = !settings.showClock;
    dateLine.hidden = !settings.showDate;
    header.hidden = !settings.showClock && !settings.showDate;

    tick();
  }

  // ---------------------------------------------------------------- rendering

  /** Monogram shown until the site's real icon arrives, or when there is none. */
  function buildFallback(label, seed) {
    const el = document.createElement('span');
    el.className = 'tile__fallback';
    el.style.background = colorFor(seed);

    const first = label.trim().charAt(0);
    if (/[\p{L}\p{N}]/u.test(first)) {
      el.textContent = first.toUpperCase();
    } else {
      el.append(Icons.create('globe', { size: 22 }));
    }
    return el;
  }

  /** Swaps the monogram for the sharpest icon the site offers, once found. */
  async function attachIcon(el, tile, token) {
    const found = await Favicons.resolve(tile.url, { deep: settings.deepIcons });
    if (!found || token !== renderToken || !el.isConnected) return;

    const img = document.createElement('img');
    img.className = 'tile__icon';
    img.alt = '';
    img.hidden = true;
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => {
      img.hidden = false;
      const fallback = el.querySelector('.tile__fallback');
      if (fallback) fallback.remove();
    });
    img.addEventListener('error', () => img.remove());
    img.src = found.url;

    el.prepend(img);
  }

  function buildTile(tile, token) {
    const el = document.createElement('a');
    el.className = 'tile';
    el.href = tile.url;
    el.draggable = true;
    el.dataset.id = tile.id;

    if (settings.openInNewTab) {
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    }

    const label = tile.title || defaultTitle(tile.url);
    el.title = label + '\n' + tile.url;

    const text = document.createElement('span');
    text.className = 'tile__label';
    text.textContent = label;

    el.append(buildFallback(label, tile.url), text);
    attachIcon(el, tile, token);
    return el;
  }

  function buildAddButton() {
    const el = document.createElement('button');
    el.className = 'tile tile--add';
    el.id = 'addTile';
    el.type = 'button';
    el.title = 'Add a tile';
    el.setAttribute('aria-label', 'Add a tile');
    el.append(Icons.create('plus', { size: 28 }));
    el.addEventListener('click', () => openTileModal(null));
    return el;
  }

  function render() {
    const token = ++renderToken;
    grid.textContent = '';
    tiles.forEach(tile => grid.append(buildTile(tile, token)));
    grid.append(buildAddButton());
    empty.hidden = tiles.length > 0;
  }

  // ---------------------------------------------------------------- persistence

  let ownWrite = false;

  async function withOwnWrite(fn) {
    ownWrite = true;
    try {
      return await fn();
    } finally {
      ownWrite = false;
    }
  }

  async function persistTiles() {
    await withOwnWrite(async () => { tiles = await Store.save(tiles); });
  }

  let persistTimer;

  /** Settings apply instantly; the write is batched so dragging a slider
   *  does not hammer storage. */
  function updateSetting(key, value) {
    settings = Schema.coerce({ ...settings, [key]: value });
    applySettings();

    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      withOwnWrite(() => Store.saveSettings(settings));
    }, 250);

    return settings[key];
  }

  /** Reads the current DOM order back into `tiles`. */
  function syncOrderFromDom() {
    const byId = new Map(tiles.map(t => [t.id, t]));
    tiles = [...grid.querySelectorAll('.tile[data-id]')]
      .map(el => byId.get(el.dataset.id))
      .filter(Boolean);
  }

  // ---------------------------------------------------------------- drag & drop

  grid.addEventListener('dragstart', e => {
    const el = e.target.closest('.tile[data-id]');
    if (!el) return;
    dragEl = el;
    grid.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox only starts a drag when some data is attached.
    e.dataTransfer.setData('text/plain', el.dataset.id);
    requestAnimationFrame(() => el.classList.add('is-dragging'));
  });

  grid.addEventListener('dragover', e => {
    if (!dragEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const target = e.target.closest('.tile');
    if (!target || target === dragEl) return;

    if (target.id === 'addTile') {
      // Dropping past the last tile parks the item at the end.
      grid.insertBefore(dragEl, target);
      return;
    }

    const rect = target.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;

    if (before && target.previousElementSibling !== dragEl) {
      grid.insertBefore(dragEl, target);
    } else if (!before && target.nextElementSibling !== dragEl) {
      grid.insertBefore(dragEl, target.nextElementSibling);
    }
  });

  grid.addEventListener('drop', e => {
    if (dragEl) e.preventDefault();
  });

  grid.addEventListener('dragend', () => {
    if (!dragEl) return;
    dragEl.classList.remove('is-dragging');
    grid.classList.remove('is-dragging');
    dragEl = null;
    syncOrderFromDom();
    persistTiles();
  });

  // ---------------------------------------------------------------- dialogs

  function openDialog(el, focusEl) {
    el.hidden = false;
    if (focusEl) {
      focusEl.focus();
      focusEl.select();
    }
  }

  function closeDialog(el) {
    el.hidden = true;
  }

  [modal, settingsModal].forEach(el => {
    el.addEventListener('mousedown', e => {
      if (e.target === el) closeDialog(el);
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!settingsModal.hidden) closeDialog(settingsModal);
    else if (!modal.hidden) closeDialog(modal);
  });

  // ---------------------------------------------------------------- tile dialog

  function openTileModal(id) {
    editingId = id;
    const tile = id ? tiles.find(t => t.id === id) : null;

    modalTitle.textContent = tile ? 'Edit tile' : 'Add tile';
    fieldUrl.value = tile ? tile.url : '';
    fieldTitle.value = tile ? tile.title : '';
    btnDelete.hidden = !tile;
    modalError.hidden = true;

    openDialog(modal, fieldUrl);
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const url = normalizeUrl(fieldUrl.value);
    if (!url) {
      SettingsUI.setStatus(modalError, {
        kind: 'error',
        text: 'That does not look like a web address.'
      });
      return;
    }

    const title = fieldTitle.value.trim();
    if (editingId) {
      const tile = tiles.find(t => t.id === editingId);
      if (tile) Object.assign(tile, { url, title });
    } else {
      tiles.push({ id: crypto.randomUUID(), url, title });
    }

    await persistTiles();
    render();
    closeDialog(modal);
  });

  btnCancel.addEventListener('click', () => closeDialog(modal));

  btnDelete.addEventListener('click', async () => {
    tiles = tiles.filter(t => t.id !== editingId);
    await persistTiles();
    render();
    closeDialog(modal);
  });

  // Right-click a tile to edit it.
  grid.addEventListener('contextmenu', e => {
    const el = e.target.closest('.tile[data-id]');
    if (!el) return;
    e.preventDefault();
    openTileModal(el.dataset.id);
  });

  // ---------------------------------------------------------------- settings

  const FONT_SOURCE = {
    bundled: 'bundled with the extension',
    system: 'using the system font',
    cache: 'loaded from cache',
    network: 'downloaded and cached'
  };

  async function changeFont(value) {
    const name = value.trim();
    try {
      const source = await Fonts.use(name);
      updateSetting('font', name);
      return {
        value: name,
        status: { kind: 'ok', text: `${name || 'System font'} — ${FONT_SOURCE[source]}` }
      };
    } catch (err) {
      // Keep the last font that worked on screen.
      Fonts.applyStack(settings.font);
      return { value: settings.font, status: { kind: 'error', text: err.message } };
    }
  }

  const PERMISSION_HINT = 'You can also switch on "Access your data for all '
    + 'websites" under about:addons → Tiles → Permissions.';

  async function changeDeepIcons(on) {
    if (on) {
      if (!Favicons.supportsPermissions) {
        return {
          value: false,
          status: {
            kind: 'error',
            text: 'Only available once the add-on is installed in Firefox.'
          }
        };
      }

      // Nothing may be awaited before this call: Firefox grants the request
      // only while it is still handling the click that led here, which is why
      // the current state is read from a cached flag rather than looked up.
      if (!siteAccessGranted) {
        const { granted, error } = await Favicons.requestSiteAccess();
        siteAccessGranted = granted;

        if (!granted) {
          return {
            value: false,
            status: {
              kind: 'error',
              text: error
                ? `Firefox turned the request down (${error}). ${PERMISSION_HINT}`
                : `Permission declined. ${PERMISSION_HINT}`
            }
          };
        }
      }
    } else {
      await Favicons.dropSiteAccess();
      siteAccessGranted = false;
    }

    updateSetting('deepIcons', on);
    await Favicons.clearCache();
    render();

    return {
      value: on,
      status: {
        kind: 'ok',
        text: on
          ? 'Re-reading every site for its sharpest icon.'
          : 'Back to the conventional icon paths.'
      }
    };
  }

  /**
   * The background picker sends an action rather than a value, and gets back
   * `{record}` - what is on screen now. Anything that goes wrong (a file that
   * is not an image, one over the size limit, no room to store it) comes back
   * as the status line instead, with no `record`, so the preview keeps showing
   * what is really on screen.
   */
  async function changeBackground(payload) {
    const previous = background;
    try {
      if (payload.action === 'clear') {
        background = await withOwnWrite(() => Backgrounds.clear());
        Backgrounds.apply(background);
        return { value: { record: null } };
      }

      const record = await Backgrounds.fromFile(payload.file);

      // On screen first. Writing megabytes to storage is the slow half and the
      // half that can fail; the picture should not wait on it, and the settings
      // dialog is not the only place it has to show up.
      Backgrounds.apply(record);
      try {
        // Same `src`, so this does not repaint - it is the stored record, name
        // and timestamp included, that the rest of the page goes on to use.
        background = await withOwnWrite(() => Backgrounds.save(record));
      } catch (err) {
        Backgrounds.apply(previous);
        throw err;
      }

      return {
        value: { record: background },
        status: {
          kind: 'ok',
          text: settings.bgDim >= 80
            ? 'Set — turn Dim down to see more of it.'
            : 'Background set.'
        }
      };
    } catch (err) {
      return { value: {}, status: { kind: 'error', text: err.message } };
    }
  }

  async function onSettingChange(key, value) {
    if (key === 'font') return changeFont(value);
    if (key === 'deepIcons') return changeDeepIcons(value);
    if (key === 'background') return changeBackground(value);

    const effective = updateSetting(key, value);
    // These change the tile markup itself, not just a variable.
    if (key === 'openInNewTab') render();
    return { value: effective };
  }

  function mountSettings() {
    // `background` is an external field: it has no place in `settings`, so it
    // is handed to the dialog on the side.
    SettingsUI.mount(settingsBody, {
      values: { ...settings, background },
      onChange: onSettingChange
    });
  }

  /**
   * The permission is what actually enables deep lookup, so it wins over the
   * stored flag - granting or revoking it in about:addons is picked up here.
   */
  async function syncSiteAccess() {
    if (!Favicons.supportsPermissions) return;

    siteAccessGranted = await Favicons.hasSiteAccess();
    if (settings.deepIcons === siteAccessGranted) return;

    updateSetting('deepIcons', siteAccessGranted);
    await Favicons.clearCache();
    render();
    if (!settingsModal.hidden) mountSettings();
  }

  btnSettings.addEventListener('click', () => {
    mountSettings();
    openDialog(settingsModal);
    syncSiteAccess();
  });

  btnSettingsClose.addEventListener('click', () => closeDialog(settingsModal));

  settingsForm.addEventListener('submit', e => {
    e.preventDefault();
    closeDialog(settingsModal);
  });

  btnResetSettings.addEventListener('click', async () => {
    settings = await withOwnWrite(() => Store.resetSettings());
    background = await withOwnWrite(() => Backgrounds.clear());
    Backgrounds.apply(background);
    applySettings();
    Fonts.use(settings.font).catch(() => {});
    mountSettings();
    render();
  });

  // ------------------------------------------------------------ page shape

  /** Lets the settings preview crop the picture exactly as the page does. */
  function trackPageShape() {
    const set = () => {
      const { innerWidth: w, innerHeight: h } = window;
      // A zero would make the ratio invalid and leave the preview shapeless.
      if (!w || !h) return;
      document.documentElement.style.setProperty('--page-ratio', `${w} / ${h}`);
    };
    set();
    window.addEventListener('resize', set);
  }

  // ---------------------------------------------------------------- clock

  function tick() {
    const now = new Date();

    clock.textContent = now.toLocaleTimeString([], settings.clock24
      ? { hour: '2-digit', minute: '2-digit', hour12: false }
      : { hour: 'numeric', minute: '2-digit', hour12: true });

    dateLine.textContent = now.toLocaleDateString([], {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }

  // ---------------------------------------------------------------- boot

  (async function init() {
    Icons.hydrate();

    [tiles, settings, background] = await Promise.all([
      Store.load(), Store.loadSettings(), Store.loadBackground()
    ]);

    trackPageShape();
    applySettings();
    Backgrounds.apply(background);
    Fonts.use(settings.font).catch(() => Fonts.applyStack(Schema.DEFAULTS.font));
    render();

    syncSiteAccess();
    Favicons.onAccessChange(() => syncSiteAccess());

    setInterval(tick, 10000);

    Store.onExternalChange((key, value) => {
      if (ownWrite) return;
      if (key === 'tiles' && !dragEl) {
        tiles = value;
        render();
      } else if (key === 'settings') {
        settings = value;
        applySettings();
        Fonts.use(settings.font).catch(() => {});
        if (!settingsModal.hidden) mountSettings();
        render();
      } else if (key === 'background') {
        background = value;
        Backgrounds.apply(background);
        if (!settingsModal.hidden) mountSettings();
      }
    });
  })();
})();
