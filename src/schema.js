/**
 * The settings schema: one source of truth for defaults, validation and the
 * layout of the settings dialog. Add a field here and it shows up in the UI,
 * gets a default and is validated on read - nothing else to touch.
 *
 * Field types
 *   segmented   one of `options`, rendered as a row of buttons
 *   choice      one of `options`, rendered as a <select>
 *   range       number between min and max
 *   toggle      boolean
 *   color       hex colour
 *   text        free text, trimmed and capped at `max` characters
 *   font        family name, with the Google Fonts picker attached
 *   background  the page picture: file picker plus Unsplash search
 *
 * A field marked `external: true` has no value in `settings` - it is a control
 * for something stored elsewhere (the background image is megabytes of data
 * URI, far too big to rewrite on every slider drag). It still renders in the
 * dialog; the page hands its current value in through `ctx.values`.
 */
const Schema = (() => {
  const columnChoices = ['auto', 3, 4, 5, 6, 7, 8, 9, 10, 12];
  const rowChoices = ['auto', 1, 2, 3, 4, 5, 6, 8];

  const SECTIONS = [
    {
      id: 'appearance',
      label: 'Appearance',
      icon: 'palette',
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
          default: '#5b8cff'
        },
        {
          key: 'font',
          label: 'Font',
          type: 'font',
          default: 'Inter',
          busyText: 'Loading font…',
          note: 'Any family on Google Fonts works, not just the suggestions. '
              + 'Leave empty to use the system font.'
        }
      ]
    },
    {
      id: 'background',
      label: 'Background',
      icon: 'image',
      fields: [
        {
          key: 'background',
          label: 'Picture',
          type: 'background',
          // Stored under its own key, not in settings - see the header above.
          external: true,
          busyText: 'Working on it…',
          note: 'A file from this computer, or a photo from Unsplash. Large '
              + 'files are scaled down to fit.'
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
        },
        {
          key: 'unsplashKey',
          label: 'Unsplash access key',
          type: 'text',
          default: '',
          max: 80,
          placeholder: 'Client-ID from your Unsplash app',
          note: 'Needed for the search above. Create a free app at '
              + 'unsplash.com/oauth/applications and paste its Access Key.'
        }
      ]
    },
    {
      id: 'layout',
      label: 'Layout',
      icon: 'layout-grid',
      fields: [
        {
          key: 'columns',
          label: 'Columns',
          type: 'choice',
          default: 'auto',
          options: columnChoices,
          note: 'Auto fits as many tiles per row as the window allows.'
        },
        {
          key: 'rows',
          label: 'Rows',
          type: 'choice',
          default: 'auto',
          options: rowChoices,
          note: 'Beyond this the grid scrolls.'
        },
        { key: 'tileSize', label: 'Tile size', type: 'range', default: 116, min: 72, max: 200, step: 4, unit: 'px' },
        { key: 'gap', label: 'Spacing', type: 'range', default: 18, min: 4, max: 48, step: 2, unit: 'px' }
      ]
    },
    {
      id: 'header',
      label: 'Header',
      icon: 'clock',
      fields: [
        { key: 'showClock', label: 'Show the clock', type: 'toggle', default: true },
        { key: 'clock24', label: '24-hour time', type: 'toggle', default: true },
        { key: 'showDate', label: 'Show the date', type: 'toggle', default: false },
        { key: 'showHint', label: 'Show the hint line', type: 'toggle', default: true }
      ]
    },
    {
      id: 'tiles',
      label: 'Tiles',
      icon: 'globe',
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
