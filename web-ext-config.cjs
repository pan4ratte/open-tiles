/**
 * What `web-ext` is to leave out of the built add-on.
 *
 * Everything the extension needs at runtime lives in src/, fonts/, icons/ and
 * manifest.json; the rest of the repository is for people reading it. The
 * tests matter most here - they build stand-in objects with the Function
 * constructor, which an add-on review flags as `eval` wherever it finds it,
 * and there is no reason to ship them to find out.
 *
 *   npx web-ext lint     check the package the way addons.mozilla.org will
 *   npx web-ext build    write web-ext-artifacts/opentiles-<version>.zip
 *   npx web-ext run      open it in a scratch Firefox profile
 */
module.exports = {
  ignoreFiles: [
    'test',
    // Regenerates _locales/en from src/i18n.js; the add-on only ships the
    // result.
    'tools',
    'web-ext-config.cjs',
    'web-ext-artifacts',
    'README.md',
    // Rasterised marks, for store listings and anywhere that will not take an
    // SVG. Nothing in the add-on points at them and they are half a megabyte,
    // so they stay in the repository rather than in the package. A PNG the
    // manifest ever names has to move out of here first.
    'icons/png',
    // The release workflow, which runs `tools/release.js` rather than
    // shipping anything.
    '.github',
    '.git',
    '.gitignore',
    '**/*.md'
  ],
  build: {
    overwriteDest: true
  },
  run: {
    startUrl: ['about:newtab']
  }
};
