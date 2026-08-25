/**
 * Finds the sharpest icon a site offers.
 *
 * Sites publish their logo in a dozen different ways, so this tries them in
 * order of how good the result usually is:
 *
 *   1. deep lookup (optional) - reads the page's <link rel="icon|apple-touch-icon
 *      |mask-icon"> tags and its web manifest's icons[], which is the only way
 *      to find icons at non-standard paths. Needs host permission, so it is off
 *      until the user turns it on.
 *   2. conventional paths - /favicon.svg, /apple-touch-icon.png,
 *      /android-chrome-512x512.png and friends, probed in waves so the common
 *      case costs three requests, not fifteen.
 *   3. /favicon.ico as the floor.
 *
 * Every candidate is loaded as an <img> and measured, so what wins is the one
 * that really is the largest, not the one whose filename claims to be. Results
 * are cached per origin, so a tile resolves once and is instant afterwards.
 *
 * Probing images needs no permissions at all - only the deep lookup does.
 */
const Favicons = (() => {
  /** An SVG beats any bitmap: it is sharp at every size. */
  const SVG_SCORE = 1024;
  /** Below this it is a tracking pixel or a broken placeholder, not a logo. */
  const MIN_SIZE = 16;
  /** Good enough to stop probing the remaining waves. */
  const GOOD_SIZE = 128;

  const PROBE_TIMEOUT = 6000;
  const FETCH_TIMEOUT = 8000;
  const TTL_HIT = 30 * 24 * 60 * 60 * 1000;
  const TTL_MISS = 3 * 24 * 60 * 60 * 1000;
  const MAX_DEEP_CANDIDATES = 10;
  const MAX_PARALLEL_ORIGINS = 4;

  /** Conventional locations, grouped so we stop early when a wave pays off. */
  const WAVES = [
    ['/favicon.svg', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'],
    ['/android-chrome-512x512.png', '/android-chrome-192x192.png',
     '/apple-touch-icon-180x180.png', '/icon.svg'],
    ['/favicon-196x196.png', '/favicon-192x192.png', '/favicon-96x96.png',
     '/favicon-32x32.png', '/favicon.png', '/favicon.ico']
  ];

  const ICON_RELS = [
    'icon', 'shortcut', 'apple-touch-icon', 'apple-touch-icon-precomposed',
    'mask-icon', 'fluid-icon'
  ];

  // ------------------------------------------------------------------ probing

  function isSvg(url) {
    return /\.svg(\?|#|$)/i.test(url);
  }

  /** Loads a candidate and reports its real pixel size, or null if unusable. */
  function probe(url) {
    return new Promise(resolve => {
      const img = new Image();
      let settled = false;

      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        img.onload = img.onerror = null;
        resolve(result);
      };

      const timer = setTimeout(() => {
        img.src = '';
        finish(null);
      }, PROBE_TIMEOUT);

      img.onload = () => {
        // Firefox reports 0 for an SVG with no intrinsic size - still perfect.
        const size = isSvg(url)
          ? SVG_SCORE
          : Math.max(img.naturalWidth, img.naturalHeight);
        finish(size >= MIN_SIZE ? { url, size } : null);
      };
      img.onerror = () => finish(null);

      img.referrerPolicy = 'no-referrer';
      img.src = url;
    });
  }

  function best(results) {
    return results
      .filter(Boolean)
      .sort((a, b) => b.size - a.size)[0] || null;
  }

  async function probeConventions(origin) {
    let found = null;
    for (const wave of WAVES) {
      const winner = best(await Promise.all(wave.map(path => probe(origin + path))));
      if (winner && (!found || winner.size > found.size)) found = winner;
      if (found && found.size >= GOOD_SIZE) break;
    }
    return found;
  }

  // -------------------------------------------------------------- deep lookup

  /** "192x192" or "any" -> a rough score used only to order candidates. */
  function sizesHint(value) {
    if (!value) return 0;
    if (/any/i.test(value)) return SVG_SCORE;
    return value.split(/\s+/)
      .map(part => parseInt(part, 10))
      .filter(Number.isFinite)
      .reduce((max, n) => Math.max(max, n), 0);
  }

  async function fetchText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, {
        credentials: 'omit',
        redirect: 'follow',
        signal: controller.signal
      });
      if (!res.ok) return null;
      return { text: await res.text(), url: res.url || url };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Icons declared in the page markup and in the site's web manifest. */
  async function candidatesFromSite(pageUrl) {
    const page = await fetchText(pageUrl);
    if (!page) return [];

    const doc = new DOMParser().parseFromString(page.text, 'text/html');
    const found = [];

    doc.querySelectorAll('link[rel][href]').forEach(link => {
      const rels = (link.getAttribute('rel') || '').toLowerCase().split(/\s+/);
      if (!rels.some(rel => ICON_RELS.includes(rel))) return;
      try {
        found.push({
          url: new URL(link.getAttribute('href'), page.url).href,
          hint: sizesHint(link.getAttribute('sizes'))
        });
      } catch { /* malformed href */ }
    });

    const manifestLink = doc.querySelector('link[rel~="manifest"][href]');
    if (manifestLink) {
      try {
        const manifestUrl = new URL(manifestLink.getAttribute('href'), page.url).href;
        const manifest = await fetchText(manifestUrl);
        const icons = manifest ? (JSON.parse(manifest.text).icons || []) : [];
        icons.forEach(icon => {
          if (!icon || !icon.src) return;
          try {
            found.push({
              url: new URL(icon.src, manifestUrl).href,
              hint: sizesHint(icon.sizes)
            });
          } catch { /* malformed src */ }
        });
      } catch { /* manifest missing or not JSON */ }
    }

    const seen = new Set();
    return found
      .filter(c => (seen.has(c.url) ? false : seen.add(c.url)))
      .sort((a, b) => b.hint - a.hint)
      .slice(0, MAX_DEEP_CANDIDATES);
  }

  // -------------------------------------------------------------- permissions

  const perms = (typeof browser !== 'undefined' && browser.permissions)
    || (typeof chrome !== 'undefined' && chrome.permissions)
    || null;

  const ALL_SITES = { origins: ['http://*/*', 'https://*/*'] };

  async function hasSiteAccess() {
    if (!perms) return false;
    try {
      return await perms.contains(ALL_SITES);
    } catch {
      return false;
    }
  }

  /**
   * Asks for access to all sites. Firefox only allows this while it is handling
   * user input, so it must be reached synchronously from a click - see the
   * `gesture` flag in schema.js.
   *
   * A rejected promise and a `false` result mean very different things (the API
   * refused to ask vs. the user said no), so both are reported.
   *
   * @returns {Promise<{granted: boolean, error?: string}>}
   */
  async function requestSiteAccess() {
    if (!perms) return { granted: false, error: 'Permissions API unavailable.' };
    try {
      return { granted: await perms.request(ALL_SITES) };
    } catch (err) {
      return { granted: false, error: err && err.message ? err.message : String(err) };
    }
  }

  /** Fires with the new access state when it changes anywhere in Firefox. */
  function onAccessChange(handler) {
    if (!perms) return;
    const report = () => hasSiteAccess().then(handler);
    if (perms.onAdded) perms.onAdded.addListener(report);
    if (perms.onRemoved) perms.onRemoved.addListener(report);
  }

  async function dropSiteAccess() {
    if (!perms) return;
    try {
      await perms.remove(ALL_SITES);
    } catch { /* nothing granted */ }
  }

  // ------------------------------------------------------------------ queue

  let active = 0;
  const waiting = [];

  function schedule(task) {
    return new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });
      pump();
    });
  }

  function pump() {
    while (active < MAX_PARALLEL_ORIGINS && waiting.length) {
      const { task, resolve, reject } = waiting.shift();
      active++;
      task().then(resolve, reject).finally(() => {
        active--;
        pump();
      });
    }
  }

  // ----------------------------------------------------------------- resolve

  const inFlight = new Map();

  async function lookup(pageUrl, origin, deep) {
    let winner = null;

    if (deep && await hasSiteAccess()) {
      const candidates = await candidatesFromSite(pageUrl);
      if (candidates.length) {
        winner = best(await Promise.all(candidates.map(c => probe(c.url))));
      }
    }

    if (!winner || winner.size < GOOD_SIZE) {
      const guessed = await probeConventions(origin);
      if (guessed && (!winner || guessed.size > winner.size)) winner = guessed;
    }

    return winner;
  }

  /**
   * Resolves the best icon for a site.
   * @param {string} pageUrl the tile's URL
   * @param {{deep?: boolean, force?: boolean}} [opts]
   * @returns {Promise<{url:string,size:number}|null>}
   */
  async function resolve(pageUrl, opts = {}) {
    let origin;
    try {
      origin = new URL(pageUrl).origin;
    } catch {
      return null;
    }

    const mode = opts.deep ? 'deep' : 'basic';

    if (!opts.force) {
      const cached = await Store.icons.get(origin);
      if (cached) {
        const ttl = cached.url ? TTL_HIT : TTL_MISS;
        const fresh = Date.now() - (cached.savedAt || 0) < ttl;
        // A basic result is worth redoing once deep lookup is available.
        const goodEnough = cached.mode === mode || cached.mode === 'deep';
        if (fresh && goodEnough) {
          return cached.url ? { url: cached.url, size: cached.size } : null;
        }
      }
    }

    if (inFlight.has(origin)) return inFlight.get(origin);

    const job = schedule(() => lookup(pageUrl, origin, opts.deep))
      .then(async winner => {
        await Store.icons.put(origin, {
          url: winner ? winner.url : null,
          size: winner ? winner.size : 0,
          mode
        });
        return winner;
      })
      .catch(() => null)
      .finally(() => inFlight.delete(origin));

    inFlight.set(origin, job);
    return job;
  }

  return {
    resolve,
    clearCache: () => Store.icons.clear(),
    hasSiteAccess,
    requestSiteAccess,
    dropSiteAccess,
    onAccessChange,
    supportsPermissions: Boolean(perms)
  };
})();
