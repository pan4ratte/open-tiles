/**
 * The clock and the date, and everything that can now be set about them.
 *
 * What can go quietly wrong here:
 *
 *   - the 24-hour toggle became a four-entry format menu, and a profile
 *     written before that has to come back as the format it meant rather than
 *     as the default. There is no second chance at a migration: once the
 *     settings are written again the toggle is gone.
 *   - letter spacing is set in half a percent, and the range coercion used to
 *     round every slider to a whole number. Rounding this one would flatten
 *     every other stop, so the snapping is to the step - and it has to leave
 *     every other slider exactly where it was.
 *   - three families can now be in play at once. One stylesheet per family is
 *     what keeps the clock's from clearing the page's, and `sync` is what stops
 *     a family tried on and moved away from costing the page a sheet forever.
 *   - the colour and the shadow mean "leave it to the page" when they are off,
 *     which is the property being absent rather than set to something. Written
 *     as a value, an unset shadow would paint over the one a picture gives.
 *
 *   node test/header.test.js [path/to/src]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '..', 'src');
/* Line endings normalised: the lifts below find a run of code by its first and
   last lines, and those markers are written here with plain newlines. */
const read = file => fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

const Schema = new Function(
  read('i18n.js') + read('schema.js') + '\nreturn Schema;')();

// ------------------------------------------------------------- the menus

/*
 * Both format menus are written by handing each option bag to Intl and showing
 * what comes back, so an example is always in the reader's own language and
 * there is nothing there to translate by hand. Two things can go quietly wrong
 * with that: an example that is not really an example, and an order that is
 * not the order the tables were written in - '24' and '12' are keys a
 * JavaScript object sorts as numbers and puts in front of '24s' and '12s'.
 */
const options = key => Schema.FIELDS.find(field => field.key === key).options;

check('the clock menu reads plain, then with seconds, in both conventions',
  options('timeFormat').map(o => o.value).join() === '24,24s,12,12s',
  options('timeFormat').map(o => o.value).join());

check('the date menu keeps the order it was written in',
  options('dateFormat').map(o => o.value).join() === 'full,weekday,medium,long,short',
  options('dateFormat').map(o => o.value).join());

check('every clock example is a time rather than a name for one',
  options('timeFormat').every(o => /\d/.test(o.label)),
  options('timeFormat').map(o => o.label).join(' | '));

check('the ones carrying seconds show a third part the plain ones do not',
  options('timeFormat').filter(o => o.value.endsWith('s'))
    .every(o => o.label.length > options('timeFormat')
      .find(plain => plain.value === o.value.slice(0, -1)).label.length),
  options('timeFormat').map(o => o.label).join(' | '));

check('every date example is written out rather than left as a key',
  options('dateFormat').every(o => o.label && o.label !== o.value && /\d|\p{L}/u.test(o.label)),
  options('dateFormat').map(o => o.label).join(' | '));

check('the two menus offer exactly what the clock knows how to draw',
  options('timeFormat').every(o => Schema.TIME_FORMATS[o.value])
    && options('dateFormat').every(o => Schema.DATE_FORMATS[o.value]));

// ------------------------------------------------------------- the migration

check('a profile written when the clock had a 24-hour toggle keeps 24-hour time',
  Schema.coerce({ clock24: true }).timeFormat === '24');

check('and one that had it off comes back on the 12-hour format',
  Schema.coerce({ clock24: false }).timeFormat === '12');

check('the toggle itself is not carried forward',
  !('clock24' in Schema.coerce({ clock24: false })));

check('a format already chosen wins over the old toggle',
  Schema.coerce({ clock24: true, timeFormat: '12s' }).timeFormat === '12s');

check('a profile that never had either simply gets the default',
  Schema.coerce({}).timeFormat === '24' && Schema.coerce({}).dateFormat === 'full');

// -------------------------------------------------------------- the defaults

/* The stylesheet carries these values too, as the fallback behind each custom
   property. They are written twice on purpose - the page should look right
   before any script has run - so they have to agree. */
const css = read('newtab.css');
const fallback = name => (css.match(new RegExp('var\\(' + name + ', ([^)]*)\\)')) || [])[1];

/* Regular rather than Light: Apple's typography guidance is to avoid the
   Ultralight, Thin and Light weights, and the clamp takes this clock down to
   56px on a narrow window. The slider still reaches 300. */
check('the clock defaults to the face the stylesheet draws, and it is not a light one',
  Schema.DEFAULTS.clockWeight === 400 && fallback('--clock-weight') === '400',
  `settings ${Schema.DEFAULTS.clockWeight}, stylesheet ${fallback('--clock-weight')}`);

check('and to the tracking it was drawn with before there was a slider',
  Schema.DEFAULTS.clockTracking / 100 === parseFloat(fallback('--clock-tracking'))
    && Schema.DEFAULTS.dateTracking / 100 === parseFloat(fallback('--date-tracking')),
  `settings ${Schema.DEFAULTS.clockTracking}%, stylesheet ${fallback('--clock-tracking')}`);

check('the date starts on the page font rather than a face of its own',
  Schema.DEFAULTS.dateFont === '' && Schema.DEFAULTS.clockFont === '');

check('the colour and the shadow start out unset',
  Schema.DEFAULTS.headerTint === false && Schema.DEFAULTS.headerShadow === 0);

// ------------------------------------------------------------ the half-steps

check('a spacing of half a percent survives being stored',
  Schema.coerce({ clockTracking: -2.5 }).clockTracking === -2.5);

check('one between two stops is snapped to the nearer of them',
  Schema.coerce({ clockTracking: -2.4 }).clockTracking === -2.5,
  String(Schema.coerce({ clockTracking: -2.4 }).clockTracking));

check('one off the end of the slider is clamped to it',
  Schema.coerce({ clockTracking: 400 }).clockTracking === 20
    && Schema.coerce({ dateTracking: -400 }).dateTracking === -6);

check('and nonsense falls back to the default',
  Schema.coerce({ clockTracking: 'wide' }).clockTracking === -2.5);

check('every other slider comes out exactly as it went in',
  [['tileSize', 116], ['tileSize', 200], ['gap', 18], ['bgDim', 35], ['bgBlur', 40],
    ['logoPad', 20], ['headerShadow', 45], ['clockSize', 145], ['dateSize', 60],
    ['columns', 7]]
    .every(([key, value]) => Schema.coerce({ [key]: value })[key] === value));

// The two lines are sized apart, the same way they are weighted apart, and
// each starts at the size the stylesheet already draws it at.
check('the clock and the date have a size each, starting at 100%',
  Schema.DEFAULTS.clockSize === 100 && Schema.DEFAULTS.dateSize === 100);

// Columns used to be a menu with 'auto' at the top of it. The slider reads
// zero as Auto, and a settings file still holding the old string has to land
// back on it rather than on some number of columns.
check('Columns is a slider whose bottom stop is Auto',
  Schema.coerce({ columns: 'auto' }).columns === 0
    && Schema.coerce({ columns: 99 }).columns === 12
    && Schema.FIELDS.find(f => f.key === 'columns').zeroLabel === 'Auto');

// -------------------------------------------------------------- the weights

const weights = Schema.FIELDS.find(f => f.key === 'clockWeight').options;

check('weight is offered as the nine CSS steps under their own names',
  weights.length === 9 && weights[0].value === 100 && weights[8].value === 900
    && weights[3].label === 'Regular',
  weights.map(w => w.value).join(', '));

check('a weight arrives back as a number however the menu hands it over',
  Schema.coerce({ clockWeight: '700' }).clockWeight === 700);

check('the time and the date each get their own face, weight and spacing',
  ['clockFont', 'clockWeight', 'clockTracking',
    'dateFont', 'dateWeight', 'dateTracking']
    .every(key => Schema.FIELDS.some(f => f.key === key)));

check('over one colour and one shadow, shared',
  ['headerColor', 'headerShadow']
    .every(key => Schema.FIELDS.filter(f => f.key === key).length === 1));

check('and the colour is out of the way until it is switched on',
  Schema.FIELDS.find(f => f.key === 'headerColor').when.headerTint === true);

// ---------------------------------------------------------- how it is drawn

/*
 * The font helpers and `applyHeaderType`, lifted whole out of newtab.js and run
 * against stubs for the root element's style and for the font loader.
 */
const js = read('newtab.js');
const from = '  /** The three fields that name a family, and so need one downloading. */';
const to = '\n  }\n';
const start = js.indexOf(from);
/* The run wanted is every font helper down to the end of applyHeaderType, and
   `to` matches the close of any one of them - so the search for it starts at
   the last function in the run rather than at the first. */
const last = js.indexOf('  function applyHeaderType(root) {', start);
const end = js.indexOf(to, last);
if (start < 0 || last < 0 || end < 0) {
  throw new Error('the header drawing has moved - update this test');
}

/* One object, refilled rather than replaced: the three runs of code lifted
   below close over `settings` by name, so swapping it for another object would
   leave them reading the one they were built with. */
const settings = { ...Schema.DEFAULTS };

/** Puts the settings back to the defaults with `changes` on top. */
function set(changes = {}) {
  Object.keys(settings).forEach(key => delete settings[key]);
  Object.assign(settings, Schema.DEFAULTS, changes);
}

const props = new Map();
const stacks = new Map();

const root = {
  style: {
    setProperty: (key, value) => props.set(key, String(value)),
    removeProperty: key => props.delete(key)
  }
};

const applyHeaderType = new Function('Fonts', 'settings', `
  ${js.slice(start, end + to.length)}
  return applyHeaderType;
`)(
  {
    applyStack: (family, prop = '--font-family') => stacks.set(prop, family),
    sync: () => Promise.resolve()
  },
  settings
);

/** Draws the header with `changes` on top of the defaults. */
function draw(changes = {}) {
  set(changes);
  props.clear();
  stacks.clear();
  applyHeaderType(root);
}

draw();

check('the clock and the date follow the page font until they are given one',
  stacks.get('--clock-font') === 'Inter' && stacks.get('--date-font') === 'Inter',
  `${stacks.get('--clock-font')} / ${stacks.get('--date-font')}`);

draw({ font: 'Lora', clockFont: 'Bebas Neue' });

check('a face set on the clock is the clock alone',
  stacks.get('--clock-font') === 'Bebas Neue' && stacks.get('--date-font') === 'Lora'
    && stacks.get('--font-family') === 'Lora',
  `${stacks.get('--clock-font')} / ${stacks.get('--date-font')}`);

draw({ clockTracking: -2.5, dateTracking: 4 });

check('spacing is written as a share of the type size, so it holds at any size',
  props.get('--clock-tracking') === '-0.025em' && props.get('--date-tracking') === '0.04em',
  `${props.get('--clock-tracking')} / ${props.get('--date-tracking')}`);

draw();

check('an unset colour is the property being absent, not a colour of its own',
  !props.has('--header-color'));

check('and so is an unset shadow - which is what lets a picture still give one',
  !props.has('--header-shadow'));

draw({ headerTint: true, headerColor: '#ff9500' });

check('a custom colour is written once, for both lines',
  props.get('--header-color') === '#ff9500');

draw({ headerColor: '#ff9500' });

check('a colour chosen and then switched off goes back to the theme',
  !props.has('--header-color'));

draw({ headerShadow: 100 });

check('the shadow is a whole text-shadow, so the stylesheet has nothing to add',
  /^0 [\d.]+px [\d.]+px rgba\(0, 0, 0, [\d.]+\)$/.test(props.get('--header-shadow') || ''),
  props.get('--header-shadow'));

draw({ headerShadow: 20 });
const soft = props.get('--header-shadow');
draw({ headerShadow: 80 });
const hard = props.get('--header-shadow');
const alpha = value => Number((value.match(/,\s*([\d.]+)\)$/) || [])[1]);

check('and a stronger setting is a darker one',
  alpha(soft) > 0 && alpha(soft) < alpha(hard) && alpha(hard) <= 1,
  `${alpha(soft)} at 20%, ${alpha(hard)} at 80%`);

// ------------------------------------------------------------- what it says

/*
 * The two format tables and `tick`, lifted the same way and run against stubs
 * for the two elements they write.
 */
const tickFrom = '  const TIME_FORMATS = Schema.TIME_FORMATS;';
const tickTo = `    dateLine.textContent = now.toLocaleDateString(
      [], DATE_FORMATS[settings.dateFormat] || DATE_FORMATS.full);
  }`;
const tickStart = js.indexOf(tickFrom);
const tickEnd = js.indexOf(tickTo, tickStart);
if (tickStart < 0 || tickEnd < 0) throw new Error('tick has moved - update this test');

const clock = { textContent: '' };
const dateLine = { textContent: '' };

/* `tick` reads the moment off `new Date()`, so it is pinned under it: a
   Wednesday afternoon, on a day past the 12th so it cannot be read as a
   month, at a second that is not the one this test happens to run at. */
const at = new Date(2026, 7, 26, 13, 45, 30);
const RealDate = Date;
const Frozen = new Proxy(RealDate, {
  construct: (target, args) => (args.length ? new target(...args) : new target(at))
});

const tick = new Function('clock', 'dateLine', 'settings', 'Date', 'Schema', `
  ${js.slice(tickStart, tickEnd + tickTo.length)}
  return tick;
`)(clock, dateLine, settings, Frozen, Schema);

/** What the header reads with `changes` set. */
function shown(changes) {
  set(changes);
  tick();
  return { time: clock.textContent, date: dateLine.textContent };
}

/* Every check below is on the shape of what came out rather than on the words
   in it. What a format asks Intl for is this file's business; how the browser
   spells it, in whatever language it happens to be set to, is not - and
   asserting on "Wednesday" would only pass on a machine set to English. */
const seen = format => shown({ timeFormat: format }).time;

check('the 24-hour clock counts the afternoon up and carries no suffix',
  /(^|\D)13(\D|$)/.test(seen('24')) && !/\d{2}\D\d{2}\D\d{2}/.test(seen('24')),
  seen('24'));

check('with seconds, the same reading grows a third part',
  seen('24s').startsWith(seen('24')) && /30/.test(seen('24s')), seen('24s'));

check('the 12-hour clock counts it back down and says which half it is in',
  !/13/.test(seen('12')) && /45/.test(seen('12'))
    && seen('12').length > seen('24').length, seen('12'));

check('and carries seconds too',
  /30/.test(seen('12s')) && seen('12s').length > seen('12').length, seen('12s'));

const dated = format => shown({ dateFormat: format }).date;
const [full, weekday, medium, long, short] =
  ['full', 'weekday', 'medium', 'long', 'short'].map(dated);

check('the weekday on its own names a day and counts nothing',
  weekday.length > 0 && !/\d/.test(weekday), weekday);

check('the full date is that and the day of the month, spelt out',
  full.length > weekday.length && /26/.test(full), full);

check('the medium date says the same thing shorter',
  medium.length < full.length && /26/.test(medium), medium);

check('the long date carries the year, which the full one does not',
  /2026/.test(long) && !/2026/.test(full), `${long} / ${full}`);

check('and drops the weekday to make room for it',
  !long.includes(weekday.slice(0, 4)), long);

check('the short date is nothing but figures',
  /^[\d\W]+$/.test(short) && /2026/.test(short), short);

check('and no two of the five read alike',
  new Set([full, weekday, medium, long, short]).size === 5,
  [full, weekday, medium, long, short].join(' | '));

const unknown = shown({ timeFormat: 'sundial', dateFormat: 'stardate' });

check('a format this build has never heard of falls back rather than blanking',
  unknown.time.length > 0 && unknown.date.length > 0,
  `${unknown.time} — ${unknown.date}`);

// -------------------------------------------------------------- the cadence

const schedFrom = '  function scheduleTick() {';
const schedStart = js.indexOf(schedFrom);
const schedEnd = js.indexOf(to, schedStart);
if (schedStart < 0) throw new Error('scheduleTick has moved - update this test');

const armed = [];
const scheduleTick = new Function('settings', 'tick', 'setInterval', 'clearInterval', `
  let clockCadence = 0;
  let clockTimer = null;
  ${js.slice(schedStart, schedEnd + to.length)}
  return scheduleTick;
`)(
  settings,
  tick,
  (fn, ms) => { armed.push(ms); return armed.length; },
  () => {}
);

const arm = format => {
  set({ timeFormat: format });
  scheduleTick();
};

arm('24');
check('a clock without seconds is redrawn every ten seconds',
  armed.join() === '10000', armed.join());

arm('12');
check('and re-arming it for the same cadence leaves the timer running',
  armed.join() === '10000', armed.join());

arm('12s');
check('turning seconds on moves it to every second',
  armed.join() === '10000,1000', armed.join());

arm('24s');
check('which is still one timer, not a second one',
  armed.join() === '10000,1000', armed.join());

arm('24');
check('and turning them off puts it back',
  armed.join() === '10000,1000,10000', armed.join());

// ------------------------------------------------------------- in the panel

/*
 * The real settings.js, mounted against the DOM shim, so the two font pickers
 * the Header panel now carries are built rather than merely declared.
 */
const { El, document: shimDoc } = require('./dom-shim');

const uiSandbox = {
  console,
  document: shimDoc,
  setTimeout,
  clearTimeout,
  Schema,
  Icons: { create: () => new El('svg') },
  Fonts: {
    CATALOG: [
      { name: 'Inter', style: 'sans', scripts: ['latin-ext'] },
      { name: 'Bebas Neue', style: 'display', scripts: ['latin-ext'] }
    ],
    STYLES: [{ id: 'sans', label: 'Sans' }, { id: 'display', label: 'Display' }],
    SCRIPTS: [{ id: 'latin-ext', label: 'Latin ext' }],
    SUGGESTED: ['Inter', 'Bebas Neue'],
    stackFor: name => name || 'system-ui',
    previewStack: name => name || 'system-ui',
    loadPreviews: () => Promise.resolve('cache')
  }
};
vm.createContext(uiSandbox);
vm.runInContext(read('i18n.js'), uiSandbox, { filename: 'i18n.js' });
vm.runInContext(read('settings.js'), uiSandbox, { filename: 'settings.js' });
const SettingsUI = vm.runInContext('SettingsUI', uiSandbox);

const sent = [];
const dialog = new El('div');

SettingsUI.mount(dialog, {
  values: { ...Schema.DEFAULTS, font: 'Lora', background: { record: null, recent: [] } },
  onChange: async (key, value) => {
    sent.push({ key, value });
    return { value };
  }
});

const rowFor = key => dialog.find(el => el.dataset && el.dataset.field === key);

check('every new setting has a row in the dialog',
  ['timeFormat', 'clockFont', 'clockWeight', 'clockTracking', 'dateFormat',
    'dateFont', 'dateWeight', 'dateTracking', 'headerTint', 'headerColor',
    'headerShadow'].every(key => Boolean(rowFor(key))));

check('the custom colour is hidden until the toggle above it is on',
  rowFor('headerColor').hidden === true);

/* By the family on it rather than by the class: the shim matches a class name
   as a substring, and every card holds a `.fontcard__name` that would answer
   to "fontcard" as well. */
const cardsIn = key =>
  rowFor(key).findAll(el => el.dataset && typeof el.dataset.family === 'string');

const clockCards = cardsIn('clockFont');

check('the clock font picker offers the catalogue',
  clockCards.length === uiSandbox.Fonts.CATALOG.length + 1,
  clockCards.length + ' card(s)');

check('headed by one that hands the line back to the page font',
  clockCards[0].textContent === 'Default'
    && clockCards[0].dataset.family === '',
  clockCards[0].textContent);

check('drawn in the page font, since that is what it stands for',
  clockCards[0].find(el => el.classList.contains('fontcard__name'))
    .style.fontFamily === 'Lora');

check('and it is the one selected while the clock has no face of its own',
  clockCards[0].classList.contains('is-on'));

check('the page font picker still calls that card the system font',
  cardsIn('font')[0].textContent === 'System font', cardsIn('font')[0].textContent);

clockCards[1].fire('click');

check('picking one asks the page for that family on the clock alone',
  sent.length === 1 && sent[0].key === 'clockFont'
    && sent[0].value === uiSandbox.Fonts.CATALOG[0].name,
  JSON.stringify(sent));

// ------------------------------------------------------- a sheet per family

/**
 * Just enough document for fonts.js: a head that holds style elements, and the
 * one attribute selector `sync` sweeps with.
 */
function makeDocument() {
  const styles = [];
  return {
    styles,
    head: { append: style => styles.push(style) },
    documentElement: { style: { setProperty() {} } },
    createElement: () => ({
      dataset: {},
      textContent: '',
      replaceWith(next) { styles.splice(styles.indexOf(this), 1, next); },
      remove() { styles.splice(styles.indexOf(this), 1); }
    }),
    getElementById: id => styles.find(style => style.id === id) || null,
    querySelectorAll: sel => {
      const prefix = (sel.match(/\^="([^"]+)"/) || [])[1];
      return styles.filter(style => style.id && style.id.startsWith(prefix));
    }
  };
}

const doc = makeDocument();
const fetched = [];

const fontSandbox = {
  console,
  document: doc,
  Store: {
    /* Every family answers from cache here: which sheets end up on the page is
       a different question from how one is downloaded, and the download has a
       sandbox of its own below. */
    getFontCss: async family => { fetched.push(family); return `/* ${family} */`; },
    putFontCss: async () => {}
  }
};
vm.createContext(fontSandbox);
vm.runInContext(read('i18n.js'), fontSandbox, { filename: 'i18n.js' });
vm.runInContext(read('fonts.js'), fontSandbox, { filename: 'fonts.js' });
const Fonts = vm.runInContext('Fonts', fontSandbox);

// ------------------------------------------------------ asking for the axis

/**
 * A stand-in for Google Fonts. `axes` is the ranges this family has; anything
 * else is refused the way css2 refuses it - a 400 carrying no
 * Access-Control-Allow-Origin, which reaches the page as a **rejected fetch**
 * rather than as a status. Reading `res.status` there would never run, which
 * is exactly the trap this section is here to hold the loader out of.
 */
function makeFontServer({ axes = [], cuts = [], down = false } = {}) {
  const asked = [];
  const fetchStub = async url => {
    // The woff2 behind a face, which is not what any of this is about.
    if (url.includes('gstatic')) {
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }

    asked.push(url);
    if (down) return { ok: false, status: 503 };

    const spec = (url.match(/:wght@([^&]*)/) || [])[1] || null;
    const served = spec === null ? cuts.includes(null) : (axes.includes(spec) || cuts.includes(spec));
    if (!served) throw new TypeError('Failed to fetch');

    return {
      ok: true,
      status: 200,
      text: async () => '/* latin */\n@font-face { font-family: "X";'
        + ' src: url(https://fonts.gstatic.com/x.woff2) format("woff2"); }'
    };
  };
  return { asked, fetchStub };
}

/** fonts.js on its own, over a stubbed network and a cold cache. */
function loaderOver(server) {
  const box = {
    console,
    document: makeDocument(),
    fetch: server.fetchStub,
    btoa: text => Buffer.from(text, 'binary').toString('base64'),
    Uint8Array,
    Store: { getFontCss: async () => undefined, putFontCss: async () => {} }
  };
  vm.createContext(box);
  vm.runInContext(read('i18n.js'), box, { filename: 'i18n.js' });
  vm.runInContext(read('fonts.js'), box, { filename: 'fonts.js' });
  return vm.runInContext('Fonts', box);
}

const specsIn = server =>
  server.asked.map(url => (url.match(/:wght@([^&]*)/) || [])[1] || 'bare');

const sheets = () => doc.styles.map(style => style.dataset.family).sort().join(', ');

(async () => {
  await Fonts.sync(['Lora', 'Bebas Neue', 'Lora']);

  check('a family named twice is only fetched once',
    fetched.filter(name => name === 'Lora').length === 1, fetched.join(', '));

  check('and each family gets a stylesheet of its own',
    sheets() === 'Bebas Neue, Lora', sheets());

  check('under an id nothing else in the head can collide with',
    doc.styles.every(style => /^webfont-family-[a-z0-9-]+$/.test(style.id)),
    doc.styles.map(style => style.id).join(', '));

  await Fonts.sync(['Lora']);

  check('a family nothing names any more loses its sheet',
    sheets() === 'Lora', sheets());

  fetched.length = 0;
  await Fonts.sync(['Lora', 'Bebas Neue']);

  check('and going back to it puts the sheet back rather than showing nothing',
    sheets() === 'Bebas Neue, Lora' && fetched.includes('Bebas Neue'),
    `${sheets()} — fetched ${fetched.join(', ') || 'nothing'}`);

  fetched.length = 0;
  await Fonts.sync(['Lora', 'Bebas Neue']);

  check('while a family already on the page is left alone',
    fetched.length === 0 && sheets() === 'Bebas Neue, Lora',
    fetched.join(', ') || 'nothing fetched');

  await Fonts.sync(['Inter', '']);

  check('the bundled family needs no sheet, and neither does the system font',
    doc.styles.length === 0 && await Fonts.load('Inter') === 'bundled'
      && await Fonts.load('') === 'system',
    doc.styles.length + ' sheet(s)');

  /* A family dropped while it was still coming down: the sweep that should
     take it away runs before it has anything to take, so the sheet would
     otherwise land after it and stay. */
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const held = {
    ...fontSandbox.Store,
    getFontCss: async family => {
      if (family === 'Slowpoke') await slow;
      return `/* ${family} */`;
    }
  };
  fontSandbox.Store = held;

  const inFlight = Fonts.sync(['Slowpoke']);
  await Fonts.sync(['Lora']);
  release();
  await inFlight;

  check('a family dropped mid-download does not land behind the sweep',
    sheets() === 'Lora', sheets() || 'nothing');

  // -------------------------------------------------- asking for the axis

  const wide = makeFontServer({ axes: ['100..900'], cuts: ['300;400;600', null] });
  check('a family with the whole axis is taken at that and nothing else',
    await loaderOver(wide).load('Montserrat') === 'network'
      && !specsIn(wide).includes('300;400;600'),
    specsIn(wide).join(', '));

  const narrow = makeFontServer({ axes: ['400..700'], cuts: ['300;400;600', null] });
  await loaderOver(narrow).load('Lora');
  check('a narrower axis is found by asking for all of them at once',
    specsIn(narrow).slice(0, 4).join(',') === '100..900,200..800,300..800,400..700'
      && !specsIn(narrow).includes('300;400;600'),
    specsIn(narrow).join(', '));

  const flat = makeFontServer({ cuts: ['300;400;600', null] });
  check('a family with no axis at all still comes down off the static cut',
    await loaderOver(flat).load('Bebas Neue') === 'network',
    specsIn(flat).join(', '));

  check('which means four refusals in a row are not four reasons to give up',
    specsIn(flat).length === 5 && specsIn(flat)[4] === '300;400;600',
    specsIn(flat).join(', '));

  const bare = makeFontServer({ cuts: [null] });
  check('and a family that will not be cut at all is asked for plain',
    await loaderOver(bare).load('Odd One') === 'network'
      && specsIn(bare)[5] === 'bare',
    specsIn(bare).join(', '));

  const none = makeFontServer({});
  let refused = null;
  try { await loaderOver(none).load('Definitely Not A Font'); } catch (err) { refused = err.message; }
  check('a family Google has never heard of is reported as that',
    /no family called/.test(refused || ''), refused);

  const down = makeFontServer({ down: true });
  let outage = null;
  try { await loaderOver(down).load('Inter Tight'); } catch (err) { outage = err.message; }
  check('while an outage is reported as the reply it actually was',
    /503/.test(outage || ''), outage);

  let failed = 0;
  for (const result of results) {
    if (!result.pass) failed++;
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
