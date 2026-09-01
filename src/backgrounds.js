/**
 * Page background support: a picture or a video, from a file on this computer
 * or named by web address.
 *
 * The background lives under its own storage key rather than inside
 * `settings`, because it is orders of magnitude larger than everything else
 * there and settings are rewritten on every slider drag. Pictures are
 * downscaled and re-encoded before they are stored, so a 12 MP phone photo
 * does not have to fit in extension storage at full size.
 *
 * A video gets none of that: nothing here can shorten one or re-encode it, so
 * the only lever is the ceiling on what will be taken at all - which is why it
 * is higher than the one for pictures, and why it still refuses on the spot.
 * Anything over either limit comes back with a message naming both the size of
 * the file and the limit; shrinking a 40 MB picture would take long enough to
 * look broken, and the result would not fit anyway.
 *
 * Every record carries a `type`, 'image' or 'video', because the two are put
 * on screen by different elements - see `apply`.
 */
const Backgrounds = (() => {
  const t = I18N.t;

  /** Longest edge kept when a picture is re-encoded. */
  const MAX_DIM = 2560;
  /** Files at or under this are stored byte for byte (keeps SVG and GIF whole). */
  const DIRECT_LIMIT = 800 * 1024;
  /** Above this a picture is re-encoded even when it already fits MAX_DIM. */
  const REENCODE_ABOVE = 2 * 1024 * 1024;
  /** The upload ceiling: bigger files are refused before anything is read. */
  const MAX_FILE = 6 * 1024 * 1024;
  /**
   * The same, for a video. Higher, because a picture over its limit is one
   * that was going to be scaled down anyway, where a video over this is simply
   * not taken - and a wallpaper loop worth having runs to a few megabytes.
   */
  const MAX_VIDEO_FILE = 16 * 1024 * 1024;
  /** Refused beyond this, so one background cannot fill the storage area. */
  const MAX_STORED = 6 * 1024 * 1024;
  const JPEG_QUALITY = 0.82;

  // ---------------------------------------------------- the wallpapers it ships with

  /** Where the packaged pictures sit, relative to the add-on's root. */
  const GALLERY_DIR = 'backgrounds/';

  /**
   * The photographs that come with the add-on: six, each named for the
   * photographer who took it. That name is what the picker shows, and the
   * README credits the same six by it - who took which, and the licence they
   * were published under.
   *
   * They are held as paths rather than as pictures. A chosen wallpaper is
   * stored as a data: URI because the file it came from is not the add-on's to
   * keep; one of these is already inside the add-on, so storing it would be
   * keeping a second copy of a file that cannot go missing - a megabyte of the
   * storage area to say "the one on the left". The path also travels: a backup
   * taken here and read back on another computer finds the picture again,
   * where a moz-extension:// address - whose host is a different UUID on every
   * install - would find nothing.
   */
  const GALLERY = [
    { file: 'adrien-olichon.jpg', name: 'Adrien Olichon' },
    { file: 'felix-besombes.jpg', name: 'Felix Besombes' },
    { file: 'jason-mavrommatis.jpg', name: 'Jason Mavrommatis' },
    { file: 'julien-riedel.jpg', name: 'Julien Riedel' },
    { file: 'milad-fakurian.jpg', name: 'Milad Fakurian' },
    { file: 'susk-i.jpg', name: 'Susk _i' }
  ];

  /** The one a page that has never had a background of its own comes up with. */
  const DEFAULT_WALLPAPER = 'adrien-olichon.jpg';

  /** Whether a record's `src` names one of the packaged pictures. */
  const isBundled = src =>
    typeof src === 'string' && src.startsWith(GALLERY_DIR);

  /**
   * A packaged picture's path turned into an address the page can load.
   *
   * `runtime.getURL` is the real answer - it names the add-on's own origin,
   * which is where the file actually is. Off disk there is no such origin to
   * ask for: `src/newtab.html` opened straight from the folder is how the
   * interface is worked on (see CONTRIBUTING.md), and from there the pictures
   * sit one level up. Anything that is not one of ours is handed back
   * untouched, so this can sit in front of every src without asking first.
   */
  function resolve(src) {
    if (!isBundled(src)) return src;

    const ext = (typeof browser !== 'undefined' && browser.runtime)
      || (typeof chrome !== 'undefined' && chrome.runtime)
      || null;

    return ext && typeof ext.getURL === 'function' ? ext.getURL(src) : '../' + src;
  }

  /**
   * A record's address, packaged or not.
   *
   * Named, because the frost is cut inside a `new Promise`, and in there
   * `resolve` is the promise's own - so the picture's address has to be asked
   * for by a name that is not taken.
   */
  const srcOf = record => (record && record.src ? resolve(record.src) : '');

  /** The record for a packaged picture, or null where nothing is named that. */
  function galleryRecord(file) {
    const found = GALLERY.find(one => one.file === file);
    return found
      ? { src: GALLERY_DIR + found.file, name: found.name, type: 'image' }
      : null;
  }

  /** All of them, in the order the picker shows them. */
  const gallery = () => GALLERY.map(one => galleryRecord(one.file));

  // ------------------------------------------------------------- encoding

  /** "6 MB", "12.4 MB", "820 KB" - enough precision to explain a refusal. */
  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    const mb = bytes / (1024 * 1024);
    // A tenth of a megabyte is as fine as this needs to be, and "6 MB" reads
    // better than "6.0 MB" when the number lands square.
    return (mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)) + ' MB';
  }

  function readAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(t('bg_fileUnreadable')));
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
  async function encodeImage(blob) {
    if (blob.size > MAX_FILE) {
      throw new Error(
        t('bg_pictureTooBig', formatSize(blob.size), formatSize(MAX_FILE)));
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
      throw new Error(t('bg_pictureNoRoom'));
    }
    return src;
  }

  /**
   * A video, stored whole.
   *
   * It is opened once before it is accepted: a container this browser cannot
   * decode - a .mov full of ProRes, say - would otherwise be taken happily and
   * then turn up as a black page with nothing to explain it.
   */
  async function encodeVideo(blob) {
    if (blob.size > MAX_VIDEO_FILE) {
      throw new Error(
        t('bg_videoTooBig', formatSize(blob.size), formatSize(MAX_VIDEO_FILE)));
    }

    const url = URL.createObjectURL(blob);
    try {
      await probeVideo(url);
    } catch {
      throw new Error(t('bg_videoUnplayable'));
    } finally {
      URL.revokeObjectURL(url);
    }

    return readAsDataUrl(blob);
  }

  // -------------------------------------------------------------- probing

  /** How long to wait for something to prove it is a picture or a video. */
  const PROBE_TIMEOUT = 10000;

  /** Marked, so a refusal can tell "no answer" from "answered with rubbish". */
  function timeout() {
    const err = new Error(t('bg_slowAddress'));
    err.timeout = true;
    return err;
  }

  /** Resolves when `src` loads as a still picture. */
  function probeImage(src) {
    return new Promise((resolve, reject) => {
      const probe = new Image();
      const timer = setTimeout(() => {
        probe.src = '';
        reject(timeout());
      }, PROBE_TIMEOUT);

      probe.onload = () => { clearTimeout(timer); resolve(); };
      probe.onerror = () => {
        clearTimeout(timer);
        reject(new Error(t('bg_notAPicture')));
      };
      probe.referrerPolicy = 'no-referrer';
      probe.src = src;
    });
  }

  /**
   * Resolves when `src` loads as a video. Metadata only: enough to know this
   * browser can decode it, without pulling the whole film down to find out.
   */
  function probeVideo(src) {
    return new Promise((resolve, reject) => {
      const probe = document.createElement('video');

      const finish = failure => {
        clearTimeout(timer);
        probe.onloadedmetadata = null;
        probe.onerror = null;
        probe.removeAttribute('src');
        // Lets go of whatever was being buffered - without it the decoder
        // holds on to a film nothing is ever going to show.
        probe.load();
        if (failure) reject(failure); else resolve();
      };

      const timer = setTimeout(() => finish(timeout()), PROBE_TIMEOUT);

      probe.preload = 'metadata';
      probe.muted = true;
      probe.onloadedmetadata = () => finish(null);
      probe.onerror = () => finish(new Error(t('bg_notAVideo')));
      probe.src = src;
    });
  }

  // --------------------------------------------------------------- records

  /** What `file` is, or null when it is neither of the two. */
  function kindOf(file) {
    const mime = (file && file.type) || '';
    if (/^image\//.test(mime)) return 'image';
    if (/^video\//.test(mime)) return 'video';
    return null;
  }

  async function fromFile(file) {
    const type = kindOf(file);
    if (!type) throw new Error(t('bg_notMedia'));

    return withFrost({
      src: type === 'video' ? await encodeVideo(file) : await encodeImage(file),
      name: (file.name || t('bg_untitled')).slice(0, 80),
      type
    });
  }

  /**
   * The record with its frost cut, which is where the waiting for it belongs:
   * choosing a background is already a moment with something to watch, and
   * every new tab after this one has the small copy in hand before it paints.
   *
   * A picture that will not be read - another site's, sent without the header
   * that would allow it - comes back without one, and the page makes what it
   * can when it shows it.
   */
  async function withFrost(record) {
    const made = await cutFrost(record);
    return made ? { ...record, frost: made } : record;
  }

  /** The frost for a record, or null. A film is opened for its first frame. */
  function cutFrost(record) {
    return new Promise(resolve => {
      if (!record || !record.src) return resolve(null);

      const done = source => {
        const width = source.naturalWidth || source.videoWidth || 0;
        const height = source.naturalHeight || source.videoHeight || 0;
        const src = frostFrom(source, width, height);
        resolve(src ? { src, width, height } : null);
      };

      if (record.type === 'video') {
        const film = document.createElement('video');
        film.muted = true;
        // A frame is what is wanted, and metadata alone is not one.
        film.preload = 'auto';
        film.crossOrigin = 'anonymous';
        film.addEventListener('loadeddata', () => done(film), { once: true });
        film.addEventListener('error', () => resolve(null), { once: true });
        film.src = srcOf(record);
        return;
      }

      if (typeof Image !== 'function') return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.addEventListener('load', () => done(img), { once: true });
      img.addEventListener('error', () => resolve(null), { once: true });
      img.src = srcOf(record);
    });
  }

  /**
   * Whether an address holds a picture or a video, decided by loading it.
   *
   * Both are tried at once rather than in turn: an address need not end in
   * anything that gives it away, and a dead one should cost one wait rather
   * than two. Only one of them can win - an <img> will not decode an MP4, and
   * a <video> will not decode a JPEG.
   */
  async function sniff(address) {
    try {
      return await Promise.any([
        probeImage(address).then(() => 'image'),
        probeVideo(address).then(() => 'video')
      ]);
    } catch (err) {
      const tried = (err && err.errors) || [];
      throw new Error(tried.length && tried.every(one => one && one.timeout)
        ? t('bg_slowAddress')
        : t('bg_nothingThere'));
    }
  }

  /** Long enough for a wallpaper on a slow line, short enough that a host
   *  which has simply stopped answering does not hold the sheet open. */
  const DOWNLOAD_TIMEOUT = 20000;

  /**
   * The bytes behind an address, encoded the way a chosen file would have been,
   * or null where they cannot be had.
   *
   * Never throws. Every way this can fail - a host that will not let its bytes
   * be read, a file past the ceiling a chosen one would have been refused at, a
   * line that gave out halfway - has the same answer: keep the address instead,
   * which is what a background named by address has always been.
   */
  async function download(address, type) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);
    try {
      const res = await fetch(address, {
        credentials: 'omit',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      });
      if (!res.ok) return null;

      const blob = await res.blob();
      if (!blob.size) return null;

      return type === 'video' ? await encodeVideo(blob) : await encodeImage(blob);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A background named by web address.
   *
   * It is loaded once before being accepted, so a typo is caught here rather
   * than becoming a blank background nobody can explain - and what loads is
   * what says which of the two it is.
   *
   * Then it is downloaded and stored, exactly as a chosen file would have been.
   * Only the address used to be kept, and the browser fetched it on every new
   * tab: a page that needed the network to look right, and a wallpaper that
   * disappeared the day somebody else moved the file. Stored, it is the page's
   * own from then on.
   *
   * What cannot be stored still works the old way. A host that will not hand
   * its bytes over, and a file past the ceiling a chosen one would have been
   * refused at - a long video, most often - fall back to the address, and
   * `stored` says which of the two happened so the caller can be honest
   * about it.
   */
  async function fromUrl(raw) {
    const address = String(raw == null ? '' : raw).trim();
    if (!/^https?:\/\//i.test(address)) {
      throw new Error(t('bg_needsHttp'));
    }

    const type = await sniff(address);

    let name = address;
    try {
      name = new URL(address).hostname;
    } catch {
      // Loaded, so it is usable; only the caption is the poorer for it.
    }

    const src = (await download(address, type)) || address;

    return withFrost({ src, name: name.slice(0, 80), type, stored: src !== address });
  }

  // -------------------------------------------------------------- painting

  function cssUrl(src) {
    return `url("${src.replace(/[\\"]/g, '\$&')}")`;
  }

  /* ---------------------------------------------------------------- frost

     The tiles stand on a photograph and are drawn as frosted glass over it.
     They used to do that themselves, with a `backdrop-filter` each - fifty
     blurs of the same picture, worked out again every time anything moved.

     A browser redraws a page in pieces the size of the screen, not in whole
     elements, and a blur is not a pixel-by-pixel thing: to know one pixel of
     it you have to have read thirty pixels around it. So a piece redrawn
     under a tile came out as a blur of what was in that piece, the rest of
     the tile kept the blur it already had, and the join between the two was a
     straight edge lying across a tile nothing had happened to. Lifting one
     tile under the pointer left them on its neighbours.

     So the blur is made once, here, as a small picture, and each tile paints
     the part of it that lines up with where the tile is standing. Nothing is
     filtered while the page runs, and there is nothing left for the
     compositor to get half right.

     Sixty-four pixels across is the whole picture. What a tile shows is a
     hundred-odd pixels of a photograph stretched over the window and smoothed
     until none of its detail is left - which is a handful of pixels this size,
     with the browser smoothing between them on the way up. */

  const FROST_WIDTH = 64;

  /** The picture the frost was cut from, kept so a resize can re-place it. */
  let frost = null;

  /** Told when the frost changes, so whoever holds the tiles can re-place it. */
  let onFrost = null;

  /**
   * `source` drawn small and soft: an `<img>` that has loaded, or a `<video>`
   * that has a frame. Answers with a data URL, or '' where the browser will
   * not do it - a canvas it will not hand over, or a picture from an address
   * that will not let itself be read back out of one.
   */
  function frostFrom(source, width, height) {
    if (!source || !width || !height) return '';

    try {
      const canvas = document.createElement('canvas');
      if (!canvas || typeof canvas.getContext !== 'function') return '';

      canvas.width = FROST_WIDTH;
      canvas.height = Math.max(1, Math.round(FROST_WIDTH * height / width));

      const ctx = canvas.getContext('2d');
      if (!ctx) return '';

      // The blur takes the corners off what the downscale left; the saturate
      // is the one the material used to carry in CSS.
      ctx.filter = 'saturate(180%) blur(1px)';
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      // PNG, small as this is: a JPEG's blocks are eight pixels of a picture
      // that will be stretched across the whole window, and the smears they
      // would come back as are the size of a tile.
      return canvas.toDataURL();
    } catch {
      return '';
    }
  }

  /**
   * Hands the frost to the page, or takes it away - `has-frost` is what the
   * stylesheet reads to know whether the tiles have a picture to paint or
   * only a fill.
   */
  function setFrost(next) {
    frost = next || null;

    const root = document.documentElement;
    if (root && root.style) {
      root.style.setProperty('--tile-frost', frost ? cssUrl(frost.src) : 'none');
    }

    // The crop and the tiles' places in it, and only then the class that puts
    // the picture on them. The other way round the rule turns on with nothing
    // to size or place the picture by, and a browser reading a length it has
    // no value for drops the whole declaration - which is one frame of the
    // frost drawn at its own 64 pixels in the corner of every tile.
    if (typeof onFrost === 'function') onFrost(frost);

    if (document.body && document.body.classList) {
      document.body.classList.toggle('has-frost', Boolean(frost));
    }
  }

  /**
   * The crop the frost is taking, in the window's own pixels - the same one
   * `background-size: cover` is taking with the picture behind it, worked out
   * once here so that every tile can offset itself against it rather than
   * each working out the whole picture again.
   */
  function placeFrost(posY) {
    const root = document.documentElement;
    if (!root || !root.style || !frost) return false;

    const vw = root.clientWidth || 0;
    const vh = root.clientHeight || 0;
    if (!vw || !vh) return false;

    const scale = Math.max(vw / frost.width, vh / frost.height);
    const width = frost.width * scale;
    const height = frost.height * scale;

    root.style.setProperty('--frost-w', width + 'px');
    root.style.setProperty('--frost-h', height + 'px');
    root.style.setProperty('--frost-x', (vw - width) / 2 + 'px');
    root.style.setProperty('--frost-y', (vh - height) * (Number(posY) || 0) / 100 + 'px');
    return true;
  }

  /** A picture: loaded again off the address it is already painted from. */
  function frostPicture(src) {
    if (typeof Image !== 'function') return;

    const img = new Image();
    // A picture kept as an address rather than downloaded is another site's,
    // and a canvas that has drawn one will not be read back out unless that
    // site allows it. Asking is what makes the difference between a frost and
    // no frost there; a refusal arrives as an error, and the tiles keep the
    // fill they have.
    img.crossOrigin = 'anonymous';
    img.addEventListener('load', () => {
      const made = frostFrom(img, img.naturalWidth, img.naturalHeight);
      setFrost(made ? { src: made, width: img.naturalWidth, height: img.naturalHeight } : null);
    });
    img.addEventListener('error', () => setFrost(null));
    img.src = src;
  }

  /** A film: whatever frame it has when it has one. */
  function frostFilm(video) {
    if (!video || typeof video.addEventListener !== 'function') return;

    const take = () => {
      const made = frostFrom(video, video.videoWidth, video.videoHeight);
      setFrost(made ? { src: made, width: video.videoWidth, height: video.videoHeight } : null);
    };

    if (video.readyState >= 2) take();
    else video.addEventListener('loadeddata', take, { once: true });
  }

  /**
   * Puts `record` on screen, or takes the background away when it is null.
   *
   * The two kinds are painted by two elements, and only one of them is ever
   * carrying anything: a video left with its `src` set goes on being decoded
   * behind a hidden layer, which is megabytes of memory and a share of the CPU
   * spent on a page that is showing a photograph.
   */
  function apply(record) {
    const layer = document.getElementById('bg');
    const image = document.getElementById('bgImage');
    const video = document.getElementById('bgVideo');
    if (!layer || !image) return;

    // Resolved here rather than at every use below: a packaged wallpaper is
    // stored as the path it has inside the add-on, and what goes into a
    // stylesheet or a <video> has to be an address.
    const src = record && record.src ? resolve(record.src) : '';
    const moving = Boolean(src) && record.type === 'video';

    image.style.backgroundImage = src && !moving ? cssUrl(src) : '';

    if (video) {
      video.hidden = !moving;

      if (moving) {
        // Compared as it was written rather than as the element resolves it,
        // and set only when it differs: assigning the same address again sends
        // the film back to its first frame every time a setting changes.
        if (video.getAttribute('src') !== src) video.src = src;
        // Muted, so this needs no click to be allowed. A browser that refuses
        // anyway leaves the first frame standing, which is still a picture.
        const playing = video.play();
        if (playing && playing.catch) playing.catch(() => {});
      } else if (video.getAttribute('src') !== null) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    }

    layer.hidden = !src;
    document.body.classList.toggle('has-bg', Boolean(src));

    // And the copy of it the tiles are drawn on, which is made from the same
    // picture rather than from the page it is painted on.
    if (!src) setFrost(null);
    else if (record.frost) setFrost(record.frost);
    else if (moving) frostFilm(video);
    else frostPicture(src);
  }

  // --------------------------------------------------------------- storage

  const load = () => Store.loadBackground();

  /**
   * The background a page starts on: the one stored here, or - where none has
   * ever been chosen - the wallpaper the add-on ships with.
   *
   * Nothing is written. "Never chosen" and "chosen, then removed" are
   * different states, and only the first should be given a picture: writing
   * the default in on first paint would collapse the two, and Remove would put
   * the wallpaper back on the next new tab instead of taking it away. It also
   * keeps the shipped default a shipped default - free to change in a later
   * version, rather than frozen into everyone's storage on the day they
   * installed this one.
   */
  async function first() {
    const stored = await Store.loadBackground();
    if (stored) return stored;
    return (await Store.backgroundUntouched()) ? galleryRecord(DEFAULT_WALLPAPER) : null;
  }

  async function save(record) {
    try {
      return await Store.saveBackground(record);
    } catch {
      throw new Error(t('bg_noRoom'));
    }
  }

  const clear = () => Store.clearBackground();

  /**
   * The last few, so one can be put back without going to find the file again,
   * each carrying the Blur and Dim it was last looked at with. The list itself
   * is storage.js's business; these are here so the page has one door to the
   * background whichever part of it it wants.
   */
  const recent = () => Store.loadRecentBackgrounds();
  const remember = (record, effects) => Store.rememberBackground(record, effects);
  const noteEffects = (src, effects) => Store.noteRecentEffects(src, effects);
  const forgetOne = src => Store.forgetRecentBackground(src);
  const forget = () => Store.clearRecentBackgrounds();

  return {
    MAX_FILE, MAX_VIDEO_FILE, formatSize,
    fromFile, fromUrl, apply,
    withFrost, placeFrost,
    /** The packaged wallpapers, and what to do with the paths that name them. */
    gallery, galleryRecord, isBundled, resolve, first,
    /** Called when a frost arrives, so the tiles can be lined up on it. */
    set onFrost(fn) { onFrost = fn; },
    load, save, clear,
    recent, remember, noteEffects, forgetOne, forget
  };
})();
