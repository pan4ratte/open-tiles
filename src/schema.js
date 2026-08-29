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
          note: 'Sets the clock and the tile names. Any family on Google Fonts '
              + 'works, not just the suggestions. Leave empty to use the system '
              + 'font. The dialogs and buttons always stay on Inter.'
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
      fields: [
        { key: 'showClock', label: 'Show the clock', type: 'toggle', default: true },
        { key: 'clock24', label: '24-hour time', type: 'toggle', default: true },
        { key: 'showDate', label: 'Show the date', type: 'toggle', default: false }
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
        return Math.min(field.max, Math.max(field.min, Math.round(n)));
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

  /** Fills in defaults and drops anything invalid or unknown. */
  function coerce(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
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
