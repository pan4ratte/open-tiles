/**
 * Writes `src/changelog-data.js` from `CHANGELOG.md` and `CHANGELOG.ru.md`.
 *
 * The changelog is written once, as the documents people read on the project
 * page - one per language. This turns them into the one thing the add-on can
 * actually read at runtime, so the window inside it says exactly what the file
 * says and there is nothing to write twice.
 *
 * Run it after changing either changelog:
 *
 *   node tools/build-changelog.js
 *
 * `test/changelog.test.js` fails if the generated file has drifted from the
 * documents, so a forgotten run is caught rather than shipped.
 *
 * ## Why a generated file rather than the markdown itself
 *
 * Nothing in `src/` can read `CHANGELOG.md`: documents are deliberately left
 * out of the package - see `web-ext-config.cjs` - and a page opened straight
 * off disk, which is how the interface is worked on, cannot fetch a file
 * beside it anyway. So the markdown is parsed here, once, and what ships is
 * data. It is the same arrangement as `_locales/en`, which is generated from
 * `src/i18n.js` by `tools/build-locales.js` and committed beside it.
 *
 * ## What is taken, and what is left
 *
 * Only released versions. `## [Unreleased]` is not a version anybody is
 * running, and announcing it would be telling people about something they do
 * not have.
 *
 * Under each, the `### Added` headings and the lines beneath them, in the
 * order they are written. The heading is carried as its own words - "Added",
 * "Добавлено" - because it is part of the document, not part of the interface.
 *
 * Every language has to tell the same story: the same versions, the same
 * headings under each, the same number of lines under those. A file that has
 * fallen behind stops this rather than shipping half a translation.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'changelog-data.js');

const { SEMVER, headings, allHeadings } = require(path.join(ROOT, 'tools', 'release-notes.js'));

/**
 * The changelogs, by the language tag Firefox knows them by. English is the
 * one without a suffix, the way `README.md` is.
 *
 * Found rather than listed, so `CHANGELOG.de.md` is picked up by being
 * written - the same way a language is added under `_locales/`.
 */
function documents() {
  return fs.readdirSync(ROOT)
    .map(name => {
      if (name === 'CHANGELOG.md') return { lang: 'en', name };
      const parts = /^CHANGELOG\.([a-z]{2}(?:[-_][A-Za-z]+)?)\.md$/.exec(name);
      return parts ? { lang: parts[1].replace('-', '_'), name } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.lang === 'en' ? -1 : b.lang === 'en' ? 1 : a.lang.localeCompare(b.lang)));
}

/**
 * One document, read into releases.
 *
 * `[{ version, groups: [{ kind, lines }] }]`, newest first - the shape the
 * window draws, and the shape the languages are compared in.
 */
function parse(source) {
  const marks = allHeadings(source);

  return headings(source)
    .filter(mark => SEMVER.test(mark.version))
    .map(mark => {
      const next = marks.find(h => h.at > mark.at);
      const body = source.slice(mark.at + mark.line.length, next ? next.at : source.length);

      const groups = [];
      body.split('\n').forEach(line => {
        const kind = /^###[ \t]+(.+?)[ \t]*$/.exec(line);
        if (kind) {
          groups.push({ kind: kind[1], lines: [] });
          return;
        }

        const bullet = /^[-*][ \t]+(.+?)[ \t]*$/.exec(line);
        if (!bullet) return;
        // A release whose whole story is one list has no heading over it.
        if (!groups.length) groups.push({ kind: null, lines: [] });
        groups[groups.length - 1].lines.push(bullet[1]);
      });

      /* Prose rather than a list - "Initial release." - which is still one
         line of changelog and is drawn as one. */
      if (!groups.length) {
        const prose = body.split('\n').map(line => line.trim())
          .filter(line => line && !/^\[[^\]]+\]:/.test(line));
        if (prose.length) groups.push({ kind: null, lines: prose });
      }

      return { version: mark.version, groups };
    });
}

/** The shape of a language's changelog, for comparing one against another. */
const shapeOf = releases => releases
  .map(release => release.version + '[' + release.groups
    .map(group => (group.kind === null ? '-' : 'h') + group.lines.length).join(',') + ']')
  .join(' ');

/**
 * Every changelog there is, read and checked against each other.
 *
 * Compared by shape rather than merged: a translation a release behind would
 * otherwise ship as a version with nothing under it, or with somebody else's
 * lines under the wrong heading.
 */
function build() {
  const found = documents();
  if (!found.some(doc => doc.lang === 'en')) {
    throw new Error('CHANGELOG.md is missing, and it is the one every other is read against.');
  }

  const read = {};
  found.forEach(doc => {
    const source = fs.readFileSync(path.join(ROOT, doc.name), 'utf8').replace(/\r\n/g, '\n');
    read[doc.lang] = parse(source);
  });

  const english = shapeOf(read.en);
  Object.entries(read).forEach(([lang, releases]) => {
    const shape = shapeOf(releases);
    if (shape === english) return;
    throw new Error([
      'The changelog for "' + lang + '" does not tell the same story as CHANGELOG.md.',
      '  CHANGELOG.md  ' + english,
      '  ' + lang + '  ' + shape,
      'Every language needs the same versions, the same headings under each, and the',
      'same number of lines under those.'
    ].join('\n'));
  });

  return read;
}

/** What `src/changelog-data.js` should hold, as its own text. */
function generate(read) {
  const head = [
    '/**',
    ' * Every released version, in every language the changelog is written in.',
    ' *',
    ' * GENERATED by tools/build-changelog.js from CHANGELOG.md and its',
    ' * translations. Do not edit it: edit the changelogs and run the tool.',
    ' *',
    " * `src/changelog.js` picks the reader's language out of this and draws it.",
    ' */',
    ''
  ].join('\n');

  const tail = [
    '',
    '/* Read by the tests, which run this file under `node`. Harmless in the',
    '   browser, where there is no `module`. */',
    "if (typeof module !== 'undefined') module.exports = CHANGELOG_DATA;",
    ''
  ].join('\n');

  return head + 'const CHANGELOG_DATA = ' + JSON.stringify(read, null, 2) + ';\n' + tail;
}

module.exports = { OUT, documents, parse, shapeOf, build, generate };

if (require.main === module) {
  const read = build();
  fs.writeFileSync(OUT, generate(read), 'utf8');

  const lines = read.en
    .reduce((n, release) => n + release.groups.reduce((m, g) => m + g.lines.length, 0), 0);
  console.log('wrote ' + path.relative(ROOT, OUT) + ' - ' + read.en.length + ' release(s), '
    + lines + ' line(s), in ' + Object.keys(read).join(', '));
}
