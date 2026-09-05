/**
 * Guards the seam between the version, the changelog and the release workflow.
 *
 * Releasing is the one thing here that cannot be taken back: a tag is public the
 * moment it exists, and a release published with the wrong notes or no package
 * has already been fetched by somebody by the time it is noticed. All of it
 * fails quietly, too - a version bump with no changelog section publishes an
 * empty release, and a workflow pointing at a script that has since moved fails
 * only on the run that was meant to ship something.
 *
 * What can quietly go wrong here:
 *
 *   - `manifest.json` carries a version that is not semver. Firefox is happy
 *     with plenty of strings semver is not, and `1.0` sorts and compares in ways
 *     nobody expects.
 *   - the version has no section in CHANGELOG.md, so the release is published
 *     with nothing under its heading.
 *   - the changelog's own versions are out of order, duplicated, or not semver -
 *     which makes the file useless for working out what changed between two.
 *   - a heading is written in a shape the parser does not read, so a version
 *     that is plainly there is reported missing.
 *   - the workflow names a script, an input or an output that has since been
 *     renamed. Nothing checks a YAML file until it runs.
 *   - `.github` is packaged into the add-on, which ships CI configuration to
 *     every reader and gives an add-on review something to ask about.
 *   - a rehearsal reaches addons.mozilla.org. A version number is spent the
 *     moment it is uploaded there - AMO takes each one once, on either channel -
 *     so a rehearsal that submitted would burn the release it was rehearsing.
 *   - the store credentials end up on a command line, where every other process
 *     on the runner can read them.
 *
 *   node test/release.test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const { SEMVER, manifestVersion, isPrerelease, headings, notesFor } =
  require(path.join(ROOT, 'tools', 'release-notes.js'));

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

const CHANGELOG = read('CHANGELOG.md');
const WORKFLOW = read('.github/workflows/release.yml');
const version = manifestVersion();

// ------------------------------------------------------------ the version

check('the manifest version is a semantic version', SEMVER.test(version), version);

// -------------------------------------------------------- and its notes

let notes = null;
try {
  notes = notesFor(version);
} catch (why) {
  check('the version being shipped has a changelog section', false, why.message);
}
if (notes !== null) {
  check('the version being shipped has a changelog section', true,
    version + ', ' + notes.split('\n').length + ' line(s)');

  /* The link-reference definitions at the foot of the file belong to the whole
     document. Published as part of the last section they would read as a
     stray line of markup under the notes. */
  check('its notes stop short of the link definitions at the foot of the file',
    !/^\[[^\]]+\]:\s*http/m.test(notes),
    notes.split('\n').filter(l => /^\[[^\]]+\]:/.test(l)).join(' | '));

  check('and stop short of the next heading', !/^##\s/m.test(notes),
    notes.split('\n').find(l => /^##\s/.test(l)) || '');
}

// -------------------------------------------------------- the changelog

const marks = headings(CHANGELOG);

check('the changelog has an Unreleased heading to write the next one under',
  marks.length > 0 && marks[0].version === 'Unreleased',
  marks.map(m => m.version).join(', '));

const released = marks.filter(m => m.version !== 'Unreleased');

check('every released heading is a semantic version',
  released.every(m => SEMVER.test(m.version)),
  released.filter(m => !SEMVER.test(m.version)).map(m => m.version).join(', '));

const duplicated = released
  .map(m => m.version)
  .filter((v, i, all) => all.indexOf(v) !== i);
check('no version is written up twice', duplicated.length === 0, duplicated.join(', '));

/* Newest first, the way the file is read. Compared field by field rather than
   as strings, where '1.10.0' sorts under '1.9.0'. */
const rank = v => v.split(/[.-]/).map(Number);
const descending = released.every((m, i) => {
  if (!i) return true;
  const [a, b] = [rank(released[i - 1].version), rank(m.version)];
  for (let n = 0; n < Math.max(a.length, b.length); n++) {
    if ((a[n] || 0) !== (b[n] || 0)) return (a[n] || 0) > (b[n] || 0);
  }
  return false;
});
check('the versions run newest first', descending,
  released.map(m => m.version).join(' > '));

/* A date is optional - the changelog is written by hand, and plenty of them
   carry none. What would be odd is some versions dated and others not, which
   reads as one that was forgotten rather than as a file that does without. */
const dated = released.filter(m => m.date);
check('versions are either all dated or none of them are',
  dated.length === 0 || dated.length === released.length,
  dated.length + ' of ' + released.length + ' dated');

check('and a date that is there is a date',
  dated.every(m => /^\d{4}-\d{2}-\d{2}$/.test(m.date)),
  dated.filter(m => !/^\d{4}-\d{2}-\d{2}$/.test(m.date))
    .map(m => m.version + ' (' + m.date + ')').join(', '));

check('the version being shipped is the newest one written up',
  released.length > 0 && released[0].version === version,
  (released[0] || {}).version + ' vs manifest ' + version);

// ---------------------------------------------------- what the workflow runs

check('the workflow runs the release script rather than steps of its own',
  WORKFLOW.includes('node tools/release.js --publish'));

check('and can be asked for a rehearsal that publishes nothing',
  WORKFLOW.includes('workflow_dispatch')
    && WORKFLOW.includes('rehearse')
    && /if \[ "\$\{\{ inputs\.rehearse \}\}" = "true" \]/.test(WORKFLOW));

check('it fires on a manifest change, which is the only thing that sets a version',
  /paths:\s*\['manifest\.json'\]/.test(WORKFLOW));

check('it fetches the tags the script needs to know what is already out',
  /fetch-depth:\s*0/.test(WORKFLOW));

check('it asks for permission to write a release, and nothing else',
  /permissions:\s*\n\s*contents:\s*write\s*\n/.test(WORKFLOW));

check('and takes one release at a time', /concurrency:\s*\n\s*group:\s*release/.test(WORKFLOW));

/* The script hands the workflow these by name. A rename on either side leaves
   the upload step quietly pointing at nothing. */
const RELEASE_JS = read('tools/release.js');
['released', 'version', 'artifact', 'xpi'].forEach(name => {
  check('the workflow and the script agree on the "' + name + '" output',
    RELEASE_JS.includes("emit('" + name + "'")
      && WORKFLOW.includes('steps.release.outputs.' + name));
});

/* Firefox is handed an add-on as a .xpi, so a release carries one beside the
   .zip. Both are attached, and both are kept from a rehearsal - a release with
   only one of them is the failure worth catching here. */
check('the release attaches an .xpi beside the .zip',
  /path\.join\(artifacts, xpi\)/.test(RELEASE_JS)
    && /path\.join\(artifacts, zip\)/.test(RELEASE_JS));

const upload = WORKFLOW.slice(WORKFLOW.indexOf('upload-artifact'));
check('and a rehearsal keeps both',
  /path:\s*\|/.test(upload)
    && upload.includes('steps.release.outputs.artifact')
    && upload.includes('steps.release.outputs.xpi'),
  upload.split('\n').filter(l => l.includes('outputs.')).join(' | ').trim());

// ------------------------------------------------------ and to the store

check('the workflow hands the script the addons.mozilla.org key',
  WORKFLOW.includes('AMO_JWT_ISSUER: ${{ secrets.AMO_JWT_ISSUER }}')
    && WORKFLOW.includes('AMO_JWT_SECRET: ${{ secrets.AMO_JWT_SECRET }}'));

check('the script submits on the listed channel, which is the public listing',
  /'--channel', 'listed'/.test(RELEASE_JS));

/* A secret in an argument list is readable by every other process on the
   machine. web-ext reads both from the environment instead. */
check('and never puts the key on a command line',
  !RELEASE_JS.includes("'--api-key'") && !RELEASE_JS.includes("'--api-secret'")
    && RELEASE_JS.includes('WEB_EXT_API_KEY')
    && RELEASE_JS.includes('WEB_EXT_API_SECRET'));

/* The one thing here that cannot be taken back at all: a tag can be deleted and
   a release unpublished, but a version number AMO has seen is gone for good. So
   the upload sits past the point a rehearsal has already returned from. */
check('a rehearsal submits nothing, since AMO takes a version number only once',
  RELEASE_JS.indexOf('await signOnAmo(') > RELEASE_JS.indexOf('if (!PUBLISH) {'));

check('and signing comes before the tag, so a refusal leaves nothing behind',
  RELEASE_JS.indexOf('await signOnAmo(') < RELEASE_JS.indexOf("'release', 'create', tag"));

check('there is a way to publish without the store, for a release held up by a review',
  RELEASE_JS.includes("--no-sign"));

/* The gecko id is the add-on's identity on the store - every version ever
   published is filed under it, and a listing cannot be moved to another one.
   Written down twice, one copy drifts. */
const AMO_JS = read('tools/amo.js');
check('the store is asked by the id in the manifest, rather than one written out again',
  AMO_JS.includes('gecko') && !AMO_JS.includes('open-tiles@'));

check('the release module and the store module are the same two files the workflow runs',
  RELEASE_JS.includes("require('./amo.js')"));

// ------------------------------------------------- and what is not shipped

const ignored = require(path.join(ROOT, 'web-ext-config.cjs')).ignoreFiles;
check('the add-on package leaves the CI configuration out',
  ignored.includes('.github'), ignored.join(', '));

check('and leaves the changelog out, the way it leaves every other document out',
  ignored.includes('**/*.md'));

// ------------------------------------------------------ the heading shapes

/*
 * The four ways a version heading gets written, none of which mean anything
 * different: the brackets are the Keep a Changelog convention for a heading
 * that doubles as a link reference, and the date is whatever the person
 * writing it felt like. A changelog that drops either should not be a release
 * that cannot be cut, so all four are read.
 */
const SHAPES = {
  bare: '## 1.2.0',
  bracketed: '## [1.2.0]',
  dated: '## 1.2.0 - 2026-09-02',
  'bracketed and dated': '## [1.2.0] - 2026-09-02'
};

Object.entries(SHAPES).forEach(([shape, heading]) => {
  const file = ['# Changelog', '', '## [Unreleased]', '', heading, '', 'Something.', ''].join('\n');
  let ok = false;
  try {
    ok = notesFor('1.2.0', file) === 'Something.'
      && headings(file).map(h => h.version).join(',') === 'Unreleased,1.2.0';
  } catch { /* left false */ }
  check('a ' + shape + ' heading is read as a version', ok, heading);
});

check('a heading that is not a version is not mistaken for one',
  headings(['# Changelog', '', '## Notes on 1.0', '', '## 1.0.0', ''].join('\n'))
    .map(h => h.version).join(',') === '1.0.0');

check('but one still ends the section above it, rather than being published with it',
  notesFor('1.0.0',
    ['## 1.0.0', '', 'The notes.', '', '## How to read this', '', 'Not the notes.', '']
      .join('\n')) === 'The notes.');

check('a "### Added" under a version stays part of it',
  notesFor('1.0.0',
    ['## 1.0.0', '', '### Added', '', '- A thing.', '', '## 0.9.0', '', 'Older.', '']
      .join('\n')) === ['### Added', '', '- A thing.'].join('\n'));

// ------------------------------------------------------------ the refusals

/* Every way a release goes out wrong, each made to fail rather than to guess. */
const refuses = (what, wanted, source) => {
  try {
    notesFor(wanted, source);
    check(what, false, 'it was accepted');
  } catch (why) {
    check(what, true, why.message);
  }
};

refuses('a version that is not semver is refused', '1.0', CHANGELOG);
refuses('a v-prefixed tag is refused, rather than looked up as a version',
  'v' + version, CHANGELOG);
refuses('a version with no section is refused', '9.9.9', CHANGELOG);
refuses('and a section with nothing under it is refused', '9.9.9',
  ['# Changelog', '', '## 9.9.9', '', '## 1.0.0', '', 'Something.', ''].join('\n'));

check('a pre-release is recognised, so it is not published as a stable one',
  isPrerelease('1.1.0-beta.1') && isPrerelease('2.0.0-rc.2') && !isPrerelease('1.1.0'));

check('a section is read whole, from a file with several in it',
  notesFor('1.1.0', [
    '# Changelog', '', '## [Unreleased]', '', '## [1.1.0] - 2026-02-02', '',
    '### Added', '', '- A thing.', '- Another.', '', '## [1.0.0] - 2026-01-01', '',
    '- The first.', '', '[1.1.0]: https://example.com/1.1.0', ''
  ].join('\n')) === ['### Added', '', '- A thing.', '- Another.'].join('\n'));

// ------------------------------------------------------------------ report

let failed = 0;
results.forEach(({ name, pass, detail }) => {
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  (' + detail + ')' : ''));
});
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);
