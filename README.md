# Tiles

A Firefox extension that replaces the new tab / start page with a grid of
draggable tiles for quick access to your favourite sites.

## Install (temporary, for development)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Pick `manifest.json` in this folder
4. Open a new tab

A temporary add-on is removed when Firefox restarts. To keep it permanently,
zip the folder contents and submit it to addons.mozilla.org for signing, or run
Firefox Developer Edition / Nightly with `xpinstall.signatures.required = false`.

Firefox will ask for permission the first time the new tab page and homepage are
overridden — accept it, otherwise the default page stays.

## Usage

- **+** tile — add a site (`example.com` is enough, `https://` is filled in)
- **drag a tile** — reorder; the new order is saved automatically
- **right-click a tile** — edit or delete it
- **gear, top right** — settings, including the background picture
- **Esc** — close a dialog

## Settings

Everything lives in one dialog, grouped into sections. Changes apply as you make
them and are written to storage in the background.

| Section | Setting | Default |
| --- | --- | --- |
| Appearance | Theme — system / dark / light | System |
| | Accent colour | `#5b8cff` |
| | Font — any Google Fonts family | Inter |
| Background | Picture — a local file or an Unsplash photo | none |
| | Blur — 0–40px | 0px |
| | Dim — 0–90% | 35% |
| | Unsplash access key | empty |
| Layout | Columns — auto, or 3–12 | Auto |
| | Rows — auto, or 1–8 (beyond that the grid scrolls) | Auto |
| | Tile size — 72–200px | 116px |
| | Spacing — 4–48px | 18px |
| Header | Show the clock | on |
| | 24-hour time | on |
| | Show the date | off |
| | Show the hint line | on |
| Tiles | Show site names | on |
| | Open sites in a new tab | off |
| | Deep icon lookup | off |

**Reset all** puts every setting back to its default and takes the background
picture away.

Tiles are centred at every size. *Auto* columns fit as many tiles per row as the
window allows; a fixed count keeps the grid at exactly that width, centred, so a
row limit scrolls against the tiles rather than at the page edge.

Adding a field to [`src/schema.js`](src/schema.js) is all it takes to add a
setting — the dialog, the defaults and the validation all read from there. A
field marked `external` renders in the dialog but keeps its value somewhere
other than `settings`, which is how the background picture stays out of an
object that is rewritten on every slider drag.

## Background

Settings → *Background* → **Choose file** takes any image on this computer; you
can also drop one straight onto the preview. Anything larger than 2560px on its
longest edge is scaled down to fit and re-encoded as JPEG, so a phone photo does
not have to fit in extension storage at full size. Files under 800 KB are stored
byte for byte, which keeps SVGs and animated GIFs whole. Six megabytes is the
ceiling; past that the picture is refused rather than silently dropped.

The same field searches **Unsplash**, which needs an access key of your own —
there is none to ship in an add-on:

1. Sign in at [unsplash.com/oauth/applications](https://unsplash.com/oauth/applications)
   and create an application (the free *Demo* tier allows 50 requests an hour)
2. Copy its **Access Key** into Settings → *Background* → *Unsplash access key*
3. Search, then click a photo to set it

The chosen photo is downloaded once and stored with everything else, so the new
tab paints offline and no request goes out when you open one. Unsplash's API
guidelines are followed: their download endpoint is pinged when a photo is
actually used, and the photographer is credited in the bottom-left corner with
links back. The key travels as a `client_id` query parameter, which keeps the
call a simple CORS request — `api.unsplash.com` and `images.unsplash.com` both
send `Access-Control-Allow-Origin: *`, so no host permission is needed.

*Blur* and *Dim* apply to the picture only, not to what stands on it. Dim fades
towards the theme colour rather than towards black, so it keeps the text legible
in light and dark alike. With a picture set, the tiles and the settings button
turn to frosted glass.

## Icons

Every icon in the UI is [Lucide](https://lucide.dev). They are not loaded from a
CDN — `src/icons.js` holds the inner SVG markup of each icon used, and
`Icons.create(name)` builds the `<svg>` at runtime with `stroke="currentColor"`,
so icons follow the surrounding text colour. Markup opts in with
`data-icon="plus"` (plus an optional `data-icon-size`); `Icons.hydrate()` fills
those in on load.

To add an icon, copy the inner markup from
`https://unpkg.com/lucide-static@latest/icons/<name>.svg` into the `PATHS` map.

## Site icons

`src/favicons.js` looks for the sharpest icon a site actually has, rather than
settling for `/favicon.ico`:

1. **Deep lookup** (optional, off by default) reads the page's
   `<link rel="icon | apple-touch-icon | mask-icon">` tags and the `icons[]` of
   its web manifest. This is the only way to find logos on a separate CDN host
   or at a hashed path — Figma's 1024px SVG and 512px manifest icons, or Google
   Fonts' 192px branded PNG on gstatic, are invisible to any other method.
   It needs permission to read the sites you save, so the toggle asks for it and
   turns itself back off if you decline. See *Permissions* below.
2. **Conventional paths** — `/favicon.svg`, `/apple-touch-icon.png`,
   `/android-chrome-512x512.png` and a dozen others, probed in three waves so
   the common case costs three requests instead of thirteen, stopping as soon as
   something ≥128px turns up.
3. **`/favicon.ico`** as the floor, and a coloured monogram (or the Lucide
   `globe`) when a site offers nothing.

Every candidate is loaded as an `<img>` and *measured*, so the winner is the one
that really is largest — not the one whose filename claims a size. SVGs win
outright, and anything under 16px is discarded as a placeholder. Probing images
needs no permissions; only the deep lookup does.

Results are cached per origin (hits 30 days, misses 3 days), at most four
origins are resolved at once, and turning deep lookup on or off clears the cache
so every tile is re-resolved.

## Permissions

`storage` is the only permission granted at install. Access to websites is
requested only when you switch on **Deep icon lookup**, and revoked when you
switch it off.

Firefox honours `permissions.request()` **only while it is handling user
input** — a window that closes at the first `await`, and that never opens for a
checkbox's `change` event. So that one toggle acts on `click` and reaches the
request without awaiting anything on the way (see the `gesture` flag in
`src/schema.js`). Both mistakes fail silently at runtime, so
[`test/gesture.test.js`](test/gesture.test.js) guards the whole chain:

```
node test/gesture.test.js
```

If the request is refused, the toggle reports the reason Firefox gave rather
than assuming you declined. Either way there is a second route: switch on
*Access your data for all websites* under **about:addons → Tiles →
Permissions**. Granting or revoking it there is picked up live — the permission
itself is the source of truth for the setting, so the toggle follows it.

## Fonts

The default is **Inter**, bundled with the extension (`fonts/`, ~174 KB of
woff2 covering latin, latin-ext, cyrillic and cyrillic-ext) so it renders
offline and costs no request.

Settings → *Font* accepts **any family Google Fonts serves**, not just the ~50
suggestions in the dropdown. The first time a family is chosen, `src/fonts.js`

1. fetches `https://fonts.googleapis.com/css2?family=<name>:wght@300;400;600`,
2. downloads the woff2 for the latin/cyrillic subsets and rewrites the
   stylesheet with each file inlined as a `data:` URI,
3. stores that stylesheet under `fontCache` in extension storage (six most
   recent families are kept).

From then on the font is served from cache, so Google is not contacted again on
every new tab. Both endpoints send `Access-Control-Allow-Origin: *`, so no host
permissions are needed. Leaving the field empty falls back to the system font.

## Layout

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest; overrides `newtab` and `homepage` |
| `src/newtab.html` | Page markup, tile dialog, settings dialog |
| `src/newtab.css` | Styling, theme tokens, grid geometry |
| `src/icons.js` | `Icons` — the Lucide set used by the UI, inlined |
| `src/schema.js` | `Schema` — settings definitions, defaults, validation |
| `src/storage.js` | `Store` — `browser.storage.local` with a localStorage fallback |
| `src/fonts.js` | `Fonts` — Google Fonts loading and caching |
| `src/backgrounds.js` | `Backgrounds` — the page picture: files, Unsplash, painting |
| `src/favicons.js` | `Favicons` — site icon discovery and caching |
| `src/settings.js` | `SettingsUI` — renders the settings dialog from the schema |
| `src/newtab.js` | Rendering, drag & drop reordering, wiring |
| `test/gesture.test.js` | Guards the permission user-gesture chain |
| `test/background.test.js` | Guards the background picker's settings contract |
| `test/dom-shim.js` | The scrap of DOM both tests run the dialog against |
| `fonts/` | Bundled Inter (variable) + its `@font-face` rules |
| `icons/icon.svg` | Toolbar / add-on manager icon (Lucide `layout-grid`) |

## Storage

| Key | Shape |
| --- | --- |
| `tiles` | `[{ id, url, title }]` |
| `settings` | see `src/schema.js` |
| `background` | `{ kind, src, name, credit, savedAt }`, or `null` |
| `fontCache` | `{ [family]: { css, savedAt } }` |
| `iconCache` | `{ [origin]: { url, size, mode, savedAt } }` |

Open new tab pages stay in sync through `storage.onChanged`. Because
`src/storage.js` falls back to `localStorage`, you can also open
`src/newtab.html` directly in a browser to iterate on the UI without reloading
the extension — only the Google Fonts fetch and the deep icon lookup behave
differently there. A background picture is the one thing that may not survive
that route: `localStorage` holds about 5 MB, where extension storage is happy
with a large photo.

## Tests

Two things in the settings dialog fail quietly rather than loudly, so both are
guarded. They run the real `schema.js` and `settings.js` against a small DOM
shim — no browser, no dependencies:

```
node test/gesture.test.js      # the permission user-gesture chain
node test/background.test.js   # the background picker's settings contract
```

## Licences

- Lucide icons — ISC
- Inter — SIL Open Font License 1.1
- Unsplash photos — [Unsplash License](https://unsplash.com/license), used
  through the API under their
  [guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines)
