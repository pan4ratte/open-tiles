/**
 * Backup files: everything this extension keeps, in one JSON document that can
 * be put somewhere safe and read back later or on another computer.
 *
 * A document is an envelope - format, version, when it was written - around
 * four optional sections: `settings`, `tiles`, `groups` and `background`. A
 * section that is absent is left alone on import rather than emptied, so a
 * file written by a build that knew nothing of groups cannot delete them.
 *
 * Nothing here validates a tile, a group or a setting. Every section goes back
 * in through the sanitizer that already owns it - `Store.save`, `Schema.coerce`
 * and the rest - which is what keeps a hand-edited or older file from putting
 * anything through that the page would not have written itself. This module's
 * whole job is the envelope: is it ours, and which sections did it bring.
 *
 * The background is carried too, data URI and all, which is most of the weight
 * of a backup - a picture is megabytes where the rest is kilobytes. It is the
 * half of "how my new tab looks" that would be tedious to set up again, so it
 * travels with the rest.
 */
const Transfer = (() => {
  const FORMAT = 'tiles-backup';
  const VERSION = 1;

  /** Comfortably past a full backup: 6 MB of picture, base64'd into JSON. */
  const MAX_FILE = 16 * 1024 * 1024;

  /** The sections a document may carry, in the order they are written. */
  const SECTIONS = ['settings', 'groups', 'tiles', 'background'];

  // -------------------------------------------------------------- writing

  /**
   * Only the sections actually handed in are written, so an export never
   * claims to hold a background that is not there - `null` and "absent" mean
   * different things on the way back in.
   */
  function build(state) {
    const doc = {
      format: FORMAT,
      version: VERSION,
      savedAt: new Date().toISOString()
    };

    SECTIONS.forEach(name => {
      const value = state[name];
      if (value !== undefined) doc[name] = value;
    });

    return doc;
  }

  /** Indented, because a backup is a file somebody may well open and read. */
  const serialize = state => JSON.stringify(build(state), null, 2);

  /** "tiles-backup-2026-08-26.json" - sorts by date wherever it lands. */
  function filename(now = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    const stamp = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-');
    return `${FORMAT}-${stamp}.json`;
  }

  /**
   * Hands the file to the browser's downloader.
   *
   * The anchor has to be in the document for the click to count, and the blob
   * URL has to outlive the click - Firefox reads it after the handler returns,
   * so revoking straight away cancels the download.
   */
  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.hidden = true;

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return name;
  }

  /** Writes the current state out as a file. @returns {string} its name */
  function save(state) {
    return download(serialize(state), filename());
  }

  // -------------------------------------------------------------- reading

  function readAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('That file could not be read.'));
      reader.readAsText(file);
    });
  }

  /**
   * Pulls the sections out of a backup file.
   *
   * The version is recorded and not gated on: since every section is
   * re-sanitized downstream, a file from a later build degrades to the parts
   * this one understands instead of being refused outright.
   *
   * @returns {Promise<{version:number, savedAt:string, sections:object}>}
   * @throws {Error} with a message fit to show the user
   */
  async function read(file) {
    if (!file) throw new Error('No file to read.');
    if (file.size > MAX_FILE) throw new Error('That file is too large to be a backup.');

    let doc;
    try {
      doc = JSON.parse(await readAsText(file));
    } catch (err) {
      // A read that failed already carries a sensible message; a parse that
      // failed carries SyntaxError noise nobody wants to see.
      throw err instanceof SyntaxError ? new Error('That file is not valid JSON.') : err;
    }

    if (!doc || typeof doc !== 'object' || doc.format !== FORMAT) {
      throw new Error('That is not a Tiles backup file.');
    }

    const sections = {};
    SECTIONS.forEach(name => {
      if (name in doc) sections[name] = doc[name];
    });

    if (!Object.keys(sections).length) {
      throw new Error('That backup is empty — there is nothing in it to restore.');
    }

    return {
      version: Number(doc.version) || 0,
      savedAt: typeof doc.savedAt === 'string' ? doc.savedAt : '',
      sections
    };
  }

  return { FORMAT, VERSION, MAX_FILE, SECTIONS, build, serialize, filename, save, read };
})();
