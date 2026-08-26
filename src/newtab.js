(() => {
  'use strict';

  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  // The two the group block moves between: over the page, or set in it.
  const page = document.querySelector('.page');
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
  const btnDelete = document.getElementById('btnDelete');
  const fieldGroup = document.getElementById('fieldGroup');
  const fieldIcon = document.getElementById('fieldIcon');
  const fieldIconFile = document.getElementById('fieldIconFile');
  const btnIconFile = document.getElementById('btnIconFile');
  const btnIconReload = document.getElementById('btnIconReload');

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
    root.style.setProperty('--bg-blur', settings.bgBlur + 'px');
    root.style.setProperty('--bg-dim', settings.bgDim / 100);

    const fixedColumns = settings.columns !== 'auto';
    grid.classList.toggle('is-fixed-columns', fixedColumns);
    if (fixedColumns) root.style.setProperty('--columns', settings.columns);

    document.body.classList.toggle('no-labels', !settings.showLabels);

    const bar = settings.groupStyle === 'bar';
    document.body.classList.toggle('gb-bar', bar);
    document.body.classList.toggle('gb-floating', !bar);
    // The bar's own edge. A floating block has an edge too, but it is a
    // different setting with a third place in it - see below.
    document.body.classList.toggle('gb-bottom', bar && settings.groupEdge === 'bottom');
    document.body.classList.toggle('gb-hover', settings.groupShow === 'hover');
    root.style.setProperty('--groupbar-align', ALIGNMENT[settings.groupAlign]);

    // Where the floating pill sits. Top and bottom hold it over the page at
    // that edge; "above the tiles" is not a float at all - it takes its place
    // in the page's own column, between the clock and the grid.
    const inline = !bar && settings.groupFloat === 'tiles';
    document.body.classList.toggle('gb-inline', inline);
    document.body.classList.toggle('gb-float-bottom', !bar && settings.groupFloat === 'bottom');

    // A block in the page has to be *in* the page: only the markup can say
    // which row of that column it holds. Moved only when it is in the wrong
    // one, so a slider drag does not replay the pill's arrival every frame.
    const home = inline ? page : document.body;
    if (groupBar.parentElement !== home) {
      home.insertBefore(groupBar, inline ? grid : toolbar);
    }

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
    chip.title = 'New group';
    chip.setAttribute('aria-label', 'New group');
    chip.append(Icons.create('plus', { size: 15 }));
    if (!compact) chip.append(document.createTextNode('New group'));
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
    if (any && settings.showAllGroup) groupChips.append(buildChip({ id: null, name: 'All' }));
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

  /** How long the block stays out after a group change, in ms. Long enough to
   *  read the name that lit up, short enough not to become the furniture. */
  const PEEK_MS = 1600;

  /** set while the block is showing itself after a change */
  let peekTimer;

  /**
   * Brings the block out for a moment, for the benefit of hover mode.
   *
   * A grid that has just been filtered has to say what filtered it, or the
   * tiles that went look like tiles that were lost. Keeping the block out for
   * as long as a group is picked - which is what this used to do - meant it
   * never went away at all, since a remembered group is where most new tabs
   * open: the setting looked broken. So the change announces itself and the
   * block then steps back, the way a scrollbar does.
   *
   * Outside hover mode the block is on show whatever happens, and the class
   * draws nothing there - so there is nothing to guard.
   */
  function peekGroups() {
    groupBar.classList.add('is-peek');
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => groupBar.classList.remove('is-peek'), PEEK_MS);
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

  /** set while the grid is on its way out, holding the redraw that follows */
  let switchTimer;

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
    peekGroups();

    if (!animatesGroups()) {
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
      render();
      stage.forEach(el => {
        el.classList.remove('is-leaving');
        // The stylesheet puts .is-nudged last, so that a nudge can play over a
        // settled .is-entering. That order also means a nudge left on from a
        // moment ago would sit on top of this one, so it goes first.
        el.classList.remove('is-nudged');
        replay(el, 'is-entering');
      });
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

  /** How far this event went the way the setting cares about; 0 to ignore it. */
  function wheelDelta(e) {
    const scale = e.deltaMode === 1 ? WHEEL_LINE : e.deltaMode === 2 ? WHEEL_PAGE : 1;

    if (settings.groupScrollAxis === 'horizontal') {
      // Left and right is a gesture a mouse cannot make. Rather than leave
      // wheel users with a setting that does nothing, a notch of the wheel
      // counts as the push its one axis was meant to be - while a touchpad
      // scrolled up and down is still left to the page, which is what asking
      // for left and right was about.
      if (e.deltaX) return e.deltaX * scale;
      return isWheel(e) ? e.deltaY * scale : 0;
    }
    if (settings.groupScrollAxis === 'vertical') return e.deltaY * scale;
    // Either way: whichever way the gesture is mostly going.
    return (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * scale;
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

    const delta = wheelDelta(e);
    if (!delta) return;

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
      // With the + turned off there is no + to hit, and the only way in is
      // the one the menu offers.
      empty.textContent = activeGroup
        ? 'Nothing in this group yet - drag a tile onto its name to put it here.'
        : settings.showAddButton
          ? 'No tiles yet. Hit + to add your first site.'
          : 'No tiles yet. Right-click anywhere to add your first site.';
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
        text: settings.deepIcons
          ? 'This site offers no icon of its own — choose or paste a picture instead.'
          : 'Nothing at the usual addresses. Deep icon lookup, in Settings, reads '
            + 'the page itself and usually finds one.'
      };
    }

    if (found.vector) {
      return { kind: 'ok', text: 'Found a vector icon — sharp at any size.' };
    }

    if (found.size >= GOOD_ICON) {
      return { kind: 'ok', text: `Found a ${found.size}px icon.` };
    }

    return {
      kind: 'ok',
      text: `Found a ${found.size}px icon`
        + (settings.deepIcons
          ? ', which is the largest this site publishes.'
          : '. Deep icon lookup, in Settings, often finds a larger one.')
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
    const url = normalizeUrl(fieldUrl.value);
    if (!url) {
      SettingsUI.setStatus(modalError,
        { kind: 'error', text: 'Fill in the address first — that is what is looked up.' });
      return;
    }

    const had = fieldIcon.value.trim();
    fieldIcon.value = '';

    btnIconReload.disabled = true;
    SettingsUI.setStatus(modalError,
      { kind: 'loading', text: 'Looking for the sharpest icon this site has…' });

    try {
      const found = await Favicons.resolve(url, { deep: settings.deepIcons, force: true });
      paintPreview();

      const report = iconReport(found);
      SettingsUI.setStatus(modalError, had
        ? { ...report, text: report.text + ' The picture that was set has been cleared.' }
        : report);
    } catch (err) {
      SettingsUI.setStatus(modalError, { kind: 'error', text: err.message });
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
      paintPreview();
      SettingsUI.setStatus(modalError, null);
    } catch (err) {
      SettingsUI.setStatus(modalError, { kind: 'error', text: err.message });
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
        SettingsUI.setStatus(modalError,
          { kind: 'error', text: 'That is not a picture.' });
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
    if (!img) return false;

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
    if (!fallback) return null;

    const box = fallback.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right
      && event.clientY >= box.top && event.clientY <= box.bottom;

    return inside ? parseCssColor(getComputedStyle(fallback).color) : null;
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

  /**
   * Takes a tile away.
   *
   * No confirmation, the same as the sheet's own Delete has always been: the
   * tile is a bookmark, and putting it back is typing an address. The menu
   * item that calls this is marked destructive so it does not get hit by
   * accident on the way past.
   */
  async function deleteTile(id) {
    tiles = tiles.filter(t => t.id !== id);
    await persistTiles();
    render();
  }

  btnDelete.addEventListener('click', async () => {
    // Closed first: the sheet is showing the tile that is about to go.
    closeDialog(modal);
    await deleteTile(editingId);
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

  /** What can be done to the page, whatever was right-clicked to get here. */
  function pageItems() {
    return [
      { icon: 'plus', label: 'Add tile', run: () => openTileModal(null) },
      { icon: 'tag', label: 'New group', run: () => openGroupModal(null) }
    ];
  }

  function tileItems(id) {
    return [
      { icon: 'pencil', label: 'Edit tile', run: () => openTileModal(id) },
      { icon: 'trash-2', label: 'Delete tile', danger: true, run: () => deleteTile(id) },
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

  /** The record a picker action names: one from the list, a file, an address. */
  async function pickedBackground(payload) {
    if (payload.action === 'recent') {
      const found = recentBackgrounds.find(item => item.src === payload.src);
      // Another new-tab page can have pushed it off the end between the strip
      // being drawn and the chip being clicked.
      if (!found) throw new Error('That one has dropped off the list.');
      return found;
    }

    return payload.action === 'url'
      ? Backgrounds.fromUrl(payload.url)
      : Backgrounds.fromFile(payload.file);
  }

  /** Blur and Dim as they stand: what a wallpaper is being looked at with. */
  const currentEffects = () =>
    Object.fromEntries(Schema.EFFECT_KEYS.map(key => [key, settings[key]]));

  /**
   * Puts Blur and Dim back to what the wallpaper being restored was last seen
   * with, and says whether that moved anything.
   *
   * Written straight into `settings` rather than through one `updateSetting`
   * per key, so the two land in a single repaint and a single write - and so
   * the caller can decide, once, whether the dialog needs rebuilding around
   * the sliders that just moved under it.
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
   * Hands the background being left the Blur and Dim it was last looked at
   * with, so going back to it later goes back to how it looked.
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

      // The one being left keeps the Blur and Dim it was looked at with, and
      // the one arriving gets them back if it had any of its own. Nothing to
      // do when the same wallpaper is picked twice.
      const swapped = !previous || previous.src !== background.src;
      if (swapped) await partWith(previous);

      const moved = swapped && record.effects ? applyEffects(record.effects) : false;

      // Read after the restore, so the entry is stamped with what is actually
      // in force - the pair just put back, or the pair that was already there.
      recentBackgrounds = await remember(background, currentEffects());

      const status = {
        kind: 'ok',
        text: moved
          ? 'Background set, with the Blur and Dim it was last seen with.'
          : settings.bgDim >= 80
            ? 'Set — turn Dim down to see more of it.'
            : payload.action === 'url'
              ? 'Background set. It is fetched from that address on every new tab.'
              : 'Background set.'
      };

      // Blur and Dim just changed under their own sliders, so the whole dialog
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
        if (background) recentBackgrounds = await remember(background);
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
    // The list goes with it. Leaving six stored pictures behind - a click
    // from being back on screen, and still taking up the room - is not what
    // "take the background away" says.
    recentBackgrounds = await Backgrounds.forget();

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
    'openInNewTab', 'showVisits', 'showAddButton', 'tileOrder',
    // Taking "All" away moves the page into the first group, which is a
    // different set of tiles - see settleActiveGroup.
    'showAllGroup'
  ]);

  /** The same, for the block of group chips: what it holds, not how it looks. */
  const REBUILDS_GROUPS = new Set(['showGroupAdd', 'showAllGroup']);

  async function onSettingChange(key, value) {
    if (key === 'font') return changeFont(value);
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
    Backgrounds.apply(background);
    Fonts.use(settings.font).catch(() => Fonts.applyStack(Schema.DEFAULTS.font));
    renderGroups();
    render();
    // A tab that opens in a group says so, even where the block is hidden
    // until the pointer asks for it.
    if (activeGroup) peekGroups();

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
