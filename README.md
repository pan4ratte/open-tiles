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
| Background | Picture or video — a file, or a web address | none |
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
| | Show the All category | on |
| | Show the new group button | on |
| | Remember the open group | on |
| | Animate group changes | on |
| | Switch groups by scrolling | off |
| | Gesture direction — up and down / left and right / either *(scrolling)* | Up and down |
| | Position — top / above the tiles / bottom *(floating)* | Top |
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
settings and the background — to a single `.json` file, and reads one back. See
[Backup](#backup) below.

**Other → Reset all** puts every setting back to its default and takes the
background away, the history of recent ones included. Tiles and groups are left
alone.

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
other than `settings`, which is how the background stays out of an
object that is rewritten on every slider drag.

## Groups

A group is a name and the tiles put into it. They show as chips in a block over
the page: click one to narrow the grid to its tiles, click **All** to see
everything again. A tile can be dragged straight onto a chip to move it
there, which is usually quicker than opening the tile dialog and picking a group
from the list. Deleting a group leaves its tiles alone — they simply go loose
and show under *All*.

Settings → *Groups* decides how the block looks:

- **Floating** — a HUD pill, frosted whatever is behind it, sitting at the
  **top** of the window, at the **bottom** of it the way the Dock does, or
  **above the tiles**. The first two float over the page; the third is not a
  float at all — the pill takes its place in the page's own column, under the
  clock and over the grid, and moves with them as the window changes shape.
- **Status bar** — the menu bar: a full-width translucent strip pinned to the
  **top** or **bottom** of the window, with its chips to the **left**,
  **centre** or **right**. The settings button moves into the bar, at its right
  hand end, the way macOS keeps status items in the menu bar; the page keeps
  its centre inside whatever is left of the window.
- **On hover** fades the block out until the pointer reaches it. Picking a
  group brings it back for a moment and it then steps away again, the way a
  scrollbar does — a grid that has just been filtered has to say what filtered
  it, or the tiles that went look like tiles that were lost. It also stays out
  while a tile is being dragged, which is the moment the chips are wanted.

**Show the All category** takes the *All* chip away. The page then always sits
in a group — opening on the first one where it would have opened on *All* —
and a tile leaves a group from the tile dialog rather than by being dragged
onto the chip that is no longer there. The scroll gesture walks the same
shortened line, so there is nowhere along it the block cannot show.

Chips are put in order by dragging them about the block, the same way tiles are
ordered in the grid — the chip travels under the pointer and where it is let go
is where it stays. "All" and the **+** hold the two ends and do not move.

### Changing group

Picking a group is a page turn, so the grid moves like one. The tiles on screen
slide a little the way you are travelling and fade out; the new ones come in
from the other side, slower than the old ones left, because what arrives is
what the eye should follow. Which way it runs is read off the block itself — a
group further along the chips comes in from the right, one further back from
the left — so the movement agrees with what you clicked.

The travel is deliberately small, and the fade does most of the work. A
full-width slide belongs to a screen you put your thumb on; a window on a desk
gets the shorter, quieter version macOS uses to move between two views. The
chips light up the moment you pick one, without waiting for the grid, so the
page always answers instantly even while the tiles are still moving.

**Animate group changes** turns the whole thing off, and the grid then simply
changes. It is off regardless whenever the system asks for reduced motion.

### Switching by scroll or touchpad

**Switch groups by scrolling** turns to the next group along on a roll of the
wheel or a swipe across the touchpad. **Gesture direction** decides which way
the gesture runs — **up and down**, **left and right**, or **either**, which
takes whichever way the flick was mostly going. Down and right go on to the
next group; up and left go back.

**Left and right** answers a mouse wheel too, which has only the one direction
to give: a notch of one counts as the sideways push it was meant to be, so the
setting is not one that quietly does nothing for anyone without a touchpad. A
wheel is told from fingers by what it sends — whole notches, in lines or pages
or one big round pixel step, with nothing sideways beside them, where a
touchpad sends a stream of small uneven deltas and leaks a little to the side
even when swiped straight. So a touchpad scrolled up and down is still left to
the page, which is what asking for left and right was about.

It walks the same line the chips show, "All" at the front, and it stops at each
end rather than coming round again — flick past the last group and the content
gives a little in the direction you pushed and comes back, which is how it says
there is nothing further. Where there are more chips than the block can show,
the strip scrolls to keep the one you are on in view.

Keep scrolling and it keeps going, about four groups a second — fast enough to
feel like one movement, slow enough that each group is actually on screen to be
seen. Stop, and it stops.

Getting that right is most of the work here, because a single swipe of two
fingers is not one wheel event but a flurry of them, followed by a tail of
momentum after your fingers have lifted. The deltas are added up and a group is
turned each time they pass the threshold, never more often than the repeat
allows. The tail is the awkward part: it is deltas like any other and would
carry on turning groups by itself. It gives itself away by fading — momentum
only ever decays, while a finger still moving holds its strength — so past the
first turn, an event has to still carry a fair share of the hardest push in the
gesture to count. A hard flick may carry a group past the one you aimed at,
which is what a flick is for; a released one does not run away with the block.

The gesture keeps its hands off scrolling that belongs to something else: a
dialog, the right-click menu, the colour picker, a pinch to zoom, and the chip
block itself once it holds more chips than it can show.

Groups live under their own storage key and sync across open new tab pages like
everything else. There is room for 24 of them, each with a name of up to 32
characters.

## Background

Settings → *Background* → **Choose file** takes any image or video on this
computer; you can also drop one straight onto the preview. **Six megabytes is
the ceiling for a picture, sixteen for a video** — a file over it is refused on
the spot, with a notice naming its size and the limit, rather than being read
and quietly dropped later.

Under that ceiling, a picture larger than 2560px on its longest edge is scaled
down to fit and re-encoded as JPEG, so a phone photo does not have to fit in
extension storage at full size. Files under 800 KB are stored byte for byte,
which keeps SVGs and animated GIFs whole. Either way it is stored as a `data:`
URI, so the new tab paints offline and no request goes out when you open one.

A video gets none of that treatment: nothing here can shorten one or re-encode
it, so the only lever is the higher ceiling, which is why it is the one kind of
file the add-on will refuse without offering to shrink it. It is opened once
before it is accepted, so a container this browser cannot decode is caught there
rather than becoming a black page. On screen it is muted, looped and played
inline, which is what lets it start without a click.

Either kind can be named by **web address** instead — paste one under the
*Choose file* button. Nothing is downloaded into storage, only the address, so
there is no size limit and no re-encoding; the cost is that the browser fetches
it on every new tab, and an address that stops working takes the background with
it. For a video it is also the only way to have one longer than the storage
ceiling allows. The address is loaded once before it is accepted, so a typo is
caught there rather than becoming a blank page nobody can explain — and what
loads is what decides which of the two it is. Both are tried at once rather than
in turn, because an address need not end in anything that gives it away
(`…/loop.mp4?v=2` and a CDN path with no extension both work), and a dead
address should cost one wait rather than two.

The **last six backgrounds** are kept under the picker, newest first, so one can
be put back without going to find the file again. They are laid out three across
and two down rather than as a row that shares itself out, which is what keeps a
thumbnail the same size whether there is one of them or six — a flex row grows
the last picture left to the full width of the panel, and that reads as a second
preview rather than as a thumbnail. The one on screen is marked rather than left
out, and moving ones carry a play badge, since a thumbnail of a video is a still.
Choosing one again moves it up rather than repeating it.

Each one is **dropped** with the × in its corner, which appears when the
thumbnail is pointed at or tabbed into — six delete buttons on show turn a grid
of pictures into a grid of controls. That takes the entry out of the history and
does not touch what is on screen, even when it is the one being dropped:
*Remove*, just above, is the way to take the background away. Removing the
background is the mirror of it and leaves the history alone — putting back what
was just taken away is most of what it is for — while *Reset all* clears the lot,
because leaving six stored pictures a click from being back is not what "take the
background away" says.

Every entry also carries the **Blur and Dim it was last looked at with**, and
going back to one brings those back with it: a photograph wants dimming where a
flat colour does not, and having to re-dial the pair every time you swap
wallpapers is most of the friction in swapping them. The pair is written against
the wallpaper you are *leaving*, at the moment you leave it — not on every slider
drag. The history is the heaviest thing in the storage area, and a wallpaper
still on screen needs nothing remembered about it: what is in `settings` already
*is* how it looks. For the same reason the pair rides on the history entry rather
than on the `background` record, which is the megabytes; an entry that falls off
the end takes its settings with it rather than leaving them behind for nothing.
An entry from before this existed carries no pair at all, which is not the same
as carrying the defaults — going back to one leaves the sliders where they are.

The history holds whole backgrounds, not thumbnails: a stored one *is* its data
URI, and there would be nothing to put back from a thumbnail. That makes it the
heaviest thing in the storage area, so it is capped twice over — six entries,
and 64 MB between them. One named by web address costs only its address, so a
history of those never comes near the ceiling.

The background appears behind the tiles the moment it is chosen — it goes on
screen before it is written to storage, not after. The preview in the dialog
runs the full width of the panel, is shaped like the window and is cropped the
same way (`cover`, centred), so what it shows is what ends up behind the tiles —
*Blur* and *Dim* included. The blur radius is scaled by the preview's width
against the window's, so a 40px blur reads at the same strength in a 500px
preview as it does full size. A video plays in the preview rather than being
framed there, because what the preview is for is saying what the page will look
like.

*Blur* and *Dim* apply to the background only, not to what stands on it. Dim
fades towards black in both themes: dimming towards white washes a picture out
rather than settling it back. That is why the clock, the date and the settings
button are lit in both themes once there is a background behind them — they
stand on the picture with no material of their own, so their ink cannot follow
the theme without going dark on dark. Everything that does have a material —
tiles, the group block — is frosted glass either way, and over a picture it
thins out further so more of it shows through.

## Backup

Settings → *Other* → **Export** saves everything the add-on keeps to one
`tiles-backup-YYYY-MM-DD.json` file: your tiles, your groups, every setting and
the background, data URI and all — the last six are left out, being a history
rather than a setting. It is indented, so it is a file you
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
Any tile can override that with one of its own: fill in **Icon** with a web
address, choose a file, or paste one — see below. A set icon is drawn straight
away and the lookup never runs, so it is also the way to fix a site whose own
icon is wrong, ugly, or missing.

A chosen file is scaled to fit 256px and kept inline as a PNG — transparent, so
a logo sits on the tile rather than in a white box, and fitted rather than
cropped so a wide wordmark keeps its ends. Files under 32 KB are stored byte
for byte, which keeps SVGs sharp. An icon is capped at 256 KB: the tile list is
rewritten on every drag, so nothing on it may grow to the size of a background.

Only `https:`, `http:` and `data:image/` are accepted. Anything else — a
`javascript:` address in a hand-edited or imported file, most of all — is
dropped on the way into storage.

#### Pasting one

Two things can be pasted into the tile sheet and mean *use this as the icon*.

**A picture on the clipboard** — copied out of a drawing program, or with
*Copy image* in a browser — is taken wherever the caret happens to be, because
a file cannot be typed into a field and there is nothing else it could have
meant. It goes through exactly the same scaling as a chosen file. Paste a file
that is not a picture and it says so rather than doing nothing.

**SVG source** — what a design tool or a code editor puts on the clipboard —
is converted to a data URI and kept whole, so it stays sharp at any tile size.
This one is only taken from the **Icon** field, or from the sheet with nothing
focused: it is still text, and pasting it into the address or name field should
give you the text you asked for rather than watch it disappear into a picture.
An address pasted into the Icon field is likewise left alone to paste itself.

Two things are put right on the way through, because both are ordinary in
copied markup and both otherwise fail in silence — the tile simply shows its
letter and nothing says why:

- **No `xmlns`.** An `<img>` draws nothing at all for an SVG that does not name
  its namespace, and markup lifted out of a page's DOM never carries one,
  because the page had already established it. One is added.
- **No `viewBox`.** Then the picture has a fixed size rather than a shape, and
  will not scale to the tile. Where `width` and `height` were given, they say
  what the shape was meant to be, and a `viewBox` is built from them.

The running parts — a `<script>`, a `<foreignObject>`, an `onclick`, a
`javascript:` href — are stripped out. An `<img>` is already a sealed room: the
browser runs no script in an SVG loaded that way and fetches nothing the
picture refers to, and that, not the stripping, is what makes a pasted logo
safe to draw. The stripping is for afterwards, because the source is kept in
storage and handed back out in a backup file, and it should carry nothing that
would run if it ever landed somewhere less careful than an `<img>`.

Pasted SVG is refused above 128 KB. That is deliberately under the 256 KB cap
on a tile's icon, because storage drops anything over that by storing nothing
at all — a refusal in the sheet can say why, where a silent drop cannot.

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
   `<link rel="icon | apple-touch-icon | mask-icon">` tags, its
   `msapplication-TileImage` and square-logo metas, and the `icons[]` of its web
   manifest. This is the only way to find logos on a separate CDN host or at a
   hashed path — Figma's 1024px SVG and 512px manifest icons, or Google Fonts'
   192px branded PNG on gstatic, are invisible to any other method.
   It needs permission to read the sites you save, so the toggle asks for it and
   turns itself back off if you decline. See *Permissions* below.
2. **Conventional paths** — `/favicon.svg`, `/icon.svg`,
   `/apple-touch-icon.png`, `/android-chrome-512x512.png` and a dozen others,
   probed in three waves ordered by *what each is usually worth* rather than by
   how common it is. The common case costs four requests instead of fifteen.
3. **`/favicon.ico`** as the floor, and a coloured monogram (or the Lucide
   `globe`) when a site offers nothing.

Every candidate is loaded as an `<img>` and *measured*, so the winner is the one
that really is largest — not the one whose filename claims a size. SVGs win
outright, and anything under 16px is discarded as a placeholder. Probing images
needs no permissions; only the deep lookup does.

### How sharp the result is

A tile's logo is at most about 172 CSS pixels across — a 200px tile less its
inset — which is **344 real pixels on a 2× screen**. Three separate ceilings
used to sit below that, and each one silently cost resolution:

- **Probing stopped at 128px.** A site publishing both a 180px
  `apple-touch-icon` and a 512px `android-chrome` icon handed over the 180,
  because the first wave had already cleared the bar. The bar is now 256px, and
  the first wave asks for the large ones to begin with.
- **A kept picture was redrawn at 192px** — under half of what the largest tile
  draws — and then held in that state for a month. It is now 384px.
- **A vector over 13 KB was rasterized** on its way into the cache. That is the
  one case where keeping a picture makes it *worse* than not keeping it: an SVG
  is sharp at every size until it is turned into a bitmap. Vectors are now never
  redrawn. One too large to store is simply not stored, and the tile loads the
  address instead — still the vector.

Going over the storage ceiling is not a failure, for the same reason: the
picture is not kept, the tile loads the address as an `<img>`, and what is lost
is only its instant appearance on the next new tab.

Results are cached per origin (hits 30 days, misses 3 days), at most four
origins are resolved at once, and turning deep lookup on or off clears the cache
so every tile is re-resolved.

Cache entries carry the **revision** of the lookup that found them. Bumping it
is what lets a sharper lookup reach sites you have already visited — otherwise
a better result would only ever be seen by someone who had never opened that
site before, because the old answer stays fresh for a month.

### Looking one up again

The **↻** button beside *Icon* in the tile sheet looks the site's own icon up
again from scratch: past the answer cached here, and past the browser's own
cache for the page and manifest it reads on the way. It reports what it found
and how big it was, which matters — *the icon is blurry* and *this site only
publishes a 32px icon* look identical on a tile, and only one of them is
something you can do anything about. Where deep lookup is off and the result is
small, it says so.

A picture of the tile's own is what would be drawn instead, so the button
clears one if it is set — looking up the site's icon cannot mean anything else
while an override is in place. Nothing is written until **Save**.

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
| `src/backgrounds.js` | `Backgrounds` — the page background: encoding, limits, painting |
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
| `background` | `{ src, name, type, savedAt }`, or `null` — `src` is a `data:` URI or a web address, `type` is `image` or `video` |
| `bgRecent` | `[background & { effects }]` — the last six, newest first; `effects` is the `{ bgBlur, bgDim }` that entry was last looked at with |
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
differently there. The background is the one thing that may not survive
that route: `localStorage` holds about 5 MB, where extension storage — with
`unlimitedStorage` asked for in the manifest — is happy with a large photo or a
video, and with six more of them in the history.

## Tests

Several things here fail quietly rather than loudly, so each is guarded. They
run the real `schema.js`, `settings.js`, `storage.js`, `transfer.js` and
`importers.js` against a small DOM shim — no browser, no dependencies:

```
node test/gesture.test.js      # the permission user-gesture chain
node test/background.test.js   # the background picker and the settings tabs
node test/groups.test.js       # groups, conditional fields, markup ids
node test/groupswitch.test.js  # the group transition and the scroll gesture
node test/paste.test.js        # pasted SVG code and pasted pictures
node test/favicon.test.js      # icon resolution: probing, keeping, the cache
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
