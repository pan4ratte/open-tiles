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
  const SETTINGS_SHORTCUT = { apple: APPLE, label: APPLE ? '⌘ ,' : 'Ctrl + ,' };

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
    name: 'OpenTiles',
    version: manifestVersion(),
    author: 'Mark (pan4ratte)',
    licence: 'GNU AGPL v3',
    repo: 'https://github.com/pan4ratte/open-tiles',
    blurb: 'Replaces the new tab page with a grid of draggable tiles for the '
         + 'sites you use most - with groups, a clock, and a background of '
         + 'your own.'
  };

  /**
   * The nine CSS weights under the names the type world gives them. A family
   * that does not carry one of these is drawn in its nearest neighbour, or
   * thickened by the browser - which is why the list is the same everywhere
   * rather than cut down per family.
   */
  const WEIGHTS = [
    { value: 100, label: 'Thin' },
    { value: 200, label: 'Extra light' },
    { value: 300, label: 'Light' },
    { value: 400, label: 'Regular' },
    { value: 500, label: 'Medium' },
    { value: 600, label: 'Semibold' },
    { value: 700, label: 'Bold' },
    { value: 800, label: 'Extra bold' },
    { value: 900, label: 'Black' }
  ];

  const RAW_SECTIONS = [
    {
      id: 'general',
      label: 'General',
      // The gear rather than a palette: this page is no longer only about how
      // the page looks - it is also where the settings themselves are kept,
      // backed up and put back. Which is the same page macOS calls General.
      icon: 'settings',
      tint: 'var(--system-gray)',
      groups: [
        {
          label: 'Appearance',
          fields: [
            {
              key: 'theme',
              label: 'Theme',
              type: 'segmented',
              default: 'system',
              options: [
                { value: 'system', label: 'System', icon: 'monitor' },
                { value: 'dark', label: 'Dark', icon: 'moon' },
                { value: 'light', label: 'Light', icon: 'sun' }
              ]
            },
            {
              key: 'accent',
              label: 'Accent colour',
              type: 'color',
              default: '#0088ff'
            },
            {
              key: 'font',
              label: 'Font',
              type: 'font',
              default: 'Inter',
              busyText: 'Loading font…',
              note: 'Sets the tile names, the clock and the date. The dialogs always stay on Inter.'
            },
            {
              key: 'showSettingsButton',
              label: 'Show the settings button',
              type: 'toggle',
              default: true,
              note: 'With it off, ' + SETTINGS_SHORTCUT.label
                  + ' and the right-click menu are the ways in.'
            }
          ]
        },
        {
          label: 'Backup and reset',
          fields: [
            {
              key: 'backup',
              label: 'Backup',
              // Reads and writes four storage keys, none of them its own - see
              // `external`.
              type: 'backup',
              external: true,
              busyText: 'Working on it…',
              note: 'Saves tiles, groups, settings and background to a file, and puts one back.'
            },
            {
              key: 'reset',
              label: 'Reset all settings',
              // Nothing to store: the button just does the deed - see `external`.
              type: 'action',
              external: true,
              danger: true,
              buttonLabel: 'Reset all',
              buttonIcon: 'rotate-ccw',
              busyText: 'Putting everything back…',
              note: 'Every setting back to its default, and the background away. Tiles are left alone.'
            }
          ]
        }
      ]
    },
    {
      id: 'background',
      label: 'Background',
      icon: 'image',
      tint: 'var(--system-teal)',
      fields: [
        {
          key: 'background',
          label: 'Picture or video',
          type: 'background',
          // Stored under its own key, not in settings - see the header above.
          external: true,
          busyText: 'Working on it…',
          note: 'From this computer, or a web address fetched fresh each time.'
        },
        { key: 'bgBlur', label: 'Blur', type: 'range', default: 0, min: 0, max: 40, step: 2, unit: 'px' },
        {
          key: 'bgDim',
          label: 'Dim',
          type: 'range',
          default: 35,
          min: 0,
          max: 90,
          step: 5,
          unit: '%',
          note: 'Darkens it so the tiles stay readable.'
        },
        {
          key: 'bgPosY',
          label: 'Vertical position',
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
      label: 'Layout',
      icon: 'layout-grid',
      tint: 'var(--system-indigo)',
      // How the tiles are arranged and how each one is drawn are the same
      // decision made twice, so they share a page - two boxes, one panel.
      groups: [
        {
          label: 'Grid',
          fields: [
            {
              key: 'columns',
              label: 'Columns',
              type: 'range',
              // Zero is not a count, it is Auto - see `zeroLabel`. Which also
              // means a settings file written when this was a menu, holding
              // the string 'auto', reads back as the default: 0, the same
              // answer it always gave.
              default: 0,
              min: 0,
              max: 12,
              step: 1,
              zeroLabel: 'Auto',
              note: 'Auto fits as many per row as the window allows.'
            },
            { key: 'tileSize', label: 'Tile size', type: 'range', default: 116, min: 72, max: 200, step: 4, unit: 'px' },
            { key: 'gap', label: 'Spacing', type: 'range', default: 18, min: 4, max: 48, step: 2, unit: 'px' },
            {
              key: 'tileOrder',
              label: 'Order',
              type: 'segmented',
              default: 'manual',
              options: [
                { value: 'manual', label: 'Manual' },
                { value: 'visits', label: 'Most visited' }
              ],
              note: 'Most visited counts how often you open each one.'
            }
          ]
        },
        {
          label: 'Tiles',
          fields: [
            {
              key: 'tileShape',
              label: 'Shape',
              type: 'choice',
              default: 'square',
              options: [
                { value: 'square', label: 'Square' },
                { value: 'circle', label: 'Circular' },
                { value: '3:2', label: '3:2' },
                { value: '16:10', label: '16:10' },
                { value: '16:9', label: '16:9' }
              ],
              note: 'Tile size sets the width; the shape sets the height to match.'
            },
            {
              key: 'tileBg',
              label: 'Background',
              type: 'choice',
              default: 'theme',
              options: [
                { value: 'theme', label: 'Follow the theme' },
                { value: 'dark', label: "Dark theme's" },
                { value: 'light', label: "Light theme's" },
                { value: 'custom', label: 'Custom colour' }
              ],
              note: 'What a tile without a colour of its own is drawn in.'
            },
            {
              key: 'tileBgColor',
              label: 'Colour',
              type: 'color',
              default: '#2f2f31',
              when: { tileBg: 'custom' },
              note: 'Only what tiles with no colour of their own fall back to.'
            },
            {
              key: 'logoPad',
              label: 'Logo padding',
              type: 'range',
              default: 20,
              min: 0,
              max: 40,
              step: 5,
              unit: '%',
              note: 'The room left clear around a tile\'s icon.'
            },
            { key: 'showLabels', label: 'Show site names', type: 'toggle', default: true },
            {
              key: 'showVisits',
              label: 'Show visit counts',
              type: 'toggle',
              default: false,
              note: 'Puts the number of times you have opened a site in the corner of its tile.'
            },
            {
              key: 'showAddButton',
              label: 'Show the add button',
              type: 'toggle',
              default: true,
              note: 'The dotted + at the end of the grid. Right-clicking the page also adds one.'
            },
            { key: 'openInNewTab', label: 'Open sites in a new tab', type: 'toggle', default: false },
            {
              key: 'confirmDelete',
              label: 'Confirm before deleting a tile',
              type: 'toggle',
              default: false,
              note: 'Asks first, wherever the tile is being deleted from.'
            },
            {
              key: 'deepIcons',
              label: 'Deep icon lookup',
              type: 'toggle',
              default: false,
              busyText: 'Asking Firefox for access…',
              // Firefox only grants permissions.request() while it is handling
              // user input, so this toggle has to act on the click itself.
              gesture: true,
              note: 'Reads each site\'s markup for its sharpest logo. Firefox will ask for access.'
            }
          ]
        }
      ]
    },
    {
      id: 'header',
      label: 'Header',
      icon: 'clock',
      tint: 'var(--system-orange)',
      // The time and the date are set separately - they are two lines of very
      // different type, and a face that carries a 86px clock rarely carries a
      // 15px caption. What they share is what they stand on: one colour and
      // one shadow, because they read as a single block over the page.
      groups: [
        {
          label: 'Time',
          fields: [
            { key: 'showClock', label: 'Show the clock', type: 'toggle', default: true },
            {
              key: 'timeFormat',
              label: 'Format',
              type: 'choice',
              default: '24',
              options: [
                { value: '24', label: '13:45' },
                { value: '24s', label: '13:45:30' },
                { value: '12', label: '1:45 PM' },
                { value: '12s', label: '1:45:30 PM' }
              ],
              note: 'The exact shape follows your browser\'s language.'
            },
            {
              key: 'clockFont',
              label: 'Font',
              type: 'font',
              default: '',
              emptyLabel: 'Match page font',
              inherit: 'font',
              busyText: 'Loading font…',
              note: 'The clock on its own. Match page font follows General → Font.'
            },
            { key: 'clockWeight', label: 'Weight', type: 'choice', default: 400, options: WEIGHTS },
            {
              key: 'clockSize',
              label: 'Size',
              type: 'range',
              default: 100,
              min: 50,
              max: 200,
              step: 5,
              unit: '%',
              note: 'A share of the size the page picks for the window.'
            },
            {
              key: 'clockTracking',
              label: 'Spacing',
              type: 'range',
              default: -2.5,
              min: -6,
              max: 20,
              step: .5,
              unit: '%',
              note: 'Apple tracks large type in, never out.'
            }
          ]
        },
        {
          label: 'Date',
          fields: [
            { key: 'showDate', label: 'Show the date', type: 'toggle', default: false },
            {
              key: 'dateFormat',
              label: 'Format',
              type: 'choice',
              default: 'full',
              options: [
                { value: 'full', label: 'Wednesday, 29 August' },
                { value: 'weekday', label: 'Wednesday' },
                { value: 'medium', label: 'Wed, 29 Aug' },
                { value: 'long', label: '29 August 2026' },
                { value: 'short', label: '29/08/2026' }
              ],
              note: 'The order follows your browser\'s language.'
            },
            {
              key: 'dateFont',
              label: 'Font',
              type: 'font',
              default: '',
              emptyLabel: 'Match page font',
              inherit: 'font',
              busyText: 'Loading font…',
              note: 'The date on its own, the same way.'
            },
            { key: 'dateWeight', label: 'Weight', type: 'choice', default: 600, options: WEIGHTS },
            {
              key: 'dateSize',
              label: 'Size',
              type: 'range',
              default: 100,
              min: 50,
              max: 200,
              step: 5,
              unit: '%'
            },
            {
              key: 'dateTracking',
              label: 'Spacing',
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
          label: 'Both lines',
          fields: [
            {
              key: 'headerTint',
              label: 'Custom colour',
              type: 'toggle',
              default: false,
              note: 'Off, they follow the theme, and go white over a picture.'
            },
            {
              key: 'headerColor',
              label: 'Colour',
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
              label: 'Shadow',
              type: 'range',
              default: 0,
              min: 0,
              max: 100,
              step: 5,
              unit: '%',
              note: 'At 0 they take the page\'s own.'
            }
          ]
        }
      ]
    },
    {
      id: 'groups',
      label: 'Groups',
      icon: 'tag',
      tint: 'var(--system-green)',
      fields: [
        {
          key: 'groupStyle',
          label: 'Appearance',
          type: 'segmented',
          default: 'floating',
          options: [
            { value: 'floating', label: 'Floating' },
            { value: 'bar', label: 'Status bar' }
          ],
          note: 'A pill over the page, or a bar across it.'
        },
        {
          key: 'groupShow',
          label: 'Display',
          type: 'segmented',
          default: 'always',
          options: [
            { value: 'always', label: 'Always' },
            { value: 'hover', label: 'On hover' }
          ],
          note: 'On hover hides it until the pointer arrives.'
        },
        {
          key: 'showAllGroup',
          label: 'Show the All category',
          type: 'toggle',
          default: true,
          note: 'The chip that clears the filter. With it off the page always sits in a group.'
        },
        {
          key: 'showGroupAdd',
          label: 'Show the new group button',
          type: 'toggle',
          default: true,
          note: 'The + at the end of the block. Right-clicking the page also makes one.'
        },
        {
          key: 'keepGroup',
          label: 'Remember the open group',
          type: 'toggle',
          default: true,
          note: 'Opens a new tab on the group you were last looking at.'
        },
        {
          key: 'groupAnimate',
          label: 'Animate group changes',
          type: 'toggle',
          default: true,
          note: 'Slides the old tiles aside and brings the new ones in behind them.'
        },
        {
          key: 'groupScroll',
          label: 'Switch groups by scrolling',
          type: 'toggle',
          default: false,
          note: 'A roll of the wheel or a swipe turns to the next group. It stops at each end.'
        },
        {
          key: 'groupScrollAxis',
          label: 'Gesture direction',
          type: 'segmented',
          default: 'vertical',
          when: { groupScroll: true },
          options: [
            { value: 'vertical', label: 'Up and down' },
            { value: 'horizontal', label: 'Left and right' },
            { value: 'either', label: 'Either' }
          ],
          note: 'Down and right go on; up and left go back.'
        },
        {
          key: 'groupFloat',
          label: 'Position',
          type: 'segmented',
          default: 'top',
          when: { groupStyle: 'floating' },
          options: [
            { value: 'top', label: 'Top' },
            { value: 'tiles', label: 'Above the tiles' },
            { value: 'bottom', label: 'Bottom' }
          ],
          note: 'Above the tiles puts it under the clock.'
        },
        {
          key: 'groupAlign',
          label: 'Alignment',
          type: 'segmented',
          default: 'center',
          when: { groupStyle: 'bar' },
          options: [
            { value: 'start', label: 'Left' },
            { value: 'center', label: 'Centre' },
            { value: 'end', label: 'Right' }
          ]
        },
        {
          key: 'groupEdge',
          label: 'Position',
          type: 'segmented',
          default: 'top',
          when: { groupStyle: 'bar' },
          options: [
            { value: 'top', label: 'Top' },
            { value: 'bottom', label: 'Bottom' }
          ]
        }
      ]
    },
    {
      id: 'about',
      label: 'About',
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
              version: APP.version,
              note: APP.blurb
            }
          ]
        },
        {
          fields: [
            {
              key: 'aboutAuthor',
              label: 'Author',
              type: 'info',
              external: true,
              value: APP.author
            },
            {
              key: 'aboutLicence',
              label: 'Licence',
              type: 'info',
              external: true,
              value: APP.licence,
              note: 'Use it, read it, change it, pass it on.'
            },
            {
              key: 'source',
              label: 'Source code',
              type: 'link',
              external: true,
              href: APP.repo,
              buttonLabel: 'GitHub',
              buttonIcon: 'github',
              note: 'The code, the releases, and where to report anything that is not working.'
            }
          ]
        },
        {
          label: 'Bundled work',
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
    coerce, coerceEffects, optionValue, optionLabel
  };
})();
