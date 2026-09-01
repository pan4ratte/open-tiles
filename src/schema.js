/**
 * The settings schema: one source of truth for defaults, validation and the
 * layout of the settings dialog. Add a field here and it shows up in the UI,
 * gets a default and is validated on read - nothing else to touch.
 *
 * Sections become the rows of the settings sidebar, in the order below. Each
 * carries an `icon` and a `tint` - the colour of the rounded square its glyph
 * sits on, which is what makes the sidebar scannable at a glance.
 *
 * A section holds either a flat run of `fields` or, where one page covers more
 * ground than a single list should, a few named `groups` of them - each drawn
 * as its own titled box down the one panel. Both forms come out of `normalize`
 * with the same shape, so nothing downstream has to know which was written.
 *
 * Field types
 *   segmented   one of `options`, rendered as a row of buttons
 *   choice      one of `options`, rendered as a macOS pop-up button. An
 *               option is a bare value, or { value, label } to name it
 *   range       number between min and max. A `zeroLabel` names the bottom
 *               of the travel in a word - Columns reads "Auto" there, not 0
 *   toggle      boolean
 *   color       hex colour
 *   text        free text, trimmed and capped at `max` characters
 *   font        family name, with the Google Fonts picker attached
 *   background  the page background: a picture or a video, from a file on
 *               this computer or from a web address, and the last few of them
 *   backup      export and import, as a pair of buttons
 *   action      a button that does something once, storing nothing
 *   info        a fact rather than a setting: `value` read off to the right
 *   link        a button that opens `href` in a tab of its own
 *   about       the About page's masthead - mark, name, version, blurb
 *
 * A group written `bare: true` is drawn without the box around it, for fields
 * that are blocks in their own right rather than rows in a list. The About
 * masthead is the one of these.
 *
 * A field marked `hidden: true` is the other way about: an ordinary stored
 * setting, with a default and a type that validates it, that draws no row of
 * its own because some other control sets it. The background's vertical
 * position is the one of these - it is set by dragging the picture.
 *
 * A field marked `external: true` has no value in `settings` - it is a control
 * for something stored elsewhere (the background image is megabytes of data
 * URI, far too big to rewrite on every slider drag), or no value at all, like
 * the reset button. It still renders in the dialog; the page hands its current
 * value in through `ctx.values`.
 *
 * A field with a `when` only shows while every key in it holds the value
 * named - that is how the status-bar options stay out of the way of somebody
 * using the floating group block.
 */
const Schema = (() => {
  const t = I18N.t;

  /**
   * Whether this is an Apple keyboard, which settles both what the shortcut
   * that opens this window is - Command rather than Control - and how it is
   * written down. Read once: the platform does not change under a page.
   *
   * `navigator` is absent under the test harness, which runs this file in
   * `node`; the answer there is the one every other platform gives.
   */
  const APPLE = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(
    (navigator.userAgentData && navigator.userAgentData.platform)
    || navigator.platform || ''
  );

  /**
   * The shortcut that opens the settings window, in one place: `apple` is what
   * the page tests the modifier against, `label` is how the note below names
   * it. Two readers of one fact, rather than each making its own guess.
   */
  const SETTINGS_SHORTCUT = { apple: APPLE, label: APPLE ? t('shortcut_command') : t('shortcut_control') };

  /**
   * What the About page says this is. The version is read off the manifest, so
   * there is one number to bump when a release goes out; the fallback beside
   * it is only for the page opened straight off disk, where there is no
   * add-on to ask - keep it in step with manifest.json.
   */
  const RUNTIME = (typeof browser !== 'undefined' && browser.runtime)
    || (typeof chrome !== 'undefined' && chrome.runtime)
    || null;

  function manifestVersion() {
    try {
      const manifest = RUNTIME && RUNTIME.getManifest && RUNTIME.getManifest();
      return (manifest && manifest.version) || '1.0.0';
    } catch {
      return '1.0.0';
    }
  }

  const APP = {
    // Not translated: a name, a person and a licence are the same in every
    // language, and the blurb under them is the one line of prose here.
    name: 'OpenTiles',
    version: manifestVersion(),
    author: 'Mark Ingrem',
    licence: 'GNU AGPL v3',
    repo: 'https://github.com/pan4ratte/open-tiles',
    blurb: t('about_blurb')
  };

  /**
   * The nine CSS weights under the names the type world gives them. A family
   * that does not carry one of these is drawn in its nearest neighbour, or
   * thickened by the browser - which is why the list is the same everywhere
   * rather than cut down per family.
   */
  const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900]
    .map(value => ({ value, label: t('weight_' + value) }));

  /**
   * What each clock and date format asks `Intl` for. They live here rather
   * than beside the clock because this is where the settings that name them
   * are: the menu below is built by handing each bag to the browser and
   * showing what comes back, so an option can never promise a shape the page
   * does not actually draw.
   *
   * They are option bags, never patterns. Where the separators go, whether the
   * day comes before the month and where an AM/PM suffix lands are the
   * browser's to decide from the reader's own language - which is why none of
   * this needs translating.
   */
  const TIME_FORMATS = {
    '24':  { hour: '2-digit', minute: '2-digit', hour12: false },
    '24s': { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
    '12':  { hour: 'numeric', minute: '2-digit', hour12: true },
    '12s': { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }
  };

  const DATE_FORMATS = {
    full:    { weekday: 'long', day: 'numeric', month: 'long' },
    weekday: { weekday: 'long' },
    medium:  { weekday: 'short', day: 'numeric', month: 'short' },
    long:    { day: 'numeric', month: 'long', year: 'numeric' },
    short:   { day: '2-digit', month: '2-digit', year: 'numeric' }
  };

  /**
   * The moment every example in those two menus is written for: a Wednesday
   * afternoon, on a day past the twelfth so it cannot be misread as a month,
   * at a second that is not zero so the formats carrying seconds show one.
   */
  const SAMPLE = new Date(2026, 7, 26, 13, 45, 30);

  /**
   * The order the two menus read in, written out rather than taken off the
   * tables above: '24' and '12' are keys a JavaScript object sorts as numbers
   * and puts in front of '24s' and '12s', which is not the order anybody would
   * choose to read four clocks in.
   */
  const TIME_ORDER = ['24', '24s', '12', '12s'];
  const DATE_ORDER = ['full', 'weekday', 'medium', 'long', 'short'];

  const examples = (order, table, write) => order
    .map(value => ({ value, label: write.call(SAMPLE, [], table[value]) }));

  const TIME_OPTIONS = examples(TIME_ORDER, TIME_FORMATS, Date.prototype.toLocaleTimeString);
  const DATE_OPTIONS = examples(DATE_ORDER, DATE_FORMATS, Date.prototype.toLocaleDateString);

  const RAW_SECTIONS = [
    {
      id: 'general',
      label: t('section_general'),
      // The gear rather than a palette: this page is no longer only about how
      // the page looks - it is also where the settings themselves are kept,
      // backed up and put back. Which is the same page macOS calls General.
      icon: 'settings',
      tint: 'var(--system-gray)',
      groups: [
        {
          label: t('group_appearance'),
          fields: [
            {
              key: 'theme',
              label: t('set_theme'),
              type: 'segmented',
              default: 'system',
              options: [
                { value: 'system', label: t('set_themeSystem'), icon: 'monitor' },
                { value: 'dark', label: t('set_themeDark'), icon: 'moon' },
                { value: 'light', label: t('set_themeLight'), icon: 'sun' }
              ]
            },
            {
              key: 'accent',
              label: t('set_accent'),
              type: 'color',
              default: '#0088ff'
            },
            {
              key: 'font',
              label: t('set_font'),
              type: 'font',
              default: 'Inter',
              busyText: t('busy_font'),
              note: t('set_fontNote')
            },
            {
              key: 'showSettingsButton',
              label: t('set_settingsButton'),
              type: 'toggle',
              default: true,
              note: t('set_settingsButtonNote', SETTINGS_SHORTCUT.label)
            }
          ]
        },
        {
          label: t('group_backupReset'),
          fields: [
            {
              key: 'backup',
              label: t('set_backup'),
              // Reads and writes four storage keys, none of them its own - see
              // `external`.
              type: 'backup',
              external: true,
              busyText: t('busy_working'),
              note: t('set_backupNote')
            },
            {
              key: 'reset',
              label: t('set_reset'),
              // Nothing to store: the button just does the deed - see `external`.
              type: 'action',
              external: true,
              danger: true,
              buttonLabel: t('set_resetButton'),
              buttonIcon: 'rotate-ccw',
              busyText: t('busy_resetting'),
              note: t('set_resetNote')
            }
          ]
        }
      ]
    },
    {
      id: 'background',
      label: t('section_background'),
      icon: 'image',
      tint: 'var(--system-teal)',
      fields: [
        {
          key: 'background',
          label: t('set_background'),
          type: 'background',
          // Stored under its own key, not in settings - see the header above.
          external: true,
          busyText: t('busy_working'),
          note: t('set_backgroundNote')
        },
        { key: 'bgBlur', label: t('set_blur'), type: 'range', default: 0, min: 0, max: 40, step: 2, unit: 'px' },
        {
          key: 'bgDim',
          label: t('set_dim'),
          type: 'range',
          default: 0,
          min: 0,
          max: 90,
          step: 5,
          unit: '%',
          note: t('set_dimNote')
        },
        {
          key: 'bgPosY',
          label: t('set_bgPosY'),
          type: 'range',
          default: 50,
          min: 0,
          max: 100,
          step: 1,
          unit: '%',
          // Set by dragging the picture in the preview above rather than by a
          // slider of its own - see `hidden`, and buildBackground in
          // settings.js. Kept a `range` all the same: that is what says what a
          // valid one is, and what clamps a hand-edited backup file.
          hidden: true
        }
      ]
    },
    {
      id: 'layout',
      label: t('section_layout'),
      icon: 'layout-grid',
      tint: 'var(--system-indigo)',
      // How the tiles are arranged and how each one is drawn are the same
      // decision made twice, so they share a page - two boxes, one panel.
      groups: [
        {
          label: t('group_grid'),
          fields: [
            {
              key: 'columns',
              label: t('set_columns'),
              type: 'range',
              // Zero is not a count, it is Auto - see `zeroLabel`. Which also
              // means a settings file written when this was a menu, holding
              // the string 'auto', reads back as the default: 0, the same
              // answer it always gave.
              default: 0,
              min: 0,
              max: 12,
              step: 1,
              zeroLabel: t('set_columnsAuto'),
              note: t('set_columnsNote')
            },
            { key: 'tileSize', label: t('set_tileSize'), type: 'range', default: 152, min: 72, max: 200, step: 4, unit: 'px' },
            { key: 'gap', label: t('set_gap'), type: 'range', default: 12, min: 4, max: 48, step: 2, unit: 'px' },
            {
              key: 'tileOrder',
              label: t('set_order'),
              type: 'segmented',
              default: 'manual',
              options: [
                { value: 'manual', label: t('set_orderManual') },
                { value: 'visits', label: t('set_orderVisits') }
              ]
            }
          ]
        },
        {
          label: t('group_tiles'),
          fields: [
            {
              key: 'tileShape',
              label: t('set_shape'),
              type: 'choice',
              default: '3:2',
              options: [
                { value: 'square', label: t('set_shapeSquare') },
                { value: 'circle', label: t('set_shapeCircle') },
                // The three ratios are figures, and read the same everywhere.
                { value: '3:2', label: '3:2' },
                { value: '16:10', label: '16:10' },
                { value: '16:9', label: '16:9' }
              ]
            },
            {
              key: 'tileBg',
              label: t('set_tileBg'),
              type: 'choice',
              default: 'theme',
              options: [
                { value: 'theme', label: t('set_tileBgTheme') },
                { value: 'dark', label: t('set_tileBgDark') },
                { value: 'light', label: t('set_tileBgLight') },
                { value: 'custom', label: t('set_tileBgCustom') }
              ]
            },
            {
              key: 'tileBgColor',
              label: t('set_tileBgColor'),
              type: 'color',
              default: '#2f2f31',
              when: { tileBg: 'custom' }
            },
            {
              key: 'logoPad',
              label: t('set_logoPad'),
              type: 'range',
              default: 20,
              min: 0,
              max: 40,
              step: 5,
              unit: '%',
              note: t('set_logoPadNote')
            },
            { key: 'showLabels', label: t('set_showLabels'), type: 'toggle', default: true },
            {
              key: 'showVisits',
              label: t('set_showVisits'),
              type: 'toggle',
              default: false,
              note: t('set_showVisitsNote')
            },
            {
              key: 'showAddButton',
              label: t('set_showAddButton'),
              type: 'toggle',
              default: true,
              note: t('set_showAddButtonNote')
            },
            { key: 'openInNewTab', label: t('set_openInNewTab'), type: 'toggle', default: true },
            {
              key: 'confirmDelete',
              label: t('set_confirmDelete'),
              type: 'toggle',
              default: true
            },
            {
              key: 'deepIcons',
              label: t('set_deepIcons'),
              type: 'toggle',
              default: true,
              busyText: t('busy_permission'),
              // Firefox only grants permissions.request() while it is handling
              // user input, so this toggle has to act on the click itself.
              gesture: true,
              note: t('set_deepIconsNote')
            }
          ]
        }
      ]
    },
    {
      id: 'header',
      label: t('section_header'),
      icon: 'clock',
      tint: 'var(--system-orange)',
      // The time and the date are set separately - they are two lines of very
      // different type, and a face that carries a 86px clock rarely carries a
      // 15px caption. What they share is what they stand on: one colour and
      // one shadow, because they read as a single block over the page.
      groups: [
        {
          label: t('group_time'),
          fields: [
            { key: 'showClock', label: t('set_showClock'), type: 'toggle', default: true },
            {
              key: 'timeFormat',
              label: t('set_format'),
              type: 'choice',
              default: '24',
              options: TIME_OPTIONS,
              note: t('set_timeNote')
            },
            {
              key: 'clockFont',
              label: t('set_clockFont'),
              type: 'font',
              default: '',
              emptyLabel: t('set_matchPageFont'),
              inherit: 'font',
              busyText: t('busy_font'),
              note: t('set_clockFontNote')
            },
            { key: 'clockWeight', label: t('set_weight'), type: 'choice', default: 400, options: WEIGHTS },
            {
              key: 'clockSize',
              label: t('set_size'),
              type: 'range',
              default: 100,
              min: 50,
              max: 200,
              step: 5,
              unit: '%'
            },
            {
              key: 'clockTracking',
              label: t('set_tracking'),
              type: 'range',
              default: -2.5,
              min: -6,
              max: 20,
              step: .5,
              unit: '%'
            }
          ]
        },
        {
          label: t('group_date'),
          fields: [
            { key: 'showDate', label: t('set_showDate'), type: 'toggle', default: true },
            {
              key: 'dateFormat',
              label: t('set_format'),
              type: 'choice',
              default: 'full',
              options: DATE_OPTIONS
            },
            {
              key: 'dateFont',
              label: t('set_clockFont'),
              type: 'font',
              default: '',
              emptyLabel: t('set_matchPageFont'),
              inherit: 'font',
              busyText: t('busy_font'),
              note: t('set_dateFontNote')
            },
            { key: 'dateWeight', label: t('set_weight'), type: 'choice', default: 600, options: WEIGHTS },
            {
              key: 'dateSize',
              label: t('set_size'),
              type: 'range',
              default: 100,
              min: 50,
              max: 200,
              step: 5,
              unit: '%'
            },
            {
              key: 'dateTracking',
              label: t('set_tracking'),
              type: 'range',
              default: -1,
              min: -6,
              max: 20,
              step: .5,
              unit: '%'
            }
          ]
        },
        {
          label: t('group_bothLines'),
          fields: [
            {
              key: 'headerTint',
              label: t('set_headerTint'),
              type: 'toggle',
              default: false,
              note: t('set_headerTintNote')
            },
            {
              key: 'headerColor',
              label: t('set_headerColor'),
              type: 'color',
              // A neutral grey rather than white: this is the colour the two
              // lines take the instant the toggle above is flipped, and white
              // would make them disappear on a light page before the reader
              // has had a chance to pick anything.
              default: '#8e8e93',
              when: { headerTint: true }
            },
            {
              key: 'headerShadow',
              label: t('set_headerShadow'),
              type: 'range',
              default: 0,
              min: 0,
              max: 100,
              step: 5,
              unit: '%'
            }
          ]
        }
      ]
    },
    {
      id: 'groups',
      label: t('section_groups'),
      icon: 'tag',
      tint: 'var(--system-green)',
      fields: [
        {
          key: 'groupStyle',
          label: t('set_groupStyle'),
          type: 'segmented',
          default: 'floating',
          options: [
            { value: 'floating', label: t('set_groupFloating') },
            { value: 'bar', label: t('set_groupBar') }
          ]
        },
        {
          key: 'groupShow',
          label: t('set_groupShow'),
          type: 'segmented',
          default: 'always',
          options: [
            { value: 'always', label: t('set_groupAlways') },
            { value: 'hover', label: t('set_groupHover') }
          ]
        },
        {
          key: 'showAllGroup',
          label: t('set_showAllGroup'),
          type: 'toggle',
          default: true,
          note: t('set_showAllGroupNote')
        },
        {
          key: 'showGroupAdd',
          label: t('set_showGroupAdd'),
          type: 'toggle',
          default: true,
          note: t('set_showGroupAddNote')
        },
        {
          key: 'keepGroup',
          label: t('set_keepGroup'),
          type: 'toggle',
          default: true,
          note: t('set_keepGroupNote')
        },
        {
          key: 'groupAnimate',
          label: t('set_groupAnimate'),
          type: 'toggle',
          default: true
        },
        {
          key: 'groupScroll',
          label: t('set_groupScroll'),
          type: 'toggle',
          default: true,
          note: t('set_groupScrollNote')
        },
        {
          key: 'groupScrollAxis',
          label: t('set_groupAxis'),
          type: 'segmented',
          default: 'horizontal',
          when: { groupScroll: true },
          options: [
            { value: 'vertical', label: t('set_groupAxisVertical') },
            { value: 'horizontal', label: t('set_groupAxisHorizontal') },
            { value: 'either', label: t('set_groupAxisEither') }
          ]
        },
        {
          key: 'groupFloat',
          label: t('set_groupPosition'),
          type: 'segmented',
          default: 'top',
          when: { groupStyle: 'floating' },
          options: [
            { value: 'top', label: t('set_groupTop') },
            { value: 'tiles', label: t('set_groupAboveTiles') },
            { value: 'bottom', label: t('set_groupBottom') }
          ]
        },
        {
          key: 'groupAlign',
          label: t('set_groupAlign'),
          type: 'segmented',
          default: 'center',
          when: { groupStyle: 'bar' },
          options: [
            { value: 'start', label: t('set_groupLeft') },
            { value: 'center', label: t('set_groupCentre') },
            { value: 'end', label: t('set_groupRight') }
          ]
        },
        {
          key: 'groupEdge',
          label: t('set_groupPosition'),
          type: 'segmented',
          default: 'top',
          when: { groupStyle: 'bar' },
          options: [
            { value: 'top', label: t('set_groupTop') },
            { value: 'bottom', label: t('set_groupBottom') }
          ]
        }
      ]
    },
    {
      id: 'about',
      label: t('section_about'),
      icon: 'info',
      tint: 'var(--system-blue)',
      groups: [
        {
          // No box: the masthead is not a list of anything, so there is
          // nothing for one to gather. See `bare` at the top of this file.
          bare: true,
          fields: [
            {
              key: 'about',
              type: 'about',
              external: true,
              label: APP.name,
              logo: '../icons/icon.svg',
              logoDark: '../icons/icon-dark.svg',
              version: APP.version,
              note: APP.blurb
            }
          ]
        },
        {
          fields: [
            {
              key: 'aboutAuthor',
              label: t('about_author'),
              type: 'info',
              external: true,
              value: APP.author
            },
            {
              key: 'aboutLicence',
              label: t('about_licence'),
              type: 'info',
              external: true,
              value: APP.licence
            },
            {
              key: 'source',
              label: t('about_source'),
              type: 'link',
              external: true,
              href: APP.repo,
              // GitHub is a place, not a word.
              buttonLabel: 'GitHub',
              buttonIcon: 'github',
              note: t('about_sourceNote')
            }
          ]
        },
        {
          label: t('group_bundled'),
          fields: [
            {
              key: 'aboutLucide',
              label: 'Lucide icons',
              type: 'info',
              external: true,
              value: 'ISC'
            },
            {
              key: 'aboutInter',
              label: 'Inter',
              type: 'info',
              external: true,
              value: 'SIL Open Font License 1.1'
            }
          ]
        }
      ]
    }
  ];

  /**
   * Gives every section both halves of its shape: `groups` (the boxes the
   * dialog draws, in order) and `fields` (the flat list everything else reads
   * for defaults, validation and lookups). A section written as a plain run of
   * fields becomes the one unnamed group holding them.
   */
  function normalize(section) {
    const groups = (section.groups || [{ label: null, fields: section.fields }])
      .map(group => ({
        label: group.label || null,
        bare: Boolean(group.bare),
        fields: group.fields
      }));

    return { ...section, groups, fields: groups.flatMap(group => group.fields) };
  }

  const SECTIONS = RAW_SECTIONS.map(normalize);

  const FIELDS = SECTIONS.flatMap(section => section.fields);

  /** The fields that actually live in the settings object. */
  const STORED = FIELDS.filter(field => !field.external);

  const DEFAULTS = Object.fromEntries(STORED.map(f => [f.key, f.default]));

  /**
   * A `choice` option is either the value itself - `600` - or a
   * `{ value, label }` pair, for when the stored value is not what should be
   * read off the menu.
   */
  function optionValue(option) {
    return option && typeof option === 'object' ? option.value : option;
  }

  function optionLabel(option) {
    return option && typeof option === 'object' ? option.label : String(option);
  }

  function coerceField(field, value) {
    switch (field.type) {
      case 'toggle':
        return typeof value === 'boolean' ? value : field.default;

      case 'range': {
        const n = Number(value);
        if (!Number.isFinite(n)) return field.default;
        const clamped = Math.min(field.max, Math.max(field.min, n));
        // Snapped to the step rather than to whole numbers: letter spacing is
        // set in half a percent, and rounding it would flatten every other
        // stop on the slider. Every other range steps in whole numbers, so
        // they come out exactly as they went in.
        const step = field.step || 1;
        return Number((Math.round(clamped / step) * step).toFixed(3));
      }

      case 'choice': {
        // A <select> hands its value back as a string whatever went in, so the
        // match is made on the rendered form and the option's own value - a
        // number for Columns, a string for Shape - is what comes out.
        const hit = field.options.find(o => String(optionValue(o)) === String(value));
        return hit === undefined ? field.default : optionValue(hit);
      }

      case 'segmented':
        return field.options.some(o => o.value === value) ? value : field.default;

      case 'color':
        return /^#[0-9a-f]{6}$/i.test(value) ? value : field.default;

      case 'font':
        return typeof value === 'string' ? value.trim().slice(0, 64) : field.default;

      case 'text':
        return typeof value === 'string'
          ? value.trim().slice(0, field.max || 200)
          : field.default;

      default:
        return value === undefined ? field.default : value;
    }
  }

  /**
   * The background effects: what Blur, Dim and Vertical position are set to.
   *
   * They are named together because they travel as one - a wallpaper in the
   * recent strip carries the three it was last looked at with, and going back
   * to it brings them back too. Position belongs with the other two for the
   * same reason they belong with each other: where a tall photograph should be
   * cut is a fact about that photograph, not about the page. They are ordinary
   * stored settings all the same; this is only the subset, not a second home
   * for them.
   */
  const EFFECT_KEYS = ['bgBlur', 'bgDim', 'bgPosY'];

  /** The three, filled in from the defaults and clamped the way a slider is. */
  function coerceEffects(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    EFFECT_KEYS.forEach(key => {
      const field = STORED.find(f => f.key === key);
      out[key] = key in source ? coerceField(field, source[key]) : field.default;
    });
    return out;
  }

  /**
   * Settings written by an older version, read in the shape this one speaks.
   *
   * `clock24` was a toggle with two answers in it; the clock now has a format
   * menu with four, so the toggle is read as whichever of them it meant. It is
   * not written back - `coerce` drops it on the way past, and the menu is what
   * is stored from then on.
   */
  function migrate(source) {
    if (!('clock24' in source) || 'timeFormat' in source) return source;
    return { ...source, timeFormat: source.clock24 === false ? '12' : '24' };
  }

  /** Fills in defaults and drops anything invalid or unknown. */
  function coerce(raw) {
    const source = migrate(raw && typeof raw === 'object' ? raw : {});
    const out = {};
    STORED.forEach(field => {
      out[field.key] = field.key in source
        ? coerceField(field, source[field.key])
        : field.default;
    });
    return out;
  }

  return {
    SECTIONS, FIELDS, STORED, DEFAULTS, EFFECT_KEYS, SETTINGS_SHORTCUT,
    TIME_FORMATS, DATE_FORMATS,
    coerce, coerceEffects, optionValue, optionLabel
  };
})();
