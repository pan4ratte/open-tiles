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
 *      case costs four requests, not fifteen.
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
  /**
   * Good enough to stop probing the remaining waves.
   *
   * A tile's logo is at most about 172 CSS pixels across - a 200px tile less
   * its inset - which is 344 real ones on a 2x screen. Stopping at an icon
   * smaller than that is stopping too early: the site may well publish a
   * larger one a wave further down, and settling for a 128px apple-touch-icon
   * is most of why tiles used to look soft.
   */
  const GOOD_SIZE = 256;

  /**
   * Bumped whenever a change here would produce a better result than a cached
   * entry holds. Entries stamped with an older revision are looked up again
   * rather than served for the rest of their month - otherwise a sharper
   * lookup only reaches anyone who has never visited the site before.
   */
  const REV = 2;

  const PROBE_TIMEOUT = 6000;
  const FETCH_TIMEOUT = 8000;
  const TTL_HIT = 30 * 24 * 60 * 60 * 1000;
  const TTL_MISS = 3 * 24 * 60 * 60 * 1000;
  const MAX_DEEP_CANDIDATES = 10;
  const MAX_PARALLEL_ORIGINS = 4;

  /**
   * A kept picture, as a data: URI, may be this long and no longer.
   *
   * Going over is not a failure: the picture is simply not kept, and the tile
   * loads the address as an <img> instead - at whatever size the site
   * published, which is if anything sharper. What is lost is only the instant
   * appearance on the next new tab.
   */
  const KEEP_MAX = 40 * 1024;
  /** Under this the file is kept byte for byte, at whatever size it came. */
  const KEEP_DIRECT = 24 * 1024;
  /** Anything larger is not downloaded to be kept: it is a picture, not a logo. */
  const KEEP_SOURCE_MAX = 2 * 1024 * 1024;
  /**
   * What a bitmap too large to keep whole is redrawn at.
   *
   * Enough for the largest logo a tile can draw on a 2x screen - see
   * GOOD_SIZE. It used to be 192, which is under half of that, so every icon
   * big enough to be worth keeping was thrown away down to blurry and then
   * kept in that state for a month.
   */
  const KEEP_DIM = 384;

  /**
   * Conventional locations, grouped so we stop early when a wave pays off.
   *
   * Ordered by what each is usually worth rather than by how common it is: the
   * first wave is the vectors and the two large bitmaps nearly every site with
   * a modern icon set publishes, so the common case now costs four requests
   * and comes back with something worth having. The last wave is the small
   * ones, which are the floor rather than the aim.
   */
  const WAVES = [
    ['/favicon.svg', '/icon.svg', '/apple-touch-icon.png',
     '/android-chrome-512x512.png'],
    ['/apple-touch-icon-precomposed.png', '/apple-touch-icon-180x180.png',
     '/android-chrome-192x192.png', '/icon-512x512.png', '/icon-192x192.png'],
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
        const vector = isSvg(url);
        const size = vector ? SVG_SCORE : Math.max(img.naturalWidth, img.naturalHeight);
        finish(size >= MIN_SIZE ? { url, size, vector } : null);
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

  /**
   * `fresh` asks the network rather than the browser's own cache.
   *
   * Only a forced lookup sets it. Without it, looking an icon up again right
   * after a site changed one reads the same page out of the HTTP cache and
   * finds the same icon, which looks exactly like the button doing nothing.
   */
  async function fetchText(url, fresh) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, {
        credentials: 'omit',
        redirect: 'follow',
        cache: fresh ? 'reload' : 'default',
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
  async function candidatesFromSite(pageUrl, fresh) {
    const page = await fetchText(pageUrl, fresh);
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

    // Windows tiles. Often the largest square logo a site publishes anywhere,
    // and it is declared nowhere else.
    doc.querySelectorAll('meta[name][content]').forEach(meta => {
      const name = (meta.getAttribute('name') || '').toLowerCase();
      const square = name.match(/^msapplication-square(\d+)x\d+logo$/);
      if (name !== 'msapplication-tileimage' && !square) return;
      try {
        found.push({
          url: new URL(meta.getAttribute('content'), page.url).href,
          hint: square ? parseInt(square[1], 10) : 0
        });
      } catch { /* malformed content */ }
    });

    const manifestLink = doc.querySelector('link[rel~="manifest"][href]');
    if (manifestLink) {
      try {
        const manifestUrl = new URL(manifestLink.getAttribute('href'), page.url).href;
        const manifest = await fetchText(manifestUrl, fresh);
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
  async function fetchBlob(url, fresh) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, {
        credentials: 'omit',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        cache: fresh ? 'reload' : 'default',
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
  async function keep(url, fresh) {
    try {
      if (/^data:/i.test(url)) return within(url);

      const blob = await fetchBlob(url, fresh);
      if (!blob) return null;

      // Small already: kept exactly as it came, at whatever size it came.
      if (blob.size <= KEEP_DIRECT) return within(await readAsDataUrl(blob));

      // A vector is never redrawn to fit. Rasterizing it would throw away the
      // one thing that makes it worth having, and a 30 KB SVG kept as a 384px
      // bitmap is worse than the same SVG not kept at all - which is what
      // happens instead when it will not fit: the tile loads the address, and
      // draws it as the vector it is.
      if (/^image\/svg/i.test(blob.type || '') || isSvg(url)) {
        return within(await readAsDataUrl(blob));
      }

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

  async function lookup(pageUrl, origin, deep, fresh) {
    let winner = null;

    if (deep && await hasSiteAccess()) {
      const candidates = await candidatesFromSite(pageUrl, fresh);
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
  const fromCache = entry => (entry && entry.url
    ? { url: entry.data || entry.url, size: entry.size, vector: Boolean(entry.vector) }
    : null);

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
   * @param {{deep?: boolean, force?: boolean}} [opts] `force` looks the icon up
   *   again from scratch: past the cache here, and past the browser's own for
   *   everything it fetches. Probing is still left to the browser's cache -
   *   the address a probe wins with is the one that gets stored, so it cannot
   *   carry a cache-busting parameter around with it.
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
        const fresh = Date.now() - (cached.savedAt || 0) < ttl
          // Found by a build that would do better now - see REV.
          && cached.rev === REV;
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
      const winner = await lookup(pageUrl, origin, opts.deep, opts.force);
      return {
        url: winner ? winner.url : null,
        data: winner ? await keep(winner.url, opts.force) : null,
        size: winner ? winner.size : 0,
        vector: Boolean(winner && winner.vector),
        mode,
        rev: REV
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

  // --------------------------------------------------------- pasted SVG code

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Room for a hand-drawn logo, and well short of the 256 KB at which storage
   *  drops a tile's icon without a word - a refusal here can say why. */
  const OWN_SVG_MAX = 128 * 1024;

  /** Elements that do something rather than draw something. */
  const SVG_RUNNING = new Set(['script', 'foreignobject', 'iframe', 'embed', 'object']);

  /**
   * SVG source, as opposed to an address, a data URI or a stray tag.
   *
   * Kept deliberately cheap and certain: it is asked on every paste into the
   * sheet, and anything it says yes to is taken out of the field it was
   * dropped in. A leading prolog, doctype or comment is ordinary in a file
   * saved by a drawing program.
   */
  function looksLikeSvg(text) {
    return /^\s*(?:<\?xml[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!doctype[^>]*>\s*)*<svg[\s>]/i
      .test(String(text || ''));
  }

  /**
   * Reads SVG source, strictly first and forgivingly second.
   *
   * Markup copied out of a running page is often not well-formed XML - an
   * unclosed tag, a bare attribute, an HTML entity - and the XML parser
   * refuses the lot. The HTML parser takes what the XML one will not, and it
   * is the same parser that read the page the markup was copied from, so it
   * fails in the same places.
   */
  function parseSvg(text) {
    const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = xml.documentElement;
    if (root && root.localName === 'svg' && !xml.querySelector('parsererror')) return root;

    return new DOMParser().parseFromString(text, 'text/html').body.querySelector('svg');
  }

  /**
   * Takes the running parts out of an SVG.
   *
   * An <img> is already a sealed room: the browser runs no script in an SVG
   * loaded that way and fetches nothing the picture refers to, and that - not
   * this - is what makes a pasted logo safe to draw. This is for afterwards.
   * The source is kept in storage and handed back out in a backup file, so it
   * should carry nothing that would run if it ever landed somewhere less
   * careful than an <img>.
   */
  function scrubSvg(root) {
    const doomed = [];

    (function walk(el) {
      if (SVG_RUNNING.has(el.localName.toLowerCase())) {
        doomed.push(el);
        return;
      }

      Array.from(el.attributes).forEach(attr => {
        const name = attr.name.toLowerCase();
        // onclick, onload and the rest of them.
        if (name.startsWith('on')) el.removeAttribute(attr.name);
        // And a link that runs instead of pointing.
        else if (/(^|:)(href|src)$/.test(name) && /^\s*javascript:/i.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      });

      Array.from(el.children).forEach(walk);
    })(root);

    doomed.forEach(el => el.remove());
  }

  /**
   * Turns pasted SVG source into a picture a tile can draw.
   *
   * Two things are put right on the way through, because both are ordinary in
   * copied markup and both fail silently - the tile simply shows its letter
   * and nothing says why:
   *
   *   - no xmlns. An <img> draws nothing at all for an SVG that does not name
   *     its namespace, and markup lifted out of a page's DOM arrives without
   *     one, because the page had already established it.
   *   - no viewBox. Then the picture has a fixed size rather than a shape, and
   *     a tile scales its logo to whatever the tile size is. Width and height,
   *     where they were given, say what the shape was meant to be.
   */
  function fromSvg(source) {
    const text = String(source || '').trim();
    if (!looksLikeSvg(text)) throw new Error('That does not look like SVG code.');

    const svg = parseSvg(text);
    if (!svg) throw new Error('That SVG could not be read — it may be incomplete.');

    scrubSvg(svg);

    if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', SVG_NS);

    if (!svg.getAttribute('viewBox')) {
      const width = parseFloat(svg.getAttribute('width'));
      const height = parseFloat(svg.getAttribute('height'));
      if (width > 0 && height > 0) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    // Percent-encoded rather than base64: it carries UTF-8 without any dance,
    // and it leaves the picture readable in a backup file.
    const uri = 'data:image/svg+xml,'
      + encodeURIComponent(new XMLSerializer().serializeToString(svg));

    if (uri.length > OWN_SVG_MAX) {
      throw new Error('That SVG is too long to keep on a tile — try a simpler one.');
    }

    return uri;
  }

  return {
    resolve,
    fromFile,
    fromSvg,
    looksLikeSvg,
    clearCache: () => Store.icons.clear(),
    hasSiteAccess,
    requestSiteAccess,
    dropSiteAccess,
    onAccessChange,
    supportsPermissions: Boolean(perms)
  };
})();
