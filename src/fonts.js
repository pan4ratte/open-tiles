/**
 * Google Fonts support.
 *
 * Inter ships with the extension (see ../fonts/inter.css) so the default look
 * works offline and costs no request. Any other family is pulled from Google
 * Fonts once, rewritten so the woff2 files live in the stylesheet as data URIs,
 * and cached in extension storage. After the first use the font renders from
 * cache, so Google is not contacted on every new tab.
 */
const Fonts = (() => {
  const BUNDLED = 'Inter';
  const STYLE_ID = 'webfont';
  const FALLBACK = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  /** Subsets worth caching; the rest of the CSS is dropped to keep it small. */
  const SUBSETS = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'];
  const MAX_CSS_BYTES = 1.5 * 1024 * 1024;

  /**
   * Popular families offered in the picker. The field is not limited to these
   * - any family name Google Fonts serves will load.
   */
  const SUGGESTED = [
    'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins',
    'Source Sans 3', 'Raleway', 'Nunito', 'Nunito Sans', 'Work Sans', 'Rubik',
    'Manrope', 'DM Sans', 'Karla', 'Mulish', 'Quicksand', 'Outfit', 'Figtree',
    'Plus Jakarta Sans', 'Space Grotesk', 'Urbanist', 'Sora', 'Lexend',
    'Public Sans', 'IBM Plex Sans', 'Barlow', 'Cabin', 'Ubuntu', 'PT Sans',
    'Fira Sans', 'Archivo', 'Oswald', 'Bebas Neue', 'Merriweather',
    'Playfair Display', 'Lora', 'Source Serif 4', 'PT Serif', 'EB Garamond',
    'Crimson Text', 'Bitter', 'JetBrains Mono', 'Fira Code', 'IBM Plex Mono',
    'Source Code Pro', 'Space Mono', 'Roboto Mono', 'Inconsolata'
  ];

  // ------------------------------------------------------------------ helpers

  function quote(family) {
    return /^[A-Za-z][A-Za-z0-9]*$/.test(family) ? family : `"${family}"`;
  }

  /** The stack written into the --font-family custom property. */
  function stackFor(family) {
    const name = (family || '').trim();
    if (!name) return 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
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
      const match = block.match(/url\((https:\/\/[^)]+)\)/);
      if (!match) return null;
      const res = await fetch(match[1], { credentials: 'omit' });
      if (!res.ok) return null;
      const data = toBase64(await res.arrayBuffer());
      const inlined = block.replace(match[1], `data:font/woff2;base64,${data}`);
      return subset ? `/* ${subset} */\n${inlined}` : inlined;
    }));

    const out = blocks.filter(Boolean).join('\n');
    if (!out) throw new Error('Could not download the font files.');
    if (out.length > MAX_CSS_BYTES) throw new Error('That font is too large to cache.');
    return out;
  }

  // ---------------------------------------------------------------- loading

  function injectCss(css) {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
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
      injectCss(cached);
      return 'cache';
    }

    const css = await inlineFaces(await fetchCss(name));
    injectCss(css);
    await Store.putFontCss(name, css);
    return 'network';
  }

  /** Applies the stack right away, then loads the files behind it. */
  async function use(family) {
    applyStack(family);
    return load(family);
  }

  return { BUNDLED, SUGGESTED, stackFor, applyStack, load, use };
})();
