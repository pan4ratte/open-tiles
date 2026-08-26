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
  const fieldGroup = document.getElementById('fieldGroup');
  const fieldIcon = document.getElementById('fieldIcon');
  const fieldIconFile = document.getElementById('fieldIconFile');
  const btnIconFile = document.getElementById('btnIconFile');
  const btnAddTile = document.getElementById('btnAddTile');

  const groupBar = document.getElementById('groupBar');
  const groupChips = document.getElementById('groupChips');
  const groupModal = document.getElementById('groupModal');
  const groupForm = document.getElementById('groupForm');
  const groupModalTitle = document.getElementById('groupModalTitle');
  const fieldGroupName = document.getElementById('fieldGroupName');
  const groupError = document.getElementById('groupError');
  const btnGroupCancel = document.getElementById('btnGroupCancel');
  const btnGroupDelete = document.getElementById('btnGroupDelete');

  const settingsModal = document.getElementById('settings');
  const settingsForm = document.getElementById('settingsForm');
  const settingsBody = document.getElementById('settingsBody');
  const btnSettings = document.getElementById('btnSettings');
  const btnSettingsClose = document.getElementById('btnSettingsClose');

  /** @type {{id:string,url:string,title:string,groupId:?string,
   *   icon:string,bg:string,visits:number}[]} */
  let tiles = [];
  /** @type {{id:string,name:string}[]} the chips across the top */
  let groups = [];
  /** id of the group being shown, or null for all of them */
  let activeGroup = null;
  /** @type {object} see schema.js */
  let settings = { ...Schema.DEFAULTS };
  /** @type {?{src:string,name:string,savedAt:number}} page picture */
  let background = null;
  /** id of the tile currently open in the modal, or null when adding */
  let editingId = null;
  /** id of the group currently open in its dialog, or null when adding */
  let editingGroupId = null;
  /** element being dragged, or null */
  let dragEl = null;
  /** the group chip being dragged to a new place in the block, or null */
  let dragChip = null;
  /** set when a drag ended on a group chip, so the drop is saved as a move */
  let movedGroup = false;
  /** whether the add-on currently holds access to all sites (deep icon lookup).
   *  Cached because the permission request must not be preceded by an await. */
  let siteAccessGranted = false;
  /** bumped on every render so late icon lookups can tell they are stale */
  let renderToken = 0;

  // ---------------------------------------------------------------- helpers

  /* Apple's system colours rather than fixed hex, so a monogram brightens in
     dark mode along with everything else. */
  const TILE_COLORS = [
    'var(--system-blue)', 'var(--system-red)', 'var(--system-green)',
    'var(--system-purple)', 'var(--system-orange)', 'var(--system-teal)',
    'var(--system-pink)', 'var(--system-indigo)'
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

  /** Tile shape -> the width : height ratio the tile's box takes. */
  const TILE_RATIOS = {
    square: 1,
    circle: 1,
    '3:2': 3 / 2,
    '16:10': 16 / 10,
    '16:9': 16 / 9
  };

  function applySettings() {
    const root = document.documentElement;

    root.dataset.theme = settings.theme;
    root.style.setProperty('--accent', settings.accent);
    root.style.setProperty('--tile-size', settings.tileSize + 'px');
    root.style.setProperty('--gap', settings.gap + 'px');
    // The shape is a ratio plus, for a circle, a border radius the stylesheet
    // cannot work out from the ratio alone.
    root.style.setProperty('--tile-ratio', TILE_RATIOS[settings.tileShape] || 1);
    root.style.setProperty('--logo-pad', settings.logoPad / 100);
    document.body.classList.toggle('tile-round', settings.tileShape === 'circle');
    root.style.setProperty('--bg-blur', settings.bgBlur + 'px');
    root.style.setProperty('--bg-dim', settings.bgDim / 100);

    const fixedColumns = settings.columns !== 'auto';
    grid.classList.toggle('is-fixed-columns', fixedColumns);
    if (fixedColumns) root.style.setProperty('--columns', settings.columns);

    document.body.classList.toggle('no-labels', !settings.showLabels);
    // With the + gone from the grid there has to be one somewhere, or a tile
    // cannot be added at all.
    btnAddTile.hidden = settings.showAddButton;

    const bar = settings.groupStyle === 'bar';
    document.body.classList.toggle('gb-bar', bar);
    document.body.classList.toggle('gb-floating', !bar);
    // Only a status bar can sit at the bottom; the floating block is a lid.
    document.body.classList.toggle('gb-bottom', bar && settings.groupEdge === 'bottom');
    document.body.classList.toggle('gb-hover', settings.groupShow === 'hover');
    root.style.setProperty('--groupbar-align', ALIGNMENT[settings.groupAlign]);

    clock.hidden = !settings.showClock;
    dateLine.hidden = !settings.showDate;
    header.hidden = !settings.showClock && !settings.showDate;

    tick();
  }

  // ------------------------------------------------------------------ groups

  const ALIGNMENT = { start: 'flex-start', center: 'center', end: 'flex-end' };

  /** The group a tile is in, or null when it is loose or its group has gone. */
  function groupOf(tile) {
    return groups.some(group => group.id === tile.groupId) ? tile.groupId : null;
  }

  /**
   * The tiles on screen: the group filter, then the order.
   *
   * Sorting by visits is a view of the list, not a rewrite of it - the stored
   * order stays the one that was dragged, so turning "Most visited" back off
   * puts the grid back exactly as it was rather than baked into a new order.
   */
  function tilesInView() {
    const shown = activeGroup
      ? tiles.filter(tile => groupOf(tile) === activeGroup)
      : tiles;

    if (settings.tileOrder !== 'visits') return shown;

    // Slice first: sort is in place, and `shown` is the live array when no
    // group is picked. Ties keep the manual order behind them.
    return shown
      .map((tile, at) => ({ tile, at }))
      .sort((a, b) => (b.tile.visits - a.tile.visits) || (a.at - b.at))
      .map(entry => entry.tile);
  }

  /** Dropping a tile on a chip moves it into that group - or, on "All", out. */
  function acceptTiles(chip, id) {
    chip.addEventListener('dragover', e => {
      if (!dragEl) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      chip.classList.add('is-drop');
    });
    chip.addEventListener('dragleave', () => chip.classList.remove('is-drop'));
    chip.addEventListener('drop', e => {
      e.preventDefault();
      chip.classList.remove('is-drop');

      const tile = dragEl && tiles.find(t => t.id === dragEl.dataset.id);
      if (!tile || tile.groupId === id) return;
      tile.groupId = id;
      // dragend is still to come, and it is what saves and redraws.
      movedGroup = true;
    });
  }

  function buildChip(group) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    // The name sits in its own box: a flex item is what an ellipsis needs to
    // trim, and a long group name would otherwise be cut off mid-letter.
    const name = document.createElement('span');
    name.className = 'chip__name';
    name.textContent = group.name;
    chip.append(name);

    chip.title = group.id
      ? group.name + '\nDrag to reorder, right-click to rename or delete'
      : 'Every tile';

    const on = activeGroup === group.id;
    chip.classList.toggle('is-on', on);
    chip.setAttribute('aria-pressed', String(on));

    chip.addEventListener('click', () => {
      activeGroup = group.id;
      // Remembered whether or not the setting is on, so turning it on later
      // picks up where the last tab left off rather than starting blank.
      Store.saveActiveGroup(activeGroup);
      renderGroups();
      render();
    });

    if (group.id) {
      // "All" is not a group and cannot be moved; the real ones can, and each
      // carries its id so the new order can be read straight off the block.
      chip.dataset.groupId = group.id;
      chip.draggable = true;

      chip.addEventListener('contextmenu', e => {
        e.preventDefault();
        openGroupModal(group.id);
      });
    }

    acceptTiles(chip, group.id);
    return chip;
  }

  /** Spelt out while there are no groups yet, a bare + once there are. */
  function buildAddChip(compact) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip chip--add';
    chip.title = 'New group';
    chip.setAttribute('aria-label', 'New group');
    chip.append(Icons.create('plus', { size: 15 }));
    if (!compact) chip.append(document.createTextNode('New group'));
    chip.addEventListener('click', () => openGroupModal(null));
    return chip;
  }

  function renderGroups() {
    groupChips.textContent = '';

    const any = groups.length > 0;
    if (any) groupChips.append(buildChip({ id: null, name: 'All' }));
    groups.forEach(group => groupChips.append(buildChip(group)));
    groupChips.append(buildAddChip(any));

    // A picked group keeps the block on screen even in hover mode: filtered
    // tiles with nothing to say why would just look like missing ones.
    groupBar.classList.toggle('is-active', Boolean(activeGroup));
  }

  // -------------------------------------------------- reordering the chips

  /*
   * Groups are put in order the same way tiles are: the chip travels through
   * the block under the pointer, and where it is let go is where it stays.
   * Nothing is drawn to stand in for it - what is already on screen is the
   * answer, so there is nothing to reconcile when the drag ends.
   *
   * `dragChip` is what holds this apart from the other drag the block takes -
   * a *tile* dropped on a chip to be filed in that group. Exactly one of the
   * two is ever set, and each handler bows out when it is not its turn.
   */

  groupChips.addEventListener('dragstart', e => {
    const chip = e.target.closest('.chip[data-group-id]');
    if (!chip) return;

    dragChip = chip;
    e.dataTransfer.effectAllowed = 'move';
    // Firefox only starts a drag when some data is attached.
    e.dataTransfer.setData('text/plain', chip.dataset.groupId);
    // Keeps the block out of hiding for as long as the drag lasts.
    document.body.classList.add('is-dragging');
    requestAnimationFrame(() => chip.classList.add('is-dragging'));
  });

  groupChips.addEventListener('dragover', e => {
    if (!dragChip) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const over = e.target.closest('.chip[data-group-id]');
    if (!over || over === dragChip) return;

    const rect = over.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;

    // Only ever moved among the other groups: "All" holds the front of the
    // block and the + holds the back, and neither has a data-group-id.
    if (before && over.previousElementSibling !== dragChip) {
      groupChips.insertBefore(dragChip, over);
    } else if (!before && over.nextElementSibling !== dragChip) {
      groupChips.insertBefore(dragChip, over.nextElementSibling);
    }
  });

  groupChips.addEventListener('drop', e => {
    if (dragChip) e.preventDefault();
  });

  groupChips.addEventListener('dragend', async () => {
    if (!dragChip) return;

    dragChip.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging');
    dragChip = null;

    const order = [...groupChips.querySelectorAll('.chip[data-group-id]')]
      .map(chip => chip.dataset.groupId);

    const byId = new Map(groups.map(group => [group.id, group]));
    const next = order.map(id => byId.get(id)).filter(Boolean);

    // A short read means the block and the list have drifted apart - another
    // new-tab page deleting a group mid-drag, say. Leaving the saved order
    // alone is better than writing a truncated one.
    if (next.length !== groups.length) return;

    groups = next;
    await persistGroups();
    renderGroups();
  });

  // ---------------------------------------------------------------- rendering

  /**
   * Black or white, whichever will be read more easily on `hex`.
   *
   * The threshold is on relative luminance rather than plain brightness, so a
   * saturated yellow is treated as the light colour it is - the standard sRGB
   * weights, written out here rather than pulled in for six lines of it.
   */
  function readableInk(hex) {
    const n = parseInt(hex.slice(1), 16);
    const channel = c => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const luminance = 0.2126 * channel((n >> 16) & 255)
      + 0.7152 * channel((n >> 8) & 255)
      + 0.0722 * channel(n & 255);

    // Roughly where the contrast against white and against black is equal.
    return luminance > 0.18 ? '#1c1c1e' : '#ffffff';
  }

  /**
   * A tile's own background colour, if it has one, and the ink to go on it.
   *
   * The class is what the stylesheet keys the "no text shadow over a picture"
   * exception off: a tile standing on its own colour is not standing on the
   * picture, and its ink was already chosen to read against that colour.
   */
  function applyTileBg(el, hex) {
    el.classList.toggle('has-own-bg', Boolean(hex));
    if (hex) {
      el.style.setProperty('--tile-bg', hex);
      el.style.setProperty('--tile-ink', readableInk(hex));
    } else {
      el.style.removeProperty('--tile-bg');
      el.style.removeProperty('--tile-ink');
    }
  }

  /** Monogram shown until the site's real icon arrives, or when there is none. */
  function buildFallback(label, seed) {
    const el = document.createElement('span');
    el.className = 'tile__fallback';
    el.style.background = colorFor(seed);
    el.dataset.seed = seed;

    const first = label.trim().charAt(0);
    if (/[\p{L}\p{N}]/u.test(first)) {
      el.textContent = first.toUpperCase();
    } else {
      el.append(Icons.create('globe', { size: 22 }));
    }
    return el;
  }

  /**
   * Puts a picture on a tile, and takes the monogram away once it has loaded -
   * not before, so a picture that never arrives leaves the letter standing
   * rather than an empty square.
   */
  function paintIcon(el, url) {
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
    img.src = url;

    el.prepend(img);
  }

  /**
   * Swaps the monogram for the sharpest icon the site offers, once found.
   *
   * Only tiles without a picture of their own come here. The lookup is slow
   * enough that the grid may have been rebuilt, or this tile dropped from it,
   * by the time it answers - hence both guards.
   */
  async function attachIcon(el, tile, token) {
    const found = await Favicons.resolve(tile.url, { deep: settings.deepIcons });
    if (!found || token !== renderToken || !el.isConnected) return;
    paintIcon(el, found.url);
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
    applyTileBg(el, tile.bg);

    const text = document.createElement('span');
    text.className = 'tile__label';
    text.textContent = label;

    el.append(buildFallback(label, tile.url), text);

    if (settings.showVisits && tile.visits > 0) {
      const badge = document.createElement('span');
      badge.className = 'tile__visits';
      // Past a thousand the exact number stops meaning anything and the badge
      // stops fitting, which is the same point to round at.
      badge.textContent = tile.visits > 999
        ? Math.round(tile.visits / 100) / 10 + 'k'
        : String(tile.visits);
      badge.title = tile.visits + ' visits from here';
      el.append(badge);
    }

    // A tile that names its own picture uses it and asks the network nothing;
    // that is the point of setting one. It goes on now rather than later,
    // because there is nothing to wait for.
    if (tile.icon) paintIcon(el, tile.icon);
    else attachIcon(el, tile, token);

    return el;
  }

  /**
   * Counts an open.
   *
   * The write is not awaited and not batched: this page is usually on its way
   * out when a tile is clicked, so the call has to be made while there is
   * still a page to make it from. A count that misses now and then is the
   * cost, and it is the right thing to lose.
   */
  function countVisit(id) {
    const tile = tiles.find(t => t.id === id);
    if (!tile) return;

    tile.visits += 1;
    Store.save(tiles).catch(() => {});

    // Re-sorting the grid under the pointer mid-click would be startling, so
    // the new order waits for the next new tab.
    if (settings.showVisits) render();
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
    const shown = tilesInView();

    grid.textContent = '';
    shown.forEach(tile => grid.append(buildTile(tile, token)));
    if (settings.showAddButton) grid.append(buildAddButton());

    empty.hidden = shown.length > 0;
    if (!shown.length) {
      empty.textContent = activeGroup
        ? 'Nothing in this group yet - drag a tile onto its name to put it here.'
        : 'No tiles yet. Hit + to add your first site.';
    }
  }

  // ---------------------------------------------------------------- persistence

  /* Nothing here guards against the page hearing its own writes back: storage.js
     drops that echo at the source, by the value written, which is the only way
     to tell it apart that does not depend on when the browser gets round to
     firing the event. */

  async function persistTiles() {
    tiles = await Store.save(tiles);
  }

  async function persistGroups() {
    groups = await Store.saveGroups(groups);
  }

  let persistTimer;

  /** Settings apply instantly; the write is batched so dragging a slider
   *  does not hammer storage. */
  function updateSetting(key, value) {
    settings = Schema.coerce({ ...settings, [key]: value });
    applySettings();

    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => Store.saveSettings(settings), 250);

    return settings[key];
  }

  /**
   * Reads the current DOM order back into `tiles`.
   *
   * Only the tiles on screen can have moved, so they are poured back into the
   * slots they held between them - which leaves the ones a group filter is
   * hiding exactly where they were.
   */
  function syncOrderFromDom() {
    // What is on screen is a sort, not the list: reading it back would write
    // the sorted order over the one that was dragged into place.
    if (settings.tileOrder !== 'manual') return;

    const byId = new Map(tiles.map(t => [t.id, t]));
    const shown = [...grid.querySelectorAll('.tile[data-id]')]
      .map(el => byId.get(el.dataset.id))
      .filter(Boolean);

    const ids = new Set(shown.map(t => t.id));
    let next = 0;
    tiles = tiles.map(tile => (ids.has(tile.id) ? shown[next++] : tile));
  }

  // ---------------------------------------------------------------- drag & drop

  grid.addEventListener('dragstart', e => {
    const el = e.target.closest('.tile[data-id]');
    if (!el) return;
    dragEl = el;
    grid.classList.add('is-dragging');
    // Brings the group block out of hiding, so a tile can be dropped on it.
    document.body.classList.add('is-dragging');
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

  grid.addEventListener('dragend', async () => {
    if (!dragEl) return;
    dragEl.classList.remove('is-dragging');
    grid.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging');
    dragEl = null;

    syncOrderFromDom();
    await persistTiles();

    // The drop landed on a group chip, so what is on screen has changed.
    if (movedGroup) {
      movedGroup = false;
      render();
    }
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
    // The colour picker's popover lives in the body rather than in the sheet
    // that opened it, so hiding the sheet would leave it standing on its own.
    SettingsUI.closePicker();
    el.hidden = true;
  }

  [modal, groupModal, settingsModal].forEach(el => {
    el.addEventListener('mousedown', e => {
      if (e.target === el) closeDialog(el);
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!settingsModal.hidden) closeDialog(settingsModal);
    else if (!groupModal.hidden) closeDialog(groupModal);
    else if (!modal.hidden) closeDialog(modal);
  });

  // ---------------------------------------------------------------- tile dialog

  /** "No group" plus one option per group; nothing at all until there are any. */
  function fillGroupSelect(selected) {
    fieldGroup.textContent = '';

    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'No group';
    fieldGroup.append(none);

    groups.forEach(group => {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.name;
      fieldGroup.append(option);
    });

    fieldGroup.value = selected || '';
    fieldGroup.closest('.field').hidden = groups.length === 0;
  }

  // ------------------------------------------------------- the tile preview

  /**
   * The tile being edited, drawn the way the grid will draw it.
   *
   * It is a real `.tile` with the real children, so shape, corner, logo
   * padding, whether the name shows and the material behind it all come from
   * the same rules and the same custom properties the grid reads. Nothing here
   * restates any of them, which is the point: a preview that is only nearly
   * right is worse than none.
   */
  let previewBg = '';
  /** Bumped on every repaint, so a slow icon lookup can tell it is stale. */
  let previewToken = 0;

  function previewFields() {
    const raw = fieldUrl.value.trim();
    const url = normalizeUrl(raw) || raw;
    return {
      url,
      label: fieldTitle.value.trim() || (url ? defaultTitle(url) : 'Example'),
      icon: fieldIcon.value.trim()
    };
  }

  function paintPreview() {
    const token = ++previewToken;
    const { url, label, icon } = previewFields();

    tilePreview.textContent = '';
    applyTileBg(tilePreview, previewBg);

    // Everything inside a tile is worked out from its width, so capping that
    // one property here scales the whole preview down faithfully - a sheet
    // this wide has nowhere to put a 200px tile.
    tilePreview.style.setProperty('--tile-size',
      Math.min(settings.tileSize, 132) + 'px');

    const text = document.createElement('span');
    text.className = 'tile__label';
    text.textContent = label;

    tilePreview.append(buildFallback(label, url || label), text);

    if (icon) {
      paintIcon(tilePreview, icon);
    } else if (url) {
      // The same lookup the grid does, so what is on show here is what will be
      // on the tile - and what the pipette has to work with.
      Favicons.resolve(url, { deep: settings.deepIcons })
        .then(found => {
          if (found && token === previewToken) paintIcon(tilePreview, found.url);
        })
        .catch(() => {});
    }

    armPipette(false);
  }

  /** Typing an address should not fire a lookup on every keystroke. */
  let previewTimer;
  function schedulePreview(immediate) {
    clearTimeout(previewTimer);
    if (immediate) paintPreview();
    else previewTimer = setTimeout(paintPreview, 400);
  }

  fieldUrl.addEventListener('input', () => schedulePreview());
  fieldTitle.addEventListener('input', () => schedulePreview());
  fieldIcon.addEventListener('input', () => schedulePreview(true));

  btnIconFile.addEventListener('click', () => fieldIconFile.click());

  fieldIconFile.addEventListener('change', async () => {
    const picked = fieldIconFile.files && fieldIconFile.files[0];
    fieldIconFile.value = '';
    if (!picked) return;

    try {
      fieldIcon.value = await Favicons.fromFile(picked);
      paintPreview();
    } catch (err) {
      SettingsUI.setStatus(modalError, { kind: 'error', text: err.message });
    }
  });

  // ---------------------------------------------------- the background well

  /**
   * The colour well, built from the same picker the accent colour uses and
   * rebuilt whenever the sheet opens - the popover it hangs off has to go with
   * it, and there is only ever one of these on screen.
   */
  let bgWell = null;

  function mountBgWell(value) {
    if (bgWell) bgWell.remove();

    const built = SettingsUI.colorControl(
      { key: 'tileBg', label: 'Tile background', default: '#007aff' },
      // With no colour set the picker still has to open on something, and the
      // tile's own monogram colour is the one already on screen.
      value || colorFor(previewFields().url || 'tile'),
      hex => { setPreviewBg(hex); return hex; }
    );

    bgWell = built.control;
    tileBgRow.prepend(bgWell);
  }

  function setPreviewBg(hex) {
    previewBg = hex || '';
    applyTileBg(tilePreview, previewBg);
    btnBgClear.hidden = !previewBg;
  }

  btnBgClear.addEventListener('click', () => {
    setPreviewBg('');
    mountBgWell('');
    armPipette(false);
  });

  // ------------------------------------------------------------ the pipette

  /**
   * Taking a colour straight out of the icon.
   *
   * Reading a picture's pixels means drawing it to a canvas, which the browser
   * only allows for one it is sure this page is entitled to read: stored
   * inline, or served by a host that said so. A remote icon whose host says
   * nothing cannot be sampled, and the button says so rather than going quiet.
   *
   * The canvas is square and the picture is fitted into it exactly as the tile
   * fits it, so a point on the icon is the same point on the canvas once it
   * has been scaled - no arithmetic about letterboxing.
   */
  const sampler = { canvas: null, ctx: null, ready: false };
  let pipetteOn = false;

  const iconEl = () => tilePreview.querySelector('img.tile__icon');

  function loadForSampling(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  /** @returns {boolean} whether the drawn picture can actually be read back */
  function drawForSampling(img) {
    const side = 128;
    const canvas = sampler.canvas || document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, side, side);

    const scale = Math.min(side / img.naturalWidth, side / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, (side - w) / 2, (side - h) / 2, w, h);

    try {
      // The read is what decides it: a tainted canvas throws here, not above.
      ctx.getImageData(0, 0, 1, 1);
    } catch {
      return false;
    }

    sampler.canvas = canvas;
    sampler.ctx = ctx;
    return true;
  }

  /** Gets the icon ready to be read from, if it can be. */
  async function prepareSampler() {
    const img = iconEl();
    sampler.ready = false;
    if (!img || !img.naturalWidth) return false;

    // A picture already on the page and readable - anything stored inline.
    if (drawForSampling(img)) {
      sampler.ready = true;
      return true;
    }

    // Otherwise ask for it again, this time as a request the host has to agree
    // to. Most icon hosts do; the ones that do not cannot be sampled.
    const cors = await loadForSampling(img.src);
    sampler.ready = Boolean(cors && cors.naturalWidth && drawForSampling(cors));
    return sampler.ready;
  }

  const toHex = (r, g, b) => '#' + [r, g, b]
    .map(n => n.toString(16).padStart(2, '0')).join('');

  function parseCssColor(value) {
    const hit = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value || '');
    return hit ? toHex(Number(hit[1]), Number(hit[2]), Number(hit[3])) : null;
  }

  /** With no icon there is still a monogram, and it is a colour on the tile. */
  function colorUnderFallback(event) {
    const fallback = tilePreview.querySelector('.tile__fallback');
    if (!fallback) return null;

    const box = fallback.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right
      && event.clientY >= box.top && event.clientY <= box.bottom;

    return inside ? parseCssColor(getComputedStyle(fallback).backgroundColor) : null;
  }

  /** The colour under the pointer, or null where there is nothing to read. */
  function sampleAt(event) {
    const img = iconEl();
    if (!img) return colorUnderFallback(event);
    if (!sampler.ready) return null;

    const box = img.getBoundingClientRect();
    // An icon still loading is hidden, so it has no box to point at - and
    // dividing by that width would put NaN through the whole sum.
    if (!box.width || !box.height) return null;

    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;

    const px = Math.min(sampler.canvas.width - 1, Math.floor(x * sampler.canvas.width));
    const py = Math.min(sampler.canvas.height - 1, Math.floor(y * sampler.canvas.height));
    const [r, g, b, a] = sampler.ctx.getImageData(px, py, 1, 1).data;

    // Clear pixels are the space around a logo, not a colour it is made of.
    return a < 24 ? null : toHex(r, g, b);
  }

  function hint(text) {
    pipetteHint.textContent = text || '';
    pipetteHint.hidden = !text;
  }

  async function armPipette(on) {
    if (on && !pipetteOn && iconEl() && !(await prepareSampler())) {
      hint('That icon will not let itself be read — try one from a file.');
      return;
    }

    pipetteOn = on;
    tilePreview.classList.toggle('is-sampling', on);
    btnPipette.classList.toggle('is-on', on);
    btnPipette.setAttribute('aria-pressed', String(on));
    hint(on ? 'Click the icon to take its colour.' : '');
  }

  btnPipette.addEventListener('click', () => armPipette(!pipetteOn));

  tilePreview.addEventListener('pointermove', e => {
    if (!pipetteOn) return;
    const hex = sampleAt(e);
    hint(hex ? hex.toUpperCase() : 'Point at the icon.');
  });

  tilePreview.addEventListener('click', e => {
    if (!pipetteOn) return;
    const hex = sampleAt(e);
    if (!hex) return;

    setPreviewBg(hex);
    mountBgWell(hex);
    armPipette(false);
  });

  function openTileModal(id) {
    editingId = id;
    const tile = id ? tiles.find(t => t.id === id) : null;

    modalTitle.textContent = tile ? 'Edit tile' : 'Add tile';
    fieldUrl.value = tile ? tile.url : '';
    fieldTitle.value = tile ? tile.title : '';
    fieldIcon.value = tile ? tile.icon : '';
    // A tile added while a group is being shown belongs to that group.
    fillGroupSelect(tile ? groupOf(tile) : activeGroup);
    btnDelete.hidden = !tile;
    modalError.hidden = true;

    // The colour first: the preview is painted from it.
    previewBg = tile ? tile.bg : '';
    btnBgClear.hidden = !previewBg;
    mountBgWell(previewBg);
    paintPreview();

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
    const groupId = fieldGroup.value || null;
    const icon = fieldIcon.value.trim();
    const bg = previewBg;

    if (editingId) {
      const tile = tiles.find(t => t.id === editingId);
      if (tile) Object.assign(tile, { url, title, groupId, icon, bg });
    } else {
      tiles.push({ id: crypto.randomUUID(), url, title, groupId, icon, bg, visits: 0 });
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

  // Opening a tile is what a visit is. The click is not intercepted - the link
  // does its own navigating - only counted on the way past.
  grid.addEventListener('click', e => {
    const el = e.target.closest('.tile[data-id]');
    if (el) countVisit(el.dataset.id);
  });

  btnAddTile.addEventListener('click', () => openTileModal(null));

  // Right-click a tile to edit it.
  grid.addEventListener('contextmenu', e => {
    const el = e.target.closest('.tile[data-id]');
    if (!el) return;
    e.preventDefault();
    openTileModal(el.dataset.id);
  });

  // --------------------------------------------------------------- group dialog

  function openGroupModal(id) {
    editingGroupId = id;
    const group = id ? groups.find(g => g.id === id) : null;

    groupModalTitle.textContent = group ? 'Edit group' : 'New group';
    fieldGroupName.value = group ? group.name : '';
    btnGroupDelete.hidden = !group;
    groupError.hidden = true;

    openDialog(groupModal, fieldGroupName);
  }

  groupForm.addEventListener('submit', async e => {
    e.preventDefault();

    const name = fieldGroupName.value.trim();
    if (!name) {
      SettingsUI.setStatus(groupError, { kind: 'error', text: 'Give the group a name.' });
      return;
    }
    if (!editingGroupId && groups.length >= Store.MAX_GROUPS) {
      SettingsUI.setStatus(groupError, {
        kind: 'error',
        text: `That is as many groups as there is room for (${Store.MAX_GROUPS}).`
      });
      return;
    }

    if (editingGroupId) {
      const group = groups.find(g => g.id === editingGroupId);
      if (group) group.name = name;
    } else {
      // The view stays where it is: a brand new group is empty, and tiles are
      // dragged into it from whatever is on screen now.
      groups.push({ id: crypto.randomUUID(), name });
    }

    await persistGroups();
    renderGroups();
    render();
    closeDialog(groupModal);
  });

  btnGroupCancel.addEventListener('click', () => closeDialog(groupModal));

  btnGroupDelete.addEventListener('click', async () => {
    const id = editingGroupId;
    groups = groups.filter(g => g.id !== id);
    // The group goes; its tiles stay, loose.
    tiles.forEach(tile => { if (tile.groupId === id) tile.groupId = null; });
    if (activeGroup === id) activeGroup = null;

    await persistGroups();
    await persistTiles();
    renderGroups();
    render();
    closeDialog(groupModal);
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
        background = await Backgrounds.clear();
        Backgrounds.apply(background);
        return { value: { record: null } };
      }

      const record = payload.action === 'url'
        ? await Backgrounds.fromUrl(payload.url)
        : await Backgrounds.fromFile(payload.file);

      // On screen first. Writing megabytes to storage is the slow half and the
      // half that can fail; the picture should not wait on it, and the settings
      // dialog is not the only place it has to show up.
      Backgrounds.apply(record);
      try {
        // Same `src`, so this does not repaint - it is the stored record, name
        // and timestamp included, that the rest of the page goes on to use.
        background = await Backgrounds.save(record);
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
            : payload.action === 'url'
              ? 'Background set. It is fetched from that address on every new tab.'
              : 'Background set.'
        }
      };
    } catch (err) {
      return { value: {}, status: { kind: 'error', text: err.message } };
    }
  }

  /**
   * Export and import.
   *
   * Export is a file the browser saves; there is nothing to change on the page,
   * so it answers with a status line and no more.
   *
   * Import puts a whole page's worth of state back at once. Each section goes
   * in through the same call the page uses to save it normally, so a file that
   * has been hand-edited, or written by an older build, is sanitized exactly
   * as anything else is - and the value that comes back is the cleaned one to
   * carry on with. A section the file does not carry is left alone.
   */
  async function changeTransfer(payload) {
    if (payload.action === 'export') {
      try {
        const name = Transfer.save({ settings, tiles, groups, background });
        return { value: null, status: { kind: 'ok', text: `Saved as ${name}.` } };
      } catch (err) {
        return { value: null, status: { kind: 'error', text: err.message } };
      }
    }

    let doc;
    try {
      doc = await Transfer.read(payload.file);
    } catch (err) {
      return { value: null, status: { kind: 'error', text: err.message } };
    }

    try {
      return await applyImport(doc);
    } catch (err) {
      // A storage area with no room left in it, most likely. Whatever landed
      // before it gave out is on screen, so the dialog is rebuilt around what
      // is really there rather than left showing the values it started with.
      mountSettings({
        backup: {
          kind: 'error',
          text: `The restore stopped part way through: ${err.message}`
        }
      });
      return { value: null };
    }
  }

  /**
   * What a file from another add-on held that there is nowhere to put. Saying
   * so is the point: an icon that silently turned into a different icon is the
   * kind of thing somebody notices a week later and cannot explain.
   */
  function leftBehind(dropped) {
    if (!dropped) return '';

    const lost = [];
    if (dropped.stats) lost.push('the time-of-day split behind the visit counts');
    if (dropped.colours) lost.push('group colours');
    if (!lost.length) return '';

    return ` It also held ${summarize(lost)}, which this add-on has nowhere to keep.`;
  }

  /** "3 groups, 12 tiles and your settings" - what an import actually did. */
  function summarize(parts) {
    if (parts.length < 2) return parts[0] || 'nothing';
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  async function applyImport(doc) {
    const sections = doc.sections;
    const done = [];
    // The picture is the one part that can be refused on its own (too big for
    // the storage area), and the least of what a backup carries - so it is
    // reported beside the restore rather than sinking it.
    let pictureFailed = false;

    if ('groups' in sections) {
      groups = await Store.saveGroups(sections.groups);
      if (activeGroup && !groups.some(g => g.id === activeGroup)) activeGroup = null;
      done.push(plural(groups.length, 'group'));
    }

    if ('tiles' in sections) {
      tiles = await Store.save(sections.tiles);
      done.push(plural(tiles.length, 'tile'));
    }

    if ('settings' in sections) {
      // One of ours is coerced first, so a key it is missing comes back as its
      // default rather than keeping whatever is set now: a restore, not a merge.
      //
      // A file from another add-on is the other way about. It speaks to a
      // handful of settings and says nothing at all about the rest, so it is
      // merged in - importing one should not put the accent colour back to
      // blue on the way past.
      settings = await Store.saveSettings(doc.partialSettings
        ? sections.settings
        : Schema.coerce(sections.settings));
      done.push(doc.partialSettings ? 'some settings' : 'your settings');
    }

    if ('background' in sections) {
      try {
        background = sections.background
          ? await Backgrounds.save(sections.background)
          : await Backgrounds.clear();
        done.push('the background');
      } catch {
        pictureFailed = true;
      }
    }

    Backgrounds.apply(background);
    applySettings();
    Fonts.use(settings.font).catch(() => {});
    renderGroups();
    render();

    const refused = 'The background picture would not fit, so it was left as it is.';
    const from = doc.source ? ` from a ${doc.source} backup` : '';
    // A backup of nothing but a picture that was then refused restored nothing
    // at all, so there is only the refusal to report.
    const text = done.length
      ? `Restored ${summarize(done)}${from}.`
        + (pictureFailed ? ' ' + refused : '')
        + leftBehind(doc.dropped)
      : refused;

    // Every control in the dialog is now showing a value that changed under it,
    // so the whole thing is rebuilt - which takes the row waiting on this
    // status with it. The new mount is handed the line instead.
    mountSettings({ backup: { kind: pictureFailed ? 'error' : 'ok', text } });
    return { value: null };
  }

  /**
   * Reset lives in the dialog's "Other" section now, so it comes through as a
   * field change like everything else. It re-mounts the dialog to show every
   * control at its default - which is the confirmation, no status line needed.
   */
  async function resetSettings() {
    settings = await Store.resetSettings();
    background = await Backgrounds.clear();

    Backgrounds.apply(background);
    applySettings();
    Fonts.use(settings.font).catch(() => {});
    mountSettings();
    render();

    return { value: null };
  }

  /**
   * Settings the grid is built from rather than styled by: a custom property
   * cannot add a badge, take the + away or put the tiles in another order, so
   * these are the ones worth tearing the grid down for. Everything else is a
   * variable the stylesheet already reads.
   */
  const REBUILDS_GRID = new Set([
    'openInNewTab', 'showVisits', 'showAddButton', 'tileOrder'
  ]);

  async function onSettingChange(key, value) {
    if (key === 'font') return changeFont(value);
    if (key === 'reset') return resetSettings();
    if (key === 'deepIcons') return changeDeepIcons(value);
    if (key === 'background') return changeBackground(value);
    if (key === 'backup') return changeTransfer(value);

    const effective = updateSetting(key, value);
    if (REBUILDS_GRID.has(key)) render();
    return { value: effective };
  }

  /**
   * @param {Object<string, {kind:string, text:string}>} [status] lines to show
   *   under named fields, for a change that re-mounted the dialog out from
   *   under the row that would have shown its own.
   */
  function mountSettings(status) {
    // `background` is an external field: it has no place in `settings`, so it
    // is handed to the dialog on the side.
    SettingsUI.mount(settingsBody, {
      values: { ...settings, background },
      status,
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

    let remembered;
    [tiles, groups, settings, background, remembered] = await Promise.all([
      Store.load(), Store.loadGroups(), Store.loadSettings(), Store.loadBackground(),
      Store.loadActiveGroup()
    ]);

    // A group that has since been deleted is no group at all, and starting on
    // it would show an empty grid with no way to tell why.
    if (settings.keepGroup && groups.some(group => group.id === remembered)) {
      activeGroup = remembered;
    }

    trackPageShape();
    applySettings();
    Backgrounds.apply(background);
    Fonts.use(settings.font).catch(() => Fonts.applyStack(Schema.DEFAULTS.font));
    renderGroups();
    render();

    syncSiteAccess();
    Favicons.onAccessChange(() => syncSiteAccess());

    setInterval(tick, 10000);

    Store.onExternalChange((key, value) => {
      if (key === 'tiles' && !dragEl) {
        tiles = value;
        render();
      } else if (key === 'groups' && !dragChip) {
        groups = value;
        // The group being shown may be the one that just went.
        if (activeGroup && !groups.some(g => g.id === activeGroup)) activeGroup = null;
        renderGroups();
        render();
      } else if (key === 'settings') {
        const before = settings;
        settings = value;
        applySettings();

        // Almost every setting is a custom property the stylesheet reads, so
        // applySettings() has already done the whole job. Only the two that are
        // baked into a tile's markup are worth tearing the grid down for -
        // rebuilding it sends every icon back to the network.
        if (before.font !== settings.font) Fonts.use(settings.font).catch(() => {});
        if (before.deepIcons !== settings.deepIcons
            || [...REBUILDS_GRID].some(key => before[key] !== settings[key])) render();
        if (!settingsModal.hidden) mountSettings();
      } else if (key === 'background') {
        background = value;
        Backgrounds.apply(background);
        if (!settingsModal.hidden) mountSettings();
      } else if (key === 'activeGroup') {
        // Which group is being looked at is shared, the way everything else
        // here is - so picking one moves every open new tab to it.
        if (!settings.keepGroup) return;
        activeGroup = groups.some(group => group.id === value) ? value : null;
        renderGroups();
        render();
      }
    });
  })();
})();
