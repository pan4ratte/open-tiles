/**
 * Backup files written by *other* new-tab add-ons.
 *
 * Each importer is a `detect` and a `convert`: the first says "this is one of
 * mine" from the shape of the parsed JSON, the second turns it into the same
 * `{ settings, groups, tiles, background }` sections a Tiles backup carries.
 * Everything downstream then treats a foreign file exactly like one of ours,
 * sanitizers included - see transfer.js.
 *
 * A converter's job is mapping, not validation. It may hand back a title that
 * is too long or a column count this build has never heard of; `Store.save`
 * and `Schema.coerce` are what decide, and they decide the same way for a
 * foreign file as for a native one.
 *
 * Settings are the one section that comes out of a foreign file *partial*.
 * Another add-on's preferences overlap ours in a handful of places and say
 * nothing about the rest, so they are merged into what is already set rather
 * than replacing it - importing a file that only mentions columns and spacing
 * should not quietly put the accent colour back to blue. `partialSettings`
 * on the result is what tells transfer.js that.
 */
const Importers = (() => {

  // ------------------------------------------------------------ small tools

  /** Sorts by a numeric field, leaving anything unnumbered at the back. */
  function byNumber(pick) {
    return (a, b) => {
      const x = Number(pick(a));
      const y = Number(pick(b));
      return (Number.isFinite(x) ? x : Infinity) - (Number.isFinite(y) ? y : Infinity);
    };
  }

  /** Only writes a key when there is something to write under it. */
  function assign(out, key, value) {
    if (value !== undefined && value !== null) out[key] = value;
    return out;
  }

  // ------------------------------------------------------- Speed Dial 2

  /**
   * Speed Dial 2 (`{ dials, groups, preferences }`).
   *
   * Its model is close enough to this one that tiles and groups come over
   * whole. Two differences are worth knowing about:
   *
   * Order. Speed Dial 2 numbers every dial within its group; this add-on keeps
   * one flat list and filters it. So the dials are laid out group by group, in
   * the group order the file gives, and by `position` inside each - which is
   * what makes every group's page read the way it did over there. Dials that
   * share a position (this happens) keep their file order behind it.
   *
   * The default group. `home` is a real group there, and the tiles in it are
   * not the same set as "All" - so it comes across as a group of its own
   * rather than being flattened into the loose pile.
   */
  const speedDial2 = {
    name: 'Speed Dial 2',

    detect: doc => Array.isArray(doc.dials) && Array.isArray(doc.groups),

    convert(doc) {
      const groups = [...doc.groups]
        .sort(byNumber(g => g.position))
        // A prefix rather than the bare number: `String(0)` is falsy where the
        // group sanitizer tests it, and "0" is a real group id here (`home`).
        .map(g => ({ id: 'g' + g.id, name: String(g.title == null ? '' : g.title) }));

      const rank = new Map(groups.map((group, at) => [group.id, at]));
      const groupOf = dial => 'g' + dial.idgroup;

      const dials = doc.dials
        .filter(dial => dial && typeof dial.url === 'string' && dial.url)
        .map((dial, at) => ({ dial, at }));

      dials.sort((a, b) => {
        const ga = rank.has(groupOf(a.dial)) ? rank.get(groupOf(a.dial)) : Infinity;
        const gb = rank.has(groupOf(b.dial)) ? rank.get(groupOf(b.dial)) : Infinity;
        if (ga !== gb) return ga - gb;

        const pa = Number(a.dial.position);
        const pb = Number(b.dial.position);
        if (pa !== pb) return (Number.isFinite(pa) ? pa : Infinity)
                            - (Number.isFinite(pb) ? pb : Infinity);

        return a.at - b.at;
      });

      const tiles = dials.map(({ dial }) => ({
        id: 't' + dial.id,
        url: dial.url,
        title: String(dial.title == null ? '' : dial.title),
        groupId: rank.has(groupOf(dial)) ? groupOf(dial) : null,
        // A dial's saved thumbnail is a tile's own icon. Anything that is not
        // an address or an inline picture is dropped by the sanitizer.
        icon: typeof dial.thumbnail === 'string' ? dial.thumbnail : '',
        visits: dial.visits
      }));

      const sections = { groups, tiles };
      assign(sections, 'settings', preferencesOf(doc.preferences));
      assign(sections, 'background', backgroundOf(doc.preferences));

      return {
        sections,
        // What the file held and this add-on has nowhere to put, so the page
        // can say so rather than letting it go missing quietly.
        dropped: countDropped(doc)
      };
    }
  };

  const THEMES = { auto: 'system', light: 'light', dark: 'dark' };

  /** The handful of Speed Dial 2 preferences that have a home here. */
  function preferencesOf(raw) {
    if (!raw || typeof raw !== 'object') return undefined;

    const out = {};
    assign(out, 'columns', raw.columns);
    assign(out, 'gap', raw.spacing);
    if (raw.openInNewTab !== undefined) out.openInNewTab = Boolean(raw.openInNewTab);

    const tiles = raw.bookmarks || {};
    if (typeof tiles.showTitle === 'boolean') out.showLabels = tiles.showTitle;
    if (typeof tiles.showVisits === 'boolean') out.showVisits = tiles.showVisits;
    if (raw.showAddButton !== undefined) out.showAddButton = Boolean(raw.showAddButton);
    if (raw.keepActiveGroup !== undefined) out.keepGroup = Boolean(raw.keepActiveGroup);
    // "manual" is the only order both add-ons name the same way; anything else
    // over there is a sort this one does not have, so the manual order stands.
    if (raw.orderBy === 'visits') out.tileOrder = 'visits';

    // Speed Dial 2 sizes a logo as a fraction of its tile; this add-on names
    // the space left around one instead. They are the same number, inverted.
    const ratio = Number(tiles.thumbnailRatio);
    if (Number.isFinite(ratio) && ratio > 0 && ratio <= 1) {
      out.logoPad = Math.round((1 - ratio) * 100);
    }

    const theme = raw.theme || {};
    assign(out, 'theme', THEMES[theme.theme]);
    // "default" there means the add-on's own font, which is not this one's -
    // so it is left unsaid, and the default here stands.
    if (typeof theme.font === 'string' && theme.font && theme.font !== 'default') {
      out.font = theme.font;
    }

    return Object.keys(out).length ? out : undefined;
  }

  /**
   * The picture behind the page.
   *
   * Speed Dial 2 keeps one per theme; this add-on has a single background, so
   * the dark one wins where both are set - it is the one chosen against tiles
   * rather than against a white page.
   */
  function backgroundOf(raw) {
    const theme = (raw && raw.theme) || {};
    const dark = theme.dark || {};
    const light = theme.light || {};
    const src = dark.backgroundImage || light.backgroundImage;
    if (typeof src !== 'string' || !src) return undefined;

    return { src, name: hostOf(src), savedAt: Date.now() };
  }

  function hostOf(src) {
    try {
      return new URL(src).hostname;
    } catch {
      return 'Imported picture';
    }
  }

  /**
   * What a file held that there is still nowhere to put. Time-of-day visit
   * splits and the date a dial was added are counted here as gone: the totals
   * come across, the breakdown behind them does not.
   *
   * @returns {{stats:boolean, colours:number}}
   */
  function countDropped(doc) {
    return {
      stats: doc.dials.some(dial => dial && (Number(dial.visits_morning)
        || Number(dial.visits_afternoon) || Number(dial.visits_evening)
        || Number(dial.visits_night))),
      colours: doc.groups.filter(group => group && group.color).length
    };
  }

  // ------------------------------------------------------------------ entry

  const FORMATS = [speedDial2];

  /**
   * Reads a parsed JSON document written by another add-on.
   *
   * @returns {{source:string, sections:object, partialSettings:boolean,
   *   dropped:object}|null} null when nothing here recognises it
   */
  function read(doc) {
    if (!doc || typeof doc !== 'object') return null;

    const format = FORMATS.find(candidate => {
      try {
        return candidate.detect(doc);
      } catch {
        return false;
      }
    });
    if (!format) return null;

    const { sections, dropped } = format.convert(doc);
    return { source: format.name, sections, partialSettings: true, dropped };
  }

  return { FORMATS, read };
})();
