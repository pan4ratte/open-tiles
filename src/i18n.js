/**
 * Every word this add-on says, in one place.
 *
 * Nothing else in `src/` holds a sentence. A file that needs one asks for it
 * by key - `t('tile_addTitle')` - and the markup asks by attribute, so adding
 * a language is a translation job rather than a programming one.
 *
 * ## Where a translation actually comes from
 *
 * Firefox's own `browser.i18n` is asked first. It picks the folder under
 * `_locales/` that matches the browser's language and hands back the string
 * from its `messages.json`; that is the machinery add-on sites and translation
 * platforms already understand, and it is what a translator's file plugs into.
 *
 * The English below is the fallback under it, and the source `_locales/en` is
 * generated from - see `tools/build-locales.js`. It is here rather than only in
 * the JSON for one reason: `browser.i18n` does not exist when `src/newtab.html`
 * is opened straight off disk, which is how the interface is worked on (see
 * CONTRIBUTING.md), and Firefox will not let a `file:` page fetch the JSON to
 * make up for it. So English is compiled in, and every other language is
 * loaded by the browser.
 *
 * ## Writing a message
 *
 * `$1`, `$2` … are filled in by the caller, in order. They are Firefox's own
 * substitution syntax, so a message reads the same here and in `messages.json`.
 *
 *   t('group_full', Store.MAX_GROUPS)
 *   t('bg_pictureTooBig', '9 MB', '6 MB')
 *
 * Whole sentences, never halves glued together: word order is the first thing
 * a translation changes, so a message that arrives as "Found a " + n + "px
 * icon" cannot be translated into a language that puts the number last. Where
 * English would join two clauses with a comma, that is two messages here - one
 * per case, each complete.
 *
 * Counting is the same problem: `plural` below takes a pair of keys, one for
 * one and one for the rest, because a language with three plural forms needs
 * somewhere to put the third and a language with none needs the pair to be
 * allowed to say the same thing.
 *
 * ## Marking up the page
 *
 * `newtab.html` carries the keys as attributes, and `I18N.apply()` fills them
 * in before the page is shown:
 *
 *   data-i18n="key"              the element's text
 *   data-i18n-title="key"        its title=
 *   data-i18n-label="key"        its aria-label=
 *   data-i18n-placeholder="key"  its placeholder=
 *
 * Where a message has something drawn in the middle of it - the icon in the
 * paste hint - the element the message wraps around carries `data-i18n-slot`
 * and the message carries `$1` where it goes.
 */
const I18N = (() => {
  /**
   * The keys, and what they say in English.
   *
   * Key names are `area_thing`: letters, digits and underscores only, which is
   * all `messages.json` allows. Keep an area's keys together and the order of
   * this file roughly the order of the interface - a translator reads it top to
   * bottom.
   */
  const MESSAGES = {
    // ----------------------------------------------------------- the add-on
    // Shown by Firefox itself, in about:addons and on the add-on's listing.
    // The name is a proper noun and is here to be transliterated, not
    // translated.
    extName: 'OpenTiles',
    extDescription: 'A free, modern, open-source and highly customizable visual bookmark '
      + 'manager and '
      + 'start page for your browser.',

    // -------------------------------------------------------------- the page
    page_title: 'New Tab',
    page_groupbar: 'Tile groups',
    page_grid: 'Quick access tiles',
    page_settings: 'Settings',
    page_search: 'Search',

    empty_inGroup: 'Nothing in this group yet - drag a tile onto its name to put it here.',
    empty_noTiles: 'No tiles yet. Hit + to add your first bookmark.',
    empty_noTilesNoAdd: 'No tiles yet. Right-click anywhere to add your first bookmark.',
    // $1 is what was typed into the search field.
    empty_noMatches: 'Nothing here matches “$1”.',

    // ------------------------------------------------------------ the search
    // The field that takes the block of group chips' place. It looks through
    // every group, which is what the placeholder is there to say - a field
    // sitting where a group filter was would otherwise read as searching the
    // group being shown.
    search_placeholder: 'Search every group',
    search_close: 'Close search',

    // ------------------------------------------------------------- the tiles
    tile_add: 'Add a tile',
    // $1 is how many times this site has been opened from here.
    tile_visits: '$1 visits',
    // Standing in for a name while the sheet has no address typed in it yet.
    tile_sampleName: 'My favourite site',

    // ------------------------------------------------------ the right-click menu
    menu_addTile: 'Add tile',
    menu_newGroup: 'New group',
    menu_settings: 'Settings',
    menu_search: 'Search tiles',
    menu_openInNewTab: 'Open in new tab',
    menu_editTile: 'Edit tile',
    menu_deleteTile: 'Delete tile',

    // ------------------------------------------------------------ the groups
    // The chip that clears the filter, and what its tooltip says.
    group_all: 'All',
    group_allTitle: 'Every tile',
    // $1 is the group's name. The line break is deliberate: a tooltip's second
    // line says what can be done to it.
    group_chipTitle: '$1\nDrag to reorder, right-click to rename or delete',
    group_new: 'New group',
    group_edit: 'Edit group',
    group_sheetNote: 'Tiles are added to a group by dragging them onto it.',
    group_name: 'Name',
    group_namePlaceholder: 'Work',
    group_needName: 'Give the group a name.',
    // $1 is the most groups there is room for.
    group_full: 'That is as many groups as there is room for ($1).',
    // What a group with no usable name of its own is called.
    group_untitled: 'Group',

    // -------------------------------------------------------- the tile sheet
    tile_addTitle: 'Add tile',
    tile_editTitle: 'Edit tile',
    tile_sheetNote: 'The icon is fetched automatically as you type the address.',
    tile_url: 'URL',
    tile_urlPlaceholder: 'example.com',
    tile_name: 'Name',
    // Marks a field that may be left empty. Shown after the field's own name.
    tile_optional: '(optional)',
    tile_namePlaceholder: 'My favourite site',
    tile_appearance: 'Appearance',
    tile_icon: 'Icon',
    tile_iconPlaceholder: 'Web address, or paste a picture or SVG',
    tile_iconReload: "Look up the site's own icon again",
    tile_iconFile: 'Choose a picture file',
    // $1 is the button that chooses a file, drawn as its icon.
    tile_iconHelp: 'Press $1 to choose a file, or paste a picture or its SVG code anywhere in this '
      + 'sheet.',
    tile_iconColor: 'Icon colour',
    tile_pipette: 'Eyedropper',
    tile_iconColorClear: "Back to the icon's own colours",
    tile_bg: 'Background',
    // The name the colour picker gives itself when it opens on a tile.
    tile_bgTitle: 'Tile background',
    tile_bgClear: 'Back to the default background',
    tile_pad: 'Padding',
    tile_padClear: 'Back to the default padding',
    tile_round: 'Icon rounding',
    tile_roundClear: 'Reset the rounding',
    // This tile's own answer to "Show site names" in Settings, which it
    // overrides either way.
    tile_showLabel: 'Show site name',
    tile_group: 'Group',

    // ------------------------------------------- what the icon lookup reports
    icon_looking: 'Looking for the highest-resolution icon…',
    icon_noneDeep: 'This site has no icon — choose or paste a picture instead.',
    icon_noneShallow: 'The usual lookup found nothing. Try switching on Deep icon lookup in '
      + 'Settings.',
    icon_vector: 'Found a vector icon.',
    // $1 is the icon's width in pixels, in all three. Three messages rather
    // than one with a tail: each is a whole sentence to be re-ordered freely.
    icon_found: 'Found a $1px icon.',
    icon_foundLargest: 'Found a $1px icon, the highest resolution there was to find.',
    icon_foundSmall: 'Found a $1px icon. Try switching on Deep icon lookup in Settings to find a '
      + 'larger one.',
    icon_needAddress: "Fill in the site's address first.",
    // Added after whichever of the above the lookup ended with.
    icon_cleared: 'The icon that was set has been cleared.',
    icon_fetching: 'Fetching the icon…',
    icon_cannotKeep: 'The icon could not be downloaded. Try choosing a file, or pasting one from '
      + 'the clipboard.',
    icon_notAPicture: 'Unsupported image format.',
    icon_unreadable: 'The image could not be read — try choosing a file.',
    icon_clickToTake: 'Click the icon to pick a colour out of it.',
    icon_pointAt: 'Point at the icon.',
    tile_badUrl: 'That does not look like a web address…',

    // --------------------------------------------------- a picture for a tile
    icon_fileUnreadable: 'That file could not be read.',
    icon_notImageFile: 'Unsupported image format.',
    icon_fileTooLarge: 'That image is too large — pick a smaller one.',
    icon_svgNotCode: 'That does not look like SVG code…',
    icon_svgUnreadable: 'That SVG could not be read — it may be incomplete.',
    icon_svgTooLong: 'That SVG is too long to save.',

    // ------------------------------------------------------------- the alert
    confirm_deleteTitle: 'Delete this tile?',
    // $1 is the tile's name.
    confirm_deleteText: '“$1” will be deleted from the page.',

    // ------------------------------------------------------------- the buttons
    btn_save: 'Save',
    btn_cancel: 'Cancel',
    btn_delete: 'Delete',
    btn_close: 'Close',
    btn_use: 'Use',
    // The pair on the Backup row: one writes the file, the other reads one back.
    btn_export: 'Export…',
    btn_import: 'Import…',

    // ------------------------------------------------------ settings: chrome
    // What a control says while it is busy, in place of its status line.
    busy_font: 'Loading font…',
    busy_working: 'Working on it…',
    busy_resetting: 'Putting everything back to how it was…',
    busy_permission: 'Asking Firefox for access…',

    // How the shortcut that opens the settings window is written down. The
    // Apple one is a symbol and reads the same everywhere; the other names a
    // key, and a keyboard in another language names it differently.
    shortcut_command: '⌘ ,',
    shortcut_control: 'Ctrl + ,',

    settings_title: 'Settings',
    settings_sections: 'Settings sections',
    // $1 is the version number.
    settings_version: 'Version $1',

    // ---------------------------------------------------- settings: sections
    section_general: 'General',
    section_background: 'Background',
    section_layout: 'Layout',
    section_header: 'Date and time',
    section_groups: 'Groups',
    section_about: 'About',

    group_appearance: 'Appearance',
    group_backupReset: 'Backup and reset',
    group_grid: 'Grid',
    group_tiles: 'Tiles',
    group_time: 'Time',
    group_date: 'Date',
    group_bothLines: 'Common settings',
    group_bundled: 'Third-party licences',

    // -------------------------------------------------- settings: appearance
    set_theme: 'Theme',
    set_themeSystem: 'System',
    set_themeDark: 'Dark',
    set_themeLight: 'Light',
    set_accent: 'Accent colour',
    set_font: 'Font',
    set_fontNote: 'Sets the font for the tile names, the date and the time.',
    set_settingsButton: 'Show the settings button',
    // $1 is the keyboard shortcut that opens this window.
    set_settingsButtonNote: 'It can still be opened with $1 and from the right-click menu.',
    set_searchButton: 'Show the search button',
    set_searchButtonNote: 'Search can still be started from the right-click menu.',

    set_backup: 'Backup and restore',
    set_backupNote: 'Export and import your tiles, groups and settings.',
    set_reset: 'Reset all settings',
    set_resetButton: 'Reset all',
    set_resetNote: 'Every setting goes back to its default; your tiles are kept.',

    // -------------------------------------------------- settings: background
    set_background: 'Image or video',
    set_backgroundNote: 'A local file, or a web address.',
    set_blur: 'Blur',
    set_dim: 'Dim',
    set_dimNote: 'Darkens the background for better readability.',
    set_bgPosY: 'Vertical position',

    // ------------------------------------------------------ settings: layout
    set_columns: 'Columns',
    // Names the bottom of the Columns slider, where a count would be nothing.
    set_columnsAuto: 'Auto',
    set_columnsNote: 'Auto fits as many per row as the window allows.',
    set_tileSize: 'Tile size',
    set_gap: 'Spacing',
    set_order: 'Sort order',
    set_orderManual: 'Manual',
    set_orderVisits: 'By visit count',

    set_shape: 'Tile shape',
    set_shapeSquare: 'Square',
    set_shapeCircle: 'Circular',
    set_tileBg: 'Tile background',
    set_tileBgTheme: 'Follow the theme',
    set_tileBgDark: "Dark theme's",
    set_tileBgLight: "Light theme's",
    set_tileBgCustom: 'Custom colour',
    set_tileBgColor: 'Custom background colour',
    set_logoPad: 'Icon padding',
    set_logoPadNote: "The room left clear around a tile's icon.",
    set_showLabels: 'Show site names',
    // The row under it: a tile can be told to show or hide its name in the
    // tile editor, and this is the one way back from every one of those.
    set_tileNames: 'Names set on single tiles',
    set_tileNamesButton: 'Reset',
    set_tileNamesNote: 'Tiles told to show or hide their name in their own editor follow this '
      + 'again.',
    // After that button, in place of a count: what matters is that it is done,
    // and "3 tiles" would be a different word in a language that counts in
    // threes.
    set_tileNamesDone: 'Every tile follows this setting again.',
    set_tileNamesNone: 'No tile had a name of its own to give up.',
    set_showVisits: 'Show visit counts',
    set_showVisitsNote: 'Puts the number of times you have opened a site in the corner of its tile.',
    set_showAddButton: 'Show the add button',
    set_showAddButtonNote: 'A + is shown at the end of the grid for adding a site.',
    set_openInNewTab: 'Open sites in a new tab',
    set_confirmDelete: 'Confirm before deleting a tile',
    set_deepIcons: 'Deep icon lookup',
    set_deepIconsNote: "Reads a site's markup for its sharpest logo. Firefox permission is "
      + "required.",

    // ------------------------------------------------------ settings: header
    set_showClock: 'Show the clock',
    set_format: 'Time format',
    set_timeNote: "The exact shape follows your browser's language.",
    set_clockFont: 'Font',
    // The card at the head of the clock's and the date's font pickers: no
    // family of their own, follow the one the page is set in.
    set_matchPageFont: 'Default',
    set_clockFontNote: 'Default follows General → Font.',
    set_weight: 'Font weight',
    set_size: 'Size',
    set_tracking: 'Letter spacing',

    set_showDate: 'Show the date',
    set_dateFontNote: 'Default follows General → Font.',

    set_headerTint: 'Custom colour',
    set_headerTintNote: 'With it off, the colour follows the theme.',
    set_headerColor: 'Colour',
    set_headerShadow: 'Shadow',

    // ------------------------------------------------------ settings: groups
    set_groupStyle: 'Group bar appearance',
    set_groupFloating: 'Floating bar',
    set_groupBar: 'Status bar',
    set_groupShow: 'Visibility',
    set_groupAlways: 'Always',
    set_groupHover: 'On hover',
    set_showAllGroup: 'Show the All group',
    set_showAllGroupNote: 'The group that holds every saved page from all groups.',
    set_showGroupAdd: 'Show the add group button',
    set_showGroupAddNote: 'The + at the end of the bar. Right-clicking the page also makes one.',
    set_keepGroup: 'Remember the last group',
    set_keepGroupNote: 'The start page opens on the group that was open last.',
    set_groupAnimate: 'Animate switching between groups',
    set_groupScroll: 'Switch groups by gesture',
    set_groupScrollNote: 'A mouse scroll or a trackpad gesture changes the group.',
    set_groupAxis: 'Gesture direction',
    set_groupAxisVertical: 'Up and down',
    set_groupAxisHorizontal: 'Left and right',
    set_groupAxisEither: 'Either',
    set_groupPosition: 'Group bar position',
    set_groupTop: 'Top',
    set_groupAboveTiles: 'Above the tiles',
    set_groupBottom: 'Bottom',
    set_groupAlign: 'Alignment',
    set_groupLeft: 'Left',
    set_groupCentre: 'Centre',
    set_groupRight: 'Right',

    // ------------------------------------------------------- settings: about
    about_blurb: 'A free, modern, open-source and highly customizable visual bookmark manager and '
      + 'start page for your browser.',
    about_author: 'Author',
    about_licence: 'Licence',
    about_source: 'Project page',
    about_sourceNote: 'The source code, the community, and where to report bugs.',

    // ------------------------------------------------------- the type weights
    weight_100: 'Thin',
    weight_200: 'Extra light',
    weight_300: 'Light',
    weight_400: 'Regular',
    weight_500: 'Medium',
    weight_600: 'Semibold',
    weight_700: 'Bold',
    weight_800: 'Extra bold',
    weight_900: 'Black',

    // ------------------------------------------------------- the colour names
    // The ten macOS accents, then five whites and five blacks. Names for the
    // ear rather than exact colour words - what a reader would call them.
    color_blue: 'Blue',
    color_indigo: 'Indigo',
    color_purple: 'Purple',
    color_pink: 'Pink',
    color_red: 'Red',
    color_orange: 'Orange',
    color_yellow: 'Yellow',
    color_green: 'Green',
    color_teal: 'Teal',
    color_graphite: 'Graphite',
    color_white: 'White',
    color_offWhite: 'Off white',
    color_paleGrey: 'Pale grey',
    color_lightGrey: 'Light grey',
    color_silver: 'Silver',
    color_slate: 'Slate',
    color_charcoal: 'Charcoal',
    color_ink: 'Ink',
    color_nearBlack: 'Near black',
    color_black: 'Black',

    picker_area: 'Saturation and brightness',
    picker_hue: 'Hue',
    picker_hex: 'Hex value',

    // ------------------------------------------------- the background picker
    bg_chooseFile: 'Choose file',
    bg_remove: 'Remove',
    bg_reposition: 'Reposition',
    bg_done: 'Done',
    bg_empty: 'Drop an image or video here, or choose a file.',
    // What a picture chosen from this computer is called when it has no name.
    bg_localFile: 'Local file',
    bg_tooWide: 'This image is wider than the window, so its position cannot be changed.',
    bg_dragIt: 'Drag it with the mouse, or use the arrow keys.',
    bg_position: 'Vertical position of the background',
    bg_urlPlaceholder: 'or paste a web address…',
    bg_recent: 'Recent background',
    // The heading over the pictures this page has had before.
    bg_history: 'Recent',
    // The heading over the photographs the add-on ships with.
    bg_gallery: 'Included wallpapers',
    // $1 is the picture's name, or `bg_thisOne` where it has none.
    bg_useAgain: 'Use $1 again',
    // The same, for one that has not been used here before. $1 is its name.
    bg_use: 'Use $1',
    bg_thisOne: 'this background',
    bg_forget: 'Remove from history',
    bg_forgetLabel: 'Remove $1 from history',

    // ------------------------------------------- what the background answers
    bg_fileUnreadable: 'That file could not be read.',
    // $1 is the file's size, $2 the largest allowed - both already in words.
    bg_pictureTooBig: 'That picture is $1 — the limit is $2. Pick a smaller one.',
    bg_pictureNoRoom: 'That image is too large to store, even shrunk down.',
    bg_videoTooBig: 'That video is $1 — the limit is $2. Pick a shorter or smaller one.',
    bg_videoUnplayable: 'The browser cannot play that video.',
    bg_slowAddress: 'The address took too long to answer.',
    bg_notAPicture: 'Unsupported image format.',
    bg_notAVideo: 'Unsupported video format.',
    bg_notMedia: 'Unsupported format.',
    bg_nothingThere: 'Nothing could be loaded — is it really an image or a video?',
    bg_needsHttp: 'That needs to be a web address starting http:// or https://.',
    bg_noRoom: 'There was no room left to store that background.',
    bg_unusable: 'Unsuitable image.',
    // The name a picture with none of its own is filed under.
    bg_untitled: 'Image',
    bg_droppedOff: 'That one has dropped off the list.',

    bg_setByAddress: 'Background set. That address would not let its image be downloaded, '
      + 'so it is fetched '
      + 'again every time.',
    bg_setRemembered: 'Background set, with its settings restored.',
    bg_setDefaults: 'Background set, with default settings.',
    bg_setDimmed: 'Set — turn Dim down to see more of it.',
    bg_set: 'Background set.',

    // ------------------------------------------------------ the font picker
    font_filterStyle: 'Style',
    font_filterScript: 'Script',
    // The first button of either filter: no filter at all.
    font_filterAll: 'All',
    font_styleSans: 'Sans',
    font_styleSerif: 'Serif',
    font_styleMono: 'Mono',
    font_styleDisplay: 'Display',
    font_scriptLatinExt: 'Latin ext',
    font_scriptLatinExtTitle: 'Extended Latin - accents and the rest of Europe',
    font_scriptCyrillic: 'Cyrillic',
    font_scriptGreek: 'Greek',
    font_scriptVietnamese: 'Vietnamese',
    // The card at the head of the page font's picker: no family at all.
    font_system: 'System font',
    font_noneMatch: 'No family in the list covers both of those.',
    font_previewsOffline: 'Drawing the fonts for the first time needs a connection.',
    font_other: 'Other family…',
    font_otherPlaceholder: 'Any family on Google Fonts',
    font_otherLabel: 'Another font family',

    // ------------------------------------------------- what a font load says
    // $1 is the family, $2 where it came from - one of the four below.
    font_loaded: '$1 — $2',
    font_fromBundle: 'bundled with the extension',
    font_fromSystem: 'using the system font',
    font_fromCache: 'loaded from cache',
    font_fromNetwork: 'downloaded and cached',
    font_following: 'Using the default font.',
    // $1 is the HTTP status Google Fonts answered with.
    font_googleReplied: 'Google Fonts: $1.',
    // $1 is the family that was asked for.
    font_noSuchFamily: 'Google Fonts has no family called "$1".',
    font_noFiles: 'Could not download the font files.',
    font_tooLarge: 'That font is too large to cache.',
    font_noPreviews: 'Could not download the font previews.',

    // ----------------------------------------------- asking for site access
    perm_unavailable: 'Permissions API unavailable.',
    perm_notInstalled: 'Only available once the add-on is installed in Firefox.',
    // The way in that does not go through this toggle. Added to both refusals
    // below, so it is written once.
    perm_hint: 'You can also switch on "Access your data for all websites" under '
      + 'about:addons → Tiles → Permissions.',
    // $1 is the reason Firefox gave, $2 is perm_hint.
    perm_refused: 'Firefox turned the request down ($1). $2',
    // $1 is perm_hint.
    perm_declined: 'Permission declined. $1',
    perm_deepOn: 'Every site is now examined for a high-resolution icon.',
    perm_deepOff: 'Back to the conventional ways of finding icons.',

    // ------------------------------------------------- backing up and back
    // $1 is the name the file was saved under.
    backup_saved: 'Saved as $1.',
    backup_fileUnreadable: 'That file could not be read.',
    backup_noFile: 'No file to read.',
    backup_tooLarge: 'That file is too large to be a backup.',
    backup_notJson: 'Invalid JSON.',
    backup_notABackup: 'This add-on cannot read that backup file.',
    backup_empty: 'That backup is empty — there is nothing in it to restore.',
    // $1 is whatever went wrong, in the browser's own words.
    backup_stopped: 'The restore was interrupted: $1',

    // $1 is a list of what came back - "3 groups, 12 tiles and your settings".
    restore_done: 'Restored $1.',
    // $2 is the add-on the file was written by.
    restore_doneFrom: 'Restored $1 from a $2 backup.',
    restore_pictureRefused: 'The background image would not fit, so the old one was kept.',
    // $1 is a list, the same shape as restore_done's.
    restore_lost: 'It also held $1, which this add-on has nowhere to keep.',
    restore_lostStats: 'the time-of-day split behind the visit counts',
    restore_lostColours: 'group colours',
    restore_someSettings: 'some settings',
    restore_allSettings: 'your settings',
    restore_background: 'the background',
    // One tile, and more than one. See `plural` below.
    restore_tile: '$1 tile',
    restore_tiles: '$1 tiles',
    restore_group: '$1 group',
    restore_groups: '$1 groups',

    // Joining a list of the above. $1 is everything but the last, already
    // joined by `list_comma`; $2 is the last one.
    list_and: '$1 and $2',
    list_comma: '$1, $2',
    list_nothing: 'nothing'
  };

  /** Firefox's own machinery, absent on a page opened straight off disk. */
  const RUNTIME = (typeof browser !== 'undefined' && browser.i18n)
    || (typeof chrome !== 'undefined' && chrome.i18n)
    || null;

  /**
   * Fills `$1`, `$2` … in, the way `browser.i18n` does - so a message reads
   * and behaves the same whether it came from a `messages.json` or from the
   * table above.
   */
  function fill(text, subs) {
    if (!subs.length) return text;
    return text.replace(/\$(\d)/g, (whole, n) => {
      const at = Number(n) - 1;
      return at < subs.length ? String(subs[at]) : whole;
    });
  }

  /**
   * What this add-on says for `key`, in the reader's language where there is
   * one and in English where there is not.
   *
   * Firefox is asked first and answers with the empty string for a key it has
   * never heard of, which is also what an untranslated key looks like - either
   * way the English below it is the right answer. A key that is in neither is
   * a mistake in the code, so it comes back as itself rather than as nothing:
   * a visible `tile_addTitle` is found in a screenshot, an empty label is not.
   */
  function t(key, ...subs) {
    if (RUNTIME) {
      try {
        const said = RUNTIME.getMessage(key, subs.map(String));
        if (said) return said;
      } catch {
        // An add-on API that is present but unhappy is no reason to have no
        // words at all.
      }
    }

    const text = MESSAGES[key];
    return text === undefined ? key : fill(text, subs);
  }

  /**
   * One of a pair of keys, by the count: `one` when there is exactly one and
   * `other` for everything else, with the number filled in as `$1`.
   *
   * English needs two forms and this is where they are chosen between. A
   * language that needs more can put them in its own `messages.json` and
   * decide there; a language that needs one gives both keys the same text.
   */
  function plural(n, one, other) {
    return t(n === 1 ? one : other, n);
  }

  /**
   * "a, b and c" - a list read out in a sentence, joined by the language's own
   * words rather than by a comma this file assumes.
   */
  function list(parts) {
    if (!parts.length) return t('list_nothing');
    if (parts.length === 1) return parts[0];
    const last = parts[parts.length - 1];
    const rest = parts.slice(0, -1).reduce((all, one) => t('list_comma', all, one));
    return t('list_and', rest, last);
  }

  /**
   * Fills in every key the markup asks for, and says what language the page
   * turned out to be in - which is what a screen reader and the browser's own
   * spell checker read to know how to pronounce and check it.
   *
   * Run before the page is shown, so nothing is ever seen in the wrong
   * language on the way to the right one.
   */
  function apply(root) {
    const scope = root || document;

    if (scope === document) {
      document.title = t('page_title');
      const lang = RUNTIME && RUNTIME.getUILanguage && RUNTIME.getUILanguage();
      if (lang) document.documentElement.lang = lang;
    }

    scope.querySelectorAll('[data-i18n]').forEach(el => {
      const said = t(el.dataset.i18n);

      // A message with something drawn inside it - the icon in the paste hint.
      // The slot keeps its place while the words around it are replaced.
      const slot = el.querySelector('[data-i18n-slot]');
      if (slot && said.includes('$1')) {
        const [before, after] = said.split('$1');
        el.textContent = '';
        el.append(document.createTextNode(before), slot, document.createTextNode(after));
        return;
      }

      el.textContent = said;
    });

    const ATTRS = {
      'data-i18n-title': 'title',
      'data-i18n-label': 'aria-label',
      'data-i18n-placeholder': 'placeholder'
    };

    Object.entries(ATTRS).forEach(([from, to]) => {
      scope.querySelectorAll('[' + from + ']').forEach(el => {
        el.setAttribute(to, t(el.getAttribute(from)));
      });
    });
  }

  return { MESSAGES, t, plural, list, apply };
})();

/* Read by tools/build-locales.js and by the tests, which run this file under
   `node`. Harmless in the browser, where there is no `module`. */
if (typeof module !== 'undefined') module.exports = I18N;
