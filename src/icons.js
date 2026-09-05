/**
 * Lucide icons (lucide-static v1.34.0, ISC licence) inlined as path data.
 * https://lucide.dev - every icon in the UI comes from here.
 *
 * To add one: copy the inner markup of the icon's SVG from
 * https://unpkg.com/lucide-static@latest/icons/<name>.svg into the map below.
 */
const Icons = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  const PATHS = {
    'archive':
      '<rect width="20" height="5" x="2" y="3" rx="1"/> <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/> <path d="M10 12h4"/>',
    'archive-restore':
      '<rect width="20" height="5" x="2" y="3" rx="1"/> <path d="M4 8v11a2 2 0 0 0 2 2h2"/> <path d="M20 8v11a2 2 0 0 1-2 2h-2"/> <path d="m9 15 3-3 3 3"/> <path d="M12 12v9"/>',
    'check':
      '<path d="M20 6 9 17l-5-5"/>',
    'chevron-down':
      '<path d="m6 9 6 6 6-6"/>',
    'chevrons-up-down':
      '<path d="m7 15 5 5 5-5"/> <path d="m7 9 5-5 5 5"/>',
    'circle-alert':
      '<circle cx="12" cy="12" r="10"/> <line x1="12" x2="12" y1="8" y2="12"/> <line x1="12" x2="12.01" y1="16" y2="16"/>',
    'clock':
      '<circle cx="12" cy="12" r="10"/> <path d="M12 6v6l4 2"/>',
    'columns-3':
      '<rect width="18" height="18" x="3" y="3" rx="2"/> <path d="M9 3v18"/> <path d="M15 3v18"/>',
    'download':
      '<path d="M12 15V3"/> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/> <path d="m7 10 5 5 5-5"/>',
    'external-link':
      '<path d="M15 3h6v6"/> <path d="M10 14 21 3"/> <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    'eye':
      '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/> <circle cx="12" cy="12" r="3"/>',
    'github':
      '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 4 5 4 5 4c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 11c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/> <path d="M9 18c-4.51 2-5-2-7-2"/>',
    'globe':
      '<circle cx="12" cy="12" r="10"/> <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/> <path d="M2 12h20"/>',
    'image':
      '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/> <circle cx="9" cy="9" r="2"/> <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    'info':
      '<circle cx="12" cy="12" r="10"/> <path d="M12 16v-4"/> <path d="M12 8h.01"/>',
    'layout-grid':
      '<rect width="7" height="7" x="3" y="3" rx="1"/> <rect width="7" height="7" x="14" y="3" rx="1"/> <rect width="7" height="7" x="14" y="14" rx="1"/> <rect width="7" height="7" x="3" y="14" rx="1"/>',
    'loader-circle':
      '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    'maximize-2':
      '<path d="M15 3h6v6"/> <path d="m21 3-7 7"/> <path d="m3 21 7-7"/> <path d="M9 21H3v-6"/>',
    'monitor':
      '<rect width="20" height="14" x="2" y="3" rx="2"/> <line x1="8" x2="16" y1="21" y2="21"/> <line x1="12" x2="12" y1="17" y2="21"/>',
    'moon':
      '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
    'move-vertical':
      '<path d="M8 18L12 22L16 18"/> <path d="M8 6L12 2L16 6"/> <line x1="12" x2="12" y1="2" y2="22"/>',
    'palette':
      '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/> <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/> <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/> <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/> <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
    'pencil':
      '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/> <path d="m15 5 4 4"/>',
    'pipette':
      '<path d="m2 22 1-1h3l9-9"/> <path d="M3 21v-3l9-9"/> <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
    'play':
      '<polygon points="6 3 20 12 6 21 6 3"/>',
    'plus':
      '<path d="M5 12h14"/> <path d="M12 5v14"/>',
    'refresh-cw':
      '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/> <path d="M21 3v5h-5"/> <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/> <path d="M8 16H3v5"/>',
    'rotate-ccw':
      '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/> <path d="M3 3v5h5"/>',
    'rows-3':
      '<rect width="18" height="18" x="3" y="3" rx="2"/> <path d="M21 9H3"/> <path d="M21 15H3"/>',
    'search':
      '<path d="m21 21-4.34-4.34"/> <circle cx="11" cy="11" r="8"/>',
    'settings':
      '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/> <circle cx="12" cy="12" r="3"/>',
    'shield-check':
      '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/> <path d="m9 12 2 2 4-4"/>',
    'sun':
      '<circle cx="12" cy="12" r="4"/> <path d="M12 2v2"/> <path d="M12 20v2"/> <path d="m4.93 4.93 1.41 1.41"/> <path d="m17.66 17.66 1.41 1.41"/> <path d="M2 12h2"/> <path d="M20 12h2"/> <path d="m6.34 17.66-1.41 1.41"/> <path d="m19.07 4.93-1.41 1.41"/>',
    'tag':
      '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/> <circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    'trash-2':
      '<path d="M10 11v6"/> <path d="M14 11v6"/> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/> <path d="M3 6h18"/> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    'type':
      '<path d="M12 4v16"/> <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/> <path d="M9 20h6"/>',
    'upload':
      '<path d="M12 3v12"/> <path d="m17 8-5-5-5 5"/> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
    'x':
      '<path d="M18 6 6 18"/> <path d="m6 6 12 12"/>',
  };

  /**
   * The shapes a Lucide glyph is drawn from, and the attributes they carry.
   *
   * The table above is markup because markup is the form the icons are copied
   * in - but markup is not how it reaches the page. `shapesFor` reads an entry
   * with a matcher that knows only these names and builds the elements itself,
   * so nothing outside the two lists can ever be drawn, and no string is
   * handed to `innerHTML` - which an add-on review flags wherever it appears.
   */
  const SHAPES = ['path', 'circle', 'line', 'rect', 'polygon'];
  const ATTRS = ['cx', 'cy', 'd', 'fill', 'height', 'points', 'r', 'rx', 'ry',
                 'width', 'x', 'x1', 'x2', 'y', 'y1', 'y2'];

  const SHAPE_RE = /<([a-z]+)\s([^>]*?)\s*\/>/g;
  const ATTR_RE = /([a-zA-Z0-9]+)="([^"]*)"/g;

  /** Each glyph parsed the first time it is asked for, then cloned. */
  const built = new Map();

  /**
   * The elements one glyph is made of, read out of its entry in PATHS.
   * @param {string} name key of PATHS
   * @returns {SVGElement[]} shared - clone before putting one in a document
   */
  function shapesFor(name) {
    const done = built.get(name);
    if (done) return done;

    const out = [];
    const markup = PATHS[name] || '';
    SHAPE_RE.lastIndex = 0;
    let shape;
    while ((shape = SHAPE_RE.exec(markup)) !== null) {
      if (!SHAPES.includes(shape[1])) continue;
      const el = document.createElementNS(NS, shape[1]);
      ATTR_RE.lastIndex = 0;
      let attr;
      while ((attr = ATTR_RE.exec(shape[2])) !== null) {
        if (ATTRS.includes(attr[1])) el.setAttribute(attr[1], attr[2]);
      }
      out.push(el);
    }

    built.set(name, out);
    return out;
  }

  /**
   * Builds an <svg> element for a Lucide icon.
   * @param {string} name key of PATHS
   * @param {{size?:number, className?:string, strokeWidth?:number}} [opts]
   */
  function create(name, opts = {}) {
    const svg = document.createElementNS(NS, 'svg');
    const size = opts.size || 24;
    svg.setAttribute('xmlns', NS);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', opts.strokeWidth || 2);
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'icon' + (opts.className ? ' ' + opts.className : ''));
    for (const shape of shapesFor(name)) svg.append(shape.cloneNode(true));
    return svg;
  }

  /** Fills every [data-icon] element in the markup with its icon. */
  function hydrate(root = document) {
    root.querySelectorAll('[data-icon]').forEach(el => {
      const size = el.dataset.iconSize ? Number(el.dataset.iconSize) : 20;
      el.prepend(create(el.dataset.icon, { size }));
      delete el.dataset.icon;
    });
  }

  return { create, hydrate, names: Object.keys(PATHS) };
})();
