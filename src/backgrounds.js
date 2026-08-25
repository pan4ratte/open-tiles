/**
 * Page background support: a picture from a file on this computer.
 *
 * The picture lives under its own storage key rather than inside `settings`,
 * because it is orders of magnitude larger than everything else there and
 * settings are rewritten on every slider drag. Files are downscaled and
 * re-encoded before they are stored, so a 12 MP phone photo does not have to
 * fit in extension storage at full size.
 *
 * Anything above MAX_FILE is refused outright, with a message naming both the
 * size of the file and the limit - shrinking a 40 MB picture would take long
 * enough to look broken, and the result would not fit anyway.
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
  async function encode(blob) {
    if (!blob || !/^image\//.test(blob.type || '')) {
      throw new Error('That is not an image file.');
    }
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

  // --------------------------------------------------------------- records

  async function fromFile(file) {
    return {
      src: await encode(file),
      name: (file.name || 'Image').slice(0, 80)
    };
  }

  /** How long to wait for a named picture to prove it is one. */
  const PROBE_TIMEOUT = 10000;

  /**
   * A picture named by web address rather than stored.
   *
   * Nothing is downloaded into storage - only the address is kept, and the
   * browser fetches the picture on every new tab. That is the trade: no size
   * limit and no re-encoding, against a page that needs the network to look
   * right and an address that can stop working without warning.
   *
   * It is loaded once before being accepted, so a typo is caught here rather
   * than becoming a blank background nobody can explain.
   */
  async function fromUrl(raw) {
    const address = String(raw == null ? '' : raw).trim();
    if (!/^https?:\/\//i.test(address)) {
      throw new Error('That needs to be a web address starting http:// or https://.');
    }

    await new Promise((resolve, reject) => {
      const probe = new Image();
      const timer = setTimeout(() => {
        probe.src = '';
        reject(new Error('That address took too long to answer.'));
      }, PROBE_TIMEOUT);

      probe.onload = () => { clearTimeout(timer); resolve(); };
      probe.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Nothing loaded from that address — is it a picture?'));
      };
      probe.referrerPolicy = 'no-referrer';
      probe.src = address;
    });

    let name = address;
    try {
      name = new URL(address).hostname;
    } catch {
      // Loaded, so it is usable; only the caption is the poorer for it.
    }

    return { src: address, name: name.slice(0, 80) };
  }

  // -------------------------------------------------------------- painting

  function cssUrl(src) {
    return `url("${src.replace(/[\\"]/g, '\$&')}")`;
  }

  /** Puts `record` on screen, or takes the picture away when it is null. */
  function apply(record) {
    const layer = document.getElementById('bg');
    const image = document.getElementById('bgImage');
    if (!layer || !image) return;

    const on = Boolean(record && record.src);
    image.style.backgroundImage = on ? cssUrl(record.src) : '';
    layer.hidden = !on;
    document.body.classList.toggle('has-bg', on);
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

  return { MAX_FILE, formatSize, fromFile, fromUrl, apply, load, save, clear };
})();
