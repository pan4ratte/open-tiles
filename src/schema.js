/**
 * The settings schema: one source of truth for defaults, validation and the
 * layout of the settings dialog. Add a field here and it shows up in the UI,
 * gets a default and is validated on read - nothing else to touch.
 *
 * Sections become the rows of the settings sidebar, in the order below. Each
 * carries an `icon` and a `tint` - the colour of the rounded square its glyph
 * sits on, which is what makes the sidebar scannable at a glance.
 *
 * Field types
 *   segmented   one of `options`, rendered as a row of buttons
 *   choice      one of `options`, rendered as a macOS pop-up button
 *   range       number between min and max
 *   toggle      boolean
 *   color       hex colour
 *   text        free text, trimmed and capped at `max` characters
 *   font        family name, with the Google Fonts picker attached
 *   background  the page picture: a file from this computer
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

  const SECTIONS = [
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
          label: 'Picture',
          type: 'background',
          // Stored under its own key, not in settings - see the header above.
          external: true,
          busyText: 'Working on it…',
          note: 'A file from this computer, up to 6 MB. Large pictures are '
              + 'scaled down to fit; the preview shows the crop you will get.'
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
          note: 'Fades the picture towards the theme colour so tiles stay readable.'
        }
      ]
    },
    {
      id: 'layout',
      label: 'Layout',
      icon: 'layout-grid',
      tint: 'var(--system-indigo)',
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
        { key: 'gap', label: 'Spacing', type: 'range', default: 18, min: 4, max: 48, step: 2, unit: 'px' }
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
      id: 'tiles',
      label: 'Tiles',
      icon: 'globe',
      tint: 'var(--system-blue)',
      fields: [
        { key: 'showLabels', label: 'Show site names', type: 'toggle', default: true },
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
          note: 'Floating sits in a pill above the clock; a status bar spans the '
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
              + 'reaches it - or until a group is picked.'
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
              + 'picture away. Your tiles and groups are left alone.'
        }
      ]
    }
  ];

  const FIELDS = SECTIONS.flatMap(section => section.fields);

  /** The fields that actually live in the settings object. */
  const STORED = FIELDS.filter(field => !field.external);

  const DEFAULTS = Object.fromEntries(STORED.map(f => [f.key, f.default]));

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
        if (value === 'auto') return 'auto';
        const n = Number(value);
        return field.options.includes(n) ? n : field.default;
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

  return { SECTIONS, FIELDS, STORED, DEFAULTS, coerce };
})();
