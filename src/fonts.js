/**
 * Google Fonts support.
 *
 * Inter ships with the extension (see ../fonts/inter.css) so the default look
 * works offline and costs no request. Any other family is pulled from Google
 * Fonts once, rewritten so the woff2 files live in the stylesheet as data URIs,
 * and cached in extension storage. After the first use the font renders from
 * cache, so Google is not contacted on every new tab.
 *
 * Three families can be in play at once - the page's, and the clock's and the
 * date's where those are given faces of their own - so each gets a stylesheet
 * of its own rather than sharing one that the next family would clear. `sync`
 * is what keeps that set honest: it brings down whatever is named now and
 * takes away the sheets for whatever is not.
 *
 * The picker draws every family in its own face, which means loading all of
 * them at once. That is a second, much smaller stylesheet: one request for the
 * whole catalogue cut down to letters and digits, so a family costs a couple of
 * kilobytes rather than a hundred. It is cached the same way, and its faces are
 * renamed on the way in so a specimen can never stand in for the real font on
 * the page - see PREVIEW_PREFIX.
 */
const Fonts = (() => {
  const BUNDLED = 'Inter';
  /**
   * One stylesheet per family, named after it. The prefix is long enough that
   * the specimen sheet ("webfont-specimens") cannot be mistaken for a family's
   * own by the `sync` sweep below.
   */
  const STYLE_PREFIX = 'webfont-family-';
  const FALLBACK = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  /**
   * Subsets worth caching; the rest of the CSS is dropped to keep it small.
   *
   * This list is also what the picker's Script filter can honestly offer: a
   * family is only worth filtering to for Greek if the Greek glyphs actually
   * come down with it.
   */
  const SUBSETS = [
    'latin', 'latin-ext', 'cyrillic', 'cyrillic-ext',
    'greek', 'greek-ext', 'vietnamese'
  ];
  const MAX_CSS_BYTES = 2 * 1024 * 1024;

  /**
   * The families the picker offers, each with what the filters sort by.
   *
   * `style` is Google's own category, narrowed to the four worth telling apart
   * here. `scripts` lists the writing systems beyond plain Latin that the
   * family covers *and* that SUBSETS brings down - Rubik's Hebrew and Poppins'
   * Devanagari are real, but nothing here would load them, so naming them
   * would be a promise the picker could not keep.
   *
   * The list is a starting point, not a limit: "Other family" in the picker
   * takes any name Google Fonts serves.
   */
  const CATALOG = [
    { name: 'Inter', style: 'sans', scripts: ['latin-ext', 'cyrillic', 'greek', 'vietnamese'] },
    { name: 'Roboto', style: 'sans', scripts: ['latin-ext', 'cyrillic', 'greek', 'vietnamese'] },
    { name: 'Open Sans', style: 'sans', scripts: ['latin-ext', 'cyrillic', 'greek', 'vietnamese'] },
    { name: 'Lato', style: 'sans', scripts: ['latin-ext'] },
    { name: 'Montserrat', style: 'sans', scripts: ['latin-ext', 'cyrillic', 'vietnamese'] },
    { name: 'Poppins', style: 'sans', scripts: ['latin-ext'] },
    { name: 'Source Sans 3', style: 'sans', scripts: ['latin-ext', 'cyrillic', 'greek', 'vietnamese'] },
    { name: 'Raleway', style: 'sans', scripts: ['latin-ext', 'cyrillic', 'vietnamese'] },
    { name: 'Nunito', style: 'sans', scripts: ['latin-ext', 'cyrillic', 'vietnamese'] },
    { name: 'Nunito Sans', style: 'sans', scripts: ['latin-ext', 'cyrillic', 'vietnamese'] },
    { name: 'Work Sans', style: 'sans', scripts: ['latin-ext', 'vietnamese'] },
    { name: 'Rubik', style: 'sans', scripts: ['latin-ext', 'cyrillic'] },
    { name: 'Manrope', style: 'sans', scripts: ['latin-ext', 'cyrillic', 'greek', 'vietnamese'] },
    { name: 'DM Sans', style: 'sans', scripts: ['latin-ext'] },
    { name: 'Karla', style: 'sans', scripts: ['latin-ext'] },
    { name: 'Mulish', style: 'sans', scripts: ['latin-ext', 'cyrillic', 'vietnamese'] },
    { name: 'Quicksand', style: 'sans', scripts: ['latin-ext', 'vietnamese'] },
    { name: 'Outfit', style: 'sans', scripts: ['latin-ext'] },
    { name: 'Figtree', style: 'sans', scripts: ['latin-ext'] },
    { name: 'Plus Jakarta Sans', style: 'sans', scripts: ['latin-ext', 'cyrillic', 'vietnamese'] },
    { name: 'Space Grotesk', style: 'sans', scripts: ['latin-ext', 'vietnamese'] },
    { name: 'Urbanist', style: 'sans', scripts: ['latin-ext'] },
    { name: 'Sora', style: 'sans', scripts: ['latin-ext'] },
    { name: 'Lexend', style: 'sans', scripts: ['latin-ext', 'vietnamese'] },
    { name: 'Public Sans', style: 'sans', scripts: ['latin-ext'] },
    { name: 'IBM Plex Sans', style: 'sans', scripts: ['latin-ext', 'cyrillic', 'greek', 'vietnamese'] },
    { name: 'Barlow', style: 'sans', scripts: ['latin-ext', 'vietnamese'] },
    { name: 'Cabin', style: 'sans', scripts: ['latin-ext', 'vietnamese'] },
    { name: 'Ubuntu', style: 'sans', scripts: ['latin-ext', 'cyrillic', 'greek'] },
    { name: 'PT Sans', style: 'sans', scripts: ['latin-ext', 'cyrillic'] },
    { name: 'Fira Sans', style: 'sans', scripts: ['latin-ext', 'cyrillic', 'greek'] },
    { name: 'Archivo', style: 'sans', scripts: ['latin-ext', 'vietnamese'] },
    { name: 'Oswald', style: 'sans', scripts: ['latin-ext', 'cyrillic', 'vietnamese'] },
    { name: 'Bebas Neue', style: 'display', scripts: ['latin-ext'] },
    { name: 'Merriweather', style: 'serif', scripts: ['latin-ext', 'cyrillic', 'vietnamese'] },
    { name: 'Playfair Display', style: 'serif', scripts: ['latin-ext', 'cyrillic', 'vietnamese'] },
    { name: 'Lora', style: 'serif', scripts: ['latin-ext', 'cyrillic', 'vietnamese'] },
    { name: 'Source Serif 4', style: 'serif', scripts: ['latin-ext', 'cyrillic', 'greek', 'vietnamese'] },
    { name: 'PT Serif', style: 'serif', scripts: ['latin-ext', 'cyrillic'] },
    { name: 'EB Garamond', style: 'serif', scripts: ['latin-ext', 'cyrillic', 'greek', 'vietnamese'] },
    { name: 'Crimson Text', style: 'serif', scripts: ['latin-ext'] },
    { name: 'Bitter', style: 'serif', scripts: ['latin-ext', 'cyrillic', 'vietnamese'] },
    { name: 'JetBrains Mono', style: 'mono', scripts: ['latin-ext', 'cyrillic', 'greek', 'vietnamese'] },
    { name: 'Fira Code', style: 'mono', scripts: ['latin-ext', 'cyrillic', 'greek'] },
    { name: 'IBM Plex Mono', style: 'mono', scripts: ['latin-ext', 'cyrillic', 'greek', 'vietnamese'] },
    { name: 'Source Code Pro', style: 'mono', scripts: ['latin-ext', 'cyrillic', 'greek', 'vietnamese'] },
    { name: 'Space Mono', style: 'mono', scripts: ['latin-ext', 'vietnamese'] },
    { name: 'Inconsolata', style: 'mono', scripts: ['latin-ext', 'vietnamese'] }
  ];

  /** The Style filter's buttons, in the order they are shown. */
  const STYLES = [
    { id: 'sans', label: 'Sans' },
    { id: 'serif', label: 'Serif' },
    { id: 'mono', label: 'Mono' },
    { id: 'display', label: 'Display' }
  ];

  /**
   * The Script filter's buttons. Plain Latin is not among them: every family
   * here has it, so it would rule nothing out.
   */
  const SCRIPTS = [
    { id: 'latin-ext', label: 'Latin ext', title: 'Extended Latin - accents and the rest of Europe' },
    { id: 'cyrillic', label: 'Cyrillic', title: 'Cyrillic' },
    { id: 'greek', label: 'Greek', title: 'Greek' },
    { id: 'vietnamese', label: 'Vietnamese', title: 'Vietnamese' }
  ];

  /** Names only, for anything that just wants the list. */
  const SUGGESTED = CATALOG.map(font => font.name);

  // ------------------------------------------------------------------ helpers

  function quote(family) {
    return /^[A-Za-z][A-Za-z0-9]*$/.test(family) ? family : `"${family}"`;
  }

  /** The stack written into the --font-family custom property. */
  function stackFor(family) {
    const name = (family || '').trim();
    if (!name) return SYSTEM;
    if (name === BUNDLED) return FALLBACK;
    return `${quote(name)}, ${FALLBACK}`;
  }

  /**
   * Writes a family's stack into a custom property. The page's own is
   * `--font-family`; the clock and the date name theirs beside it.
   */
  function applyStack(family, prop = '--font-family') {
    document.documentElement.style.setProperty(prop, stackFor(family));
  }

  function cssUrl(family, weights) {
    const spec = weights ? `${family}:wght@${weights}` : family;
    return 'https://fonts.googleapis.com/css2?family='
      + encodeURIComponent(spec).replace(/%3A/gi, ':').replace(/%40/g, '@').replace(/%3B/gi, ';')
      + '&display=swap';
  }

  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  /** Splits the Google stylesheet into [{ subset, block }] entries. */
  function parseFaces(css) {
    const faces = [];
    const re = /(?:\/\*\s*([a-z0-9-]+)\s*\*\/\s*)?(@font-face\s*\{[^}]*\})/gi;
    let m;
    while ((m = re.exec(css)) !== null) {
      faces.push({ subset: m[1] || '', block: m[2] });
    }
    return faces;
  }

  /**
   * The descriptors worth keeping out of a Google @font-face block, and the
   * shape a value has to have to be kept.
   *
   * The block is text from a server, and text from a server is not pasted into
   * a stylesheet on trust: `inlineBlock` reads these out of it and writes a
   * fresh rule from them, so the only thing that can reach the page is a
   * descriptor named here carrying a value that matches. `src` is absent
   * because it is never taken from the reply at all - it is written from the
   * bytes of the file that was downloaded.
   */
  const DESCRIPTORS = {
    'font-family': /^(['"])[\w .+-]{1,64}\1$|^[\w .+-]{1,64}$/,
    'font-style': /^(normal|italic|oblique(\s+-?\d{1,3}(\.\d+)?deg){0,2})$/,
    'font-weight': /^\d{1,3}(\s+\d{1,3})?$/,
    'font-stretch': /^(normal|(ultra-|extra-|semi-)?(condensed|expanded)|\d{1,3}(\.\d+)?%(\s+\d{1,3}(\.\d+)?%)?)$/,
    'font-display': /^(auto|block|swap|fallback|optional)$/,
    'unicode-range': /^[Uu]\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?(\s*,\s*[Uu]\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?)*$/
  };

  /**
   * A @font-face block rewritten to stand on its own: the file it points at is
   * downloaded and carried in the rule as a data: URI, and every other
   * descriptor is copied across only where DESCRIPTORS both knows the name and
   * recognises the value. Anything else in the block is dropped.
   *
   * @returns {Promise<?string>} the rule, or null where nothing usable came
   */
  async function inlineBlock(block) {
    const match = block.match(/url\((https:\/\/[^)]+)\)/);
    if (!match) return null;
    const res = await fetch(match[1], { credentials: 'omit' });
    if (!res.ok) return null;
    const data = toBase64(await res.arrayBuffer());

    const kept = [];
    const body = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'));
    for (const decl of body.split(';')) {
      const at = decl.indexOf(':');
      if (at < 0) continue;
      const name = decl.slice(0, at).trim().toLowerCase();
      const value = decl.slice(at + 1).trim();
      if (!Object.prototype.hasOwnProperty.call(DESCRIPTORS, name)) continue;
      if (DESCRIPTORS[name].test(value)) kept.push(`  ${name}: ${value};`);
    }

    // Without a family the rule names nothing and the browser would drop it,
    // so it is dropped here instead, where the caller can count it as a miss.
    if (!kept.some(line => line.startsWith('  font-family:'))) return null;

    kept.push(`  src: url(data:font/woff2;base64,${data}) format('woff2');`);
    return `@font-face {\n${kept.join('\n')}\n}`;
  }

  /**
   * `Promise.all` over `items`, but never more than `limit` in flight. The
   * catalogue is fifty families; asking for fifty files at once is how a
   * request gets dropped rather than answered.
   */
  async function mapPool(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const at = next++;
        out[at] = await fn(items[at]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, worker)
    );
    return out;
  }

  // -------------------------------------------------------------- network

  /**
   * The weight axes worth asking for, widest first.
   *
   * A variable family answers one of these with a single file per subset
   * covering every weight the Weight menus offer - and does it in a third of
   * the bytes the static cuts below take to cover three of them (Montserrat:
   * 167 KB against 502 KB). css2 has no way to say "whatever axis this family
   * has", so the common ones are named; between them these four cover most of
   * the catalogue, and a family that answers to none of them is genuinely
   * static.
   */
  const AXES = ['100..900', '200..800', '300..800', '400..700'];

  /** The static cuts for a family with no axis at all, then the family bare. */
  const CUTS = ['300;400;600', null];

  async function fetchCss(family) {
    let trouble = null;

    /** The stylesheet for one weight spec, or null where it is not served. */
    const ask = async spec => {
      let res;
      try {
        res = await fetch(cssUrl(family, spec), { credentials: 'omit', cache: 'no-cache' });
      } catch {
        // A refusal arrives as a network error rather than as a status: css2
        // answers a range - or a family - it does not have with a 400 carrying
        // no Access-Control-Allow-Origin, so the page never gets to read it.
        return null;
      }
      if (res.ok) return res.text();
      // Kept for the message, but only from a reply that is not the ordinary
      // "not served": a 503 is worth telling the reader about, a 400 is not.
      if (res.status !== 400) trouble = `Google Fonts replied ${res.status}.`;
      return null;
    };

    // All four axes at once. Three of them are usually refused, and asking in
    // turn would spend a round trip on each refusal before the download could
    // start; the replies are a kilobyte of CSS each, so racing them is free.
    const widest = (await Promise.all(AXES.map(ask))).find(Boolean);
    if (widest) return widest;

    for (const cut of CUTS) {
      const css = await ask(cut);
      if (css) return css;
    }

    throw new Error(trouble || `Google Fonts has no family called "${family}".`);
  }

  /** Replaces every gstatic URL with a data: URI so the CSS is self-contained. */
  async function inlineFaces(css) {
    const wanted = parseFaces(css)
      .filter(f => !f.subset || SUBSETS.includes(f.subset));
    const faces = wanted.length ? wanted : parseFaces(css).slice(0, 2);

    // Pooled rather than all at once: the static fallback for a family with no
    // variable axis is three cuts across seven subsets, and twenty-one
    // simultaneous requests is how one of them gets dropped rather than
    // answered.
    const blocks = await mapPool(faces, 8, async ({ subset, block }) => {
      const inlined = await inlineBlock(block);
      if (!inlined) return null;
      return subset ? `/* ${subset} */\n${inlined}` : inlined;
    });

    const out = blocks.filter(Boolean).join('\n');
    if (!out) throw new Error('Could not download the font files.');
    if (out.length > MAX_CSS_BYTES) throw new Error('That font is too large to cache.');
    return out;
  }

  // ---------------------------------------------------------------- loading

  function injectCss(id, css) {
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement('style');
      style.id = id;
      document.head.append(style);
    }
    style.textContent = css;
  }

  /** The id of the sheet a family's faces live in. */
  function styleIdFor(family) {
    return STYLE_PREFIX + family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  /**
   * The families whose faces are on the page, each held as the job that put
   * them there. Holding the job rather than a flag is what keeps a family
   * named twice - by the clock and the date both - to one download; a job that
   * fails is dropped, so choosing that family again tries afresh.
   *
   * @type {Map<string, Promise<'cache'|'network'>>}
   */
  const jobs = new Map();

  async function fetchFamily(name) {
    const cached = await Store.getFontCss(name);
    const css = cached || await inlineFaces(await fetchCss(name));

    const style = document.createElement('style');
    style.id = styleIdFor(name);
    // What `sync` reads to tell which family a sheet belongs to; the id has
    // been through a slug and cannot be turned back into a name.
    style.dataset.family = name;
    style.textContent = css;
    const existing = document.getElementById(style.id);
    if (existing) existing.replaceWith(style);
    else document.head.append(style);

    if (!cached) await Store.putFontCss(name, css);
    return cached ? 'cache' : 'network';
  }

  /**
   * Makes `family` available on the page.
   * @returns {Promise<'bundled'|'system'|'cache'|'network'>}
   * @throws {Error} with a message fit to show the user
   */
  function load(family) {
    const name = (family || '').trim();
    if (!name) return Promise.resolve('system');
    if (name === BUNDLED) return Promise.resolve('bundled');

    if (!jobs.has(name)) {
      jobs.set(name, fetchFamily(name).catch(err => {
        jobs.delete(name);
        throw err;
      }));
    }
    return jobs.get(name);
  }

  /** The sheet ids the page is currently asking for; `sweep` judges by it. */
  let keeping = new Set();

  /** Takes away the sheet for every family no longer named. */
  function sweep() {
    document.querySelectorAll('style[id^="' + STYLE_PREFIX + '"]').forEach(style => {
      if (keeping.has(style.id)) return;
      style.remove();
      // The job is the record of "already on the page", so it goes with it.
      jobs.delete(style.dataset.family);
    });
  }

  /**
   * Brings down every family in `families` and takes away the sheets for the
   * ones no longer named - a font tried on and moved away from should not go
   * on costing the page a stylesheet. It stays in the storage cache, so trying
   * it again is instant.
   *
   * @param {string[]} families
   * @returns {Promise<void>} settles once they are all on the page, or one of
   *   them has failed
   */
  function sync(families) {
    const wanted = [...new Set(
      families.map(one => (one || '').trim()).filter(one => one && one !== BUNDLED)
    )];

    keeping = new Set(wanted.map(styleIdFor));
    sweep();

    // Swept again once they have all landed. A family dropped while it was
    // still downloading is not on the page for the first sweep to find, and
    // would otherwise arrive just after the sweep meant to have removed it -
    // so the second one reads `keeping` as it stands by then, which is the
    // newest set asked for rather than this call's.
    return Promise.all(wanted.map(load)).then(sweep, err => {
      sweep();
      throw err;
    });
  }

  // ---------------------------------------------------------------- specimens

  const PREVIEW_STYLE_ID = 'webfont-specimens';

  /**
   * Specimen faces are declared under a name of their own.
   *
   * Without this, a family cut down to letters and digits would sit in the same
   * font-family as the full one loaded for the page - and being later in the
   * document, it would win. Choosing Lora would then leave the clock with no
   * punctuation. The prefix keeps the two apart: the picker asks for
   * "Tiles Specimen Lora", the page asks for "Lora", and neither can answer for
   * the other.
   */
  const PREVIEW_PREFIX = 'Tiles Specimen ';

  /**
   * What Google is asked to cut the specimens down to. Every family name in the
   * catalogue is spelt out of this, and so is the sample line under the grid,
   * so nothing in the picker can ask for a glyph that was not fetched.
   */
  const PREVIEW_TEXT =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ';

  /** Bumped by hand when any of the above changes shape. */
  const PREVIEW_VERSION = 1;

  /** Inter is bundled, so it is already drawable and costs nothing to skip. */
  const previewFamilies = () => SUGGESTED.filter(name => name !== BUNDLED);

  const previewSignature = () =>
    `v${PREVIEW_VERSION}:${previewFamilies().join(',')}:${PREVIEW_TEXT}`;

  function previewUrl(families) {
    const params = families
      .map(name => 'family=' + encodeURIComponent(name))
      .join('&');
    return `https://fonts.googleapis.com/css2?${params}`
      + `&text=${encodeURIComponent(PREVIEW_TEXT)}&display=swap`;
  }

  /** The stack a specimen is drawn in: the cut face, then the real one. */
  function previewStack(family) {
    const name = (family || '').trim();
    if (!name) return SYSTEM;
    return `${quote(PREVIEW_PREFIX + name)}, ${stackFor(name)}`;
  }

  async function buildPreviewCss() {
    const res = await fetch(previewUrl(previewFamilies()), {
      credentials: 'omit',
      cache: 'no-cache'
    });
    if (!res.ok) throw new Error(`Google Fonts replied ${res.status}.`);

    // Renamed before anything else, so a block that fails to download cannot
    // leave a real family name behind in the stylesheet either.
    const css = (await res.text()).replace(
      /font-family:\s*(['"])([^'"]+)\1/g,
      (whole, mark, name) => `font-family:${mark}${PREVIEW_PREFIX}${name}${mark}`
    );

    const blocks = await mapPool(
      parseFaces(css).map(face => face.block),
      8,
      block => inlineBlock(block).catch(() => null)
    );

    const out = blocks.filter(Boolean).join('\n');
    if (!out) throw new Error('Could not download the font previews.');
    return out;
  }

  /**
   * One request for the whole catalogue, then never again: the built
   * stylesheet is cached, and the job is held so the picker re-mounting does
   * not start a second one.
   */
  let previewJob = null;

  async function fetchPreviews() {
    const sig = previewSignature();
    const cached = await Store.getFontPreviews(sig);
    if (cached) {
      injectCss(PREVIEW_STYLE_ID, cached);
      return 'cache';
    }
    const css = await buildPreviewCss();
    injectCss(PREVIEW_STYLE_ID, css);
    await Store.putFontPreviews(sig, css);
    return 'network';
  }

  /**
   * Draws every catalogue family in its own face.
   * @returns {Promise<'cache'|'network'>}
   */
  function loadPreviews() {
    if (!previewJob) {
      previewJob = fetchPreviews().catch(err => {
        // Dropped so a picker opened again after the network came back can try
        // once more rather than repeat the failure it remembered.
        previewJob = null;
        throw err;
      });
    }
    return previewJob;
  }

  return {
    BUNDLED, CATALOG, STYLES, SCRIPTS, SUGGESTED,
    stackFor, applyStack, load, sync,
    previewStack, loadPreviews
  };
})();
