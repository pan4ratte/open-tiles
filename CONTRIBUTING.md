# Contributing to OpenTiles

Thanks for taking a look. Issues and pull requests are welcome at
<https://github.com/pan4ratte/open-tiles>.

## Running it

There is no build step and no dependencies. Load the folder into Firefox:

1. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**
2. Pick `manifest.json`
3. Open a new tab

`src/storage.js` falls back to `localStorage`, so you can also open
`src/newtab.html` straight in a browser to iterate on the UI without reloading
the extension. Only the Google Fonts fetch and the deep icon lookup behave
differently there, and `localStorage` holds about 5 MB, so a large background may
not survive that route.

## Packaging

`web-ext` is fetched with `npx`; nothing is installed into the repository.

```
npx web-ext lint     # check the package the way addons.mozilla.org will
npx web-ext build    # write web-ext-artifacts/opentiles-<version>.zip
npx web-ext run      # open it in a scratch Firefox profile
```

`web-ext-config.cjs` says what is left out of the built add-on — the tests most
of all, since they build stand-in objects with the `Function` constructor, which
an add-on review flags as `eval` wherever it finds it.

To keep an unsigned build installed, either submit the zip to
addons.mozilla.org for signing, or run Firefox Developer Edition / Nightly with
`xpinstall.signatures.required` set to `false`.

## Tests

Plain `node`, no browser and no dependencies: the tests run the real modules
against the small DOM shim in `test/dom-shim.js`, and lift the odd run of code
straight out of `newtab.js` to run against stubs.

```
node test/gesture.test.js      # the permission user-gesture chain
node test/background.test.js   # the background picker and the settings tabs
node test/groups.test.js       # groups, conditional fields, markup ids
node test/groupswitch.test.js  # the group transition and the scroll gesture
node test/paste.test.js        # pasted SVG code and pasted pictures
node test/favicon.test.js      # icon resolution: probing, keeping, the cache
node test/fonts.test.js        # Google Fonts CSS becoming CSS on the page
node test/i18n.test.js         # the message table, the markup keys, _locales
node test/live.test.js         # the change feed, subsections, the accent picker
node test/transfer.test.js     # the backup envelope, its refusals, the buttons
node test/importers.test.js    # reading a Speed Dial 2 backup
node test/header.test.js       # the clock and date settings, a sheet per font
node test/page.test.js         # the loading screen and the page context menu
node test/hig.test.js          # the guards from the interface audit
node test/release.test.js      # the version, the changelog, the workflow
```

Everything guarded here is something that fails *quietly* — a permission request
that never opens its window, a token nobody declared, an id that moved between
the markup and the script. `header.test.js` also checks that every
`getElementById` in `src/newtab.js` still finds an id in `src/newtab.html`.
Please add a guard with any change that could go wrong without saying so.

## Releasing

The version in `manifest.json` is the only thing that decides there is a release
to make. Push a bump to `main` and `.github/workflows/release.yml` tests, lints,
builds and publishes a GitHub release for it; the notes come from the matching
`## x.y.z` section of [`CHANGELOG.md`](CHANGELOG.md), and the built zip is
attached to it. Versions follow [semver](https://semver.org): a stored tile,
group or setting read differently is major, a feature or a language is minor,
everything else is patch.

The workflow runs `tools/release.js` and nothing else, so the whole of it can be
rehearsed here first:

```
node tools/release.js            # check, test, lint and build - publish nothing
node tools/release.js --publish  # and then tag it and publish the release
```

A rehearsal skips only the two steps that would be hard to take back, and says
so when it finishes. There is also a **Run workflow** button on the Actions tab
for releasing without a push, with a *rehearse* switch that keeps the package on
the run instead of publishing it.

So, to cut 1.1.0:

1. Write the section for it in `CHANGELOG.md`, under `## [Unreleased]`. The
   heading can be `## 1.1.0` or `## [1.1.0]`, dated or not — all four read the
   same.
2. Set `"version": "1.1.0"` in `manifest.json`.
3. `node tools/release.js` and read what it says it would publish.
4. Push to `main`.

A push that touches `manifest.json` without changing the version finishes green
having done nothing: the script looks for the `v<version>` tag and stops when it
finds one. `test/release.test.js` guards the rest — a version with no changelog
section, a changelog out of order, a workflow naming a script that has moved.

## Layout

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest; overrides `newtab` and `homepage` |
| `src/newtab.html` | Page markup, squircle clip path, sheets, settings window |
| `src/newtab.css` | The design system: tokens, materials, controls, motion |
| `src/newtab.js` | Rendering, drag & drop reordering, wiring |
| `src/i18n.js` | `I18N` — every word the add-on says, and `t()` to ask for one |
| `_locales/` | One `messages.json` per language, read by Firefox |
| `tools/build-locales.js` | Writes `_locales/en` from `src/i18n.js` |
| `tools/release.js` | The release: checks, tests, lints, builds, publishes |
| `tools/release-notes.js` | One version's section of `CHANGELOG.md` |
| `src/schema.js` | `Schema` — settings definitions, defaults, validation |
| `src/settings.js` | `SettingsUI` — renders the settings window from the schema |
| `src/storage.js` | `Store` — `browser.storage.local` with a localStorage fallback |
| `src/icons.js` | `Icons` — the Lucide set used by the UI, inlined |
| `src/fonts.js` | `Fonts` — Google Fonts loading and caching |
| `src/favicons.js` | `Favicons` — site icon discovery and caching |
| `src/backgrounds.js` | `Backgrounds` — encoding, limits, painting |
| `src/transfer.js` | `Transfer` — backup files: the envelope, reading, writing |
| `src/importers.js` | `Importers` — backups written by other add-ons |
| `fonts/`, `icons/` | Bundled Inter, and the add-on icon at each size |

## Storage keys

| Key | Shape |
| --- | --- |
| `tiles` | `[{ id, url, title, groupId, icon, iconColor, bg, pad, round, visits }]` |
| `groups` | `[{ id, name }]` |
| `activeGroup` | id of the group last shown, or `null` for *All* |
| `settings` | see `src/schema.js` |
| `background` | `{ src, name, type, savedAt }`, or `null` |
| `bgRecent` | the last six backgrounds, newest first, each with its blur and dim |
| `fontCache` | `{ [family]: { css, savedAt } }` |
| `fontPreviews` | the font picker's specimen stylesheet |
| `iconCache` | `{ [origin]: { url, size, mode, savedAt } }` |

Open new tab pages stay in sync through `storage.onChanged`. That feed reports a
page's *own* writes back to it, so `storage.js` leaves a signature behind on each
write and drops the event carrying it back — without that, dragging a slider
rebuilds the dialog under the pointer after a single step.

## Translating

Every word the add-on says lives in [`src/i18n.js`](src/i18n.js) — nothing else
in `src/` holds a sentence. The code asks for one by key, `t('tile_addTitle')`,
and the markup asks by attribute, `data-i18n="tile_addTitle"`.

### Adding a language

`README.ru.md` is the Russian README, and is the authority: a change to what
the project says about itself is written there first, and `README.md` follows
it — its sections, their order, and what it does and does not say.

Each one opens with a switcher naming every language, the current one in bold
and the rest linked. Those links are written out in full —
`https://github.com/pan4ratte/open-tiles/blob/main/README.ru.md`, not
`README.ru.md` — because a README is read on addons.mozilla.org and wherever
else the description is reproduced, and a relative link resolves to nothing at
all outside the repository.

1. Copy `_locales/en/messages.json` to `_locales/<code>/messages.json`, where
   `<code>` is the language tag Firefox uses — `de`, `fr`, `pt_BR`.
2. Translate every `"message"`. Leave the keys, the `"description"` lines and
   the `$1` placeholders alone; a `$1` is a value the add-on fills in, and the
   description says what it will be.
3. Load the add-on and switch Firefox's language to test it.

Nothing else has to change: Firefox picks the folder matching the browser's
language on its own, and any message a translation has not reached yet falls
back to English rather than going blank.

Two things are worth knowing. The clock and date menus are **not** translated —
they are written out by the browser in the reader's own language from the
format tables in `schema.js`, so there is nothing there to keep in step. And a
handful of entries are deliberately not for translating: the add-on's name,
the author, the licence, the type family names, and `13:45`-style figures.

### Adding or changing a message

1. Add the key to `MESSAGES` in `src/i18n.js`, with a `//` comment above it if
   a translator would need to know what `$1` is or where the words appear —
   that comment is carried into `messages.json` as the message's description.
2. Ask for it with `t('key')`, or `data-i18n="key"` in the markup.
3. Run `node tools/build-locales.js` to rewrite `_locales/en/messages.json`.
4. Run `node test/i18n.test.js`.

Write **whole sentences**. Word order is the first thing a translation changes,
so a message built as `'Found a ' + n + 'px icon'` cannot be put into a language
that wants the number last. Where English joins two clauses, that is two
messages here, one per case. Counting goes through `I18N.plural(n, one, other)`
and lists through `I18N.list(parts)` for the same reason.

`test/i18n.test.js` guards all of it: a key nothing has, a key nothing asks for,
a sentence left loose in the markup, a message filled in with nothing, and
`_locales/en` drifting from the table it was generated from.

### Right-to-left

Not done. `newtab.css` is written in `left`/`right` rather than in logical
properties, so an RTL language would need that pass first.

## Making changes

**Adding a setting** means adding a field to `src/schema.js` — the settings
window, the defaults, the validation and the backup format all read from there.
A field can carry a `when` to appear only alongside another setting, a `gesture`
flag where it must reach a permission request from a real click, and `external`
where its value lives somewhere other than `settings`.

**Adding an icon** means copying the inner markup from
`https://unpkg.com/lucide-static@latest/icons/<name>.svg` into the `PATHS` map in
`src/icons.js`. Markup opts in with `data-icon="<name>"`. Icons are never loaded
from a CDN.

**The look** follows Apple's Human Interface Guidelines for macOS; the Lucide
icons and Inter are the only parts that are ours. `src/newtab.css` is organised
around four ideas, and its opening comment says the same:

- **Semantic colour.** Nothing names a colour it wants, it names the job the
  colour does — `--label`, `--fill-secondary`, `--separator`, `--system-red`.
  Every job has a light and a dark value, so a theme switch is a token swap.
- **Materials.** Surfaces are translucent and blur what is behind them, in four
  thicknesses. Depth comes from the material and a hairline, not a heavy shadow.
  Everything falls back to something opaque under **Reduce transparency**.
- **Deference.** Controls are small, quiet and macOS-shaped. The accent is spent
  only where it carries meaning.
- **Continuity of motion.** Everything that appears, appears from somewhere, on
  Apple's curves — and stops moving entirely under **Reduce motion**.

Sheets and windows are not interchangeable: a **sheet** belongs to the page it
interrupts and comes down from the top edge, with anything destructive banished
to its far left; **settings** is a **window**, centred and closed from its
toolbar.

## Licence

OpenTiles is licensed under the [GNU AGPL v3](LICENSE). By contributing you agree
that your contribution is licensed the same way.
