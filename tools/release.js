/**
 * Cuts a release, and is the whole of what the release workflow does.
 *
 * `.github/workflows/release.yml` checks the repository out, installs node and
 * runs this - nothing more. Keeping the steps here rather than as a list of
 * `run:` blocks in the YAML means the release can be rehearsed on a laptop
 * against the same code that will run in CI:
 *
 *   node tools/release.js              rehearse: check, test, lint, build
 *   node tools/release.js --publish    and then sign, tag and publish it
 *
 * Without `--publish` nothing leaves the machine and nothing is written to the
 * repository; the only steps a rehearsal skips are the three that would be hard
 * to take back, and it says so when it finishes.
 *
 * ## Signing, which is the same thing as submitting to the store
 *
 * A publish uploads the package to addons.mozilla.org on the listed channel -
 * which is to say, as the next version of the public listing - waits for it to
 * be approved, and attaches the signed .xpi that comes back to the GitHub
 * release. There is no separate signing step to run and no second file to
 * build: signing is what AMO does to a submission, and what it hands back is
 * the package Firefox will install.
 *
 * That needs an API key - AMO_JWT_ISSUER and AMO_JWT_SECRET, from
 * https://addons.mozilla.org/developers/addon/api/key/ - and the version
 * number has to be one AMO has never seen, since it takes each one once.
 *
 *   node tools/release.js --publish --no-sign
 *
 * skips the store and publishes the GitHub release with an unsigned copy of the
 * zip beside it, for the release that has to go out while a review still sits
 * on AMO.
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
const amo = require('./amo.js');

const ROOT = path.join(__dirname, '..');
const PUBLISH = process.argv.includes('--publish');
const SIGN = !process.argv.includes('--no-sign');

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
 *
 * Nor does any of them carry a secret: what `web-ext sign` needs is passed to it
 * in `options.env`, out of reach of every other process on the machine.
 */
const npx = (args, options) => (process.platform === 'win32'
  ? run(['npx', ...args].join(' '), [], { shell: true, ...options })
  : run('npx', args, options));

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

/**
 * Submits the built add-on to addons.mozilla.org, and leaves what comes back
 * signed at `dest`.
 *
 * The question asked first is whether AMO already holds this version, and it is
 * asked because a version number is spent the moment it is uploaded: a run that
 * signed and then fell over on the GitHub half of the release would otherwise
 * be unrepeatable, the store holding a version the release never got. Finding
 * it already up there is the ordinary answer on a second run, and the signed
 * package is fetched rather than sent again.
 */
async function signOnAmo(version, artifacts, dest) {
  const creds = amo.credentials();
  const xpis = () => fs.readdirSync(artifacts).filter(name => name.endsWith('.xpi'));

  say(++step + '. addons.mozilla.org: submit ' + version + ' to the listing');

  const already = await amo.versionOnAmo(version, creds);
  if (already) {
    if (!amo.isPublished(already)) {
      throw new Error('addons.mozilla.org already has ' + version + ' on the '
        + already.channel + ' channel but has not published it: its package is "'
        + ((amo.fileOf(already) || {}).status || 'missing') + '", so it is waiting on a '
        + 'review. Run this again once that clears and it will pick the signed package '
        + 'up, or go out without the store for now with --no-sign.');
    }
    console.log('Already published there, so the signed package is fetched rather than '
      + 'sent a second time - which AMO would refuse.');
    await amo.download(amo.fileOf(already).url, dest, creds);
    return;
  }

  /* `web-ext sign` builds its own package to send - from this same tree, and
     through the same web-ext-config.cjs the zip came from - then waits for AMO
     to approve it, which for an add-on carrying no minified code is usually
     seconds. The credentials reach it through the environment, which is where
     web-ext looks for --api-key and --api-secret of its own accord. */
  const before = xpis();
  npx(['web-ext', 'sign', '--channel', 'listed'], {
    env: {
      ...process.env,
      WEB_EXT_API_KEY: creds.issuer,
      WEB_EXT_API_SECRET: creds.secret
    }
  });

  /* Looked for rather than assumed: the signed package is named by AMO, which
     spells the add-on's name its own way. */
  const signed = xpis().filter(name => !before.includes(name));
  if (signed.length !== 1) {
    throw new Error('web-ext sign left ' + signed.length + ' new .xpi in '
      + 'web-ext-artifacts/' + (signed.length ? ': ' + signed.join(', ')
        : ', so there is nothing signed to publish.'));
  }
  fs.renameSync(path.join(artifacts, signed[0]), dest);
  say('addons.mozilla.org signed ' + version + ', and the listing now carries it');
}

async function main() {
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

  if (PUBLISH && SIGN && !amo.credentials()) {
    throw new Error('--publish needs AMO_JWT_ISSUER and AMO_JWT_SECRET set to an '
      + 'addons.mozilla.org API key, from '
      + 'https://addons.mozilla.org/developers/addon/api/key/ - submitting the version '
      + 'to the store is what signs it. Pass --no-sign to publish a GitHub release '
      + 'without one.');
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
  /* An XPI is a zip under the name Firefox knows it by, and where the release
     is signed this is the name the signed package takes when it arrives back
     from addons.mozilla.org further down - so the two files on a release are
     plainly the same version, whatever AMO called its own copy of it.

     Where it is not signed - a rehearsal, or --no-sign - the second file is a
     copy of the zip rather than a second build: two packages built one after
     the other could differ, and a release whose two downloads are not the same
     add-on is worse than a release with one. That copy is unsigned, and release
     Firefox refuses to install one from a file; it is for Developer Edition,
     for an unbranded build, and for anyone loading it through about:debugging. */
  const xpi = zip.replace(/\.zip$/, '.xpi');
  const xpiPath = path.join(artifacts, xpi);
  if (PUBLISH && SIGN) {
    say('Built ' + zip + '; ' + xpi + ' will be the copy addons.mozilla.org signs');
  } else {
    fs.copyFileSync(path.join(artifacts, zip), xpiPath);
    say('Built ' + zip + ', and an unsigned ' + xpi + ' beside it');
  }

  // ------------------------------------------------------------ publish it

  emit('released', 'true');
  emit('version', version);
  emit('tag', tag);
  // Written with a forward slash rather than through `path.join`: this is read
  // by the workflow, which is a POSIX shell wherever it runs.
  emit('artifact', 'web-ext-artifacts/' + zip);
  emit('xpi', 'web-ext-artifacts/' + xpi);

  if (!PUBLISH) {
    say('Rehearsal finished. Everything passed.');
    console.log('Publishing would now submit ' + version + ' to addons.mozilla.org as the');
    console.log('next version of the listing, wait for it to be signed, then create the tag');
    console.log(tag + ' and a GitHub release titled "OpenTiles ' + version + '", with the');
    console.log('notes above and ' + zip + ' and the signed ' + xpi + ' attached.');
    console.log('\nRun it for real with:  node tools/release.js --publish');
    console.log('Leave the store out of it with:  node tools/release.js --publish --no-sign');
    return;
  }

  /* Before the tag rather than after it. A tag is public the moment it exists,
     and a release tagged for a version the store then refused would have to be
     taken back by hand; a signing that fails here leaves nothing behind but a
     run to read. */
  if (SIGN) await signOnAmo(version, artifacts, xpiPath);

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
    path.join(artifacts, zip),
    path.join(artifacts, xpi)
  ]);

  say('Published ' + tag + '.');
}

main().catch(why => {
  console.error('\nRelease stopped: ' + why.message);
  process.exit(1);
});
