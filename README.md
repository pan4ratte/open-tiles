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
- **right-click a tile** — edit or delete it (opens as a sheet)
- **+ New group** — start a group; **click a group** to show only its tiles
- **drag a tile onto a group** — move it there (or onto *All* to take it out)
- **right-click a group** — rename or delete it
- **gear, top right** — settings, in a window of their own
- **Esc** — close a sheet or the settings window

## Design

The interface follows Apple's Human Interface Guidelines for macOS. The icons
are Lucide and the type is Inter — those stay ours; everything else about the
look is Apple's. [`src/newtab.css`](src/newtab.css) is organised around four
ideas, and its opening comment says the same:

**Semantic colour.** Nothing in the stylesheet names a colour it wants; it names
the job the colour does — `--label`, `--fill-secondary`, `--separator`,
`--system-red`. Each job has a light and a dark value, so switching theme is a
token swap and nothing else. The system palette is Apple's, including the pairs
that differ between themes (`#007AFF` / `#0A84FF` for blue, `#FF3B30` /
`#FF453A` for red), and the accent defaults to systemBlue.

**Materials.** Surfaces are translucent and blur what is behind them, in four
thicknesses — thick for sheets and toolbars, regular for the group pill and the
sidebar, thin for tiles. Depth comes from the material and a hairline stroke
rather than from a heavy shadow. Where `backdrop-filter` is unavailable, and
wherever the reader has asked for **Reduce transparency**, every material falls
back to something opaque.

**Deference.** Controls are small, quiet and macOS-shaped: 22px switches, 4px
sliders with a round knob, pop-up buttons with the paired chevron, and Ventura's
segmented control — a tinted trough with the chosen segment *raised* out of it
in the control colour rather than filled with the accent. The accent is spent
only where it carries meaning: the default button, the selected sidebar row, the
active group.

**Continuity of motion.** Everything that appears, appears from somewhere, on
Apple's curves. A sheet slides down from the top edge; a window scales the last
few per cent into place; a switch knob springs.

Two presentations, and the difference is deliberate. A **sheet** belongs to the
page it interrupts — it comes down from the top edge, keeps its bottom corners
round and its top corners square, and is dismissed by its own *Cancel* and
default buttons, with anything destructive banished to the far left. That is the
tile and group dialogs. **Settings** is a **window**: centred, fully rounded, a
toolbar with a centred title, and closed from that toolbar.

Site icons are clipped to Apple's app-icon squircle — one `<clipPath>` in
[`src/newtab.html`](src/newtab.html), in `objectBoundingBox` units, so the one
path fits an icon of any size.

## Settings

Everything lives in one window, laid out the way macOS System Settings is: the
sections run down a translucent sidebar, each with its glyph on a tinted rounded
square, and the chosen one's panel fills the pane beside it. Related rows are
gathered into a grouped box with hairlines between them. The sidebar lies down
across the top when the window is too narrow for it. Changes apply as you make
them and are written to storage in the background.

| Section | Setting | Default |
| --- | --- | --- |
| Appearance | Theme — system / dark / light | System |
| | Accent colour | `#007AFF` (systemBlue) |
| | Font — any Google Fonts family | Inter |
| Background | Picture — a file from this computer | none |
| | Blur — 0–40px | 0px |
| | Dim — 0–90% | 35% |
| Layout | Columns — auto, or 3–12 | Auto |
| | Tile size — 72–200px | 116px |
| | Spacing — 4–48px | 18px |
| Header | Show the clock | on |
| | 24-hour time | on |
| | Show the date | off |
| Tiles | Show site names | on |
| | Open sites in a new tab | off |
| | Deep icon lookup | off |
| Groups | Appearance — floating / status bar | Floating |
| | Display — always / on hover | Always |
| | Alignment — left / centre / right *(status bar)* | Centre |
| | Position — top / bottom *(status bar)* | Top |
| Other | Reset all | — |

The window is a fixed size, so moving between sections does not make it jump
about; a panel taller than the pane scrolls on its own.

**Other → Reset all** puts every setting back to its default and takes the
background picture away. Tiles and groups are left alone.

The two status-bar-only options carry a `when` in the schema and appear only
while *Appearance* is set to *Status bar* — a field is hidden, not disabled, so
the panel never shows a control that does nothing.

Tiles are centred at every size. *Auto* columns fit as many tiles per row as the
window allows; a fixed count keeps the grid at exactly that width, centred,
rather than leaving it against one edge of the row.

Each section also carries a `tint` — the colour of its sidebar square. Adding a
field to [`src/schema.js`](src/schema.js) is all it takes to add a
setting — the dialog, the defaults and the validation all read from there. A
field marked `external` renders in the dialog but keeps its value somewhere
other than `settings`, which is how the background picture stays out of an
object that is rewritten on every slider drag.

## Groups

A group is a name and the tiles put into it. They show as chips in a block at
the top of the page: click one to narrow the grid to its tiles, click **All** to
see everything again. A tile can be dragged straight onto a chip to move it
there, which is usually quicker than opening the tile dialog and picking a group
from the list. Deleting a group leaves its tiles alone — they simply go loose
and show under *All*.

Settings → *Groups* decides how the block looks:

- **Floating** — a HUD pill above the clock, frosted whatever is behind it.
- **Status bar** — the menu bar: a full-width translucent strip pinned to the
  **top** or **bottom** of the window, with its chips to the **left**,
  **centre** or **right**. A bar along the top pushes the settings button and
  the page down out of its way.
- **On hover** fades the block out until the pointer reaches it — with two
  exceptions, because both would otherwise look like a bug: while a group is
  being shown, and while a tile is being dragged.

Groups live under their own storage key and sync across open new tab pages like
everything else. There is room for 24 of them, each with a name of up to 32
characters.

## Background

Settings → *Background* → **Choose file** takes any image on this computer; you
can also drop one straight onto the preview. **Six megabytes is the ceiling** —
a file over it is refused on the spot, with a notice naming its size and the
limit, rather than being read and quietly dropped later.

Under that ceiling, anything larger than 2560px on its longest edge is scaled
down to fit and re-encoded as JPEG, so a phone photo does not have to fit in
extension storage at full size. Files under 800 KB are stored byte for byte,
which keeps SVGs and animated GIFs whole. The picture is stored as a `data:`
URI, so the new tab paints offline and no request goes out when you open one.

The picture appears behind the tiles the moment it is chosen — it goes on screen
before it is written to storage, not after. The preview in the dialog runs the
full width of the panel, is shaped like the window and is cropped the same way
(`cover`, centred), so what it shows is what ends up behind the tiles — *Blur*
and *Dim* included. The blur radius is scaled by the preview's width against the
window's, so a 40px blur reads at the same strength in a 500px preview as it
does full size.

*Blur* and *Dim* apply to the picture only, not to what stands on it. Dim fades
towards the theme colour rather than towards black, so it keeps the text legible
in light and dark alike. The tiles and the group block are frosted glass either
way; over a picture they thin out further, so more of it shows through.

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

Settings → *Font* sets the clock and the tile names, and nothing else — the
dialogs, buttons and labels stay on Inter whatever is chosen, so an ornamental
family cannot make the UI hard to read. It accepts **any family Google Fonts
serves**, not just the ~50 suggestions in the dropdown. The first time a family is chosen, `src/fonts.js`

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
| `src/newtab.html` | Page markup, squircle clip path, sheets, settings window |
| `src/newtab.css` | The design system: Apple tokens, materials, controls, motion |
| `src/icons.js` | `Icons` — the Lucide set used by the UI, inlined |
| `src/schema.js` | `Schema` — settings definitions, defaults, validation |
| `src/storage.js` | `Store` — `browser.storage.local` with a localStorage fallback |
| `src/fonts.js` | `Fonts` — Google Fonts loading and caching |
| `src/backgrounds.js` | `Backgrounds` — the page picture: encoding, limits, painting |
| `src/favicons.js` | `Favicons` — site icon discovery and caching |
| `src/settings.js` | `SettingsUI` — renders the settings dialog from the schema |
| `src/newtab.js` | Rendering, drag & drop reordering, wiring |
| `test/gesture.test.js` | Guards the permission user-gesture chain |
| `test/background.test.js` | Guards the background picker and the settings tabs |
| `test/groups.test.js` | Guards groups, conditional fields and the markup's ids |
| `test/dom-shim.js` | The scrap of DOM both tests run the dialog against |
| `fonts/` | Bundled Inter (variable) + its `@font-face` rules |
| `icons/icon.svg` | Toolbar / add-on manager icon (Lucide `layout-grid`) |

## Storage

| Key | Shape |
| --- | --- |
| `tiles` | `[{ id, url, title, groupId }]` — `groupId` is `null` when loose |
| `groups` | `[{ id, name }]` |
| `settings` | see `src/schema.js` |
| `background` | `{ src, name, savedAt }`, or `null` |
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

Several things here fail quietly rather than loudly, so each is guarded. They
run the real `schema.js`, `settings.js` and `storage.js` against a small DOM
shim — no browser, no dependencies:

```
node test/gesture.test.js      # the permission user-gesture chain
node test/background.test.js   # the background picker and the settings tabs
node test/groups.test.js       # groups, conditional fields, markup ids
```

The last of those also checks that every `getElementById` in `src/newtab.js`
still finds an id in `src/newtab.html` — moving a control between the two (the
reset button, say) otherwise throws on load and takes the whole page with it.

## Licences

- Lucide icons — ISC
- Inter — SIL Open Font License 1.1
