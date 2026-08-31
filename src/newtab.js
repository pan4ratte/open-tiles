(() => {
  'use strict';

  const t = I18N.t;

  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  // Where the group block goes when it is not floating over the page: into the
  // stack above the tiles, which is the header's own column.
  const toolbar = document.querySelector('.toolbar');
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
  const btnSave = document.getElementById('btnSave');
  const btnDelete = document.getElementById('btnDelete');
  const fieldGroup = document.getElementById('fieldGroup');
  const fieldIcon = document.getElementById('fieldIcon');
  const fieldIconFile = document.getElementById('fieldIconFile');
  const btnIconFile = document.getElementById('btnIconFile');
  const btnIconReload = document.getElementById('btnIconReload');
  const btnIconColorClear = document.getElementById('btnIconColorClear');
  const btnPadClear = document.getElementById('btnPadClear');
  const btnRoundClear = document.getElementById('btnRoundClear');
  const tileIconRow = document.getElementById('tileIconRow');
  const tilePadRow = document.getElementById('tilePadRow');
  const tileRoundRow = document.getElementById('tileRoundRow');
  const iconStatus = document.getElementById('iconStatus');
  const btnIconPipette = document.getElementById('btnIconPipette');

  const confirmAlert = document.getElementById('confirmAlert');
  const confirmText = document.getElementById('confirmText');
  const btnConfirmOk = document.getElementById('btnConfirmOk');
  const btnConfirmCancel = document.getElementById('btnConfirmCancel');

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
  const settingsTitle = document.getElementById('settingsTitle');
  const btnSettings = document.getElementById('btnSettings');
  const btnSettingsClose = document.getElementById('btnSettingsClose');

  /** @type {{id:string,url:string,title:string,groupId:?string,icon:string,
   *   iconColor:string,bg:string,pad:?number,round:number,visits:number}[]} */
  let tiles = [];
  /** @type {{id:string,name:string}[]} the chips across the top */
  let groups = [];
  /** id of the group being shown, or null for all of them */
  let activeGroup = null;
  /** @type {object} see schema.js */
  let settings = { ...Schema.DEFAULTS };
  /** @type {?{src:string,name:string,type:string,savedAt:number}} page background */
  let background = null;
  /** @type {object[]} the last few backgrounds, newest first - see storage.js */
  let recentBackgrounds = [];
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
    applyTileMaterial(root);
    root.style.setProperty('--bg-blur', settings.bgBlur + 'px');
    root.style.setProperty('--bg-dim', settings.bgDim / 100);
    // Where a picture taller than the window is cut. The same property drives
    // the picture, the film and the preview in the settings dialog, so all
    // three are cut at the same place.
    root.style.setProperty('--bg-pos-y', settings.bgPosY + '%');
    // Which is also the crop the tiles are drawn on, and the size and spacing
    // above decide where each of them is standing in it.
    placeFrostSoon();

    // Zero is the bottom of the Columns slider, where it reads "Auto" - see
    // the field in schema.js. Anything above it is a count.
    const fixedColumns = settings.columns > 0;
    grid.classList.toggle('is-fixed-columns', fixedColumns);
    if (fixedColumns) root.style.setProperty('--columns', settings.columns);

    document.body.classList.toggle('no-labels', !settings.showLabels);
    document.body.classList.toggle('no-toolbar', !settings.showSettingsButton);

    const bar = settings.groupStyle === 'bar';
    document.body.classList.toggle('gb-bar', bar);
    document.body.classList.toggle('gb-floating', !bar);
    // The bar's own edge. A floating block has an edge too, but it is a
    // different setting with a third place in it - see below.
    document.body.classList.toggle('gb-bottom', bar && settings.groupEdge === 'bottom');
    document.body.classList.toggle('gb-hover', settings.groupShow === 'hover');
    root.style.setProperty('--groupbar-align', ALIGNMENT[settings.groupAlign]);

    // Where the floating pill sits. Top and bottom hold it over the page at
    // that edge; "above the tiles" is not a float at all - it joins the stack
    // the tiles anchor, under the clock and over the grid.
    const inline = !bar && settings.groupFloat === 'tiles';
    document.body.classList.toggle('gb-inline', inline);
    document.body.classList.toggle('gb-float-bottom', !bar && settings.groupFloat === 'bottom');

    // That stack is the header's column, so the block has to be in it: laid
    // out with the clock rather than beside it, which is what lets it take
    // room without the tiles giving any up. Moved only when it is in the wrong
    // place, so a slider drag does not replay the pill's arrival every frame.
    const home = inline ? header : document.body;
    if (groupBar.parentElement !== home) {
      home.insertBefore(groupBar, inline ? null : toolbar);
    }

    applyHeaderType(root);

    clock.hidden = !settings.showClock;
    dateLine.hidden = !settings.showDate;
    // The column is the block's home in this placement, so it stays even with
    // nothing else in it to show.
    header.hidden = !settings.showClock && !settings.showDate && !inline;

    tick();
    scheduleTick();
  }

  /**
   * What one theme's tiles actually come out as, written down as flat colour.
   *
   * A tile is a material: a translucent fill over whatever the page is showing
   * through it. Handing the dark theme's fill to a light page would not give
   * the dark theme's tile, it would give a mid grey - the fill is only half of
   * the answer and the page behind it is the other half. So each of these is
   * that theme's --mat-thin already composited over that theme's own desktop,
   * which is the colour a reader asking for "the dark theme's" has in mind.
   *
   * Opaque, therefore, and deliberately: it is the same thing a tile given a
   * colour in its own sheet has always been, and it holds whatever is behind
   * it - a light page, a dark one, a photograph.
   */
  const TILE_MATERIALS = { dark: '#2f2f31', light: '#f2f2f4' };

  /**
   * The material every tile falls back to, and the ink that reads on it.
   *
   * Written as custom properties on the root rather than onto each tile,
   * because it is the fallback rather than the answer: a tile with a colour of
   * its own sets --tile-bg inline and wins the chain in the stylesheet without
   * either side having to know about the other. `theme` writes nothing at all,
   * which is what leaves the tiles as the frosted glass they have always been.
   */
  function applyTileMaterial(root) {
    const hex = settings.tileBg === 'custom'
      ? settings.tileBgColor
      : TILE_MATERIALS[settings.tileBg];

    // The class is for the two places over a picture where a tile standing in
    // a material of its own is not standing on the photograph - the same
    // exceptions has-own-bg already carries.
    document.body.classList.toggle('has-tile-mat', Boolean(hex));

    if (!hex) {
      ['--tile-mat', '--tile-mat-ink', '--tile-mat-ink-dim', '--tile-mat-ink-plate']
        .forEach(prop => root.style.removeProperty(prop));
      return;
    }

    const { ink, dim, plate } = readableInk(hex);
    root.style.setProperty('--tile-mat', hex);
    root.style.setProperty('--tile-mat-ink', ink);
    root.style.setProperty('--tile-mat-ink-dim', dim);
    root.style.setProperty('--tile-mat-ink-plate', plate);
  }

  /** The three fields that name a family, and so need one downloading. */
  const FONT_KEYS = ['font', 'clockFont', 'dateFont'];

  /**
   * The family a header line is actually drawn in: the one it names, or the
   * page's where it names none. An empty clock font is not "no font" the way an
   * empty page font is - it is the line saying it has no opinion.
   */
  const headerFamily = (key, view) => (view[key] || '').trim() || view.font;

  /**
   * Writes the three font stacks. `overrides` puts a family on the page before
   * it has been committed to `settings`, which is how a choice takes effect at
   * once without a font that turns out not to exist being stored.
   */
  function applyFontStacks(overrides) {
    const view = overrides ? { ...settings, ...overrides } : settings;
    Fonts.applyStack(view.font);
    Fonts.applyStack(headerFamily('clockFont', view), '--clock-font');
    Fonts.applyStack(headerFamily('dateFont', view), '--date-font');
  }

  /** Brings down whatever the settings name now, and drops the rest. */
  const loadFonts = () =>
    Fonts.sync(FONT_KEYS.map(key => headerFamily(key, settings))).catch(() => {});

  /**
   * How the time and the date are drawn: a face, a weight and a tracking each,
   * and a colour and a shadow they share.
   *
   * Every one of these is a custom property the stylesheet already reads with
   * its own value behind it, so a setting left alone is written as the property
   * not being there at all - which is why the colour and the shadow are removed
   * rather than set when they are off. That is what lets the shadow keep its
   * two meanings: none on a plain page, a soft one over a picture.
   */
  function applyHeaderType(root) {
    applyFontStacks();

    root.style.setProperty('--clock-weight', settings.clockWeight);
    root.style.setProperty('--date-weight', settings.dateWeight);
    // Size is a multiplier rather than a number of pixels: the stylesheet
    // still picks the size for the window - the clock shrinks on a narrow one
    // - and this scales whatever it arrives at.
    root.style.setProperty('--clock-scale', settings.clockSize / 100);
    root.style.setProperty('--date-scale', settings.dateSize / 100);
    // Tracking is set as a share of the type size, so it holds at every size
    // the clock is drawn at.
    root.style.setProperty('--clock-tracking', settings.clockTracking / 100 + 'em');
    root.style.setProperty('--date-tracking', settings.dateTracking / 100 + 'em');

    if (settings.headerTint) root.style.setProperty('--header-color', settings.headerColor);
    else root.style.removeProperty('--header-color');

    const shadow = settings.headerShadow / 100;
    if (shadow > 0) {
      root.style.setProperty('--header-shadow',
        `0 ${(1 + shadow).toFixed(2)}px ${(shadow * 26).toFixed(1)}px `
        + `rgba(0, 0, 0, ${(shadow * .75).toFixed(3)})`);
    } else {
      root.style.removeProperty('--header-shadow');
    }
  }

  // ------------------------------------------------------------------ groups

  const ALIGNMENT = { start: 'flex-start', center: 'center', end: 'flex-end' };

  /**
   * What scrolls when the page is taller than the window.
   *
   * Three things ask about it: the gesture, which gives way to it; the change
   * of group, which starts the new one at the end it is being entered from;
   * and the block set in the page, which is measured against it.
   */
  const scroller = () => document.scrollingElement || document.documentElement;

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
      ? t('group_chipTitle', group.name)
      : t('group_allTitle');

    const on = activeGroup === group.id;
    chip.classList.toggle('is-on', on);
    chip.setAttribute('aria-pressed', String(on));

    chip.addEventListener('click', () => switchGroup(group.id));

    if (group.id) {
      // "All" is not a group and cannot be moved; the real ones can, and each
      // carries its id so the new order can be read straight off the block.
      chip.dataset.groupId = group.id;
      chip.draggable = true;

      chip.addEventListener('contextmenu', e => {
        e.preventDefault();
        // The page's own menu is listening further up and would open over the
        // dialog this is about to raise.
        e.stopPropagation();
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
    chip.title = t('group_new');
    chip.setAttribute('aria-label', t('group_new'));
    chip.append(Icons.create('plus', { size: 15 }));
    if (!compact) chip.append(document.createTextNode(t('group_new')));
    chip.addEventListener('click', () => openGroupModal(null));
    return chip;
  }

  /**
   * Moves the page into the first group when "All" is not there to be on.
   *
   * With the chip hidden there is no way back to the unfiltered grid, so
   * sitting on it would strand the page somewhere the block cannot show - a
   * grid of everything with nothing lit to say so. The block is where "All"
   * either is or is not, so this is settled just before the chips are drawn;
   * every caller draws the grid straight after.
   */
  function settleActiveGroup() {
    if (settings.showAllGroup || activeGroup || !groups.length) return;
    activeGroup = groups[0].id;
    Store.saveActiveGroup(activeGroup);
  }

  function renderGroups() {
    settleActiveGroup();
    groupChips.textContent = '';

    const any = groups.length > 0;
    if (any && settings.showAllGroup) {
      groupChips.append(buildChip({ id: null, name: t('group_all') }));
    }
    groups.forEach(group => groupChips.append(buildChip(group)));
    if (settings.showGroupAdd) groupChips.append(buildAddChip(any));

    // With no groups and the + turned off there is nothing in the block, and
    // an empty pill floating over the page is just a smudge.
    groupBar.hidden = !any && !settings.showGroupAdd;

    // Once there are more chips than the block can show, the strip scrolls -
    // and the group being looked at has to be one of the chips on show. A
    // gesture that walked the selection off the end would otherwise look like
    // nothing happening at all. "nearest" moves it only when it has to.
    const chosen = groupChips.querySelector('.chip.is-on');
    if (chosen && groupChips.scrollWidth > groupChips.clientWidth) {
      chosen.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  // ------------------------------------------------------ changing group

  /**
   * The groups in the order the block shows them, "All" at the front.
   *
   * This is the line a change travels along, so where a chip sits is what
   * decides which way the grid moves to reach it - and it is the same line the
   * scroll gesture walks.
   */
  function groupOrder() {
    const ids = groups.map(group => group.id);
    return settings.showAllGroup ? [null, ...ids] : ids;
  }

  /**
   * Slides the column over the tiles to wherever the redraw has left it.
   *
   * The date, the clock and - where the setting puts it there - the block of
   * group chips hang from the bottom of the row above the grid, and a group
   * with more or fewer rows than the last one re-centres the page, which moves
   * that row. Left alone the three of them would jump to the new place while
   * the tiles they sit over were still fading across, so the column is put
   * back where it was and let go: the stylesheet's transition carries it the
   * rest of the way.
   *
   * One transform for all three, because they are rigid against each other -
   * a change of group alters what is under the column, never what is in it.
   * The block only travels when it is in the column; a floating pill and a
   * status bar are pinned to the window and are not here to be moved.
   *
   * @param {number} from where the column was before the grid was rebuilt, as
   *   headerAt measures it
   */
  function glideHeader(from) {
    const shift = from - headerAt();
    if (!shift) return;

    // The jump back has to be made with the transition off, or it is itself
    // something to animate: the column would set off towards where it came
    // from, and letting go a moment later would leave it where it already is.
    header.style.transition = 'none';
    header.style.transform = `translateY(${shift}px)`;
    // Reading the layout is what makes the jump real. Without it both writes
    // land in the same style pass and there is nothing to travel from.
    void header.offsetWidth;
    header.style.transition = '';
    header.style.transform = '';
  }

  /**
   * Where the column sits on the page rather than in the window.
   *
   * A change of group can take the scroll with it - see startOfGroup - and
   * that is a jump, not a move: the column has not gone anywhere on the page,
   * the page has gone somewhere under the window. Measured this way, the
   * glide is left with the layout change alone, which is the part worth
   * travelling.
   */
  function headerAt() {
    return header.getBoundingClientRect().top + scroller().scrollTop;
  }

  /** Off when the setting says so, and off when the system does. */
  function animatesGroups() {
    return settings.groupAnimate
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Starts a CSS animation over, even when the class is already on.
   *
   * Taking the class off and putting it back in the same turn is no change at
   * all as far as the browser is concerned; reading the layout in between is
   * what makes the removal real, and the animation then runs from the top.
   */
  function replay(el, className) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  /** Whichever of the two is showing - a grid of tiles, or the line of text
   *  standing in for it - is what moves, so both are moved. */
  const stage = [grid, empty];

  /** Mirrors --t-group-out: how long the outgoing grid has before the new one
   *  is drawn in its place. */
  const GROUP_OUT_MS = 110;

  /** Mirrors --t-group-in: how long the arriving one takes to settle. */
  const GROUP_IN_MS = 260;

  /** set while the grid is on its way out, holding the redraw that follows */
  let switchTimer;

  /** Mirrors --t-base, which is what group-nudge runs for. */
  const GROUP_NUDGE_MS = 220;

  /** set while the arriving grid is still moving, holding its tidy-up */
  let settleTimer;

  /** the same, for the give at either end of the block */
  let nudgeTimer;

  /**
   * Puts the page at the top of the group just arrived in.
   *
   * A group is only left once it has been read to its end, so arriving in the
   * next one at that same end would leave it read before it was seen - one
   * more push and it would be gone. The top is where a group begins however it
   * was arrived at: turned on to, turned back to, or picked from the block.
   *
   * Going back is the one that gives something up for that. Landing at the top
   * of a group is landing at the limit for travelling further back, so a scroll
   * held upwards walks group to group rather than reading each one from its
   * end - which is the price of every group opening the same way.
   */
  function startOfGroup() {
    scroller().scrollTop = 0;
  }

  /**
   * Moves to a group, taking the grid with it.
   *
   * The chips change at once and the grid follows, which is what lets a run of
   * quick changes - a finger held on the touchpad - land where it was aimed:
   * each one puts the redraw off a little longer, so the grid is built once,
   * for wherever the run came to rest, and stays out of sight in between.
   *
   * @param {?string} id the group to show, or null for all of them
   * @param {{step?: number, remember?: boolean}} [opts] step is the direction
   *   travelled where it is already known - a gesture knows, a click on a chip
   *   has to be worked out from the block. remember is off for a change that
   *   arrived from another new tab page, which has saved it already.
   */
  function switchGroup(id, { step = 0, remember = true } = {}) {
    if (id === activeGroup) return;

    const order = groupOrder();
    const direction = step || (order.indexOf(id) < order.indexOf(activeGroup) ? -1 : 1);

    activeGroup = id;
    // Remembered whether or not the setting is on, so turning it on later
    // picks up where the last tab left off rather than starting blank.
    if (remember) Store.saveActiveGroup(activeGroup);
    renderGroups();

    // With the animation off the grid simply changes, and the block set in the
    // page simply moves with it - gliding one while the other jumps would be
    // the animation the setting just turned off.
    if (!animatesGroups()) {
      // The scroll first: the tiles are told where they stand in the picture
      // as they are built, and a scroll thrown away afterwards would leave
      // every one of those places one screenful out.
      startOfGroup();
      render();
      return;
    }

    document.documentElement.style.setProperty('--group-dir', direction < 0 ? '-1' : '1');

    // Already on its way out from a change a moment ago: that fade is left to
    // finish rather than snapped back to full opacity to be run again.
    if (!grid.classList.contains('is-leaving')) {
      stage.forEach(el => {
        el.classList.remove('is-entering');
        el.classList.remove('is-nudged');
        replay(el, 'is-leaving');
      });
    }

    clearTimeout(switchTimer);
    switchTimer = setTimeout(() => {
      // Every class off before the new tiles are made. The animations are on
      // the tiles now rather than on the grid, so a class left on the grid
      // would be picked up by whatever is appended into it - a tile arriving
      // mid-render already playing the animation the last lot left with.
      // The stylesheet puts .is-nudged last, so that a nudge can play over a
      // settled .is-entering; that order also means a nudge left on from a
      // moment ago would sit on top of this one.
      //
      // Before the measurement below rather than after it, and it makes no
      // difference which: all three animate transform and opacity, and neither
      // moves anything on the page.
      stage.forEach(el => {
        el.classList.remove('is-leaving');
        el.classList.remove('is-nudged');
        el.classList.remove('is-entering');
      });

      const from = headerAt();
      startOfGroup();
      render();
      glideHeader(from);

      stage.forEach(el => replay(el, 'is-entering'));

      // And off again once it has played. The animation fills forwards, so
      // left on it would go on dictating each tile's transform - and a tile
      // whose transform is being animated no longer lifts under the pointer.
      // Finished, it says nothing the base style does not.
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        stage.forEach(el => el.classList.remove('is-entering'));
      }, GROUP_IN_MS);
    }, GROUP_OUT_MS);
  }

  /** One group along the block - or, at either end, the give that says so. */
  function stepGroup(step) {
    const order = groupOrder();
    // "All" on its own is not somewhere to travel between.
    if (order.length < 2) return;

    // A group that has just been deleted is nowhere on the line; the front of
    // it is where the page is really looking.
    const from = Math.max(0, order.indexOf(activeGroup));
    const to = Math.min(order.length - 1, Math.max(0, from + step));

    if (to !== from) {
      switchGroup(order[to], { step });
      return;
    }

    // Nowhere further to go. Rather than let the gesture fall flat, the
    // content gives a little the way it was pushed and comes back.
    if (!animatesGroups()) return;
    document.documentElement.style.setProperty('--group-dir', step < 0 ? '-1' : '1');
    stage.forEach(el => replay(el, 'is-nudged'));

    // And off again once it has played. The animation is on the tiles now, so
    // a class left on the grid is one that every tile built into it afterwards
    // picks up - and the grid is rebuilt for reasons that have nothing to do
    // with groups, like a visit being counted.
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => {
      stage.forEach(el => el.classList.remove('is-nudged'));
    }, GROUP_NUDGE_MS);
  }

  // --------------------------------------------- changing group by gesture

  /*
   * One flick of two fingers across a touchpad is not one wheel event but a
   * flurry of them, and then a tail of momentum after the fingers have lifted.
   * Turning a group per event would run the whole block in a frame, so the
   * deltas are added up and a group is turned each time they pass the
   * threshold - but no faster than WHEEL_REPEAT, so that keeping the wheel
   * moving walks the groups steadily rather than blurring through them.
   *
   * That leaves the tail to deal with, because it is deltas like any other and
   * would carry on turning groups after the fingers had gone. It gives itself
   * away by fading: momentum only ever decays, while a finger still moving
   * holds its strength. So a turn after the first one asks that the events
   * driving it still be a fair share of the hardest push in the gesture, and
   * the tail falls below that within a beat or two. A hard flick may still
   * carry a group past the one it was aimed at, which is what a flick is meant
   * to do.
   */

  /** How far the deltas have to add up before a group is turned. */
  const WHEEL_THRESHOLD = 50;
  /** The least time between two turns, in ms. Long enough that each group is
   *  on screen to be seen, short enough that a held scroll feels like one. */
  const WHEEL_REPEAT = 280;
  /** The quiet that ends a gesture, in ms - momentum runs well past the flick. */
  const WHEEL_QUIET = 260;
  /** How much of the gesture's hardest push an event has to still carry to be
   *  taken for a finger rather than for the tail it left behind. */
  const WHEEL_CARRY = .55;
  /** What a notch and a page stand for, for the devices that report in lines
   *  or pages rather than pixels. A Firefox mouse wheel reports three lines. */
  const WHEEL_LINE = 20;
  const WHEEL_PAGE = 400;
  /** The smallest pixel step taken for a wheel notch rather than for fingers.
   *  Chrome sends 100 a notch; a touchpad sends a stream of much smaller ones. */
  const WHEEL_NOTCH = 50;

  /** the deltas since the last turn, the hardest push since it, and when it
   *  was - all three reset by the pause that ends the gesture */
  let wheelSum = 0;
  let wheelPeak = 0;
  let wheelTurned = 0;
  let wheelTimer;

  function endGesture() {
    wheelSum = 0;
    wheelPeak = 0;
    wheelTurned = 0;
  }

  /**
   * Whether this came off a wheel rather than off a touchpad.
   *
   * A mouse has one axis and turns it in whole notches, whichever unit the
   * browser counts them in: three lines, a page, one big round pixel step with
   * nothing sideways beside it. Fingers give a stream of small deltas instead,
   * and a touchpad scrolled straight up still leaks a little to the side.
   *
   * The whole-step test is also what keeps Gecko honest: it reports a
   * precision touchpad in lines, the way it reports a wheel, but in fractions
   * of one - where a notch is always a round number of them.
   */
  function isWheel(e) {
    if (!Number.isInteger(e.deltaY)) return false;
    if (e.deltaMode !== 0) return true;
    return e.deltaX === 0 && Math.abs(e.deltaY) >= WHEEL_NOTCH;
  }

  /**
   * How far this event went the way the setting cares about, and which axis
   * that came off.
   *
   * The axis matters because the page scrolls on one of them: a gesture that
   * the page could scroll with has to wait its turn, and a sideways one never
   * does. See pageScrolls.
   *
   * @returns {{delta: number, vertical: boolean}} delta is 0 to ignore the event
   */
  function wheelDelta(e) {
    const scale = e.deltaMode === 1 ? WHEEL_LINE : e.deltaMode === 2 ? WHEEL_PAGE : 1;
    const across = { delta: e.deltaX * scale, vertical: false };
    const down = { delta: e.deltaY * scale, vertical: true };

    if (settings.groupScrollAxis === 'horizontal') {
      // Left and right is a gesture a mouse cannot make. Rather than leave
      // wheel users with a setting that does nothing, a notch of the wheel
      // counts as the push its one axis was meant to be - while a touchpad
      // scrolled up and down is still left to the page, which is what asking
      // for left and right was about.
      if (e.deltaX) return across;
      return isWheel(e) ? down : { delta: 0, vertical: false };
    }
    if (settings.groupScrollAxis === 'vertical') return down;
    // Either way: whichever way the gesture is mostly going.
    return Math.abs(e.deltaX) > Math.abs(e.deltaY) ? across : down;
  }

  /**
   * Whether the page can still scroll the way this gesture is pushing.
   *
   * A group with more tiles than the window can hold is somewhere to read
   * before it is somewhere to leave, so the wheel scrolls it and the group
   * only turns once there is none of it left in that direction - at the very
   * top, or at the very bottom. A group that fits is at both at once, and
   * turns on the first push the way it always did.
   *
   * @param {number} delta which way the gesture is pushing
   */
  function pageScrolls(delta) {
    const el = scroller();
    const room = delta > 0
      ? el.scrollHeight - el.clientHeight - el.scrollTop
      : el.scrollTop;
    // Fractional layouts and page zoom leave a sliver behind that nobody can
    // scroll and nobody can see.
    return room > 1;
  }

  document.addEventListener('wheel', e => {
    if (!settings.groupScroll) return;
    // A pinch to zoom arrives as a wheel event holding Ctrl, and belongs to
    // the browser.
    if (e.ctrlKey) return;
    // A dialog, a menu and the colour picker all have scrolling of their own,
    // and it is theirs.
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('.modal, .menu, .picker')) return;
    // So does the block itself, once it holds more chips than it can show.
    const strip = e.target.closest('.groupbar__inner');
    if (strip && strip.scrollWidth > strip.clientWidth) return;

    const { delta, vertical } = wheelDelta(e);
    if (!delta) return;

    // The group's own scrolling comes first: while there is more of it to
    // reach, the wheel reaches it and the page keeps the event. Only the
    // vertical axis waits - the page has no use for a sideways push, so there
    // is nothing there for one to wait behind.
    if (vertical && pageScrolls(delta)) {
      // None of that scroll counts towards a turn: the tally starts from the
      // moment the group runs out, so arriving at the end is not itself
      // enough to be carried past it.
      clearTimeout(wheelTimer);
      endGesture();
      return;
    }

    if (e.cancelable) e.preventDefault();

    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(endGesture, WHEEL_QUIET);

    // Turning back the other way mid-scroll starts the sums again, so going
    // back is not held up by however far the scroll had already got.
    if (wheelSum && Math.sign(delta) !== Math.sign(wheelSum)) {
      wheelSum = 0;
      wheelPeak = 0;
    }

    const force = Math.abs(delta);
    wheelPeak = Math.max(wheelPeak, force);
    wheelSum += delta;

    if (Math.abs(wheelSum) < WHEEL_THRESHOLD) return;
    // One group at a time, however hard the wheel is spun.
    const now = Date.now();
    if (now - wheelTurned < WHEEL_REPEAT) return;
    // Past the first turn, only a finger still pushing carries on; the tail a
    // touchpad throws after the fingers have lifted has faded by now.
    if (wheelTurned && force < wheelPeak * WHEEL_CARRY) return;

    wheelTurned = now;
    wheelSum = 0;
    // The hardest push is measured per turn, so easing off into a steady
    // scroll is not read as the gesture dying.
    wheelPeak = force;

    stepGroup(delta > 0 ? 1 : -1);
  }, { passive: false });

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
    // block and the + holds the back, and neither has a data-group-id. The
    // chips slide past one another exactly as the tiles do.
    if (before && over.previousElementSibling !== dragChip) {
      slideMove(groupChips, () => groupChips.insertBefore(dragChip, over));
    } else if (!before && over.nextElementSibling !== dragChip) {
      slideMove(groupChips, () => groupChips.insertBefore(dragChip, over.nextElementSibling));
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
   * Black or white, whichever will be read more easily on `hex`, and the
   * quieter weight of the same ink for the type that is not the point.
   *
   * Three of them because a tile has two kinds of writing on it. The monogram
   * carries the tile and takes the ink at full strength; the site name and the
   * visit count sit under it and are dimmed, exactly as --label-secondary is a
   * dimmed --label everywhere else. Fading the ink rather than picking a grey
   * keeps it the tile's own colour's opposite, whatever that colour is. The
   * third is the plate under the visit count, which is the same ink faded
   * almost away.
   *
   * The threshold is on relative luminance rather than plain brightness, so a
   * saturated yellow is treated as the light colour it is - the standard sRGB
   * weights, written out here rather than pulled in for six lines of it.
   */
  const INK = {
    dark: {
      ink: '#1c1c1e',
      dim: 'rgba(28, 28, 30, .62)',
      plate: 'rgba(28, 28, 30, .1)'
    },
    light: {
      ink: '#ffffff',
      dim: 'rgba(255, 255, 255, .72)',
      plate: 'rgba(255, 255, 255, .18)'
    }
  };

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
    return luminance > 0.18 ? INK.dark : INK.light;
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
      const { ink, dim, plate } = readableInk(hex);
      el.style.setProperty('--tile-bg', hex);
      el.style.setProperty('--tile-ink', ink);
      el.style.setProperty('--tile-ink-dim', dim);
      el.style.setProperty('--tile-ink-plate', plate);
    } else {
      el.style.removeProperty('--tile-bg');
      el.style.removeProperty('--tile-ink');
      el.style.removeProperty('--tile-ink-dim');
      el.style.removeProperty('--tile-ink-plate');
    }
  }

  /**
   * A tile's own logo padding, if it has one.
   *
   * The property is the same one the settings write to the root, so a tile
   * that sets it wins for itself and every tile that does not carries on
   * reading the one set for all of them. Removing it is what "follow the
   * setting" means - there is no value to write that would mean it.
   */
  function applyTilePad(el, pad) {
    if (typeof pad === 'number') el.style.setProperty('--logo-pad', pad / 100);
    else el.style.removeProperty('--logo-pad');
  }

  /**
   * How far this tile takes the corners off its icon, as a share of the icon's
   * short side - so 50% rounds a square logo to a circle.
   *
   * Unlike the padding above there is no setting behind it to fall back to, so
   * zero is a real answer rather than an absent one, and the property is simply
   * taken off again where nothing was asked for. The stylesheet reads it on
   * .tile__icon, which by then is a box fitted to the picture inside it - see
   * --icon-aspect in paintIcon.
   */
  function applyIconRound(el, round) {
    if (round > 0) el.style.setProperty('--icon-round', round / 100);
    else el.style.removeProperty('--icon-round');
  }

  /** Monogram shown until the site's real icon arrives, or when there is none. */
  function buildFallback(label, seed) {
    const el = document.createElement('span');
    el.className = 'tile__fallback';
    // A custom property rather than `color` outright: a tile standing on its
    // own background has already worked out an ink that reads against it, and
    // an inline `color` would beat any stylesheet rule trying to say so. The
    // stylesheet picks between the two - see --tile-ink in newtab.css.
    el.style.setProperty('--mono-ink', colorFor(seed));
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
   * A web address on its way into a CSS url(), which takes a quoted string.
   *
   * JSON quotes and escapes by the same rules CSS does, and an icon is either
   * a plain http(s) address or a data URI - both ASCII, neither of which has
   * anything in it the two disagree about.
   */
  const cssUrl = url => 'url(' + JSON.stringify(url) + ')';

  /**
   * The picture each tile is showing, held on to across a redraw.
   *
   * A group change rebuilds the whole grid, and a rebuilt tile used to start
   * again from its letter: a fresh <img> is hidden until it has loaded, and
   * even a picture the browser already holds is not handed back inside the
   * frame that asked for it. So every group change blinked every icon. What is
   * kept here is the element itself - already loaded, and moved straight into
   * the tile being built - so the picture never leaves the screen.
   *
   * Keyed on what decides the picture rather than on the picture: the address
   * the lookup runs against, or the tile's own icon where it has one; the
   * colour it is drawn in, which is what makes it a stencil rather than a
   * picture; and whether deep lookup is on. Change any of those and the key no
   * longer matches, so the icon is fetched again rather than the old one being
   * shown for a site that no longer has anything to do with it.
   *
   * Only what is on screen, so nothing here survives the page. The picture
   * itself is kept in storage - see favicons.js.
   */
  const shownIcons = new Map();

  const iconKey = tile => [
    tile.icon || tile.url,
    tile.iconColor,
    settings.deepIcons ? 'deep' : 'basic'
  ].join('\n');

  /** The element this tile is already showing, where it is still the right
   *  one for it; null where there is nothing to reuse. */
  function keptIcon(tile) {
    const held = shownIcons.get(tile.id);
    return held && held.key === iconKey(tile) ? held.node : null;
  }

  const originOf = url => {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  };

  /**
   * Forgets a tile's picture, both where it is held.
   *
   * Called when a tile is pointed somewhere else, given a picture of its own,
   * or deleted - all three make what is held about it wrong rather than stale.
   * The element goes at once. The site's entry in the lookup cache goes too,
   * but only when no other tile still points at that site: the cache is keyed
   * by origin and shared, and two tiles on the same site should not cost each
   * other their icon.
   *
   * @param {{id:string,url:string}} was the tile as it was before the change
   */
  async function forgetTileIcon(was) {
    shownIcons.delete(was.id);

    const origin = originOf(was.url);
    if (!origin) return;
    if (tiles.some(other => other.id !== was.id && originOf(other.url) === origin)) return;

    await Store.icons.drop(origin);
  }

  /**
   * Reveals a loaded icon and retires the letter that was standing in for it.
   *
   * The picture's own proportions go on with it. The box an icon is drawn in is
   * as wide as the tile allows and only as tall as it has room for, so a square
   * logo sits in it with air either side - which is nothing at all until a
   * corner radius is asked for, and then it is the air that gets rounded rather
   * than the logo. Handing the ratio to CSS lets the box close up to the
   * picture; `contain` was already drawing it at exactly that size, so nothing
   * moves. A picture that will not say - an SVG with no size and no viewBox -
   * keeps the square box, which is where this started.
   */
  function iconArrived(el, icon, measured) {
    if (measured && measured.naturalWidth && measured.naturalHeight) {
      icon.style.setProperty('--icon-aspect',
        String(measured.naturalWidth / measured.naturalHeight));
    }

    icon.hidden = false;
    const fallback = el.querySelector('.tile__fallback');
    if (fallback) fallback.remove();
  }

  /**
   * Puts a picture on a tile, and takes the monogram away once it has loaded -
   * not before, so a picture that never arrives leaves the letter standing
   * rather than an empty square.
   *
   * With a colour given the picture is drawn as a stencil instead: the colour
   * shows through the picture's own alpha channel, so every shape and every
   * soft edge in it survives and only the hue is replaced. That is a mask, and
   * a mask needs an element of its own - an <img> would paint its own pixels
   * straight over the colour behind them, and there is no way to hide a
   * picture while keeping the box it fills. The span is sized and placed by
   * the same rules the picture would have been, so the two are swappable.
   *
   * A stencil loads the picture all the same, through an <img> that never
   * joins the page: a mask that fails leaves an empty box, and the letter
   * underneath is a better answer than that.
   */
  function paintIcon(el, url, color, keep) {
    const icon = document.createElement(color ? 'span' : 'img');
    icon.className = color ? 'tile__icon tile__icon--tint' : 'tile__icon';
    icon.hidden = true;

    if (color) {
      icon.style.setProperty('--icon-mask', cssUrl(url));
      icon.style.setProperty('--icon-tint', color);
    } else {
      icon.alt = '';
    }

    const probe = color ? new Image() : icon;
    probe.referrerPolicy = 'no-referrer';
    probe.addEventListener('load', () => {
      iconArrived(el, icon, probe);
      // Kept only once it has actually arrived: a redraw that moved a picture
      // which never loaded would put an invisible box on the tile, with no
      // letter underneath it to stand in.
      if (keep) shownIcons.set(keep.id, { key: iconKey(keep), node: icon });
    });
    probe.addEventListener('error', () => {
      icon.remove();
      if (keep) shownIcons.delete(keep.id);
    });
    probe.src = url;

    el.prepend(icon);
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
    paintIcon(el, found.url, tile.iconColor, tile);
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
    applyTilePad(el, tile.pad);
    applyIconRound(el, tile.round);

    const text = document.createElement('span');
    text.className = 'tile__label';
    text.textContent = label;

    // The picture this tile is already showing, where it is still the right
    // one - moved across rather than made again, which is what keeps a group
    // change from blinking every icon back to its letter.
    const kept = keptIcon(tile);
    el.append(kept || buildFallback(label, tile.url), text);

    if (settings.showVisits && tile.visits > 0) {
      const badge = document.createElement('span');
      badge.className = 'tile__visits';
      // Past a thousand the exact number stops meaning anything and the badge
      // stops fitting, which is the same point to round at.
      badge.textContent = tile.visits > 999
        ? Math.round(tile.visits / 100) / 10 + 'k'
        : String(tile.visits);
      badge.title = t('tile_visits', tile.visits);
      el.append(badge);
    }

    // A tile that names its own picture uses it and asks the network nothing;
    // that is the point of setting one. It goes on now rather than later,
    // because there is nothing to wait for.
    if (!kept) {
      if (tile.icon) paintIcon(el, tile.icon, tile.iconColor, tile);
      else attachIcon(el, tile, token);
    }

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
    el.title = t('tile_add');
    el.setAttribute('aria-label', t('tile_add'));
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

    // The tiles that were lined up on the picture are gone; these are new.
    placeFrost();

    empty.hidden = shown.length > 0;
    if (!shown.length) {
      // With the + turned off there is no + to hit, and the only way in is
      // the one the menu offers.
      empty.textContent = t(activeGroup
        ? 'empty_inGroup'
        : settings.showAddButton ? 'empty_noTiles' : 'empty_noTilesNoAdd');
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

  /**
   * Every step of a drag is meant to be watchable: the tile fades and shrinks
   * as it is picked up, the ones it displaces slide aside, a chip it is held
   * over lifts to meet it, and it settles when it is let go. The stylesheet
   * carries the steps that are a class changing. The one it cannot carry is
   * the sliding, because nothing about those tiles changes - they are simply
   * somewhere else the moment insertBefore returns, and a transition has
   * nothing to run from.
   *
   * So that one is run from the outside, the way a list reorder always is:
   * measure, move, then put each element back where it was and let it travel
   * forward. FLIP - first, last, invert, play.
   */
  const stillness = window.matchMedia('(prefers-reduced-motion: reduce)');

  /** The slides in flight, so a second move can be measured against them. */
  const sliding = new WeakMap();

  /** The tile being carried is drawn smaller; the slide has to keep that. */
  const DRAG_SCALE = ' scale(.94)';

  /**
   * Runs `mutate` - a move inside `container` - and slides everything it
   * displaced from where it was to where it now is.
   *
   * A slide already running is cancelled between the two measurements rather
   * than before the first: the element then reads at the place it is really
   * going to, and the new slide starts from wherever the eye last saw it
   * instead of from a position two moves out of date.
   */
  function slideMove(container, mutate) {
    if (stillness.matches) return mutate();

    const kids = [...container.children];
    const before = kids.map(el => el.getBoundingClientRect());

    kids.forEach(el => {
      const run = sliding.get(el);
      if (run) {
        run.cancel();
        sliding.delete(el);
      }
    });

    mutate();

    kids.forEach((el, at) => {
      const now = el.getBoundingClientRect();
      const dx = before[at].left - now.left;
      const dy = before[at].top - now.top;
      if (!dx && !dy) return;

      // The scale is the stylesheet's, and an animation on transform replaces
      // it outright - so the keyframes carry it, or the tile under the pointer
      // would swell back to full size for as long as the slide lasted.
      const held = el.classList.contains('is-dragging') ? DRAG_SCALE : '';
      const run = el.animate([
        { transform: 'translate(' + dx + 'px, ' + dy + 'px)' + held },
        { transform: 'translate(0px, 0px)' + held }
      ], { duration: 240, easing: 'cubic-bezier(.16, 1, .3, 1)' });

      sliding.set(el, run);
      run.addEventListener('finish', () => {
        if (sliding.get(el) === run) sliding.delete(el);
      });
    });
  }

  /** Let go: the tile lands, gives a little under itself, and comes to rest. */
  function settle(el) {
    if (stillness.matches) return;
    el.animate([
      { transform: 'scale(.94)' },
      { transform: 'scale(1.03)', offset: .5 },
      { transform: 'scale(1)' }
    ], { duration: 300, easing: 'cubic-bezier(.16, 1, .3, 1)' });
  }

  /**
   * A tile dropped on a chip belongs to another group now, so it is about to
   * be redrawn out of this view. It sees itself out first - a redraw that
   * simply loses a tile reads as the drag having gone wrong.
   */
  function leaveView(el) {
    if (stillness.matches || !el.isConnected) return Promise.resolve();
    return el.animate([
      { opacity: .4, transform: 'scale(.94)' },
      { opacity: 0, transform: 'scale(.7)' }
    ], {
      duration: 200,
      easing: 'cubic-bezier(.16, 1, .3, 1)',
      // Held, or the tile would flash back at full size in the gap between the
      // animation finishing and the redraw taking it away.
      fill: 'forwards'
    }).finished.catch(() => {});
  }

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
      // Dropping past the last tile parks the item at the end. Guarded, or
      // every frame the pointer spends over the + would restart the slide of
      // a move that has already happened.
      if (dragEl.nextElementSibling !== target) {
        slideMove(grid, () => grid.insertBefore(dragEl, target));
      }
      return;
    }

    const rect = target.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;

    if (before && target.previousElementSibling !== dragEl) {
      slideMove(grid, () => grid.insertBefore(dragEl, target));
    } else if (!before && target.nextElementSibling !== dragEl) {
      slideMove(grid, () => grid.insertBefore(dragEl, target.nextElementSibling));
    }
  });

  grid.addEventListener('drop', e => {
    if (dragEl) e.preventDefault();
  });

  grid.addEventListener('dragend', async () => {
    if (!dragEl) return;
    const dropped = dragEl;
    dropped.classList.remove('is-dragging');
    grid.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging');
    dragEl = null;

    syncOrderFromDom();

    // The drop landed on a group chip, so what is on screen has changed. The
    // tile leaves while the write goes on underneath it, so the redraw is the
    // last thing that happens rather than a cut in the middle of the gesture.
    if (movedGroup) {
      movedGroup = false;
      await Promise.all([persistTiles(), leaveView(dropped)]);
      render();
      return;
    }

    settle(dropped);
    await persistTiles();
  });

  // ---------------------------------------------------------------- dialogs

  /**
   * Every layer of the page that a dialog can stand in front of, the other
   * dialogs included - an alert opens over the sheet that raised it.
   *
   * `aria-modal` is a claim, not a mechanism: on its own it does nothing to
   * stop Tab leaving the dialog or a screen reader wandering out of it. What
   * it claims, `inert` actually does - it takes a subtree out of the tab
   * order and out of the accessibility tree in one attribute.
   */
  const LAYERS = [groupBar, toolbar, document.querySelector('.page'),
                  modal, groupModal, settingsModal, confirmAlert];

  /**
   * What is up, innermost last, and what had the focus when each went up. A
   * stack rather than a flag because the alert opens over a sheet: closing it
   * has to hand the page back to that sheet, not to the page behind it.
   */
  const dialogStack = [];

  function isolateTop() {
    const top = dialogStack.length ? dialogStack[dialogStack.length - 1].el : null;
    LAYERS.forEach(node => {
      if (node) node.inert = Boolean(top) && node !== top;
    });
  }

  function openDialog(el, focusEl) {
    dialogStack.push({ el, opener: document.activeElement });
    el.hidden = false;
    // Before the focus call, not after: making a subtree inert while the focus
    // is inside it drops the focus on the floor.
    isolateTop();

    if (focusEl) {
      focusEl.focus();
      focusEl.select();
    } else {
      // Nothing here to type in, so the dialog takes the focus itself.
      // Without this it stays on whatever opened the dialog - the gear, which
      // is now behind the scrim - and the first Tab walks into the page that
      // was just covered up.
      el.focus();
    }
  }

  function closeDialog(el) {
    // The colour picker's popover lives in the body rather than in the sheet
    // that opened it, so hiding the sheet would leave it standing on its own.
    SettingsUI.closePicker();
    el.hidden = true;

    const at = dialogStack.findIndex(entry => entry.el === el);
    const going = at === -1 ? null : dialogStack.splice(at, 1)[0];
    isolateTop();

    // Back where it came from, so the keyboard carries on from the control
    // that opened this rather than from the top of the page.
    if (going && going.opener && going.opener.focus) going.opener.focus();
  }

  [modal, groupModal, settingsModal].forEach(el => {
    el.addEventListener('mousedown', e => {
      if (e.target === el) closeDialog(el);
    });
  });

  /**
   * The two gestures macOS cancels a dialog with. Escape everywhere, and
   * Command-Period on an Apple keyboard, which is the older of the two and
   * still the one some hands reach for first.
   */
  function isCancelKey(e) {
    if (e.key === 'Escape') return true;
    return Schema.SETTINGS_SHORTCUT.apple && e.metaKey && e.key === '.';
  }

  document.addEventListener('keydown', e => {
    if (!isCancelKey(e)) return;
    // The alert stands over every other dialog, so it is the one that answers -
    // and the answer Escape gives is the safe one.
    if (settleAlert) settleAlert(false);
    else if (!settingsModal.hidden) closeDialog(settingsModal);
    else if (!groupModal.hidden) closeDialog(groupModal);
    else if (!modal.hidden) closeDialog(modal);
  });

  /**
   * Command-comma on a Mac, Control-comma everywhere else: the shortcut every
   * desktop opens its preferences with, and the way in that is left when the
   * gear has been taken off the page. Which modifier belongs to this platform
   * is settled once, in the schema, because the note under that setting has to
   * name the same chord this reads - see SETTINGS_SHORTCUT.
   *
   * The comma is looked for twice over, because a keyboard laid out for
   * another language may not have one where this one does. `key` is the
   * character the layout actually produces, which finds the comma wherever it
   * has been moved to; `code` is the physical key in the comma's usual place,
   * which finds it on the layouts that print something else there - Cyrillic
   * and Greek among them. Shift is allowed only where it is what makes the
   * comma, since several layouts put one on a shifted key.
   */
  function isSettingsShortcut(e) {
    if (e.altKey || e.repeat) return false;
    if (e.shiftKey && e.key !== ',') return false;

    const held = Schema.SETTINGS_SHORTCUT.apple
      ? e.metaKey && !e.ctrlKey
      : e.ctrlKey && !e.metaKey;

    return held && (e.key === ',' || e.code === 'Comma');
  }

  document.addEventListener('keydown', e => {
    if (!isSettingsShortcut(e)) return;
    // Taken whether or not it opens anything, so the browser underneath never
    // gets a second go at it.
    e.preventDefault();

    // A dialog on screen is a conversation of its own and the shortcut waits
    // for it. The settings window being the one that is up means there is
    // nothing to do, which is what a second press does everywhere else too.
    if (settleAlert || !settingsModal.hidden || !modal.hidden || !groupModal.hidden) return;

    // A menu is not a conversation - it is a list of ways on, and this is one
    // of them, so it gets out of the way rather than swallowing the press.
    if (dismissMenu) dismissMenu();
    openSettings();
  });

  // ----------------------------------------------------------------- alerts

  /**
   * The alert that stands in front of something that cannot be undone.
   *
   * A promise for the answer rather than a callback, because what it guards is
   * already an await: the caller asks, and then carries on or does not. There
   * is one alert in the markup and one at a time on screen, so the way to
   * settle the one that is up is a single variable - which is also how every
   * other part of the page can tell there is one up at all.
   *
   * Cancel is what a click on the scrim and Escape both mean. There is no third
   * answer: an alert is answered rather than dismissed.
   *
   * @returns {Promise<boolean>} whether the deed was agreed to
   */
  let settleAlert = null;

  function askAlert(text) {
    // Anything already being asked is answered no, so its promise settles
    // rather than hanging on a dialog that has been replaced under it.
    if (settleAlert) settleAlert(false);

    confirmText.textContent = text;
    // No button is the default. Apple's rule is that a destructive button is
    // never given the primary role, "because people sometimes choose a primary
    // button without reading it first" - and the one way it names to make
    // somebody actually read an alert is to leave no button for Return to
    // press. Escape still cancels, and the alert itself takes the focus so the
    // keyboard is inside it.
    openDialog(confirmAlert);

    return new Promise(resolve => {
      settleAlert = answer => {
        settleAlert = null;
        closeDialog(confirmAlert);
        resolve(answer);
      };
    });
  }

  btnConfirmOk.addEventListener('click', () => settleAlert && settleAlert(true));
  btnConfirmCancel.addEventListener('click', () => settleAlert && settleAlert(false));

  confirmAlert.addEventListener('mousedown', e => {
    if (e.target === confirmAlert && settleAlert) settleAlert(false);
  });

  // ---------------------------------------------------------------- tile dialog

  /**
   * One option per group, and nothing else - a tile made or edited here lands
   * in a group. The whole field stays out of sight until there is a group for
   * it to offer.
   *
   * A tile that is in none of them - one made before there were any, or one
   * whose group has since been deleted - has to be shown as something, so it
   * is shown as the group being looked at, or failing that the first. Saving
   * is what puts it there; until then it is still loose.
   */
  function fillGroupSelect(selected) {
    fieldGroup.textContent = '';

    groups.forEach(group => {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.name;
      fieldGroup.append(option);
    });

    fieldGroup.value = selected || activeGroup || (groups[0] && groups[0].id) || '';
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
  /** '' where the icon keeps its own colours - see paintIcon. */
  let previewIconColor = '';
  /** null where the tile follows the padding set for every tile. */
  let previewPad = null;
  /** 0 where the icon keeps its own corners - see applyIconRound. */
  let previewRound = 0;
  /** Bumped on every repaint, so a slow icon lookup can tell it is stale. */
  let previewToken = 0;
  /**
   * The address the tile on screen was drawn from.
   *
   * The name is written into the tile that is already standing rather than
   * used to build a new one, and the monogram it seeds is seeded from the
   * address that picture belongs to - which, while one is being typed, is not
   * yet the address in the field.
   */
  let previewUrl = '';

  /**
   * The preview at the size the grid will really draw it.
   *
   * It used to be capped at 132px, which made every tile above that a picture
   * of a smaller tile - and the size is one of the things being previewed.
   * The only real limit is the room the sheet has, so that is what it is
   * measured against: everything inside a tile is worked out from its width,
   * so holding that one property down scales the whole thing faithfully
   * rather than cropping it.
   *
   * The stage has no width until the sheet is on screen, and this runs once
   * before that to build the tile; the real size is taken the moment it opens
   * - see openTileModal - and again if the window is resized under it.
   */
  function sizePreview() {
    const room = tilePreview.parentElement.clientWidth;
    const size = room ? Math.min(settings.tileSize, room) : settings.tileSize;
    tilePreview.style.setProperty('--tile-size', size + 'px');
  }

  window.addEventListener('resize', () => {
    if (!modal.hidden) sizePreview();
  });

  function previewFields() {
    const raw = fieldUrl.value.trim();
    const valid = normalizeUrl(raw);
    const url = valid || raw;
    return {
      url,
      // The address a lookup can actually be made against, or null. Half an
      // address typed so far is not a site that publishes no icon, and a
      // report saying so would be wrong on the way to every real one.
      lookup: valid,
      label: fieldTitle.value.trim() || (url ? defaultTitle(url) : t('tile_sampleName')),
      icon: fieldIcon.value.trim()
    };
  }

  /**
   * What the icon lookup is doing, said under the tile.
   *
   * A line of its own rather than the sheet's: modalError stands over the
   * buttons and is for what is stopping the tile being saved, and a report
   * about the picture on show was six rows away from it down there.
   */
  const setIconStatus = status => SettingsUI.setStatus(iconStatus, status);

  /**
   * @param {{force?:boolean, extra?:string}} [opts] `force` looks past every
   *   cache there is, which is what the reload button means; `extra` is a
   *   sentence hung on the end of whatever the lookup reports.
   * @returns {Promise} settles once the lookup, if there was one, has reported
   */
  function paintPreview(opts = {}) {
    const token = ++previewToken;
    const { url, lookup, label, icon } = previewFields();
    previewUrl = url;

    tilePreview.textContent = '';
    applyTileBg(tilePreview, previewBg);
    applyTilePad(tilePreview, previewPad);
    applyIconRound(tilePreview, previewRound);
    sizePreview();

    const text = document.createElement('span');
    text.className = 'tile__label';
    text.textContent = label;

    tilePreview.append(buildFallback(label, url || label), text);

    armPipette(null);

    // A tile that names its own picture asks the network nothing - that is the
    // point of setting one - so there is nothing to report on.
    if (icon) {
      paintIcon(tilePreview, icon, previewIconColor);
      setIconStatus(null);
      return Promise.resolve();
    }

    if (!lookup) {
      setIconStatus(null);
      return Promise.resolve();
    }

    return lookupPreviewIcon(lookup, token, opts);
  }

  /**
   * The same lookup the grid does, so what is on show here is what will be on
   * the tile - and what the pipette has to work with.
   *
   * It says what it is doing while it does it and what it found when it is
   * done. That report used to wait for the reload button; now an address typed
   * into the sheet starts the lookup and the lookup speaks for itself, which is
   * what lets a site with no icon of its own say so while there is still a
   * sheet open to do something about it.
   */
  async function lookupPreviewIcon(url, token, opts) {
    setIconStatus({ kind: 'loading', text: t('icon_looking') });

    let found = null;
    try {
      found = await Favicons.resolve(url, { deep: settings.deepIcons, force: opts.force });
    } catch (err) {
      if (token === previewToken) setIconStatus({ kind: 'error', text: err.message });
      return;
    }

    // The address moved on while this was in the air.
    if (token !== previewToken) return;

    if (found) paintIcon(tilePreview, found.url, previewIconColor);

    const report = iconReport(found);
    setIconStatus(opts.extra ? { ...report, text: report.text + opts.extra } : report);
  }

  /**
   * The name, written into the tile that is already on screen.
   *
   * Rebuilding the whole preview for it would throw the picture away and put
   * an identical one back, and a fresh <img> is hidden until it has loaded -
   * so every keystroke in the name field made the icon blink out and return.
   * Nothing but the label and the letter under it depends on the name, and
   * both can be changed in place.
   */
  function relabelPreview() {
    const label = fieldTitle.value.trim()
      || (previewUrl ? defaultTitle(previewUrl) : t('tile_sampleName'));

    const text = tilePreview.querySelector('.tile__label');
    if (text) text.textContent = label;

    // Only there while no picture has arrived; its letter is the name's.
    const fallback = tilePreview.querySelector('.tile__fallback');
    if (fallback) fallback.replaceWith(buildFallback(label, previewUrl || label));
  }

  /** Typing an address should not fire a lookup on every keystroke. */
  let previewTimer;
  function schedulePreview(immediate) {
    clearTimeout(previewTimer);
    if (immediate) paintPreview();
    else previewTimer = setTimeout(paintPreview, 400);
  }

  fieldUrl.addEventListener('input', () => schedulePreview());
  fieldTitle.addEventListener('input', relabelPreview);
  fieldIcon.addEventListener('input', () => schedulePreview(true));

  btnIconFile.addEventListener('click', () => fieldIconFile.click());

  /** Big enough to fill a tile's logo on a 2x screen - see favicons.js. */
  const GOOD_ICON = 256;

  /**
   * What was found, in words - and where it fell short, why.
   *
   * The size is worth saying out loud. "The icon is blurry" and "this site
   * only publishes a 32-pixel icon" look identical on a tile, and only one of
   * them is something the reader can do anything about.
   */
  function iconReport(found) {
    if (!found) {
      return {
        kind: 'error',
        text: t(settings.deepIcons ? 'icon_noneDeep' : 'icon_noneShallow')
      };
    }

    if (found.vector) {
      return { kind: 'ok', text: t('icon_vector') };
    }

    if (found.size >= GOOD_ICON) {
      return { kind: 'ok', text: t('icon_found', found.size) };
    }

    // Two whole sentences rather than one with a tail glued on: what follows
    // the size is a clause a translation may want in front of it.
    return {
      kind: 'ok',
      text: t(settings.deepIcons ? 'icon_foundLargest' : 'icon_foundSmall', found.size)
    };
  }

  /*
   * Looking the site's icon up again from scratch: past the answer cached
   * here, and past the browser's own cache for the page and the manifest it
   * reads on the way.
   *
   * A tile's own picture is what would be drawn instead, so it is cleared
   * first - "look the site's icon up again" cannot mean anything else while
   * one is set, and nothing here is written until Save is pressed.
   */
  btnIconReload.addEventListener('click', async () => {
    if (!normalizeUrl(fieldUrl.value)) {
      setIconStatus({ kind: 'error', text: t('icon_needAddress') });
      return;
    }

    const had = fieldIcon.value.trim();
    fieldIcon.value = '';

    btnIconReload.disabled = true;
    try {
      // The repaint owns the lookup and the report both, so pressing this is
      // the ordinary lookup done again from scratch rather than a second one
      // racing it.
      await paintPreview({
        force: true,
        extra: had ? ' ' + t('icon_cleared') : ''
      });
    } finally {
      btnIconReload.disabled = false;
    }
  });

  fieldIconFile.addEventListener('change', async () => {
    const picked = fieldIconFile.files && fieldIconFile.files[0];
    fieldIconFile.value = '';
    if (!picked) return;

    setIcon(() => Favicons.fromFile(picked));
  });

  // ------------------------------------------------- pasting into the sheet

  /*
   * Two things can be pasted into the tile sheet meaning "use this as the
   * icon": a picture on the clipboard - copied out of a drawing program, or
   * with "Copy image" in a browser - and the SVG source of one, which is what
   * a design tool and a code editor put there instead.
   *
   * A picture is taken wherever the caret happens to be. A file cannot be
   * typed into a field, so there is nothing else it could have meant.
   *
   * SVG source is only taken from the icon field, or from the sheet with no
   * field focused. It is still text, and somebody pasting it into the address
   * or the name field should get the text they asked for rather than watch it
   * disappear into a picture.
   */

  /** Whatever files the clipboard is offering, however it offers them. */
  function clipboardFiles(data) {
    const files = data.files ? Array.from(data.files) : [];
    if (files.length) return files;

    // getAsFile() only answers while the event is being handled, so this runs
    // now and not inside the work that follows.
    return data.items
      ? Array.from(data.items)
          .filter(item => item.kind === 'file')
          .map(item => item.getAsFile())
          .filter(Boolean)
      : [];
  }

  /** Puts whatever `work` produces in the icon field, and says how it went. */
  async function setIcon(work) {
    try {
      fieldIcon.value = await work();
      // Which clears the line under the tile: a picture of one's own is not
      // something the lookup has anything left to say about.
      paintPreview();
    } catch (err) {
      setIconStatus({ kind: 'error', text: err.message });
    }
  }

  modal.addEventListener('paste', e => {
    const data = e.clipboardData;
    if (!data) return;

    const files = clipboardFiles(data);
    if (files.length) {
      // Whatever it turns out to be, it was never going to paste as text.
      e.preventDefault();

      const picture = files.find(file => /^image\//.test(file.type || ''));
      if (!picture) {
        setIconStatus({ kind: 'error', text: t('icon_notAPicture') });
        return;
      }

      setIcon(() => Favicons.fromFile(picture));
      return;
    }

    // Only where SVG source is what was meant - see above.
    const meantAsIcon = e.target === fieldIcon
      || !(e.target.closest && e.target.closest('input, textarea, select'));
    if (!meantAsIcon) return;

    const text = data.getData('text/plain');
    if (!Favicons.looksLikeSvg(text)) return;

    e.preventDefault();
    setIcon(() => Favicons.fromSvg(text));
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
      { key: 'tileBg', label: t('tile_bgTitle'), default: '#0088ff' },
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
    armPipette(null);
  });

  // -------------------------------------------------- the icon colour well

  /**
   * Recolouring the icon itself, the same well and the same picker.
   *
   * White is what it opens on with nothing set: a logo laid over a colour of
   * its own is the reason to reach for this at all, and white is what that
   * wants far more often than any hue the picker could guess at.
   */
  let iconWell = null;

  function mountIconWell(value) {
    if (iconWell) iconWell.remove();

    const built = SettingsUI.colorControl(
      { key: 'tileIconColor', label: t('tile_iconColor'), default: '#ffffff' },
      value || '#ffffff',
      hex => { setPreviewIconColor(hex); return hex; }
    );

    iconWell = built.control;
    tileIconRow.prepend(iconWell);
  }

  function setPreviewIconColor(hex) {
    const had = previewIconColor;
    previewIconColor = hex || '';
    btnIconColorClear.hidden = !previewIconColor;

    // Dragging round the picker commits on every frame, and a stencil already
    // on the tile takes a new colour by having one written to it. Only going
    // from a picture to a stencil, or back, needs the icon drawn again.
    const stencil = tilePreview.querySelector('.tile__icon--tint');
    if (stencil && had && previewIconColor) {
      stencil.style.setProperty('--icon-tint', previewIconColor);
      return;
    }

    paintPreview();
  }

  btnIconColorClear.addEventListener('click', () => {
    setPreviewIconColor('');
    mountIconWell('');
  });

  // ------------------------------------------------------ the padding slider

  /**
   * Padding for this tile alone.
   *
   * The slider always shows a number, because a slider has nowhere to put "no
   * answer" - so with nothing set it shows the padding every tile is getting,
   * which is the number this tile is drawn with. Touching it is what makes
   * that number the tile's own; the button beside it hands the tile back to
   * the setting, and is only there while there is something to hand back.
   */
  let padRange = null;

  function mountPadRange(value) {
    if (padRange) padRange.remove();

    const built = SettingsUI.rangeControl(
      { key: 'tilePad', label: t('tile_pad'), min: 0, max: 40, step: 5, unit: '%' },
      value === null ? settings.logoPad : value,
      n => { setPreviewPad(n); return n; }
    );

    padRange = built.control;
    tilePadRow.prepend(padRange);
  }

  function setPreviewPad(pad) {
    previewPad = pad;
    applyTilePad(tilePreview, pad);
    btnPadClear.hidden = pad === null;
  }

  btnPadClear.addEventListener('click', () => {
    setPreviewPad(null);
    mountPadRange(null);
  });

  // ----------------------------------------------------- the rounding slider

  /**
   * Taking the corners off this tile's icon.
   *
   * A share of the icon's short side rather than a number of pixels, the same
   * reasoning as the padding above: the tile keeps its proportions as Tile size
   * changes. At 50% a square logo is a circle, which is what a favicon drawn as
   * a square badge by a site that never expected one usually wants; a wordmark
   * at 50% is a lozenge, because it is the short side either way.
   *
   * There is no setting behind this one, so nothing to fall back to and no
   * reason for the slider to have to say "no answer": 0 is the picture as its
   * designer drew it. The arrow beside it is the one press back to that, and is
   * only there while there is something to go back from.
   */
  let roundRange = null;

  function mountRoundRange(value) {
    if (roundRange) roundRange.remove();

    const built = SettingsUI.rangeControl(
      { key: 'tileRound', label: t('tile_round'), min: 0, max: 50, step: 5, unit: '%' },
      value,
      n => { setPreviewRound(n); return n; }
    );

    roundRange = built.control;
    tileRoundRow.prepend(roundRange);
  }

  function setPreviewRound(round) {
    previewRound = round;
    applyIconRound(tilePreview, round);
    btnRoundClear.hidden = round === 0;
  }

  btnRoundClear.addEventListener('click', () => {
    setPreviewRound(0);
    mountRoundRange(0);
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

  /**
   * Which colour the next click on the icon fills in - 'bg', 'icon', or null
   * for a pipette that is not armed.
   *
   * One state for both buttons rather than one each: the pointer can only be
   * pointing at one thing, and arming either has to disarm the other or a
   * click would have two answers.
   */
  let pipetteFor = null;

  /** The button that arms each of them, and shows which one is. */
  const PIPETTES = { bg: btnPipette, icon: btnIconPipette };

  const iconEl = () => tilePreview.querySelector('.tile__icon');
  /** The stencil, where the icon has been recoloured - see paintIcon. */
  const tintedIcon = () => tilePreview.querySelector('.tile__icon--tint');

  /** Whether a pointer event landed inside an element's box. */
  function inside(el, event) {
    const box = el.getBoundingClientRect();
    return Boolean(box.width) && Boolean(box.height)
      && event.clientX >= box.left && event.clientX <= box.right
      && event.clientY >= box.top && event.clientY <= box.bottom;
  }

  /**
   * The address to ask for the picture again by, when asking as a request the
   * host has to agree to.
   *
   * It carries a throwaway parameter, and that is the whole point. The tile
   * has already drawn this icon as a plain <img>, which asked the host for no
   * agreement and got none - and a browser holding that copy will hand it back
   * for this request too, whereupon it still cannot be read. Firefox does
   * exactly that, which is why sampling worked on a freshly hard-reloaded page
   * and stopped working once the icon had been seen once. A parameter the
   * cache has never met leaves it nothing to hand back.
   *
   * Only http(s) addresses are touched: anything stored inline is readable
   * already, and appending to a data: URI would corrupt the picture.
   */
  function sampleUrl(src) {
    if (!/^https?:/i.test(src)) return src;
    try {
      const url = new URL(src);
      url.searchParams.set('tiles-sample', Date.now().toString(36));
      return url.href;
    } catch {
      return src;
    }
  }

  function loadForSampling(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = sampleUrl(src);
    });
  }

  /**
   * Whether a picture on the page has finished arriving, and did arrive.
   *
   * The wait is capped. An <img> taken back out of the page mid-flight - which
   * is what a repaint does - fires neither event ever again, and a promise
   * that never settles would leave the button dead with nothing said about it.
   */
  const SAMPLE_WAIT = 4000;

  function settled(img) {
    if (img.complete) return Promise.resolve(img.naturalWidth > 0);
    return new Promise(resolve => {
      const done = ok => { clearTimeout(timer); resolve(ok); };
      const timer = setTimeout(() => done(img.naturalWidth > 0), SAMPLE_WAIT);
      img.addEventListener('load', () => done(img.naturalWidth > 0), { once: true });
      img.addEventListener('error', () => done(false), { once: true });
    });
  }

  /** @returns {boolean} whether the drawn picture can actually be read back */
  function drawForSampling(img) {
    const side = 128;
    // A fresh canvas each time rather than the one kept from the last tile.
    // Drawing a picture the page may not read taints a canvas, and what
    // untaints it again is resizing it - which the two lines below happen to
    // do. Depending on that is a thin thread to hang the whole feature on, and
    // a 128px canvas costs nothing to make.
    const canvas = document.createElement('canvas');
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
    // Nothing of the last tile's icon is allowed to survive into this one.
    sampler.ready = false;
    sampler.canvas = null;
    sampler.ctx = null;
    // A recoloured icon is a span with a mask, not a picture with pixels in
    // it; sampleAt answers for that one without coming here.
    if (!img || img.tagName !== 'IMG') return false;

    // An icon still on its way is not an icon that refuses to be read, and
    // saying so would be a lie the user has no way to act on. The button is
    // reachable well before a picture over the network has arrived.
    if (!(await settled(img))) return false;

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

  /** With no icon there is still a monogram, and its letter is a colour. */
  function colorUnderFallback(event) {
    const fallback = tilePreview.querySelector('.tile__fallback');
    if (!fallback || !inside(fallback, event)) return null;
    return parseCssColor(getComputedStyle(fallback).color);
  }

  /** The colour under the pointer, or null where there is nothing to read. */
  function sampleAt(event) {
    // A recoloured icon is that one colour all over; there is nothing else in
    // it left to read.
    const tint = tintedIcon();
    if (tint) return inside(tint, event) ? previewIconColor : null;

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

  async function armPipette(target) {
    if (target && target !== pipetteFor
        && !tintedIcon() && iconEl() && !(await prepareSampler())) {
      hint(t('icon_unreadable'));
      return;
    }

    pipetteFor = target;
    tilePreview.classList.toggle('is-sampling', Boolean(target));

    Object.keys(PIPETTES).forEach(key => {
      const on = key === target;
      PIPETTES[key].classList.toggle('is-on', on);
      PIPETTES[key].setAttribute('aria-pressed', String(on));
    });

    hint(target ? t('icon_clickToTake') : '');
  }

  /** Pressing an armed pipette puts it away; pressing the other one takes it. */
  const togglePipette = target => armPipette(pipetteFor === target ? null : target);

  btnPipette.addEventListener('click', () => togglePipette('bg'));
  btnIconPipette.addEventListener('click', () => togglePipette('icon'));

  tilePreview.addEventListener('pointermove', e => {
    if (!pipetteFor) return;
    const hex = sampleAt(e);
    hint(hex ? hex.toUpperCase() : t('icon_pointAt'));
  });

  tilePreview.addEventListener('click', e => {
    if (!pipetteFor) return;
    const hex = sampleAt(e);
    if (!hex) return;

    if (pipetteFor === 'icon') {
      setPreviewIconColor(hex);
      mountIconWell(hex);
    } else {
      setPreviewBg(hex);
      mountBgWell(hex);
    }

    armPipette(null);
  });

  function openTileModal(id) {
    editingId = id;
    iconKeepRefused = '';
    const tile = id ? tiles.find(t => t.id === id) : null;

    modalTitle.textContent = t(tile ? 'tile_editTitle' : 'tile_addTitle');
    fieldUrl.value = tile ? tile.url : '';
    fieldTitle.value = tile ? tile.title : '';
    fieldIcon.value = tile ? tile.icon : '';
    // A tile added while a group is being shown belongs to that group.
    fillGroupSelect(tile ? groupOf(tile) : activeGroup);
    btnDelete.hidden = !tile;
    modalError.hidden = true;

    // The tile's own answers first: the preview is painted from all three.
    previewBg = tile ? tile.bg : '';
    previewIconColor = tile ? tile.iconColor : '';
    previewPad = tile && typeof tile.pad === 'number' ? tile.pad : null;
    previewRound = tile ? tile.round || 0 : 0;

    btnBgClear.hidden = !previewBg;
    btnIconColorClear.hidden = !previewIconColor;
    btnPadClear.hidden = previewPad === null;
    btnRoundClear.hidden = previewRound === 0;

    mountBgWell(previewBg);
    mountIconWell(previewIconColor);
    mountPadRange(previewPad);
    mountRoundRange(previewRound);
    // Which also starts the icon lookup, so a tile being added has its picture
    // on the way before anything else has been filled in.
    paintPreview();

    openDialog(modal, fieldUrl);
    // Now that the sheet has a width, and so the stage has one to measure.
    sizePreview();
  }

  /**
   * The address whose picture has already been asked for and refused.
   *
   * Kept so the second press of Save goes ahead with the address itself rather
   * than asking the same host the same question again - which would leave the
   * sheet with no way out but Cancel.
   */
  let iconKeepRefused = '';

  /**
   * A tile icon named by web address, turned into one the tile owns.
   *
   * Downloaded and stored inline, so the tile is not at the mercy of a link
   * somebody else has to keep working, and is drawn the instant the page is.
   * Where the host will not let its bytes be read there is nothing to store:
   * the sheet says so and stays open, and pressing Save again keeps the
   * address, which is what a tile has always done with one.
   *
   * @returns {Promise<?string>} what to store, or null to stay in the sheet
   */
  async function iconToKeep(icon) {
    if (!/^https?:/i.test(icon) || icon === iconKeepRefused) return icon;

    btnSave.disabled = true;
    setIconStatus({ kind: 'loading', text: t('icon_fetching') });

    let kept = null;
    try {
      kept = await Favicons.fromUrl(icon);
    } catch {
      // Treated as a refusal - see below.
    }
    btnSave.disabled = false;

    if (kept) {
      // Written back into the field, so what the sheet shows is what is about
      // to be stored - the same as choosing a file or pasting a picture.
      fieldIcon.value = kept;
      return kept;
    }

    iconKeepRefused = icon;
    setIconStatus({ kind: 'error', text: t('icon_cannotKeep') });
    return null;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const url = normalizeUrl(fieldUrl.value);
    if (!url) {
      SettingsUI.setStatus(modalError, { kind: 'error', text: t('tile_badUrl') });
      return;
    }

    const icon = await iconToKeep(fieldIcon.value.trim());
    if (icon === null) return;

    const title = fieldTitle.value.trim();
    const groupId = fieldGroup.value || null;
    const look = {
      icon,
      iconColor: previewIconColor,
      bg: previewBg,
      pad: previewPad,
      round: previewRound
    };

    if (editingId) {
      const tile = tiles.find(t => t.id === editingId);
      if (tile) {
        // What is held about this tile's picture belongs to the address it had
        // and the picture it was given. Pointed somewhere else, or handed a
        // different picture, it must not go on showing the old one - and the
        // old site's entry in the lookup cache is dead weight the moment
        // nothing points at it any more.
        // The colour is deliberately not in this: it decides how the picture
        // is drawn, not which picture it is, and the key kept beside the
        // element already accounts for it.
        const was = { id: tile.id, url: tile.url };
        const changed = tile.url !== url || tile.icon !== icon;

        Object.assign(tile, { url, title, groupId }, look);
        if (changed) await forgetTileIcon(was);
      }
    } else {
      tiles.push({ id: crypto.randomUUID(), url, title, groupId, ...look, visits: 0 });
    }

    await persistTiles();
    render();
    closeDialog(modal);
  });

  btnCancel.addEventListener('click', () => closeDialog(modal));

  /**
   * Takes a tile away, asking first where the setting says to.
   *
   * With Confirm before deleting a tile off - which is how it has always
   * been - the tile simply goes: it is a bookmark, and putting one back is
   * typing an address. The menu item that calls this is marked destructive so
   * it does not get hit by accident on the way past. With it on, the alert
   * names the tile: the menu was opened over one tile out of forty, and the
   * name is how you know it was the right one.
   *
   * @returns {Promise<boolean>} whether the tile actually went
   */
  async function deleteTile(id) {
    const tile = tiles.find(t => t.id === id);
    if (!tile) return false;

    if (settings.confirmDelete) {
      const name = tile.title || defaultTitle(tile.url);
      if (!(await askAlert(t('confirm_deleteText', name)))) return false;
    }

    tiles = tiles.filter(t => t.id !== id);
    // Nothing points at it any more, so nothing kept about its picture is
    // worth the room - in memory or in the lookup cache.
    await forgetTileIcon(tile);
    await persistTiles();
    render();
    return true;
  }

  btnDelete.addEventListener('click', async () => {
    const id = editingId;

    // With nothing to ask, the sheet goes first: it is showing the tile that is
    // about to go. With the alert on it stays up behind it instead, so
    // cancelling puts you back in the sheet you were in rather than leaving it
    // closed over a tile that is still there.
    if (!settings.confirmDelete) closeDialog(modal);
    if (await deleteTile(id)) closeDialog(modal);
  });

  // Opening a tile is what a visit is. The click is not intercepted - the link
  // does its own navigating - only counted on the way past.
  grid.addEventListener('click', e => {
    const el = e.target.closest('.tile[data-id]');
    if (el) countVisit(el.dataset.id);
  });

  // --------------------------------------------------------- context menu

  /**
   * The menu that opens where it was asked for.
   *
   * Adding a tile and making a group used to be buttons standing on the page.
   * They are rare things to do and they were on screen the whole time, so they
   * are here instead: the page has no chrome to hunt through, and a right-click
   * is where a desktop looks for what it can do. What the menu offers depends
   * on what was under the pointer - a tile can be edited and deleted, the page
   * itself cannot.
   *
   * One menu exists at a time and it is built fresh each time it opens, so
   * nothing has to be kept in step with a tile that has since been deleted.
   */
  let dismissMenu = null;

  const MENU_MARGIN = 8;

  /** Stands between two runs of items; not an item itself. */
  const SEPARATOR = Symbol('separator');

  function buildMenuItem(item, close) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'menu__item';
    el.setAttribute('role', 'menuitem');
    if (item.danger) el.classList.add('menu__item--danger');

    el.append(Icons.create(item.icon, { size: 15 }));

    const text = document.createElement('span');
    text.className = 'menu__label';
    text.textContent = item.label;
    el.append(text);

    el.addEventListener('click', () => {
      // Closed first: the menu is not meant to be standing behind whatever
      // the item opens, and several of these open a dialog.
      close();
      item.run();
    });
    return el;
  }

  /**
   * Puts the menu where it was asked for, and inside the window.
   *
   * It hangs down and to the right of the pointer, the way a desktop menu
   * does, and flips to the other side of it when that would run off an edge -
   * flipping rather than sliding, so the pointer never ends up on top of an
   * item it could trigger by accident.
   */
  function placeMenu(menu, x, y) {
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;

    let left = x;
    if (left + width > window.innerWidth - MENU_MARGIN) left = x - width;
    left = Math.max(MENU_MARGIN, Math.min(left, window.innerWidth - width - MENU_MARGIN));

    let top = y;
    if (top + height > window.innerHeight - MENU_MARGIN) top = y - height;
    top = Math.max(MENU_MARGIN, Math.min(top, window.innerHeight - height - MENU_MARGIN));

    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
  }

  function openMenu(x, y, items) {
    if (dismissMenu) dismissMenu();

    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    // Focusable so the menu can hold focus without any row holding it, which
    // is what keeps the arrow keys working with nothing yet chosen.
    menu.tabIndex = -1;

    items.forEach(item => {
      if (item === SEPARATOR) {
        const rule = document.createElement('div');
        rule.className = 'menu__sep';
        menu.append(rule);
        return;
      }
      menu.append(buildMenuItem(item, close));
    });

    const entries = () => Array.from(menu.querySelectorAll('.menu__item'));

    function onOutside(e) {
      if (!menu.contains(e.target)) close();
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        // The dialogs are listening for Escape too, and the menu is what is
        // on top, so the menu is what closes.
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();

      const all = entries();
      const at = all.indexOf(document.activeElement);
      const down = e.key === 'ArrowDown';

      // From the menu itself, with no row chosen yet, the first key press
      // enters at the near end - top going down, bottom going up. After that
      // it wraps, so holding one arrow walks the whole menu round.
      const next = at === -1
        ? (down ? 0 : all.length - 1)
        : (at + (down ? 1 : -1) + all.length) % all.length;

      if (all[next]) all[next].focus();
    }

    function close() {
      if (dismissMenu !== close) return;
      dismissMenu = null;

      menu.remove();
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('scroll', close, true);
    }

    dismissMenu = close;
    document.body.append(menu);
    placeMenu(menu, x, y);

    // Capture, so a press that lands on a control which stops the event from
    // bubbling still shuts the menu.
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('scroll', close, true);

    // The menu takes focus, not the first item in it. Focusing an item would
    // light that row up and leave it lit: Firefox counts a programmatic focus
    // as focus-visible, so the row reads as hovered when the pointer is
    // nowhere near it. A menu opened by pointer starts with nothing chosen,
    // which is what a desktop menu does; the arrow keys are what choose.
    menu.focus({ preventScroll: true });
  }

  /**
   * What can be done to the page, whatever was right-clicked to get here.
   *
   * Settings sits at the foot behind a rule, where every desktop menu keeps
   * it, and is offered whether or not the gear is on the page: a menu that
   * changed its mind about what it held depending on a setting would be the
   * harder thing to learn.
   */
  function pageItems() {
    return [
      { icon: 'plus', label: t('menu_addTile'), run: () => openTileModal(null) },
      { icon: 'tag', label: t('menu_newGroup'), run: () => openGroupModal(null) },
      SEPARATOR,
      { icon: 'settings', label: t('menu_settings'), run: openSettings }
    ];
  }

  /**
   * Opens a tile in a tab of its own, whatever a click on it would have done.
   *
   * `noopener` for the reason the tiles themselves carry it: the page being
   * opened has no business reaching back into this one. The visit is counted
   * the same way a click's is - it is the same visit, asked for differently.
   */
  function openTileInNewTab(id) {
    const tile = tiles.find(t => t.id === id);
    if (!tile) return;

    window.open(tile.url, '_blank', 'noopener,noreferrer');
    countVisit(id);
  }

  /**
   * What can be done to one tile, above what can be done to the page.
   *
   * Opening it heads the list because it is what the tile is for, and it is
   * offered whether or not clicking already opens in a new tab: a menu that
   * changed its mind about what it held depending on a setting would be the
   * harder thing to learn - the same reason Settings is always at the foot.
   */
  function tileItems(id) {
    return [
      { icon: 'external-link', label: t('menu_openInNewTab'), run: () => openTileInNewTab(id) },
      { icon: 'pencil', label: t('menu_editTile'), run: () => openTileModal(id) },
      { icon: 'trash-2', label: t('menu_deleteTile'), danger: true, run: () => deleteTile(id) },
      SEPARATOR,
      ...pageItems()
    ];
  }

  document.addEventListener('contextmenu', e => {
    // A text field keeps the browser's own menu: copy, paste and spelling
    // live there, and nothing here replaces them. So does anything inside a
    // dialog, which is a place with its own buttons for what it can do.
    if (e.target.closest('input, textarea, .modal, .picker, .menu')) return;

    e.preventDefault();

    const tile = e.target.closest('.tile[data-id]');
    // A menu asked for from the keyboard has no pointer to open at, and says
    // so with a zero. The thing it was asked about is where it belongs.
    const from = (e.clientX || e.clientY)
      ? { x: e.clientX, y: e.clientY }
      : (rect => ({ x: rect.left, y: rect.bottom }))(
          (tile || document.body).getBoundingClientRect());

    openMenu(from.x, from.y, tile ? tileItems(tile.dataset.id) : pageItems());
  });

  // --------------------------------------------------------------- group dialog

  function openGroupModal(id) {
    editingGroupId = id;
    const group = id ? groups.find(g => g.id === id) : null;

    groupModalTitle.textContent = t(group ? 'group_edit' : 'group_new');
    fieldGroupName.value = group ? group.name : '';
    btnGroupDelete.hidden = !group;
    groupError.hidden = true;

    openDialog(groupModal, fieldGroupName);
  }

  groupForm.addEventListener('submit', async e => {
    e.preventDefault();

    const name = fieldGroupName.value.trim();
    if (!name) {
      SettingsUI.setStatus(groupError, { kind: 'error', text: t('group_needName') });
      return;
    }
    if (!editingGroupId && groups.length >= Store.MAX_GROUPS) {
      SettingsUI.setStatus(groupError, {
        kind: 'error',
        text: t('group_full', Store.MAX_GROUPS)
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
    bundled: 'font_fromBundle',
    system: 'font_fromSystem',
    cache: 'font_fromCache',
    network: 'font_fromNetwork'
  };

  async function changeFont(key, value) {
    const name = value.trim();

    // On the page at once, but not yet in storage: the stack takes hold before
    // a single file has arrived, so choosing a family is not a wait - and a
    // family that never arrives was never written down.
    applyFontStacks({ [key]: name });

    try {
      // A header line handed back to the page font has nothing of its own to
      // fetch: whatever it is now following is already here.
      const source = (name || key === 'font') ? await Fonts.load(name) : null;

      updateSetting(key, name);
      // The family just left may now be the family nothing names, in which
      // case its stylesheet goes with it.
      loadFonts();

      return {
        value: name,
        status: source
          ? {
            kind: 'ok',
            text: t('font_loaded', name || t('font_system'), t(FONT_SOURCE[source]))
          }
          : { kind: 'ok', text: t('font_following') }
      };
    } catch (err) {
      // Keep the last family that worked on screen.
      applyFontStacks();
      return { value: settings[key], status: { kind: 'error', text: err.message } };
    }
  }

  const PERMISSION_HINT = t('perm_hint');

  async function changeDeepIcons(on) {
    if (on) {
      if (!Favicons.supportsPermissions) {
        return {
          value: false,
          status: {
            kind: 'error',
            text: t('perm_notInstalled')
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
                ? t('perm_refused', error, PERMISSION_HINT)
                : t('perm_declined', PERMISSION_HINT)
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
        text: t(on ? 'perm_deepOn' : 'perm_deepOff')
      }
    };
  }

  /** The record a picker action names: one from the list, a file, an address. */
  async function pickedBackground(payload) {
    if (payload.action === 'recent') {
      const found = recentBackgrounds.find(item => item.src === payload.src);
      // Another new-tab page can have pushed it off the end between the strip
      // being drawn and the chip being clicked.
      if (!found) throw new Error(t('bg_droppedOff'));
      return found;
    }

    return payload.action === 'url'
      ? Backgrounds.fromUrl(payload.url)
      : Backgrounds.fromFile(payload.file);
  }

  /** How a wallpaper is being looked at: its blur, its dim and its position. */
  const currentEffects = () =>
    Object.fromEntries(Schema.EFFECT_KEYS.map(key => [key, settings[key]]));

  /**
   * Puts the effects back to what the wallpaper being restored was last seen
   * with, and says whether that moved anything.
   *
   * Written straight into `settings` rather than through one `updateSetting`
   * per key, so they land in a single repaint and a single write - and so the
   * caller can decide, once, whether the dialog needs rebuilding around the
   * controls that just moved under it.
   */
  function applyEffects(effects) {
    const wanted = Schema.coerceEffects(effects);
    if (Schema.EFFECT_KEYS.every(key => settings[key] === wanted[key])) return false;

    settings = Schema.coerce({ ...settings, ...wanted });
    applySettings();
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => Store.saveSettings(settings), 250);
    return true;
  }

  /**
   * Hands the background being left the effects it was last looked at with, so
   * going back to it later goes back to how it looked.
   *
   * This is the moment to write them rather than every time a slider moves:
   * the list is the heaviest thing in the storage area, and a wallpaper still
   * on screen needs nothing remembered about it - what is in `settings` *is*
   * how it looks.
   */
  async function partWith(record) {
    if (!record || !record.src) return;
    try {
      recentBackgrounds = await Backgrounds.noteEffects(record.src, currentEffects());
    } catch {
      // A full storage area is not worth losing the change that prompted this.
    }
  }

  /**
   * The background picker sends an action rather than a value, and gets back
   * `{record, recent}` - what is on screen now, and the last few. Anything that
   * goes wrong (a file that is neither picture nor video, one over the size
   * limit, no room to store it) comes back as the status line instead, with
   * neither, so the field keeps showing what is really on screen.
   *
   * The two removals are deliberately not the same thing: `clear` takes the
   * wallpaper off the page and leaves the history alone, `forget` takes one
   * out of the history and leaves the page alone.
   */
  async function changeBackground(payload) {
    const previous = background;
    try {
      // Drops one from the strip. The background on screen is not touched even
      // when it is the one being dropped: this is a tidy-up of the history, not
      // a way to take the wallpaper away - Remove is that, and it is right
      // there above the strip.
      if (payload.action === 'forget') {
        recentBackgrounds = await Backgrounds.forgetOne(payload.src);
        return { value: { recent: recentBackgrounds } };
      }

      if (payload.action === 'clear') {
        await partWith(previous);
        background = await Backgrounds.clear();
        Backgrounds.apply(background);
        // The list is left as it was: being able to put back what was just
        // taken away is most of what it is for.
        return { value: { record: null, recent: recentBackgrounds } };
      }

      const record = await pickedBackground(payload);

      // On screen first. Writing megabytes to storage is the slow half and the
      // half that can fail; the background should not wait on it, and the
      // settings dialog is not the only place it has to show up.
      Backgrounds.apply(record);
      try {
        // Same `src`, so this does not repaint - it is the stored record, name
        // and timestamp included, that the rest of the page goes on to use.
        background = await Backgrounds.save(record);
      } catch (err) {
        Backgrounds.apply(previous);
        throw err;
      }

      // The one being left keeps the effects it was looked at with, and the
      // one arriving gets them back if it had any of its own. Nothing to do
      // when the same wallpaper is picked twice.
      const swapped = !previous || previous.src !== background.src;
      if (swapped) await partWith(previous);

      // A wallpaper arriving brings its own effects or it brings none; what
      // it must not do is go on wearing the last one's. One picked off the strip
      // remembers what it was last looked at with. Anything newly chosen - a
      // file, an address, or an entry old enough to have been remembered
      // before they were kept with it - starts at the defaults, which is
      // the only honest answer to "what were this one's settings": it has
      // never had any.
      const remembered = swapped && record.effects ? record.effects : null;
      const moved = swapped ? applyEffects(remembered) : false;

      // Read after the restore, so the entry is stamped with what is actually
      // in force - the pair just put back, or the pair that was already there.
      recentBackgrounds = await remember(background, currentEffects());

      // What the address did in the end: kept, or left as an address because
      // the host would not give its bytes up - see Backgrounds.fromUrl.
      const byAddress = payload.action === 'url' && !record.stored;

      const status = {
        kind: 'ok',
        text: t(byAddress
          ? 'bg_setByAddress'
          : moved
            ? (remembered ? 'bg_setRemembered' : 'bg_setDefaults')
            : settings.bgDim >= 80 ? 'bg_setDimmed' : 'bg_set')
      };

      // The effects just changed under their own controls, so the whole dialog
      // is rebuilt to show them - which takes the row waiting on this status
      // with it, and the new mount is handed the line instead.
      if (moved) {
        mountSettings({ background: status });
        return { value: null };
      }

      return { value: { record: background, recent: recentBackgrounds }, status };
    } catch (err) {
      return { value: {}, status: { kind: 'error', text: err.message } };
    }
  }

  /**
   * Adds a background to the list of recent ones, or leaves the list as it is
   * when there is no room for it. A full storage area is not worth losing the
   * background that did fit over - the list is a convenience, not the setting.
   */
  async function remember(record, effects) {
    try {
      return await Backgrounds.remember(record, effects);
    } catch {
      return recentBackgrounds;
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
        return { value: null, status: { kind: 'ok', text: t('backup_saved', name) } };
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
          text: t('backup_stopped', err.message)
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
    if (dropped.stats) lost.push(t('restore_lostStats'));
    if (dropped.colours) lost.push(t('restore_lostColours'));
    if (!lost.length) return '';

    return ' ' + t('restore_lost', I18N.list(lost));
  }

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
      done.push(I18N.plural(groups.length, 'restore_group', 'restore_groups'));
    }

    if ('tiles' in sections) {
      tiles = await Store.save(sections.tiles);
      done.push(I18N.plural(tiles.length, 'restore_tile', 'restore_tiles'));
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
      done.push(t(doc.partialSettings ? 'restore_someSettings' : 'restore_allSettings'));
    }

    if ('background' in sections) {
      try {
        background = sections.background
          ? await Backgrounds.save(sections.background)
          : await Backgrounds.clear();
        if (background) recentBackgrounds = await remember(background);
        done.push(t('restore_background'));
      } catch {
        pictureFailed = true;
      }
    }

    Backgrounds.apply(background);
    applySettings();
    loadFonts();
    renderGroups();
    render();

    const refused = t('restore_pictureRefused');
    // A backup of nothing but a picture that was then refused restored nothing
    // at all, so there is only the refusal to report.
    const text = done.length
      ? (doc.source
        ? t('restore_doneFrom', I18N.list(done), doc.source)
        : t('restore_done', I18N.list(done)))
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
    // The list goes with it. Leaving six stored pictures behind - a click
    // from being back on screen, and still taking up the room - is not what
    // "take the background away" says.
    recentBackgrounds = await Backgrounds.forget();

    Backgrounds.apply(background);
    applySettings();
    loadFonts();
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
    'openInNewTab', 'showVisits', 'showAddButton', 'tileOrder',
    // Taking "All" away moves the page into the first group, which is a
    // different set of tiles - see settleActiveGroup.
    'showAllGroup'
  ]);

  /** The same, for the block of group chips: what it holds, not how it looks. */
  const REBUILDS_GROUPS = new Set(['showGroupAdd', 'showAllGroup']);

  async function onSettingChange(key, value) {
    if (FONT_KEYS.includes(key)) return changeFont(key, value);
    if (key === 'reset') return resetSettings();
    if (key === 'deepIcons') return changeDeepIcons(value);
    if (key === 'background') return changeBackground(value);
    if (key === 'backup') return changeTransfer(value);

    const effective = updateSetting(key, value);
    // The chips first: renderGroups is what settles which group the page is
    // on, and the grid is drawn from that.
    if (REBUILDS_GROUPS.has(key)) renderGroups();
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
    // is handed to the dialog on the side - the picture on screen and the last
    // few, which are the two things its picker draws.
    SettingsUI.mount(settingsBody, {
      values: { ...settings, background: { record: background, recent: recentBackgrounds } },
      status,
      onChange: onSettingChange,
      // macOS titles a settings window with the pane it is showing.
      onSection: label => { settingsTitle.textContent = label || t('settings_title'); },
      // The scroll edge effect: the hairline under the toolbar arrives with
      // the content that passes beneath it. See .window__box.is-scrolled.
      onScroll: top => settingsForm.classList.toggle('is-scrolled', top > 0)
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

  /**
   * Raises the settings window, wherever the ask came from - the gear on the
   * page, the right-click menu, or the keyboard. Three doors, one room: the
   * gear is the only one of them that can be turned off, so the other two are
   * what the setting to hide it leans on.
   */
  function openSettings() {
    mountSettings();
    openDialog(settingsModal);
    syncSiteAccess();
  }

  btnSettings.addEventListener('click', openSettings);

  btnSettingsClose.addEventListener('click', () => closeDialog(settingsModal));

  settingsForm.addEventListener('submit', e => {
    e.preventDefault();
    closeDialog(settingsModal);
  });

  // ---------------------------------------------------------------- frost

  /**
   * Tells each tile where it is standing in the blurred copy of the picture
   * it is drawn on - see the frost in backgrounds.js, and the tile background
   * in newtab.css.
   *
   * The copy is already cut to the window the way the picture behind it is;
   * all that is left is each tile's own place in that crop, which is read off
   * the page rather than worked out again. The grid decides where a tile goes
   * - from the column count, the size, the gap, how many tiles there are -
   * and a second opinion here would be one more thing to keep in step with it.
   */
  function placeFrost() {
    // Which answers whether there is one to place. Asked rather than read off
    // the page: this runs before the class that puts the frost on the tiles,
    // so that nothing is ever drawn with the crop half worked out.
    if (!Backgrounds.placeFrost(settings.bgPosY)) return;

    // Measured first, written after. A write invalidates the layout, so
    // reading the next tile in the same turn makes the browser work the whole
    // page out again - fifty times over, for a job the one layout answers.
    const places = [...grid.querySelectorAll('.tile')].map(el => [el, tileAt(el)]);
    places.forEach(([el, at]) => {
      el.style.setProperty('--tile-x', Math.round(at.left) + 'px');
      el.style.setProperty('--tile-y', Math.round(at.top) + 'px');
    });
  }

  /**
   * Where a tile *sits* in the window, which is not always where it is drawn.
   *
   * A tile is very often drawn somewhere it does not sit: sliding in on a
   * change of group, lifted a couple of pixels under the pointer, part way
   * through the slide that follows a drag. getBoundingClientRect answers with
   * the drawing, transform and all, and a frost placed from that is lined up
   * with the movement - so it comes to rest out of register with the picture
   * behind it and stays there until the next resize.
   *
   * offsetTop and offsetLeft are the layout's own answer and no transform
   * touches them. Walked up to the page and with the scroll taken back off,
   * they are the box the tile would have measured standing still.
   */
  function tileAt(el) {
    let x = 0;
    let y = 0;
    for (let node = el; node; node = node.offsetParent) {
      x += node.offsetLeft || 0;
      y += node.offsetTop || 0;
    }

    const view = scroller();
    return { left: x - (view.scrollLeft || 0), top: y - (view.scrollTop || 0) };
  }

  /**
   * A picture stored before there were frosts, whose frost has just been made
   * here rather than read. It is put away with the picture, so this is the one
   * new tab that has to wait for it - every one after it paints with the copy
   * already in hand.
   *
   * Only the background the page is actually running on, and only once: the
   * settings dialog paints trial backgrounds through the same door, and a
   * picture being looked at is not one that has been chosen.
   */
  let frostToKeep = null;

  function frostArrived(made) {
    placeFrost();

    if (!made || !frostToKeep || !background || background.src !== frostToKeep) return;
    frostToKeep = null;
    background = { ...background, frost: made };
    // No room for it is no reason to say anything: the picture is what
    // matters, and the copy is made again next time.
    Store.saveBackground(background).catch(() => {});
  }

  /** The same, at most once a frame: resizing and scrolling both ask often. */
  let frostQueued = false;
  function placeFrostSoon() {
    if (frostQueued) return;
    frostQueued = true;
    requestAnimationFrame(() => {
      frostQueued = false;
      placeFrost();
    });
  }

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

    // A window that changed shape re-cuts the picture, and the tiles have
    // moved with it; a page scrolled under a picture that does not scroll
    // leaves every one of them somewhere else in it.
    window.addEventListener('resize', placeFrostSoon);
    window.addEventListener('scroll', placeFrostSoon, { passive: true });
    Backgrounds.onFrost = frostArrived;
  }

  // ---------------------------------------------------------------- clock

  /**
   * What each format asks Intl for. Option bags rather than patterns, so the
   * separators, the order of the parts and where the AM/PM suffix falls are
   * the browser's language to decide - "29/08" and "08/29" are the same choice
   * made in two places.
   */
  const TIME_FORMATS = Schema.TIME_FORMATS;
  const DATE_FORMATS = Schema.DATE_FORMATS;

  function tick() {
    const now = new Date();

    clock.textContent = now.toLocaleTimeString(
      [], TIME_FORMATS[settings.timeFormat] || TIME_FORMATS['24']);

    dateLine.textContent = now.toLocaleDateString(
      [], DATE_FORMATS[settings.dateFormat] || DATE_FORMATS.full);
  }

  /** How often the clock is redrawn, in ms, and the timer doing it. */
  let clockCadence = 0;
  let clockTimer = null;

  /**
   * Seconds have to be redrawn every second. Anything else is a minute hand,
   * and ten seconds catches the turn closely enough without waking the page
   * sixty times a minute. Re-armed only when the cadence actually changes, so
   * dragging a slider does not keep resetting the phase under the clock.
   */
  function scheduleTick() {
    const wanted = String(settings.timeFormat).endsWith('s') ? 1000 : 10000;
    if (wanted === clockCadence) return;

    clockCadence = wanted;
    clearInterval(clockTimer);
    clockTimer = setInterval(tick, wanted);
  }

  // ---------------------------------------------------------------- boot

  (async function init() {
    // Words first, then the glyphs that stand among them: I18N.apply keeps
    // the icon in the paste hint but moves it, so hydrating before it would
    // be drawing into an element about to be picked up and put down again.
    I18N.apply();
    Icons.hydrate();

    let remembered;
    [tiles, groups, settings, background, recentBackgrounds, remembered] = await Promise.all([
      Store.load(), Store.loadGroups(), Store.loadSettings(), Store.loadBackground(),
      Store.loadRecentBackgrounds(), Store.loadActiveGroup()
    ]);

    // A group that has since been deleted is no group at all, and starting on
    // it would show an empty grid with no way to tell why.
    if (settings.keepGroup && groups.some(group => group.id === remembered)) {
      activeGroup = remembered;
    }

    trackPageShape();
    applySettings();
    // Noted before the picture goes up, because putting it up is what sets a
    // frost being made for it going.
    frostToKeep = background && !background.frost ? background.src : null;
    Backgrounds.apply(background);
    // The stacks are already written - applySettings does that - so a family
    // that will not come down still leaves the page on Inter behind it.
    loadFonts();
    renderGroups();
    render();

    // The page is up, so the outline standing in for it goes - and goes for
    // good rather than being hidden, because nothing here is ever loading
    // again. See the loading screen in newtab.css.
    document.body.classList.remove('is-loading');
    const skeleton = document.getElementById('skeleton');
    if (skeleton) skeleton.remove();

    syncSiteAccess();
    Favicons.onAccessChange(() => syncSiteAccess());

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
        if (FONT_KEYS.some(key => before[key] !== settings[key])) loadFonts();
        if ([...REBUILDS_GROUPS].some(key => before[key] !== settings[key])) renderGroups();
        if (before.deepIcons !== settings.deepIcons
            || [...REBUILDS_GRID].some(key => before[key] !== settings[key])) render();
        if (!settingsModal.hidden) mountSettings();
      } else if (key === 'background') {
        background = value;
        Backgrounds.apply(background);
        if (!settingsModal.hidden) mountSettings();
      } else if (key === 'bgRecent') {
        // Nothing on the page shows the list except the dialog, so there is
        // nothing to repaint when it is closed.
        recentBackgrounds = value;
        if (!settingsModal.hidden) mountSettings();
      } else if (key === 'activeGroup') {
        // Which group is being looked at is shared, the way everything else
        // here is - so picking one moves every open new tab to it, and moves
        // it the way the tab it was picked in moved.
        if (!settings.keepGroup) return;
        const id = groups.some(group => group.id === value) ? value : null;
        switchGroup(id, { remember: false });
      }
    });
  })();
})();
