/**
 * Pulls one version's section out of `CHANGELOG.md` - the text its GitHub
 * release is published with.
 *
 * The changelog is the only place release notes are written. Generating them
 * from commit subjects instead would publish "UI fixes" and "Locales
 * corrections" to people deciding whether to update, which is no use to them;
 * writing them twice would mean the two drift. So the file is the source and
 * this reads it.
 *
 *   node tools/release-notes.js          the version in manifest.json
 *   node tools/release-notes.js 1.2.0    a version named outright
 *
 * Exits non-zero, saying why, if the version is not semver or has no section -
 * which is what stops `tools/release.js` from cutting a release with empty
 * notes.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* The official grammar from semver.org, anchored. Kept whole rather than
   loosened to `\d+\.\d+\.\d+`, so `1.0` and `v1.0.0` are caught here rather
   than by a puzzled `gh release create` later. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** The version the add-on currently declares. */
function manifestVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
}

/** Whether `version` is a semver pre-release - `1.1.0-beta.1` and the like. */
function isPrerelease(version) {
  const parts = SEMVER.exec(version);
  return Boolean(parts && parts[4]);
}

/**
 * Every `##` heading in the file, version or not. Only these end a section, so
 * a `###` under one - `### Added` - stays part of it.
 */
function allHeadings(source) {
  return [...source.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)]
    .map(m => ({ text: m[1], at: m.index, line: m[0] }));
}

/**
 * The version headings, in the order they sit in the file.
 *
 * Four shapes are read, because a changelog is written by hand and none of the
 * differences mean anything:
 *
 *   ## 1.0.0                 ## [1.0.0]
 *   ## 1.0.0 - 2026-09-01    ## [1.0.0] - 2026-09-01
 *
 * The brackets are the Keep a Changelog convention for a heading that doubles
 * as a link reference, and the date is optional. Anything else under `##` -
 * a heading that is not a version - is left out here rather than reported as a
 * malformed one, so the file is free to carry sections of its own.
 *
 * `Unreleased` counts as a heading and is kept, so the ordering check in
 * `test/release.test.js` can see it sitting at the top where it belongs.
 */
function headings(source) {
  return allHeadings(source)
    .map(h => {
      const parts = /^\[?([^\][\s]+)\]?(?:[ \t]*[-–—][ \t]*(.+?))?$/.exec(h.text);
      return parts && { ...h, version: parts[1], date: (parts[2] || '').trim() };
    })
    .filter(h => h && (h.version === 'Unreleased' || SEMVER.test(h.version)));
}

/**
 * The body under a version's heading, down to the next `##` heading.
 *
 * The link-reference definitions at the foot of the file - `[1.0.0]: https://…`
 * - belong to the whole document rather than to the last version in it, so they
 * are dropped rather than published as part of it.
 */
function notesFor(version, source) {
  const source_ = source || fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');

  if (!SEMVER.test(version)) {
    throw new Error(version + ' is not a semantic version - see https://semver.org');
  }

  const found = headings(source_).find(h => h.version === version);
  if (!found) {
    throw new Error('CHANGELOG.md has no "## ' + version + '" section. '
      + 'Add one before releasing; it is what the release is published with.');
  }

  const next = allHeadings(source_).find(h => h.at > found.at);
  const body = source_
    .slice(found.at + found.line.length, next ? next.at : source_.length)
    .replace(/^\s*\[[^\]]+\]:\s*\S+\s*$/gm, '')
    .trim();

  if (!body) {
    throw new Error('The "## ' + version + '" section is empty. '
      + 'A release with no notes tells nobody anything.');
  }
  return body;
}

module.exports = { SEMVER, manifestVersion, isPrerelease, allHeadings, headings, notesFor };

if (require.main === module) {
  const version = process.argv[2] || manifestVersion();
  try {
    process.stdout.write(notesFor(version) + '\n');
  } catch (why) {
    console.error(why.message);
    process.exit(1);
  }
}
