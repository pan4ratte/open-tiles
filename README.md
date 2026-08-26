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
- **right-click a tile** — edit or delete it, or add another
- **right-click the page** — add a tile or start a group; this is the way in
  when either **+** is turned off
- **+ New group** — start a group; **click a group** to show only its tiles
- **drag a tile onto a group** — move it there (or onto *All* to take it out)
- **drag a group** — put the groups in whatever order you like
- **right-click a group** — rename or delete it
- **gear, top right** — settings, in a window of their own (it moves into
  the status bar when the group block is set to one)
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
| Background | Picture — a file, or a web address | none |
| | Blur — 0–40px | 0px |
| | Dim — 0–90% | 35% |
| Layout · Grid | Columns — auto, or 3–12 | Auto |
| | Tile size — 72–200px (the width) | 116px |
| | Spacing — 4–48px | 18px |
| | Order — manual / most visited | Manual |
| Layout · Tiles | Shape — square / circular / 3:2 / 16:10 / 16:9 | Square |
| | Logo padding — 0–40% | 20% |
| | Show site names | on |
| | Show visit counts | off |
| | Show the add button | on |
| | Open sites in a new tab | off |
| | Deep icon lookup | off |
| Header | Show the clock | on |
| | 24-hour time | on |
| | Show the date | off |
| Groups | Appearance — floating / status bar | Floating |
| | Display — always / on hover | Always |
| | Show the new group button | on |
| | Remember the open group | on |
| | Alignment — left / centre / right *(status bar)* | Centre |
| | Position — top / bottom *(status bar)* | Top |
| Other | Backup — export / import | — |
| | Reset all | — |

*Layout* covers two decisions that are really one — how the tiles are arranged
and how each one is drawn — so it is a single section split into two named
boxes down the same panel rather than two sidebar rows. Any section may be
written that way: give it `groups` instead of `fields` in the schema and each
group becomes a box under its own heading.

The window is a fixed size, so moving between sections does not make it jump
about; a panel taller than the pane scrolls on its own, and it keeps its place
if the dialog has to be rebuilt under it.

**Accent colour** opens a picker of this add-on's own rather than the operating
system's: the ten named macOS accents along the top, then a saturation and
brightness square, a hue strip and a hex field for anything else. It is a
popover, so it hangs off the colour well and closes on Escape, on a click
outside, or as soon as the pane behind it scrolls. The same control is reused
for a [tile's own background](#its-background), through
`SettingsUI.colorControl` — there is only ever one picker open, and only one to
fix.

**Other → Backup** writes everything this add-on keeps — tiles, groups,
settings and the background picture — to a single `.json` file, and reads one
back. See [Backup](#backup) below.

**Other → Reset all** puts every setting back to its default and takes the
background picture away. Tiles and groups are left alone.

The two status-bar-only options carry a `when` in the schema and appear only
while *Appearance* is set to *Status bar* — a field is hidden, not disabled, so
the panel never shows a control that does nothing.

The tile grid holds the centre of the window, across and down, and nothing else
is allowed to move it: turning the clock off empties the space above the tiles
rather than sliding them up, and adding a tile keeps the block centred rather
than growing it downwards. What is centred is the tiles that are actually
there — never the space a setting has reserved for tiles that are not.

Down the window the grid sits a little **above** the middle, at roughly 47% of
the height rather than 50%. Dead-centre reads as slightly low to the eye, and
lifting the block off the geometric centre is what makes it look centred. The
one exception is a window too short to hold the clock and the tiles at once —
there the page grows and scrolls, because the alternative is a clock cut off
above the top edge with no way to reach it.

*Auto* columns fit as many tiles per row as the window allows. A fixed count is
a **ceiling on the row, not a fixed width**: six columns with four tiles gives
one row of four, centred, rather than four tiles pushed to the left of a
six-wide box. If the window cannot hold the count asked for, the grid drops to
the columns that fit rather than running off the edge.

## Tile shape

Settings → *Tiles* → **Shape** gives a tile one of five outlines: **square**,
**circular**, or one of the three wide ratios **3:2**, **16:10** and **16:9**.

*Tile size* sets the **width**; the shape sets the height from it. So a 16:9
tile 116px wide is 65px tall — the grid's columns do not move when the shape
changes, only the depth of the rows. A wide tile is a short tile, and a short
tile has less height to share between the icon and the site name, so the icon
shrinks to suit rather than pushing the name out of the box. Turning *Show site
names* off gives that height back to the icon.

**Logo padding** is how much of the room inside a tile is kept clear around the
icon, on every side. At 0% the icon fills whatever the shape and the site name
leave; at 40% it is a small mark in a large tile. It is a share of the room
rather than a number of pixels, so a tile keeps its proportions as *Tile size*
changes. A circle keeps everything further from its edge than a rounded square
does, because a circle cuts its own corners off.

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
  **centre** or **right**. The settings button moves into the bar, at its right
  hand end, the way macOS keeps status items in the menu bar; the page keeps
  its centre inside whatever is left of the window.
- **On hover** fades the block out until the pointer reaches it — with two
  exceptions, because both would otherwise look like a bug: while a group is
  being shown, and while a tile is being dragged.

Chips are put in order by dragging them about the block, the same way tiles are
ordered in the grid — the chip travels under the pointer and where it is let go
is where it stays. "All" and the **+** hold the two ends and do not move.

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

A picture can also be named by **web address** instead — paste one under the
*Choose file* button. Nothing is downloaded into storage, only the address, so
there is no size limit and no re-encoding; the cost is that the browser fetches
it on every new tab, and an address that stops working takes the background with
it. The address is loaded once before it is accepted, so a typo is caught there
rather than becoming a blank page nobody can explain.

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

## Backup

Settings → *Other* → **Export** saves everything the add-on keeps to one
`tiles-backup-YYYY-MM-DD.json` file: your tiles, your groups, every setting and
the background picture, data URI and all. It is indented, so it is a file you
can open and read. **Import** reads one back.

A backup is an envelope — `format`, `version`, `savedAt` — around four optional
sections:

```json
{
  "format": "tiles-backup",
  "version": 1,
  "savedAt": "2026-08-26T09:00:00.000Z",
  "settings": { "accent": "#34c759", "columns": 7 },
  "groups":   [{ "id": "g1", "name": "Work" }],
  "tiles":    [{ "id": "t1", "url": "https://example.com", "title": "Example", "groupId": "g1" }],
  "background": null
}
```

Two rules make an import predictable:

- **A section the file does not carry is left alone.** A backup holding only
  `settings` restores the settings and does not touch your tiles. `"background":
  null` is not the same as no `background` key at all — the first takes the
  picture away, the second leaves whatever is there.
- **A section it does carry replaces what is there**, rather than merging into
  it. A setting the file is silent about comes back as its *default*, not as
  whatever the profile happens to hold — a restore puts the page back the way
  the file describes it, with nothing of the old one showing through.

Nothing is trusted on the way in. Each section goes back through the same call
the page uses to save it normally — `Store.save`, `Store.saveGroups`,
`Schema.coerce` — so a hand-edited or older file cannot put anything into
storage that the page would not have written itself: unknown keys are dropped,
out-of-range numbers are clamped, malformed tiles are discarded. That is also
why a file from a *later* version is read rather than refused: it degrades to
the parts this build understands.

The picture is the one part that can be refused on its own, if it will not fit
in the storage area. When that happens the rest of the restore still stands and
the status line says so, rather than the whole import failing over the least of
what it carried.

Import replaces without asking, the same way **Reset all** and deleting a tile
do. Export first if there is anything on the page you would want back.

### Coming from another add-on

**Import** also reads a backup written by **Speed Dial 2** — the same button,
no separate menu item. When the envelope is not ours, `src/importers.js` is
asked whether it knows the shape, and what it hands back is the same set of
sections, sanitized on the way in exactly like a native file.

| Speed Dial 2 | Tiles |
| --- | --- |
| `dials[].title` / `.url` | the tile |
| `dials[].thumbnail` | its [own icon](#tile-icons) |
| `dials[].visits` | its [visit count](#visit-counts) |
| `dials[].idgroup` | its group |
| `dials[].position` | its place in the grid |
| `groups[].title` / `.position` | the group and its place in the bar |
| `preferences.columns` | Columns |
| `preferences.spacing` | Spacing |
| `preferences.openInNewTab` | Open sites in a new tab |
| `preferences.showAddButton` | Show the add button |
| `preferences.keepActiveGroup` | Remember the open group |
| `preferences.orderBy` — `visits` | Order — *Most visited* |
| `bookmarks.showTitle` | Show site names |
| `bookmarks.showVisits` | Show visit counts |
| `bookmarks.thumbnailRatio` | Logo padding *(the same number, inverted)* |
| `theme.theme` — `auto` | Theme — *System* |
| `theme.font` | Font, unless it is `default` |
| `theme.dark.backgroundImage` | the background, as a web address |

Two things are worth knowing about the shape of that conversion:

- **Order.** Speed Dial 2 numbers each dial *within* its group; Tiles keeps one
  flat list and filters it. So the dials are laid out group by group, in the
  file's group order and by `position` inside each — which is what makes every
  group's page read the way it did over there. Dials sharing a position (it
  happens) keep their file order behind it.
- **The default group.** `home` is a real group there, holding a set of tiles
  that is *not* the same as "All", so it comes across as a group of its own
  rather than being flattened into the loose pile.
- **The background.** Speed Dial 2 keeps one picture per theme; Tiles has a
  single background, so the dark one wins where both are set — it is the one
  chosen against tiles rather than against a white page.

Settings are the one section that arrives **partial**. Another add-on's
preferences overlap ours in a handful of places and say nothing about the rest,
so they are merged into what is already set rather than replacing it — importing
one does not put the accent colour back to blue on the way past. That is what
`partialSettings` on the read result carries.

What Tiles still has nowhere to keep is named in the status line rather than
dropped in silence: the **time-of-day split** behind the visit totals
(`visits_morning` and friends — the totals themselves come across), **group
colours**, and `ts_created`. Preferences with no counterpart here —
`maxWidth`, `fontSize`, `borderRadius`, `padding`, `shadow`, the sidebar
options, the per-theme text and interface colours — are simply not read.

## Editing a tile

Right-click a tile and choose **Edit tile**. **Appearance** shows it as it will really
be drawn — the same `.tile` element, the same classes, the same custom
properties — so shape, corner, logo padding and whether the name shows all
follow the settings without the sheet knowing any of them. It is a preview, not
an impression of one; the only thing it changes is `--tile-size`, capped so a
200px tile still fits the sheet.

### Its icon

A tile normally finds its own picture — see [Site icons](#site-icons) below.
Any tile can override that with one of its own: fill in **Icon**, either as a
web address or by choosing a file. A set icon is drawn straight away and the
lookup never runs, so it is also the way to fix a site whose own icon is wrong,
ugly, or missing.

A chosen file is scaled to fit 256px and kept inline as a PNG — transparent, so
a logo sits on the tile rather than in a white box, and fitted rather than
cropped so a wide wordmark keeps its ends. Files under 32 KB are stored byte
for byte, which keeps SVGs sharp. An icon is capped at 256 KB: the tile list is
rewritten on every drag, so nothing on it may grow to the size of a background.

Only `https:`, `http:` and `data:image/` are accepted. Anything else — a
`javascript:` address in a hand-edited or imported file, most of all — is
dropped on the way into storage.

### Its background

A tile can stand on a colour of its own instead of the frosted material.
**Background** opens the same picker the accent colour uses, and the **pipette**
beside it takes a colour straight out of the icon: arm it, and the next click
on the icon reads the pixel under the pointer. Where there is no icon yet the
monogram answers instead. Clear it with the arrow to go back to the usual tile.

Reading a picture's pixels means drawing it to a canvas, which the browser only
allows for one it is sure the page may read: stored inline, or served by a host
that says so. An icon is first tried as it is, and then asked for again as a
CORS request — most icon hosts agree to that, and the ones that do not cannot be
sampled, which the pipette says rather than going quiet.

The name on a coloured tile is set to black or white by the colour's relative
luminance, so it stays readable on a dark navy and on a bright yellow alike, and
it drops the text shadow it would otherwise wear over a background picture — it
is standing on its own colour, not on the picture.

## Visit counts

Opening a site from the new tab counts a visit against its tile. Turn
**Layout → Tiles → Show visit counts** on to see the number in the corner of
each tile, and **Layout → Grid → Order → Most visited** to sort the grid by it.

Sorting is a *view*, not a rewrite: the order you dragged tiles into is left in
storage untouched, so turning *Most visited* back off puts the grid back exactly
as it was. While it is on, dragging a tile to a new place no longer sticks —
there is nothing for it to stick to.

The count is written as the click happens rather than batched, because this page
is usually on its way out at that moment. A count lost now and then is the
price, and it is the right thing to lose.

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
| `src/transfer.js` | `Transfer` — backup files: the envelope, reading and writing |
| `src/importers.js` | `Importers` — backups written by other add-ons |
| `src/favicons.js` | `Favicons` — site icon discovery and caching |
| `src/settings.js` | `SettingsUI` — renders the settings dialog from the schema |
| `src/newtab.js` | Rendering, drag & drop reordering, wiring |
| `test/gesture.test.js` | Guards the permission user-gesture chain |
| `test/background.test.js` | Guards the background picker and the settings tabs |
| `test/groups.test.js` | Guards groups, conditional fields and the markup's ids |
| `test/live.test.js` | Guards the change feed, the subsections and the accent picker |
| `test/transfer.test.js` | Guards the backup envelope, its refusals and the buttons |
| `test/importers.test.js` | Guards reading another add-on's backup |
| `test/dom-shim.js` | The scrap of DOM every test runs the dialog against |
| `fonts/` | Bundled Inter (variable) + its `@font-face` rules |
| `icons/icon.svg` | Toolbar / add-on manager icon (Lucide `layout-grid`) |

## Storage

| Key | Shape |
| --- | --- |
| `tiles` | `[{ id, url, title, groupId, icon, bg, visits }]` — `groupId` is `null` when loose; `icon` is `''` when the site's own is looked up; `bg` is `''` for the usual frosted tile |
| `groups` | `[{ id, name }]` |
| `activeGroup` | id of the group last shown, or `null` for *All* |
| `settings` | see `src/schema.js` |
| `background` | `{ src, name, savedAt }`, or `null` — `src` is a `data:` URI or a web address |
| `fontCache` | `{ [family]: { css, savedAt } }` |
| `iconCache` | `{ [origin]: { url, size, mode, savedAt } }` |

Open new tab pages stay in sync through `storage.onChanged`. That feed reports
a page's *own* writes back to it as well as everybody else's, so `storage.js`
leaves the signature of each write behind and drops the event carrying it back.
Without that, changing a setting looks to the page like an edit made in another
tab: it rebuilds the grid and the open dialog under the pointer, and a slider
cannot be dragged through more than one step. A real edit from another page has
a different signature and still gets through. Because
`src/storage.js` falls back to `localStorage`, you can also open
`src/newtab.html` directly in a browser to iterate on the UI without reloading
the extension — only the Google Fonts fetch and the deep icon lookup behave
differently there. A background picture is the one thing that may not survive
that route: `localStorage` holds about 5 MB, where extension storage is happy
with a large photo.

## Tests

Several things here fail quietly rather than loudly, so each is guarded. They
run the real `schema.js`, `settings.js`, `storage.js`, `transfer.js` and
`importers.js` against a small DOM shim — no browser, no dependencies:

```
node test/gesture.test.js      # the permission user-gesture chain
node test/background.test.js   # the background picker and the settings tabs
node test/groups.test.js       # groups, conditional fields, markup ids
node test/live.test.js         # the change feed, subsections, the accent picker
node test/transfer.test.js     # the backup envelope, its refusals, the buttons
node test/importers.test.js    # reading a Speed Dial 2 backup
```

The last of those also checks that every `getElementById` in `src/newtab.js`
still finds an id in `src/newtab.html` — moving a control between the two (the
reset button, say) otherwise throws on load and takes the whole page with it.

## Licences

- Lucide icons — ISC
- Inter — SIL Open Font License 1.1
