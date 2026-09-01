# OpenTiles

**English** · [Русский](README.ru.md)

A free, open-source visual bookmark manager that replaces your browser's new tab
page with a grid of tiles for the sites you actually use.

## Install

OpenTiles is a Firefox add-on. It needs Firefox 140 or later, or Firefox for
Android 142 or later.

To try it now:

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…** and pick `manifest.json` from this folder
3. Open a new tab, and accept the prompt asking whether the new tab page and
   homepage may be overridden

A temporary add-on goes away when Firefox restarts. See
[CONTRIBUTING.md](CONTRIBUTING.md) for building a signed package that stays.

## Features

### Tiles

Add a site with the **+** tile — `example.com` is enough, the `https://` is
filled in for you. Drag tiles to reorder them; the order is saved as you go.
Right-click a tile to edit or delete it.

Every tile can be given an icon of its own — a web address, a file, or a picture
pasted straight from the clipboard — plus its own colour, background, padding and
corner rounding, for the site whose own logo is wrong, ugly, or missing.

### Groups

Sort tiles into groups and click a group to narrow the grid to it. Drag a tile
onto a group to move it there, drag groups to reorder them, and right-click one
to rename or delete it. Deleting a group leaves its tiles alone.

The group bar can float over the page like a HUD or sit across it like a menu
bar, at the top or the bottom, and can hide itself until you point at it. Turn on
**Switch groups by gesture** to change group with the wheel or a touchpad
swipe.

### Backgrounds

Use any picture or video from your computer, or point at a web address. Blur and
dim it to taste — each is remembered per background, so swapping wallpapers does
not mean re-dialling both sliders. The last six are kept under the picker so you
can put one back without going to find the file again.

A local file is stored inside the extension, so your new tab paints instantly and
offline, with no request going out when you open one.

### Appearance

Light, dark, or follow the system. Pick an accent colour from the ten macOS
accents or any hex value. Set the grid's columns, tile size and spacing, and give
tiles one of five shapes — square, circular, 3:2, 16:10 or 16:9.

Type is **Inter** out of the box, and any Google Fonts family can be chosen from
a grid of specimens drawn in their own faces. A chosen font is downloaded once
and cached, so Google is not contacted again on every new tab.

### Clock and date

Optional, above the tiles, each in its own font, weight and letter-spacing, over
a colour and shadow they share. Times and dates are formatted by your browser in
your own locale rather than by a fixed pattern.

### Site icons

OpenTiles hunts for the sharpest icon a site actually publishes rather than
settling for a blurry `/favicon.ico`, measuring every candidate it finds and
keeping the largest. Sites that offer nothing get a coloured monogram.

**Deep icon lookup** goes further and reads each site's own markup and web
manifest, which is the only way to find logos hosted on a separate CDN. It is off
by default because it needs permission to read the sites you save.

### Backup and import

**Export** writes your tiles, groups, settings and background to a single
readable `.json` file, and **Import** reads one back. Import also understands
backups written by **Speed Dial 2**, so you can bring your dials, groups, visit
counts and preferences across.

### Translations

The interface ships in English and Russian: every word lives in one file, and
Firefox picks the language from the browser itself. See
[CONTRIBUTING.md](CONTRIBUTING.md) if you would like to add another.

### Privacy

`storage` is the only permission granted at install. Nothing is sent anywhere,
there is no account, and there is no telemetry. Website access is asked for only
if you switch **Deep icon lookup** on, and is given back the moment you switch it
off.

## Author

Made by **pan4ratte** — <https://github.com/pan4ratte>

Bug reports and feature requests are welcome on the
[issue tracker](https://github.com/pan4ratte/open-tiles/issues); if you would
like to work on the code, start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[GNU AGPL v3](LICENSE). Bundled: [Lucide](https://lucide.dev) icons (ISC) and
[Inter](https://rsms.me/inter/) (SIL OFL 1.1).
