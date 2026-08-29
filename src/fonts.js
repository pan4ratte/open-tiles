/**
 * Google Fonts support.
 *
 * Inter ships with the extension (see ../fonts/inter.css) so the default look
 * works offline and costs no request. Any other family is pulled from Google
 * Fonts once, rewritten so the woff2 files live in the stylesheet as data URIs,
 * and cached in extension storage. After the first use the font renders from
 * cache, so Google is not contacted on every new tab.
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
  const STYLE_ID = 'webfont';
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

  function applyStack(family) {
    document.documentElement.style.setProperty('--font-family', stackFor(family));
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

  /** Replaces the one gstatic URL in a @font-face block with a data: URI. */
  async function inlineBlock(block) {
    const match = block.match(/url\((https:\/\/[^)]+)\)/);
    if (!match) return null;
    const res = await fetch(match[1], { credentials: 'omit' });
    if (!res.ok) return null;
    const data = toBase64(await res.arrayBuffer());
    return block.replace(match[1], `data:font/woff2;base64,${data}`);
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

  async function fetchCss(family) {
    // Most families carry 300/400/600; the retry covers the ones that do not.
    for (const weights of ['300;400;600', null]) {
      const res = await fetch(cssUrl(family, weights), {
        credentials: 'omit',
        cache: 'no-cache'
      });
      if (res.ok) return res.text();
      if (res.status !== 400) {
        throw new Error(`Google Fonts replied ${res.status}.`);
      }
    }
    throw new Error(`Google Fonts has no family called "${family}".`);
  }

  /** Replaces every gstatic URL with a data: URI so the CSS is self-contained. */
  async function inlineFaces(css) {
    const wanted = parseFaces(css)
      .filter(f => !f.subset || SUBSETS.includes(f.subset));
    const faces = wanted.length ? wanted : parseFaces(css).slice(0, 2);

    const blocks = await Promise.all(faces.map(async ({ subset, block }) => {
      const inlined = await inlineBlock(block);
      if (!inlined) return null;
      return subset ? `/* ${subset} */\n${inlined}` : inlined;
    }));

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

  function clearCss() {
    const style = document.getElementById(STYLE_ID);
    if (style) style.textContent = '';
  }

  /**
   * Makes `family` available on the page.
   * @returns {Promise<'bundled'|'system'|'cache'|'network'>}
   * @throws {Error} with a message fit to show the user
   */
  async function load(family) {
    const name = (family || '').trim();
    if (!name) {
      clearCss();
      return 'system';
    }
    if (name === BUNDLED) {
      clearCss();
      return 'bundled';
    }

    const cached = await Store.getFontCss(name);
    if (cached) {
      injectCss(STYLE_ID, cached);
      return 'cache';
    }

    const css = await inlineFaces(await fetchCss(name));
    injectCss(STYLE_ID, css);
    await Store.putFontCss(name, css);
    return 'network';
  }

  /** Applies the stack right away, then loads the files behind it. */
  async function use(family) {
    applyStack(family);
    return load(family);
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
    stackFor, applyStack, load, use,
    previewStack, loadPreviews
  };
})();
