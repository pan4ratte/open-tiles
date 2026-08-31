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
node test/live.test.js         # the change feed, subsections, the accent picker
node test/transfer.test.js     # the backup envelope, its refusals, the buttons
node test/importers.test.js    # reading a Speed Dial 2 backup
node test/header.test.js       # the clock and date settings, a sheet per font
node test/page.test.js         # the loading screen and the page context menu
node test/hig.test.js          # the guards from the interface audit
```

Everything guarded here is something that fails *quietly* — a permission request
that never opens its window, a token nobody declared, an id that moved between
the markup and the script. `header.test.js` also checks that every
`getElementById` in `src/newtab.js` still finds an id in `src/newtab.html`.
Please add a guard with any change that could go wrong without saying so.

## Layout

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest; overrides `newtab` and `homepage` |
| `src/newtab.html` | Page markup, squircle clip path, sheets, settings window |
| `src/newtab.css` | The design system: tokens, materials, controls, motion |
| `src/newtab.js` | Rendering, drag & drop reordering, wiring |
| `src/schema.js` | `Schema` — settings definitions, defaults, validation |
| `src/settings.js` | `SettingsUI` — renders the settings window from the schema |
| `src/storage.js` | `Store` — `browser.storage.local` with a localStorage fallback |
| `src/icons.js` | `Icons` — the Lucide set used by the UI, inlined |
| `src/fonts.js` | `Fonts` — Google Fonts loading and caching |
| `src/favicons.js` | `Favicons` — site icon discovery and caching |
| `src/backgrounds.js` | `Backgrounds` — encoding, limits, painting |
| `src/transfer.js` | `Transfer` — backup files: the envelope, reading, writing |
| `src/importers.js` | `Importers` — backups written by other add-ons |
| `fonts/`, `icons/` | Bundled Inter and the add-on icon |

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
