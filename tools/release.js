/**
 * Cuts a release, and is the whole of what the release workflow does.
 *
 * `.github/workflows/release.yml` checks the repository out, installs node and
 * runs this - nothing more. Keeping the steps here rather than as a list of
 * `run:` blocks in the YAML means the release can be rehearsed on a laptop
 * against the same code that will run in CI:
 *
 *   node tools/release.js              rehearse: check, test, lint, build
 *   node tools/release.js --publish    and then tag and publish it
 *
 * Without `--publish` nothing leaves the machine and nothing is written to the
 * repository; the only steps a rehearsal skips are the two that would be hard
 * to take back, and it says so when it finishes.
 *
 * ## What decides that there is anything to release
 *
 * The version in `manifest.json`, and only that. The workflow fires on any push
 * that touches the manifest - most of which are not version bumps - so the
 * question "has this already been released?" is answered by looking for the
 * `v<version>` tag rather than by diffing the manifest against its parent. A
 * version already tagged is not an error: the run finishes green having done
 * nothing, which is the right answer both for a manifest edit that left the
 * version alone and for a maintainer pressing the button twice.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { SEMVER, manifestVersion, isPrerelease, notesFor } = require('./release-notes.js');

const ROOT = path.join(__dirname, '..');
const PUBLISH = process.argv.includes('--publish');

let step = 0;
const say = text => console.log('\n── ' + text);

/** Runs a command, showing its output, and stops the release if it fails. */
function run(command, args, options) {
  const shown = [command, ...args].join(' ');
  say(++step + '. ' + shown);

  const result = spawnSync(command, args, { stdio: 'inherit', cwd: ROOT, ...options });
  if (result.error) throw new Error(shown + ' could not be started: ' + result.error.message);
  if (result.status !== 0) throw new Error(shown + ' exited ' + result.status);
}

/**
 * `npx web-ext …`.
 *
 * On Windows `npx` is a `.cmd`, which node has refused to spawn directly since
 * it was made an argument-injection hazard; a shell is the way it is reached
 * there, and the arguments go with it as one string rather than as a list node
 * would concatenate unescaped anyway. None of them carry a space.
 */
const npx = args => (process.platform === 'win32'
  ? run(['npx', ...args].join(' '), [], { shell: true })
  : run('npx', args));

/** Runs a command for its output rather than for its effect. */
function output(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout).trim() : null;
}

/** Hands a value back to the workflow, where later steps can read it. */
function emit(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, name + '=' + value + '\n');
  }
}

function main() {
  const version = manifestVersion();
  const tag = 'v' + version;

  say('OpenTiles ' + tag + (PUBLISH ? '' : '  (rehearsal - nothing will be published)'));

  // ---------------------------------------------------------- is it releasable

  // Asked before anything is built rather than after: a publish that cannot
  // authenticate should say so in the first second, not once a full test, lint
  // and build have run.
  if (PUBLISH && !process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    throw new Error('--publish needs GH_TOKEN (or GITHUB_TOKEN) set for the GitHub CLI.');
  }

  if (!SEMVER.test(version)) {
    throw new Error('manifest.json says version "' + version + '", which is not a '
      + 'semantic version. See https://semver.org');
  }

  /* Tags are only there to be found if the checkout fetched them; a shallow
     clone with none would make every version look unreleased and publish it a
     second time. Better to stop than to guess. */
  if (output('git', ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    throw new Error('Not inside a git work tree, so nothing can say what is already released.');
  }

  const alreadyReleased = output('git', ['tag', '--list', tag]) === tag;
  if (alreadyReleased) {
    emit('released', 'false');
    emit('version', version);
    console.log('\n' + tag + ' is already tagged, so there is nothing to release.');
    console.log('Bump "version" in manifest.json and add a CHANGELOG.md section for it.');
    return;
  }

  // The notes are read before anything is built: a version with nothing written
  // about it should fail in the first seconds, not after a full lint and build.
  const notes = notesFor(version);
  say('Release notes, from CHANGELOG.md');
  console.log(notes);

  // ------------------------------------------------------------ is it any good

  const tests = fs.readdirSync(path.join(ROOT, 'test'))
    .filter(name => name.endsWith('.test.js'))
    .sort();
  tests.forEach(name => run(process.execPath, [path.join('test', name)]));

  npx(['web-ext', 'lint']);
  npx(['web-ext', 'build']);

  /* web-ext names the package after the add-on and the manifest version. It is
     looked for rather than assumed, so a rename is a clear failure here instead
     of a release published with no file attached to it. */
  const artifacts = path.join(ROOT, 'web-ext-artifacts');
  const zip = fs.readdirSync(artifacts)
    .filter(name => name.endsWith('-' + version + '.zip'))
    .sort()
    .pop();
  if (!zip) {
    throw new Error('web-ext built nothing ending in "-' + version + '.zip" in '
      + 'web-ext-artifacts/. Did the manifest version change under it?');
  }
  say('Built ' + zip);

  // ------------------------------------------------------------ publish it

  emit('released', 'true');
  emit('version', version);
  emit('tag', tag);
  // Written with a forward slash rather than through `path.join`: this is read
  // by the workflow, which is a POSIX shell wherever it runs.
  emit('artifact', 'web-ext-artifacts/' + zip);

  if (!PUBLISH) {
    say('Rehearsal finished. Everything passed.');
    console.log('Publishing would now create the tag ' + tag + ' and a GitHub release');
    console.log('titled "OpenTiles ' + version + '", with the notes above and '
      + zip + ' attached.');
    console.log('\nRun it for real with:  node tools/release.js --publish');
    return;
  }

  const notesFile = path.join(artifacts, 'release-notes.md');
  fs.writeFileSync(notesFile, notes + '\n', 'utf8');

  /* `gh release create` makes the tag itself, at the commit being released, so
     there is no separate tag push that could land without the release or the
     other way round. */
  run('gh', [
    'release', 'create', tag,
    '--title', 'OpenTiles ' + version,
    '--notes-file', notesFile,
    '--target', process.env.GITHUB_SHA || output('git', ['rev-parse', 'HEAD']),
    ...(isPrerelease(version) ? ['--prerelease'] : []),
    path.join(artifacts, zip)
  ]);

  say('Published ' + tag + '.');
}

try {
  main();
} catch (why) {
  console.error('\nRelease stopped: ' + why.message);
  process.exit(1);
}
