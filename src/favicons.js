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
 * that really is the largest, not the one whose filename claims to be.
 *
 * The winner is cached per origin, and where the host allows it the picture
 * itself is kept alongside the address, as a data: URI. That is what makes a
 * tile instant on the next new tab: an address has to be fetched again every
 * time, and a hard reload goes past the browser's own cache to do it, whereas
 * bytes already in storage are simply drawn.
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

  /** A kept picture, as a data: URI, may be this long and no longer. */
  const KEEP_MAX = 20 * 1024;
  /** Under this the file is kept byte for byte, which keeps an SVG a vector. */
  const KEEP_DIRECT = 13 * 1024;
  /** Anything larger is not downloaded to be kept: it is a picture, not a logo. */
  const KEEP_SOURCE_MAX = 2 * 1024 * 1024;
  /** What a picture too large to keep whole is redrawn at before keeping. */
  const KEEP_DIM = 192;

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

  // --------------------------------------------------- keeping the picture

  /** A data: URI worth storing, or null when it came out too long to keep. */
  const within = data => (data && data.length <= KEEP_MAX ? data : null);

  /** The icon's bytes, or null where the host would not hand them over. */
  async function fetchBlob(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, {
        credentials: 'omit',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      });
      if (!res.ok) return null;

      const blob = await res.blob();
      const usable = blob.size > 0 && blob.size <= KEEP_SOURCE_MAX
        && /^image\//.test(blob.type || '');
      return usable ? blob : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Downloads a resolved icon and returns it as a data: URI, or null.
   *
   * Reading an icon's bytes cross-origin needs the host's consent, which most
   * icon hosts give and some do not. Where it is refused - or the picture is
   * too big to be worth the room - this gives up quietly and the tile goes on
   * loading the address as an <img>, which needs no consent. The icon still
   * shows either way; what is lost is only its instant appearance next time.
   *
   * Never throws: a tile whose picture could not be kept is not a tile that
   * failed to resolve.
   */
  async function keep(url) {
    try {
      if (/^data:/i.test(url)) return within(url);

      const blob = await fetchBlob(url);
      if (!blob) return null;

      // Small already: kept exactly as it came, so an SVG stays a vector and
      // stays sharp on the largest tile the settings allow.
      if (blob.size <= KEEP_DIRECT) return within(await readAsDataUrl(blob));

      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, KEEP_DIM / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      // WebP carries a logo's flat colour and its transparency in a fraction
      // of what PNG takes. A browser that will not write one says so by
      // handing back a PNG data URI instead, which is the fallback already.
      const webp = canvas.toDataURL('image/webp', 0.92);
      return within(/^data:image\/webp/i.test(webp) ? webp : canvas.toDataURL('image/png'));
    } catch {
      return null;
    }
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

  /** What a cache entry hands back: the kept picture when there is one. */
  const fromCache = entry =>
    (entry && entry.url ? { url: entry.data || entry.url, size: entry.size } : null);

  /**
   * Fetches the picture for an entry that was cached before the bytes were
   * being kept, or by a run where the host refused them.
   *
   * `data` is left as null on a refusal rather than absent, so an origin that
   * will not hand its icon over is asked once and not on every new tab after.
   */
  function backfill(origin, cached) {
    // Through the same queue as a lookup: a page of cached tiles would
    // otherwise open one download per tile at once, on the first frame.
    schedule(() => keep(cached.url)).then(data => {
      Store.icons.put(origin, { ...cached, data }).catch(() => {});
    });
  }

  /**
   * Resolves the best icon for a site.
   *
   * The returned `url` is the kept picture where there is one - a data: URI
   * the tile can draw without going anywhere - and the address it was found
   * at otherwise. Callers do not need to know which.
   *
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
          if (cached.url && cached.data === undefined) backfill(origin, cached);
          return fromCache(cached);
        }
      }
    }

    if (inFlight.has(origin)) return inFlight.get(origin);

    // Finding the icon and fetching it to keep both go through the queue as
    // one piece of work, so a page full of new tiles cannot open more
    // connections than the limit allows by doing the second half outside it.
    const job = schedule(async () => {
      const winner = await lookup(pageUrl, origin, opts.deep);
      return {
        url: winner ? winner.url : null,
        data: winner ? await keep(winner.url) : null,
        size: winner ? winner.size : 0,
        mode
      };
    })
      .then(async entry => {
        await Store.icons.put(origin, entry);
        return fromCache(entry);
      })
      .catch(() => null)
      .finally(() => inFlight.delete(origin));

    inFlight.set(origin, job);
    return job;
  }

  // ------------------------------------------------- an icon from a file

  /** As wide as a tile's logo ever needs to be, on the densest screen. */
  const OWN_ICON_DIM = 256;
  /** Files at or under this are kept byte for byte, which keeps SVGs whole. */
  const OWN_ICON_DIRECT = 32 * 1024;
  /** Refused outright: an icon is not a photograph. */
  const OWN_ICON_MAX = 4 * 1024 * 1024;

  function readAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('That file could not be read.'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Turns a picked file into a data: URI small enough to sit on a tile record.
   *
   * Kept square and transparent - PNG, not JPEG - because a logo on a tile is
   * drawn over whatever the tile's background is, and a white box around it
   * would show. The picture is fitted inside the square rather than cropped to
   * it, so a wide wordmark keeps its ends.
   *
   * @returns {Promise<string>} a data: URI
   * @throws {Error} with a message fit to show the user
   */
  async function fromFile(blob) {
    if (!blob || !/^image\//.test(blob.type || '')) {
      throw new Error('That is not an image file.');
    }
    if (blob.size > OWN_ICON_MAX) {
      throw new Error('That picture is too large for an icon — pick a smaller one.');
    }
    if (blob.size <= OWN_ICON_DIRECT) return readAsDataUrl(blob);

    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      // A format the browser will not decode (some SVGs) is stored as it came.
      return readAsDataUrl(blob);
    }

    const scale = Math.min(1, OWN_ICON_DIM / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return canvas.toDataURL('image/png');
  }

  return {
    resolve,
    fromFile,
    clearCache: () => Store.icons.clear(),
    hasSiteAccess,
    requestSiteAccess,
    dropSiteAccess,
    onAccessChange,
    supportsPermissions: Boolean(perms)
  };
})();
