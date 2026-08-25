/**
 * Page background support: a picture from a local file or from Unsplash.
 *
 * The picture lives under its own storage key rather than inside `settings`,
 * because it is orders of magnitude larger than everything else there and
 * settings are rewritten on every slider drag. Local files are downscaled and
 * re-encoded before they are stored, so a 12 MP phone photo does not have to
 * fit in extension storage at full size.
 *
 * Unsplash needs an access key, which the user supplies in settings - there is
 * no key to ship in an add-on. Their API guidelines are honoured: the download
 * endpoint is pinged when a photo is chosen, and the photographer is credited
 * on the page with UTM-tagged links back.
 */
const Backgrounds = (() => {
  const API = 'https://api.unsplash.com';
  const UTM = 'utm_source=Tiles&utm_medium=referral';

  /** Longest edge kept when a picture is re-encoded. */
  const MAX_DIM = 2560;
  /** Files at or under this are stored byte for byte (keeps SVG and GIF whole). */
  const DIRECT_LIMIT = 800 * 1024;
  /** Above this a picture is re-encoded even when it already fits MAX_DIM. */
  const REENCODE_ABOVE = 2 * 1024 * 1024;
  /** Refused beyond this, so one background cannot fill the storage area. */
  const MAX_STORED = 6 * 1024 * 1024;
  const JPEG_QUALITY = 0.82;

  // ------------------------------------------------------------- encoding

  function readAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('That file could not be read.'));
      reader.readAsDataURL(blob);
    });
  }

  /** Down to MAX_DIM as a JPEG, or null when the original is fine as it is. */
  async function recompress(blob) {
    const bitmap = await createImageBitmap(blob);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, MAX_DIM / longest);

    if (scale === 1 && blob.size <= REENCODE_ABOVE) {
      bitmap.close();
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  }

  /**
   * @returns {Promise<string>} a data: URI small enough to store
   * @throws {Error} with a message fit to show the user
   */
  async function encode(blob) {
    if (!blob || !/^image\//.test(blob.type || '')) {
      throw new Error('That is not an image file.');
    }
    if (blob.size <= DIRECT_LIMIT) return readAsDataUrl(blob);

    let src = null;
    try {
      src = await recompress(blob);
    } catch {
      // Formats createImageBitmap will not decode (some SVGs) fall through.
    }
    if (!src) src = await readAsDataUrl(blob);

    if (src.length > MAX_STORED) {
      throw new Error('That image is too large to store, even shrunk down.');
    }
    return src;
  }

  // -------------------------------------------------------------- unsplash

  /**
   * The key goes in the query string rather than an Authorization header: that
   * keeps the call a simple CORS request, so it needs neither a preflight nor
   * a host permission.
   */
  async function api(path, key, params) {
    const url = new URL(API + path);
    Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set('client_id', key);

    let res;
    try {
      res = await fetch(url.href, { credentials: 'omit' });
    } catch {
      throw new Error('Could not reach Unsplash.');
    }

    if (res.status === 401) throw new Error('Unsplash rejected that access key.');
    if (res.status === 403) throw new Error('Unsplash hourly limit reached - try again later.');
    if (!res.ok) throw new Error(`Unsplash replied ${res.status}.`);
    return res.json();
  }

  function tagged(link) {
    if (typeof link !== 'string' || !link) return '';
    return link + (link.includes('?') ? '&' : '?') + UTM;
  }

  /** Asks imgix for something the size of this screen, not the full 6000px. */
  function sizedUrl(raw) {
    const width = Math.min(MAX_DIM, Math.round(
      (window.screen.width || 1920) * (window.devicePixelRatio || 1)
    ));
    return `${raw}${raw.includes('?') ? '&' : '?'}fm=jpg&q=80&fit=max&w=${width}`;
  }

  function toPhoto(p) {
    return {
      id: p.id,
      thumb: p.urls.small,
      full: sizedUrl(p.urls.raw),
      alt: p.alt_description || p.description || 'Unsplash photo',
      downloadLocation: (p.links && p.links.download_location) || '',
      credit: {
        name: (p.user && p.user.name) || 'Unknown',
        userUrl: tagged(p.user && p.user.links && p.user.links.html),
        photoUrl: tagged(p.links && p.links.html)
      }
    };
  }

  /**
   * @returns {Promise<object[]>} matching photos, flattened to what the UI needs
   * @throws {Error} with a message fit to show the user
   */
  async function search(query, key) {
    const q = (query || '').trim();
    if (!q) return [];
    if (!(key || '').trim()) {
      throw new Error('Add your Unsplash access key below, then search again.');
    }

    const data = await api('/search/photos', key.trim(), {
      query: q,
      per_page: 12,
      orientation: 'landscape',
      content_filter: 'high'
    });
    return (data.results || []).map(toPhoto);
  }

  /** Unsplash asks for this whenever a photo is actually put to use. */
  function pingDownload(photo, key) {
    const id = (key || '').trim();
    if (!photo.downloadLocation || !id) return;
    const sep = photo.downloadLocation.includes('?') ? '&' : '?';
    fetch(`${photo.downloadLocation}${sep}client_id=${encodeURIComponent(id)}`, {
      credentials: 'omit'
    }).catch(() => {});
  }

  // --------------------------------------------------------------- records

  async function fromFile(file) {
    return {
      kind: 'local',
      src: await encode(file),
      name: (file.name || 'Image').slice(0, 80),
      credit: null
    };
  }

  async function fromPhoto(photo, key) {
    pingDownload(photo, key);

    // Stored as data so the new tab paints offline and asks nobody's CDN on
    // every open. If the image host refuses the read, keep the URL instead.
    let src;
    try {
      const res = await fetch(photo.full, { credentials: 'omit' });
      if (!res.ok) throw new Error(String(res.status));
      src = await encode(await res.blob());
    } catch {
      src = photo.full;
    }

    return { kind: 'unsplash', src, name: photo.alt.slice(0, 80), credit: photo.credit };
  }

  // -------------------------------------------------------------- painting

  function cssUrl(src) {
    return `url("${src.replace(/[\\"]/g, '\\$&')}")`;
  }

  function paintCredit(el, record) {
    el.textContent = '';
    const credit = record && record.credit;
    if (!credit || !credit.name) {
      el.hidden = true;
      return;
    }

    const link = (href, text) => {
      const a = document.createElement('a');
      a.href = href || 'https://unsplash.com/?' + UTM;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = text;
      return a;
    };

    el.append(
      Icons.create('camera', { size: 13 }),
      document.createTextNode('Photo by '),
      link(credit.userUrl, credit.name),
      document.createTextNode(' on '),
      link(credit.photoUrl, 'Unsplash')
    );
    el.hidden = false;
  }

  /** Puts `record` on screen, or takes the picture away when it is null. */
  function apply(record) {
    const layer = document.getElementById('bg');
    const image = document.getElementById('bgImage');
    const credit = document.getElementById('bgCredit');
    if (!layer || !image) return;

    const on = Boolean(record && record.src);
    layer.hidden = !on;
    document.body.classList.toggle('has-bg', on);
    image.style.backgroundImage = on ? cssUrl(record.src) : '';
    if (credit) paintCredit(credit, on ? record : null);
  }

  // --------------------------------------------------------------- storage

  const load = () => Store.loadBackground();

  async function save(record) {
    try {
      return await Store.saveBackground(record);
    } catch {
      throw new Error('There was no room left to store that image.');
    }
  }

  const clear = () => Store.clearBackground();

  return { search, fromFile, fromPhoto, apply, load, save, clear };
})();
