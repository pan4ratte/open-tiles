/**
 * What has changed, release by release - the same words `CHANGELOG.md` says,
 * in the reader's own language and inside the add-on.
 *
 * ## Where the words come from
 *
 * The changelogs themselves: `CHANGELOG.md` and `CHANGELOG.ru.md`, the
 * documents people read on the project page. `tools/build-changelog.js` reads
 * them into `src/changelog-data.js`, which is what this draws, so the window
 * inside the add-on and the file on GitHub cannot say different things.
 *
 * That is why the lines are not in `i18n.js` with every other sentence: a
 * changelog is already written down, once per language, and writing each line
 * a second time as a message key would be two copies to keep in step and two
 * places to forget. The words *around* the lines - the title, the version, the
 * card that offers it - are ordinary messages and live where they belong.
 *
 * ## Adding a release
 *
 * Write it in `CHANGELOG.md` and in `CHANGELOG.ru.md`, then run
 * `node tools/build-changelog.js`. `test/changelog.test.js` fails if the
 * generated data has fallen behind either document.
 *
 * The newest version here is also what decides whether somebody is shown the
 * "what's new" card - see `Changelog.latest` and offerChangelog in newtab.js.
 */
const Changelog = (() => {
  const t = I18N.t;

  const RUNTIME = (typeof browser !== 'undefined' && browser.i18n)
    || (typeof chrome !== 'undefined' && chrome.i18n)
    || null;

  const DATA = typeof CHANGELOG_DATA !== 'undefined' ? CHANGELOG_DATA : { en: [] };

  /**
   * Which changelog to draw.
   *
   * The browser's own language first - `ru_RU` before `ru` - then the language
   * without its region, then English. The same walk Firefox does over
   * `_locales`, so the changelog is in the language the rest of the interface
   * turned out to be in.
   *
   * There is no `browser.i18n` on a page opened straight off disk, which is
   * how the interface is worked on; English is the answer there, as it is
   * everywhere else nothing matches.
   */
  function language() {
    const tag = ((RUNTIME && RUNTIME.getUILanguage && RUNTIME.getUILanguage()) || '')
      .replace('-', '_');

    const tries = [tag, tag.split('_')[0], 'en'];
    return tries.find(code => code && Array.isArray(DATA[code]) && DATA[code].length) || 'en';
  }

  /** Every released version in the reader's language, newest first. */
  const releases = () => DATA[language()] || DATA.en || [];

  /** The newest version written up, which is the one being run. */
  const latest = () => (DATA.en[0] || {}).version || '';

  /**
   * One line of changelog, as the run of nodes it is written as.
   *
   * `**bold**` and `` `code` `` are read, because those are what the
   * changelogs use and dropping them would leave the asterisks on screen.
   * Anything else markdown can do is left exactly as it was written - which is
   * visible, rather than silently swallowed, and `test/changelog.test.js` says
   * so before it ships.
   */
  function inline(text) {
    const nodes = [];
    const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
    let at = 0;

    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      if (m.index > at) nodes.push(document.createTextNode(text.slice(at, m.index)));

      const el = document.createElement(m[1] ? 'strong' : 'code');
      el.textContent = m[1] || m[2];
      nodes.push(el);

      at = m.index + m[0].length;
    }

    if (at < text.length) nodes.push(document.createTextNode(text.slice(at)));
    return nodes;
  }

  /**
   * Draws the whole changelog into `root`, newest release first.
   *
   * The same list wherever it is asked for - the card and the About page open
   * the same window, so there is one of these rather than one per door.
   */
  function render(root) {
    root.textContent = '';

    releases().forEach(release => {
      const section = document.createElement('section');
      section.className = 'changelog__release';

      const version = document.createElement('h3');
      version.className = 'changelog__version';
      version.textContent = t('changelog_version', release.version);
      section.append(version);

      release.groups.forEach(group => {
        if (group.kind) {
          const kind = document.createElement('h4');
          kind.className = 'changelog__kind';
          // The heading as the changelog writes it: it is part of the
          // document, not a word the interface chose.
          kind.textContent = group.kind;
          section.append(kind);
        }

        const list = document.createElement('ul');
        list.className = 'changelog__list';
        group.lines.forEach(text => {
          const line = document.createElement('li');
          line.className = 'changelog__line';
          inline(text).forEach(node => line.append(node));
          list.append(line);
        });
        section.append(list);
      });

      root.append(section);
    });
  }

  return { DATA, language, releases, latest, inline, render };
})();

/* Read by the tests, which run this file under `node`. Harmless in the
   browser, where there is no `module`. */
if (typeof module !== 'undefined') module.exports = Changelog;
