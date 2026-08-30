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
 *   range       number between min and max
 *   toggle      boolean
 *   color       hex colour
 *   text        free text, trimmed and capped at `max` characters
 *   font        family name, with the Google Fonts picker attached
 *   background  the page background: a picture or a video, from a file on
 *               this computer or from a web address, and the last few of them
 *   backup      export and import, as a pair of buttons
 *   action      a button that does something once, storing nothing
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
  const columnChoices = ['auto', 3, 4, 5, 6, 7, 8, 9, 10, 12];

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
      id: 'appearance',
      label: 'Appearance',
      icon: 'palette',
      tint: 'var(--system-purple)',
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
          default: '#007aff'
        },
        {
          key: 'font',
          label: 'Font',
          type: 'font',
          default: 'Inter',
          busyText: 'Loading font…',
          note: 'Sets the tile names, and the clock and the date wherever they '
              + 'are not given a face of their own under Header. Filter the '
              + 'list, or name any other family on Google Fonts under "Other '
              + 'family". The dialogs and buttons always stay on Inter.'
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
          note: 'A picture or a video from this computer — up to 6 MB for a '
              + 'picture, 16 MB for a video — or a web address, which is fetched '
              + 'fresh on every new tab. Large pictures are scaled down to fit; '
              + 'the preview shows the crop you will get. The last six are kept '
              + 'underneath, each with the Blur and Dim it was last seen with; '
              + 'going back to one brings those back with it.'
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
          note: 'Darkens the background so tiles stay readable, in either theme.'
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
              type: 'choice',
              default: 'auto',
              options: columnChoices,
              note: 'Auto fits as many tiles per row as the window allows.'
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
              note: 'Manual is the order you drag them into. Most visited sorts '
                  + 'by how often you have opened each one from here, so dragging '
                  + 'a tile to a new place stops sticking.'
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
              note: 'Tile size sets the width; the shape sets the height to match. '
                  + 'A wide tile is a short one, so it has less room for a site name.'
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
              note: 'How much of the room inside a tile is left clear around its '
                  + 'icon. At 0% the icon fills what the shape and the name leave.'
            },
            { key: 'showLabels', label: 'Show site names', type: 'toggle', default: true },
            {
              key: 'showVisits',
              label: 'Show visit counts',
              type: 'toggle',
              default: false,
              note: 'Puts the number of times you have opened a site from here '
                  + 'in the corner of its tile.'
            },
            {
              key: 'showAddButton',
              label: 'Show the add button',
              type: 'toggle',
              default: true,
              note: 'The dotted + at the end of the grid. With it off, '
                  + 'right-clicking the page is how a tile gets added.'
            },
            { key: 'openInNewTab', label: 'Open sites in a new tab', type: 'toggle', default: false },
            {
              key: 'confirmDelete',
              label: 'Confirm before deleting a tile',
              type: 'toggle',
              default: false,
              note: 'Asks first, whether the tile is being deleted from its own '
                  + 'sheet or from the right-click menu. Off, it goes at once — a '
                  + 'tile is a bookmark, and putting one back is typing an address.'
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
              note: 'Reads each site\'s markup and web manifest to find its sharpest '
                  + 'logo. Firefox will ask for access to the sites you save.'
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
              note: 'The separators and the position of the suffix follow '
                  + 'the language your browser is set to, so these are examples rather than '
                  + 'the exact shape you will get.'
            },
            {
              key: 'clockFont',
              label: 'Font',
              type: 'font',
              default: '',
              emptyLabel: 'Match page font',
              inherit: 'font',
              busyText: 'Loading font…',
              note: 'The clock on its own. Leave it on "Match page font" and it '
                  + 'follows Appearance → Font with everything else.'
            },
            { key: 'clockWeight', label: 'Weight', type: 'choice', default: 300, options: WEIGHTS },
            {
              key: 'clockTracking',
              label: 'Spacing',
              type: 'range',
              default: -2.5,
              min: -6,
              max: 20,
              step: .5,
              unit: '%',
              note: 'The room between the letters, as a share of the type size. '
                  + 'Apple tracks large type in, never out.'
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
              note: 'The order of the day, the month and the year follows '
                  + 'the language your browser is set to, so these are examples rather than '
                  + 'the exact shape you will get.'
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
              note: 'Off, the time and the date follow the theme — dark ink on a '
                  + 'light page, light ink on a dark one, and white over a picture.'
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
              note: 'At 0 they carry the shadow the page gives them: none on a '
                  + 'plain background, a soft one over a picture. Anything above '
                  + 'it is yours, on either.'
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
          note: 'Floating sits in a pill over the page; a status bar spans the '
              + 'whole window.'
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
          note: 'On hover keeps the block out of the way until the pointer '
              + 'reaches it. Picking a group does not bring it back; dragging '
              + 'a tile does, since that is the moment the chips are wanted.'
        },
        {
          key: 'showAllGroup',
          label: 'Show the All category',
          type: 'toggle',
          default: true,
          note: 'The chip at the front of the block that clears the filter. '
              + 'With it off the page always sits in a group, and dragging a '
              + 'tile onto All is no longer the way to take it out of one.'
        },
        {
          key: 'showGroupAdd',
          label: 'Show the new group button',
          type: 'toggle',
          default: true,
          note: 'The + at the end of the block. With it off, right-clicking the '
              + 'page is how a group gets made.'
        },
        {
          key: 'keepGroup',
          label: 'Remember the open group',
          type: 'toggle',
          default: true,
          note: 'Opens a new tab on the group you were last looking at. With it '
              + 'off, every new tab starts on All - or, where All is not shown, '
              + 'on the first group.'
        },
        {
          key: 'groupAnimate',
          label: 'Animate group changes',
          type: 'toggle',
          default: true,
          note: 'Slides the tiles aside and brings the new ones in behind them, '
              + 'in the direction the block was travelling. With it off the grid '
              + 'simply changes.'
        },
        {
          key: 'groupScroll',
          label: 'Switch groups by scrolling',
          type: 'toggle',
          default: false,
          note: 'Turns to the next group along on a roll of the wheel or a swipe '
              + 'across the touchpad, and keeps turning for as long as you keep '
              + 'scrolling. It stops at each end rather than coming round again. '
              + 'A group with more tiles than the window holds scrolls first: it '
              + 'turns once you reach the top or the bottom of it.'
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
          note: 'Which way the gesture runs. Down and right go on to the next '
              + 'group; up and left go back. Left and right still answers a '
              + 'mouse wheel, which has only the one direction to give.'
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
          note: 'Top and bottom float the pill over the page at that edge. '
              + 'Above the tiles puts it in the page itself, under the clock '
              + 'and over the grid: the clock moves up to make room for it and '
              + 'the tiles stay where they are.'
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
      id: 'other',
      label: 'Other',
      icon: 'settings',
      tint: 'var(--system-gray)',
      fields: [
        {
          key: 'backup',
          label: 'Backup',
          // Reads and writes four storage keys, none of them its own - see
          // `external`.
          type: 'backup',
          external: true,
          busyText: 'Working on it…',
          note: 'Saves your tiles, groups, settings and background picture to a '
              + 'file. Importing one puts back whatever that file holds, over '
              + 'what is here now.'
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
          note: 'Puts every setting back to its default and takes the background '
              + 'away, recent ones included. Your tiles and groups are left alone.'
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
      .map(group => ({ label: group.label || null, fields: group.fields }));

    return { ...section, groups, fields: groups.flatMap(group => group.fields) };
  }

  const SECTIONS = RAW_SECTIONS.map(normalize);

  const FIELDS = SECTIONS.flatMap(section => section.fields);

  /** The fields that actually live in the settings object. */
  const STORED = FIELDS.filter(field => !field.external);

  const DEFAULTS = Object.fromEntries(STORED.map(f => [f.key, f.default]));

/**
   * A `choice` option is either the value itself - `6`, `'auto'` - or a
   * `{ value, label }` pair, for when the stored value is not what should be
   * read off the menu.
   */
  function optionValue(option) {
    return option && typeof option === 'object' ? option.value : option;
  }

  function optionLabel(option) {
    if (option && typeof option === 'object') return option.label;
    return option === 'auto' ? 'Auto' : String(option);
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
   * The background effects: what Blur and Dim are set to.
   *
   * They are named as a pair because they travel as one - a wallpaper in the
   * recent strip carries the pair it was last looked at with, and going back
   * to it brings them back too. They are ordinary stored settings all the
   * same; this is only the subset, not a second home for them.
   */
  const EFFECT_KEYS = ['bgBlur', 'bgDim'];

  /** The pair, filled in from the defaults and clamped the way a slider is. */
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
    SECTIONS, FIELDS, STORED, DEFAULTS, EFFECT_KEYS,
    coerce, coerceEffects, optionValue, optionLabel
  };
})();
