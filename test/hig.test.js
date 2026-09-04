/**
 * The guards from the Human Interface Guidelines audit.
 *
 * These are the things that were wrong once and would go quietly wrong again:
 * a number nobody looks at, a token nobody declared, a media query nobody
 * tests because their own machine never turns that setting on.
 *
 * What can quietly go wrong here:
 *
 *   - the system palette drifts back. Apple re-cut every system colour in
 *     June 2025 and the old values are burned into a decade of muscle memory,
 *     so #007AFF is the value a hand types without thinking.
 *   - a colour token is nudged and the note under every setting drops back
 *     under the contrast floor. The floor is a number, so it is checked as one
 *     rather than looked at.
 *   - a control is given a size that reads well and cannot be hit. Apple's
 *     macOS minimum is 20x20pt, which is smaller than people assume and
 *     therefore easy to go under without noticing.
 *   - a font-size names a step of the scale that does not exist. That is not
 *     an error in CSS: the declaration is dropped and the element quietly
 *     inherits, which looks like a design decision. --t-caption did exactly
 *     this in three places.
 *   - a dialog says aria-modal and does not contain the keyboard, so Tab walks
 *     out of it into the page behind the scrim.
 *   - the settings notes grow back. Every one of them fits its row on one line
 *     here; the width a row leaves depends on the control in it, so the cap is
 *     per control type rather than one number.
 *
 *   node test/hig.test.js [path/to/src]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const { El, document } = require('./dom-shim');

const SRC = process.argv[2] || path.join(__dirname, '..', 'src');
/* Line endings normalised: several checks below find a run of code by its
   first and last lines, and those markers are written with plain newlines. */
const read = file => fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');

/* The message table, read the same way everything else here is: the checks
   below pair a colour with the name shown for it, and the name lives there. */
const I18N = require(path.join(SRC, 'i18n.js'));

const css = read('newtab.css');
const js = read('newtab.js');

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

// ------------------------------------------------------------------ colour

/** WCAG relative luminance, which is what Apple's own contrast figures use. */
function luminance([r, g, b]) {
  const f = c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));

/** An rgba(...) ink composited onto an opaque ground. */
const over = (ink, alpha, ground) =>
  ground.map((c, i) => ink[i] * alpha + c * (1 - alpha));

/**
 * A token's value, read out of the block that declares it. `theme` picks
 * between the light `:root` and the explicit dark one - the media-query copy
 * says the same thing as the latter, which is checked separately.
 */
function token(name, theme) {
  const start = theme === 'dark'
    ? css.indexOf(':root[data-theme="dark"]')
    : css.indexOf(':root {');
  // Either at the top of a line or after another declaration on the same one:
  // the tracking tokens sit beside the size they belong to.
  const hit = new RegExp('[\\n;]\\s*' + name + ':\\s*([^;]+);').exec(css.slice(start));
  return hit ? hit[1].trim() : null;
}

const alphaOf = value => Number(/rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(value)[1]);

/**
 * The body of one rule, on its own.
 *
 * Every check below that asks "does this rule still say X" has to be bounded
 * to the rule. A lazy match from the selector will happily run past the
 * closing brace and find X three rules further down, which is a test that
 * passes whatever the code does - and three of these did exactly that.
 */
function body(selector) {
  const at = css.indexOf('\n' + selector + ' {');
  return at === -1 ? '' : css.slice(at, css.indexOf('}', at));
}

// -------------------------------------------------------- the 2025 palette

/* Apple re-cut the system colours in June 2025 and published an
   increased-contrast variant of each alongside. Seven of the nine this add-on
   uses moved; green and pink did not. */
const RETIRED = ['#007aff', '#0a84ff', '#ff3b30', '#ff453a', '#ff9500',
                 '#ff9f0a', '#af52de', '#bf5af2', '#30b0c7', '#40c8e0',
                 '#5856d6', '#5e5ce6'];

const stale = RETIRED.filter(c =>
  css.toLowerCase().includes(c) || read('settings.js').toLowerCase().includes(c)
    || read('schema.js').toLowerCase().includes(c));

check('no colour from the palette Apple retired in June 2025',
  stale.length === 0, stale.join(', '));

check('systemBlue is the current one, light and dark',
  token('--system-blue', 'light') === '#0088ff'
    && token('--system-blue', 'dark') === '#0091ff',
  token('--system-blue', 'light') + ' / ' + token('--system-blue', 'dark'));

check('the accent a fresh profile gets is that same blue',
  read('schema.js').includes("default: '#0088ff'")
    && read('settings.js').includes("['#0088ff', 'blue']")
    && I18N.MESSAGES.color_blue === 'Blue');

check('the dark tokens are the same in the media query and the explicit theme',
  (css.match(/--system-blue: #0091ff;/g) || []).length === 2,
  'a theme that only answers one of the two is the classic half-swapped bug');

// ------------------------------------------------------------- contrast

/* Apple cites WCAG AA: 4.5:1 for text up to 17pt, which is every size in this
   interface. The note under a settings row is the one that used to fail. */
const BOX_LIGHT = [255, 255, 255];
const BOX_DARK = hex('#2c2c2e');
const WINDOW_LIGHT = hex('#ececee');

const secLight = alphaOf(token('--label-secondary', 'light'));
const secDark = alphaOf(token('--label-secondary', 'dark'));

check('the secondary label clears 4.5:1 on a light grouped box',
  ratio(over([0, 0, 0], secLight, BOX_LIGHT), BOX_LIGHT) >= 4.5,
  ratio(over([0, 0, 0], secLight, BOX_LIGHT), BOX_LIGHT).toFixed(2) + ':1');

check('and on the window ground behind it',
  ratio(over([0, 0, 0], secLight, WINDOW_LIGHT), WINDOW_LIGHT) >= 4.5,
  ratio(over([0, 0, 0], secLight, WINDOW_LIGHT), WINDOW_LIGHT).toFixed(2) + ':1');

check('the dark theme clears it too',
  ratio(over([255, 255, 255], secDark, BOX_DARK), BOX_DARK) >= 4.5,
  ratio(over([255, 255, 255], secDark, BOX_DARK), BOX_DARK).toFixed(2) + ':1');

/* Tertiary is a placeholder rather than prose, so 3:1 is its bar - but 1.88:1,
   which is where it was, is not a colour, it is an absence. */
const terLight = alphaOf(token('--label-tertiary', 'light'));
check('the tertiary label clears 3:1, which is the bar a placeholder has',
  ratio(over([0, 0, 0], terLight, BOX_LIGHT), BOX_LIGHT) >= 3,
  ratio(over([0, 0, 0], terLight, BOX_LIGHT), BOX_LIGHT).toFixed(2) + ':1');

/* Red as a fill and red as ink are two colours. The fill is 3.5:1 on white. */
check('destructive text is read as ink, not as the fill colour',
  ratio(hex(token('--danger-text', 'light')), BOX_LIGHT) >= 4.5
    && css.includes('color: var(--danger-text)'),
  ratio(hex(token('--danger-text', 'light')), BOX_LIGHT).toFixed(2) + ':1');

// --------------------------------------------- the accessibility settings

check('Increase contrast is answered, with the variants Apple published',
  css.includes('@media (prefers-contrast: more)')
    && css.includes('#1e6ef4') && css.includes('#5cb8ff'),
  'the light and dark increased-contrast blues');

check('and it reaches both themes, not only the light one',
  /prefers-contrast: more[\s\S]*?data-theme="dark"/.test(css));

check('the accent as a fill is taken down there, where white sits on it',
  css.includes('--accent-fill: color-mix(in srgb, var(--accent) 80%, black)'),
  'white on systemBlue is 3.5:1 raw');

check('Windows high contrast keeps a focus ring',
  css.includes('@media (forced-colors: active)')
    && /forced-colors: active[\s\S]*?outline: 2px solid Highlight/.test(css),
  'box-shadow rings vanish there; outline does not');

check('the two settings that were already answered still are',
  css.includes('@media (prefers-reduced-motion: reduce)')
    && css.includes('@media (prefers-reduced-transparency: reduce)'));

// ------------------------------------------------------------------ type

/* A font-size naming a step that does not exist is not an error - the
   declaration is dropped and the element inherits. --t-caption was used three
   times and declared nowhere, so the tile sheet's sub-labels drew at body
   size and looked like a decision. */
const declared = new Set((css.match(/--t-[a-z0-9]+(?=:)/g) || []));
const usedSizes = new Set((css.match(/var\((--t-[a-z0-9]+)\)/g) || [])
  .map(s => s.slice(4, -1)));
const undeclared = [...usedSizes].filter(name => !declared.has(name));

check('every step of the type scale that is used is also declared',
  undeclared.length === 0, undeclared.join(', '));

/* Apple's tracking does not run one way: positive below 12pt, zero at 12,
   negative above. A single letter-spacing on the body tracked the smallest
   type in the interface the wrong way. */
const TRACKING = {
  '--tr-footnote': 1, '--tr-caption': 1, '--tr-subhead': 1,
  '--tr-callout': 0, '--tr-body': -1, '--tr-title3': -1,
  '--tr-title2': -1, '--tr-title1': -1
};
const wrongWay = Object.entries(TRACKING).filter(([name, sign]) => {
  const value = token(name, 'light');
  if (value === null) return true;
  const n = parseFloat(value);
  return Math.sign(n) !== sign;
});

check('each step is tracked the way Apple tracks it',
  wrongWay.length === 0, wrongWay.map(([n]) => n).join(', '));

check('and the sizes that carry tracking actually use it',
  (css.match(/letter-spacing: var\(--tr-/g) || []).length >= 30,
  (css.match(/letter-spacing: var\(--tr-/g) || []).length + ' declarations');

check('the clock is not set in one of the weights Apple says to avoid',
  Number(/--clock-weight, (\d+)\)/.exec(css)[1]) >= 400,
  'Ultralight, Thin and Light are the three');

// ---------------------------------------------------------- hit targets

/* Apple's macOS control size is 28x28pt by default and 20x20pt at the very
   least - not the 44pt from the cross-platform buttons page. */
const MIN = 20;

const pickerWidth = Number(/\.picker \{[\s\S]*?width: (\d+)px/.exec(css)[1]);
const pickerPad = Number(/\.picker \{[\s\S]*?padding: (\d+)px/.exec(css)[1]);
const cols = Number(/\.picker__presets \{[\s\S]*?repeat\((\d+), 1fr\)/.exec(css)[1]);
const gap = Number(/\.picker__presets \{[\s\S]*?gap: (\d+)px/.exec(css)[1]);
const preset = (pickerWidth - pickerPad * 2 - gap * (cols - 1)) / cols;

check('a colour preset is big enough to be aimed at',
  preset >= MIN, preset.toFixed(1) + 'px across, ' + cols + ' to a row');

const sliderHeight = Number(/\.range input \{[\s\S]*?height: (\d+)px/.exec(css)[1]);
check('so is the slider, which is dragged rather than clicked',
  sliderHeight >= MIN, sliderHeight + 'px tall');

check('the trough it paints is still the 4px macOS draws',
  body('.range input').includes('100% 4px'));

// --------------------------------------------------- shapes and materials

const capsules = ['.segmented', '.segmented__item', '.tab'];
check('the controls macOS 26 made capsules are capsules',
  capsules.every(sel => body(sel).includes('border-radius: var(--r-pill)')),
  capsules.filter(sel => !body(sel).includes('border-radius: var(--r-pill)')).join(', '));

check('a nested radius is worked out from its parent rather than picked',
  css.includes('border-radius: calc(var(--r-control) - 1px)')
    && css.includes('border-radius: calc(var(--r-control) - 2px)'),
  'inner radius = outer radius - padding');

check('no box is drawn inside a box',
  !body('.fontfield__grid').includes('inset 0 0 0 .5px')
    && !body('.bgfield__preview').includes('inset 0 0 0 .5px'),
  'the font grid and the background preview both used to be');

check('the scrim dims the page rather than blurring it',
  !body('.modal').includes('backdrop-filter: blur'));

/* The window keeps its title bar at rest and the edge *deepens* under scrolled
   content, rather than the hairline appearing out of nothing. Taking the line
   away at the top left the bar and the pane below it at almost the same tone,
   which read as a missing border rather than as a quiet one. */
check('the toolbar has a hairline even at the top of a pane',
  body('.window__toolbar').includes('box-shadow: inset 0 -.5px 0 var(--separator)'));

check('and the edge deepens once content is passing under it',
  css.includes('.window__box.is-scrolled .window__toolbar')
    && /is-scrolled .window__toolbar \{[^}]*separator-opaque/.test(css),
  'macOS calls this the hard scroll edge style');

check('alert buttons are sized to their words, not split down the middle',
  !css.includes('.alert__actions .btn { flex: 1; }')
    && body('.alert__actions').includes('justify-content: flex-end'));

check('the rim on floating chrome is brightest along its top edge',
  css.includes('--rim: inset 0 .5px 0 rgba(255, 255, 255, .55)')
    && (css.match(/var\(--rim\)/g) || []).length >= 5,
  'the one part of macOS 26 glass that CSS can actually draw');

check('and the tiles are left out of it - they are content, not chrome',
  !body('.tile').includes('var(--rim)'),
  'putting glass on the content layer is the first thing Apple says not to do');

/* Not a matter of taste, which is why it is guarded rather than left to read
   as a stray line: fifty tiles asking the browser to blur the picture behind
   them, over and over, is fifty blurs it redraws in pieces the size of the
   screen rather than in whole tiles - and a tile with half of its blur redrawn
   against the half that was kept has a straight edge across the middle of it.
   The blur is made once instead, and painted. */
const frosted = css.slice(css.indexOf('body.has-bg.has-frost .grid .tile {'));
check('a tile over a picture paints its blur rather than filtering for it',
  frosted.startsWith('body.has-bg.has-frost .grid .tile {')
    && /backdrop-filter: none/.test(frosted.slice(0, frosted.indexOf('}')))
    && /var\(--tile-frost/.test(frosted.slice(0, frosted.indexOf('}'))),
  'hovering one tile used to leave seams across the tiles beside it');

/* Painted, so the paint has a position - and that position is what lines the
   blurred copy up with the window. It is written from the script every time
   the tiles are laid out again, so a `background` shorthand in the transition
   put a quarter of a second of travel on it: on every change of group the
   frost slid in from the corner of each tile and settled, which read as the
   blur arriving after the tiles rather than with them. */
check('and the frost is in place the moment a tile is, not a fade later',
  !/transition:[^;]*background\s/.test(body('.tile')),
  'the fill is transitioned by longhand, so the frost position is left alone');

/* And placed from where the tile *sits*, not from where it is being drawn. A
   tile is very often drawn somewhere it does not sit - sliding in on a change
   of group, lifted under the pointer, part way through the slide after a drag
   - and a frost measured off that is lined up with the movement, so it comes
   to rest out of register with the picture behind it. */
check('and it is measured off the layout, which no transform touches',
  /function tileAt\(el\)[\s\S]*?node\.offsetParent[\s\S]*?offsetLeft/.test(js)
    && !/placeFrost[\s\S]{0,400}?getBoundingClientRect/.test(js),
  'getBoundingClientRect answers with the transform, which is the animation');

/* And placed again whenever a tile has moved. A drag is the one move that
   changes where every tile stands without the grid being rebuilt - the tiles
   are reordered where they are and only the order is written afterwards - so a
   tile that changed place went on painting the piece of the blurred copy that
   belonged to where it came from, and stayed out of register with the picture
   behind it until the next resize. */
check('a reorder tells the tiles where they are standing now',
  /function moved\(container\) \{\s*if \(container === grid\) placeFrostSoon\(\);/.test(js)
    && /function slideMove\([\s\S]*?mutate\(\);\s*moved\(container\);/.test(js),
  'a dragged tile used to keep the frost of the place it came from');

// ----------------------------------------------------- keyboard and focus

check('a dialog going up makes every other layer inert',
  js.includes('const LAYERS = [groupBar, toolbar')
    && /isolateTop[\s\S]*?node\.inert = Boolean\(top\) && node !== top/.test(js),
  'aria-modal is a claim; inert is the mechanism');

check('a dialog with nothing to type in takes the focus itself',
  /openDialog[\s\S]*?\} else \{[\s\S]*?el\.focus\(\);/.test(js),
  'otherwise focus stays on the control behind the scrim');

check('every dialog can hold that focus',
  ['modal', 'settings', 'groupModal', 'confirmAlert']
    .every(id => new RegExp('id="' + id + '" tabindex="-1"').test(read('newtab.html'))));

check('closing one hands the focus back to whatever opened it',
  /closeDialog[\s\S]*?going\.opener\.focus\(\)/.test(js));

check('the alert leaves no default button for Return to press',
  !js.includes('btnConfirmOk.focus()'),
  'Apple: never give the primary role to a destructive button');

check('Command-Period cancels a dialog, as Escape does',
  js.includes("e.metaKey && e.key === '.'"));

check('the settings window titles itself with the pane it is showing',
  read('settings.js').includes('if (ctx.onSection)')
    && js.includes('settingsTitle.textContent = label'));

// ------------------------------------------------------- the dialog itself

const sandbox = {
  console, document, setTimeout, clearTimeout,
  crypto: { randomUUID: () => 'id-' + Math.random().toString(36).slice(2) },
  Icons: { create: () => new El('svg') },
  Fonts: {
    CATALOG: [{ name: 'Inter', style: 'sans', scripts: ['latin-ext'] }],
    STYLES: [{ id: 'sans', label: 'Sans' }],
    SCRIPTS: [{ id: 'latin-ext', label: 'Latin ext' }],
    SUGGESTED: ['Inter'],
    stackFor: name => name || 'system-ui',
    previewStack: name => name || 'system-ui',
    loadPreviews: () => Promise.resolve('cache')
  }
};
vm.createContext(sandbox);
for (const file of ['i18n.js', 'schema.js', 'settings.js']) {
  vm.runInContext(read(file), sandbox, { filename: file });
}
const Schema = vm.runInContext('Schema', sandbox);
const SettingsUI = vm.runInContext('SettingsUI', sandbox);

/* Every note fits its row on one line. How much room a row leaves depends on
   what control is in it - a slider takes far more of the width than a switch -
   so the cap is per type rather than one number. */
const ROOM = {
  range: 52, segmented: 52, choice: 62, color: 62, info: 62,
  toggle: 85, font: 85, background: 85, backup: 85, action: 85, link: 85
};

const overlong = Schema.SECTIONS.flatMap(section => section.fields)
  .filter(f => f.note && f.type !== 'about')
  .filter(f => f.note.length > (ROOM[f.type] || 85));

check('every settings note fits its row on one line',
  overlong.length === 0,
  overlong.map(f => `${f.key} ${f.note.length}/${ROOM[f.type] || 85}`).join(', '));

const sent = [];
const sections = [];
const container = new El('div');
SettingsUI.mount(container, {
  values: { ...Schema.DEFAULTS, background: null },
  onChange: async (key, value) => {
    sent.push({ key, value });
    return { value };
  },
  onSection: label => sections.push(label)
});

check('mounting reports which pane it opened on',
  sections.length > 0 && sections[sections.length - 1] === 'General',
  sections.join(' > '));

const theme = container.find(el => el.className === 'segmented');
const segments = theme.querySelectorAll('.segmented__item');

check('a segmented control is one tab stop, not one per option',
  segments.filter(el => el.attrs.tabindex === '0').length === 1,
  segments.map(el => el.attrs.tabindex).join(','));

segments[0].focus();
theme.fire('keydown', { key: 'ArrowRight', preventDefault() {} });

check('an arrow moves the choice, the way a radio group works everywhere else',
  sent.some(entry => entry.key === 'theme' && entry.value === 'dark'),
  JSON.stringify(sent));

theme.fire('keydown', { key: 'Nope', preventDefault() {} });
check('and a key that means nothing here is left for the page to handle',
  sent.filter(entry => entry.key === 'theme').length === 1);

// ---------------------------------------------------------------- report

let failed = 0;
for (const result of results) {
  if (!result.pass) failed++;
  console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
