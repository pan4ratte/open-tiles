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
  async function encodeImage(blob) {
    if (blob.size > MAX_FILE) {
      throw new Error(
        `That picture is ${formatSize(blob.size)} — the limit is `
        + `${formatSize(MAX_FILE)}. Pick a smaller one.`
      );
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
        `That video is ${formatSize(blob.size)} — the limit is `
        + `${formatSize(MAX_VIDEO_FILE)}. Pick a shorter or smaller one.`
      );
    }

    const url = URL.createObjectURL(blob);
    try {
      await probeVideo(url);
    } catch {
      throw new Error('This browser cannot play that video.');
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
    const err = new Error('That address took too long to answer.');
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
        reject(new Error('That is not a picture.'));
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
      probe.onerror = () => finish(new Error('That is not a video.'));
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
    if (!type) throw new Error('That is not an image or a video file.');

    return {
      src: type === 'video' ? await encodeVideo(file) : await encodeImage(file),
      name: (file.name || 'Image').slice(0, 80),
      type
    };
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
        ? 'That address took too long to answer.'
        : 'Nothing loaded from that address — is it a picture or a video?');
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
      throw new Error('That needs to be a web address starting http:// or https://.');
    }

    const type = await sniff(address);

    let name = address;
    try {
      name = new URL(address).hostname;
    } catch {
      // Loaded, so it is usable; only the caption is the poorer for it.
    }

    const src = (await download(address, type)) || address;

    return { src, name: name.slice(0, 80), type, stored: src !== address };
  }

  // -------------------------------------------------------------- painting

  function cssUrl(src) {
    return `url("${src.replace(/[\\"]/g, '\$&')}")`;
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

    const src = record && record.src ? record.src : '';
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
  }

  // --------------------------------------------------------------- storage

  const load = () => Store.loadBackground();

  async function save(record) {
    try {
      return await Store.saveBackground(record);
    } catch {
      throw new Error('There was no room left to store that background.');
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
    load, save, clear,
    recent, remember, noteEffects, forgetOne, forget
  };
})();
