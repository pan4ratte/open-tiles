/**
 * Guards changing group: the animation between two of them, and the scroll
 * gesture that turns to the next one along.
 *
 * What can go quietly wrong here:
 *
 *   - the class the page toggles and the class the stylesheet draws drift
 *     apart. Nothing throws; the grid simply changes with no animation, or
 *     worse, is left at `opacity: 0` because the class that would have brought
 *     it back is spelt differently from the one that took it away.
 *   - GROUP_OUT_MS and --t-group-out drift apart. Too short and the new tiles
 *     are drawn while the old ones are still on screen; too long and the grid
 *     sits blank between the two halves.
 *   - a scroll runs the whole block in a frame. A touchpad sends a flurry of
 *     wheel events for one gesture, so anything acting per event flies through
 *     every group at once. Keeping the wheel moving should walk them steadily;
 *     that pacing cannot be seen from reading the code.
 *   - the tail of momentum a touchpad throws after the fingers have lifted
 *     keeps turning groups on its own. It is deltas like any other, and only
 *     its fading tells it apart.
 *   - the gesture eats a scroll meant for a dialog, or for the chips when
 *     there are more of them than the block can show.
 *   - a wheel that reports in lines rather than pixels - which is what Firefox
 *     does for a mouse - never adds up to enough to turn anything.
 *
 * The wheel handler is lifted out of the real newtab.js and run here, so what
 * is tested is the code that ships rather than a copy of it. The rest runs the
 * real schema.js and settings.js against the DOM shim.
 *
 *   node test/groupswitch.test.js [path/to/src]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const { El, event, document } = require('./dom-shim');

const SRC = process.argv[2] || path.join(__dirname, '..', 'src');
const read = file => fs.readFileSync(path.join(SRC, file), 'utf8');

const js = read('newtab.js');
const css = read('newtab.css');

// ------------------------------------------------------------------ harness

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

// ------------------------------------------------------------------ sandbox

const sandbox = {
  document,
  console,
  setTimeout,
  clearTimeout,
  Icons: { create: () => new El('svg') },
  Fonts: { SUGGESTED: ['Inter'], stackFor: name => name || 'system-ui' }
};
vm.createContext(sandbox);

for (const file of ['schema.js', 'settings.js']) {
  vm.runInContext(read(file), sandbox, { filename: file });
}

const Schema = vm.runInContext('Schema', sandbox);
const SettingsUI = vm.runInContext('SettingsUI', sandbox);

// ------------------------------------------------------------- the settings

const keys = ['groupAnimate', 'groupScroll', 'groupScrollAxis'];

check('every new group setting has a default',
  keys.every(key => key in Schema.DEFAULTS),
  JSON.stringify(keys.map(key => Schema.DEFAULTS[key])));

check('the animation is on out of the box',
  Schema.DEFAULTS.groupAnimate === true);

check('the gesture is not - it takes scrolling away from the page',
  Schema.DEFAULTS.groupScroll === false);

check('a direction it does not know falls back to the default',
  Schema.coerce({ groupScrollAxis: 'diagonally' }).groupScrollAxis === 'vertical');

check('all three directions are offered',
  ['vertical', 'horizontal', 'either'].every(value =>
    Schema.coerce({ groupScrollAxis: value }).groupScrollAxis === value));

// ------------------------------------------------- the rows in the dialog

const container = new El('div');
const sent = [];

SettingsUI.mount(container, {
  values: { ...Schema.DEFAULTS, background: null },
  onChange: async (key, value) => {
    sent.push({ key, value });
    return { value };
  }
});

const rowFor = key => container.find(el => el.dataset && el.dataset.field === key);
const itemFor = (key, value) => rowFor(key)
  .find(el => el.dataset && el.dataset.value === value);

check('all three rows rendered',
  keys.every(key => Boolean(rowFor(key))),
  keys.filter(key => !rowFor(key)).join(', ') || 'all there');

check('the direction is out of sight until scrolling is turned on',
  rowFor('groupScrollAxis').hidden === true);

check('the two toggles are always on show',
  rowFor('groupAnimate').hidden === false && rowFor('groupScroll').hidden === false);

(async () => {
  const toggle = container.find(el => el.id === 'set-groupScroll');
  toggle.checked = true;
  toggle.fire('change');
  await new Promise(resolve => setTimeout(resolve, 0));

  check('turning scrolling on sends the change',
    sent.some(call => call.key === 'groupScroll' && call.value === true),
    JSON.stringify(sent[sent.length - 1] || null));

  check('and brings out the direction it should run in',
    rowFor('groupScrollAxis').hidden === false);

  check('the direction reads in words, not in axes',
    itemFor('groupScrollAxis', 'vertical').textContent === 'Up and down',
    itemFor('groupScrollAxis', 'vertical').textContent);

  toggle.checked = false;
  toggle.fire('change');
  await new Promise(resolve => setTimeout(resolve, 0));

  check('turning it off puts the direction away again',
    rowFor('groupScrollAxis').hidden === true);

  // ------------------------------------------ the page and the stylesheet

  /*
   * Every class the page puts on the grid has to be a class the stylesheet
   * draws, and every custom property the page writes has to be one the
   * stylesheet reads. Neither half fails loudly when they part company.
   */

  ['is-leaving', 'is-entering', 'is-nudged'].forEach(name => {
    check(`the stylesheet draws .${name}`,
      css.includes(`.grid.${name}`) && css.includes(`.empty.${name}`),
      js.includes(`'${name}'`) ? 'the page uses it' : 'the page never uses it');

    check(`and the page is what puts .${name} on`,
      js.includes(`'${name}'`));
  });

  /*
   * Where the floating block sits, and how it hides. Each placement is a body
   * class the page writes and the stylesheet draws; a name that drifts on one
   * side leaves the block sitting wherever it last was, with nothing thrown.
   */
  [
    ['gb-inline', 'above the tiles'],
    ['gb-float-bottom', 'at the bottom']
  ].forEach(([name, where]) => {
    check(`the page puts .${name} on for a block ${where}`, js.includes(`'${name}'`));
    check(`and the stylesheet draws it`, css.includes(`body.${name} `));
  });

  /*
   * The tiles are the anchor of this page: they hold the centre of the window
   * and nothing is allowed to shift them. So a block set in the page cannot
   * take a row of its own - a row with height in it pushes the tiles down as
   * surely as a margin would. It joins the stack the tiles anchor instead, the
   * header's column, which hangs from the bottom of a flexible row: room taken
   * there pushes the clock up and leaves the grid where it is.
   */
  const inlineRule = (css.match(/body\.gb-inline \.groupbar \{([^}]*)\}/) || [])[1] || '';

  check('the page moves the block into the column the clock is in',
    /const home = inline \? header : document\.body;/.test(js));

  check('and appends it there, so it lands under the clock',
    /home\.insertBefore\(groupBar, inline \? null : toolbar\);/.test(js));

  check('the column stays even with no clock and no date, being the block home now',
    /header\.hidden = !settings\.showClock && !settings\.showDate && !inline;/.test(js));

  check('the block is a plain item of that column, centred by it',
    /position: static/.test(inlineRule), inlineRule.replace(/\s+/g, ' ').trim());

  check('the room it takes is its own, above and below',
    /margin-top: var\(--groupbar-gap\)/.test(inlineRule)
      && /body\.gb-inline \.page__header \{ margin-bottom: var\(--groupbar-gap\); \}/.test(css));

  check('and it is a number of its own, not a share of the gap the clock leaves',
    /--groupbar-gap:\s*\d+px/.test(css) && /\.page__header \{[\s\S]*?margin-bottom: 44px/.test(css));

  check('so the page keeps the three rows it always had',
    /grid-template-rows: 1fr auto 1fr/.test(css)
      && /\.grid \{[^}]*grid-row: 2/.test(css) && /\.empty \{[^}]*grid-row: 3/.test(css));

  check('and the block asks for no row at all',
    !/grid-row/.test(inlineRule), inlineRule.replace(/\s+/g, ' ').trim());

  check('the pill arrives from the edge it lives at',
    css.includes('body.gb-float-bottom .groupbar__inner { animation-name: pill-up; }')
      && css.includes('@keyframes pill-up'));

  /*
   * A group with a different number of rows re-centres the page, which moves
   * the gap the block sits in. It travels there rather than jumping: the page
   * measures where the block was, puts it back with a transform once the grid
   * has been rebuilt, and lets go.
   */
  check('the page measures the block before the redraw and puts it back after',
    /const from = groupBarAt\(\);\s*render\(\);\s*startOfGroup\(\);\s*glideGroupBar\(from\);/.test(js));

  /*
   * The measurement is taken on the page rather than in the window, because
   * the change may take the scroll with it: that is a jump, not a move, and
   * gliding the block across it would animate the wrong thing entirely.
   */
  check('and measures it on the page, so a scroll is not read as a move',
    /function groupBarAt\(\) \{\s*return groupBar\.getBoundingClientRect\(\)\.top \+ scroller\(\)\.scrollTop;/.test(js));

  /*
   * A group is only left once it has been read to the end, so the next one
   * has to begin somewhere else - or it would arrive already read, and the
   * next push would leave it unseen. That somewhere is the top, however the
   * group was arrived at.
   */
  check('every group begins at its top, whichever way it was come to',
    /function startOfGroup\(\) \{\s*scroller\(\)\.scrollTop = 0;\s*\}/.test(js));

  check('and the page is put there as part of the change, not left to the browser',
    /render\(\);\s*startOfGroup\(\);\s*return;/.test(js));

  check('the jump back is made with the transition off, or it animates itself',
    /style\.transition = 'none';\s*groupBar\.style\.transform = `translateY\(\$\{shift\}px\)`/.test(js));

  check('and the layout is read in between, or both writes land in one pass',
    /void groupBar\.offsetWidth;\s*groupBar\.style\.transition = '';\s*groupBar\.style\.transform = '';/.test(js));

  check('the stylesheet is what carries it the rest of the way',
    /transition: opacity[^;]*,\s*transform var\(--t-group-in\)/.test(inlineRule));

  check('nowhere else measures anything - a pill and a bar are both pinned',
    /if \(!document\.body\.classList\.contains\('gb-inline'\)\) return;/.test(js));

  check('and with the animation off the block simply moves, like the grid',
    /if \(!animatesGroups\(\)\) \{\s*render\(\);\s*startOfGroup\(\);\s*return;\s*\}/.test(js));

  /*
   * On hover means on hover. The block used to let itself out whenever a group
   * was picked - first for as long as it stayed picked, which meant it never
   * hid at all, then for a moment - and both read as the setting not working.
   */
  check('nothing but the pointer, the keyboard and a drag brings the block back',
    !css.includes('.groupbar.is-peek') && !css.includes('.groupbar.is-active')
      && css.includes('body.gb-hover.is-dragging .groupbar'));

  check('and the page has no way left to ask it to show itself',
    !js.includes('peekGroups') && !js.includes("'is-peek'") && !js.includes("'is-active'"));

  check('the page writes --group-dir and the stylesheet reads it',
    js.includes("'--group-dir'") && css.includes('var(--group-dir)'));

  check('--group-shift is built from the direction, so one write turns it all',
    /--group-shift:\s*calc\(var\(--group-travel\)\s*\*\s*var\(--group-dir\)\)/.test(css));

  // The grid leaves, and only then is the new one drawn: the two numbers are
  // the same length of time written in two languages.
  const outMs = Number((js.match(/const GROUP_OUT_MS = (\d+);/) || [])[1]);
  const outCss = Number((css.match(/--t-group-out:\s*([\d.]+)s/) || [])[1]) * 1000;

  check('the redraw waits exactly as long as the fade out lasts',
    outMs === outCss, `${outMs}ms in the page, ${outCss}ms in the stylesheet`);

  check('the grid comes back in slower than it went out - it is what arrives',
    Number((css.match(/--t-group-in:\s*([\d.]+)s/) || [])[1]) * 1000 > outCss);

  check('reduced motion turns the animation off whatever the setting says',
    /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(js));

  // ------------------------------------------------------- the wheel handler

  /*
   * Lifted whole out of newtab.js - its constants, its running totals and the
   * listener itself - and run against stubs for the three things it reaches
   * out to: the settings, the call that turns a group, and the page's own
   * scrolling, which a gesture has to give way to before it turns anything.
   */
  const from = '  /** How far the deltas have to add up before a group is turned. */';
  const to = '  }, { passive: false });';

  const start = js.indexOf(from);
  const end = js.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error('the wheel handler has moved - update this test');
  const block = js.slice(start, end + to.length);

  let handler = null;
  const steps = [];

  const build = new Function('document', 'settings', 'stepGroup', 'setTimeout', 'clearTimeout',
    'scroller',
    block + '\n; return { wheelDelta };');

  let settings = { groupScroll: true, groupScrollAxis: 'vertical' };

  /*
   * The page as something to scroll. A group that fits the window has nothing
   * to scroll and turns on the first push, which is what `fits` is; `runs`
   * gives it more tiles than fit, with `at` saying how far down them the page
   * has been scrolled.
   */
  const scroller = { scrollTop: 0, scrollHeight: 800, clientHeight: 800 };
  const fits = () => Object.assign(scroller, { scrollTop: 0, scrollHeight: 800 });
  const runs = at => Object.assign(scroller, { scrollTop: at, scrollHeight: 2400 });

  const { wheelDelta } = build(
    {
      addEventListener: (type, fn) => { if (type === 'wheel') handler = fn; },
      scrollingElement: scroller
    },
    // A getter, so the stub follows whatever the test sets next.
    new Proxy({}, { get: (_, key) => settings[key] }),
    step => steps.push(step),
    setTimeout,
    clearTimeout,
    // The page's own scrolling, which the gesture asks about before it acts.
    () => scroller
  );

  check('the handler listens for wheel events', typeof handler === 'function');

  /** A wheel event over the page, with nothing scrollable underneath. */
  const wheel = (props = {}) => event('wheel', {
    deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, cancelable: true,
    target: { closest: () => null },
    ...props
  });

  /** One flick of two fingers: a flurry, then a tail of momentum. */
  function flick({ dx = 0, dy = 0, events = 6, tail = 5 } = {}) {
    for (let i = 0; i < events; i++) handler(wheel({ deltaX: dx, deltaY: dy }));
    for (let i = 0; i < tail; i++) {
      handler(wheel({ deltaX: dx / (i + 2), deltaY: dy / (i + 2) }));
    }
  }

  /** The pause that says the fingers have left the touchpad. */
  const rest = () => new Promise(resolve => setTimeout(resolve, 400));

  steps.length = 0;
  flick({ dy: 20 });
  check('a flurry of events arriving at once turns one group, not every group',
    steps.length === 1 && steps[0] === 1, JSON.stringify(steps));

  await rest();
  steps.length = 0;
  flick({ dy: -20 });
  check('flicking the other way goes back one',
    steps.length === 1 && steps[0] === -1, JSON.stringify(steps));

  // No rest: a second flick landing on the heels of the first.
  steps.length = 0;
  flick({ dy: 20 });
  check('a second flurry on the heels of the first does not turn two at once',
    steps.length === 0, JSON.stringify(steps));

  await rest();
  steps.length = 0;
  flick({ dy: 20 });
  check('but once the touchpad is quiet the next flick counts again',
    steps.length === 1, JSON.stringify(steps));

  await rest();
  steps.length = 0;
  handler(wheel({ deltaY: 4 }));
  handler(wheel({ deltaY: 4 }));
  check('a nudge too small to mean anything turns nothing',
    steps.length === 0, JSON.stringify(steps));

  // ------------------------------------------------------ scrolling on and on

  /*
   * These need real time to pass, because pacing is the whole point of them:
   * the events above all arrive in the same millisecond, which proves only
   * that a burst cannot outrun the repeat.
   */

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  /** A scroll kept going: a steady push, spaced out in real time. */
  async function hold({ dy = 40, ms = 1000, every = 30 } = {}) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      handler(wheel({ deltaY: dy }));
      await wait(every);
    }
  }

  /** A flick let go of: a short push, then a tail that only ever fades. */
  async function letGo({ dy = 60, pushes = 5, tail = 40, every = 16 } = {}) {
    for (let i = 0; i < pushes; i++) {
      handler(wheel({ deltaY: dy }));
      await wait(every);
    }
    let fading = dy;
    for (let i = 0; i < tail; i++) {
      fading *= .9;
      handler(wheel({ deltaY: fading }));
      await wait(every);
    }
  }

  await rest();
  steps.length = 0;
  await hold({ ms: 1000 });
  const held = steps.length;
  check('keeping the scroll going keeps turning groups',
    held >= 3, `${held} groups in a second`);

  check('and every one of them the same way',
    steps.every(step => step === 1), JSON.stringify(steps));

  check('but it walks them rather than blurring through them',
    held <= 6, `${held} groups in a second`);

  await rest();
  steps.length = 0;
  await letGo();
  check('the tail after the fingers lift does not keep turning on its own',
    steps.length >= 1 && steps.length <= 2,
    `${steps.length} groups from one flick and its momentum`);

  // Turning back without stopping first: the sums so far must not hold it up.
  await rest();
  steps.length = 0;
  await hold({ dy: 40, ms: 400 });
  const wentOn = steps.length;
  await hold({ dy: -40, ms: 400 });
  check('turning back mid-scroll goes back, without waiting for a pause',
    wentOn >= 1 && steps.slice(wentOn).length >= 1
      && steps.slice(wentOn).every(step => step === -1),
    JSON.stringify(steps));

  await rest();
  steps.length = 0;
  flick({ dx: 40 });
  check('a sideways flick is ignored while the setting says up and down',
    steps.length === 0, JSON.stringify(steps));

  settings = { groupScroll: true, groupScrollAxis: 'horizontal' };
  await rest();
  steps.length = 0;
  flick({ dy: 40 });
  check('and a touchpad swiped up and down while it says left and right',
    steps.length === 0, JSON.stringify(steps));

  steps.length = 0;
  flick({ dx: 40 });
  check('the direction it was asked for does turn a group',
    steps.length === 1 && steps[0] === 1, JSON.stringify(steps));

  /*
   * A mouse has no sideways to give. Left and right would otherwise be a
   * setting that does nothing at all for anyone on a wheel, so a notch of one
   * counts as the push its single axis was meant to be - while the touchpad
   * above, scrolled the way the setting is not about, is still left alone.
   */
  await rest();
  steps.length = 0;
  handler(wheel({ deltaY: 100 }));
  check('a notch of a mouse wheel turns a group even so',
    steps.length === 1 && steps[0] === 1, JSON.stringify(steps));

  await rest();
  steps.length = 0;
  handler(wheel({ deltaY: -100 }));
  check('and the other way goes back',
    steps.length === 1 && steps[0] === -1, JSON.stringify(steps));

  await rest();
  steps.length = 0;
  handler(wheel({ deltaY: 3, deltaMode: 1 }));
  check('so does one reporting in lines, which is what Firefox sends',
    steps.length === 1, JSON.stringify(steps));

  await rest();
  steps.length = 0;
  // Six of these add up past the threshold; what keeps them out is what they
  // are, not how far they went.
  for (let i = 0; i < 6; i++) handler(wheel({ deltaY: 12.5 }));
  check('but a touchpad is still told apart by its small, uneven deltas',
    steps.length === 0, JSON.stringify(steps));

  // Gecko reports a precision touchpad in lines, the way it reports a wheel -
  // but in fractions of one, and a notch is never a fraction.
  await rest();
  steps.length = 0;
  for (let i = 0; i < 8; i++) handler(wheel({ deltaY: 1.5, deltaMode: 1 }));
  check('and a touchpad counted in lines does not pass for a notch',
    steps.length === 0, JSON.stringify(steps));

  await rest();
  steps.length = 0;
  for (let i = 0; i < 6; i++) handler(wheel({ deltaX: 10, deltaY: 60 }));
  check('and a swipe that leaks sideways is read sideways, not as a notch',
    steps.length === 1 && steps[0] === 1, JSON.stringify(steps));

  settings = { groupScroll: true, groupScrollAxis: 'either' };
  await rest();
  steps.length = 0;
  flick({ dx: 40 });
  check('"either" takes a sideways flick',
    steps.length === 1, JSON.stringify(steps));

  await rest();
  steps.length = 0;
  flick({ dy: 40 });
  check('and an up-and-down one',
    steps.length === 1, JSON.stringify(steps));

  // A Firefox mouse wheel reports three lines, not pixels, and one notch of it
  // has to be enough on its own.
  settings = { groupScroll: true, groupScrollAxis: 'vertical' };
  await rest();
  steps.length = 0;
  handler(wheel({ deltaY: 3, deltaMode: 1 }));
  check('one notch of a mouse wheel reporting lines turns a group',
    steps.length === 1 && steps[0] === 1,
    `a notch reads as ${wheelDelta(wheel({ deltaY: 3, deltaMode: 1 })).delta}px`);

  await rest();
  steps.length = 0;
  handler(wheel({ deltaY: 1, deltaMode: 2 }));
  check('so does a wheel reporting whole pages',
    steps.length === 1, JSON.stringify(steps));

  // ------------------------------------- reading a group before leaving it

  /*
   * A group with more tiles than the window can hold is somewhere to read
   * before it is somewhere to leave. The gesture gives way to the page's own
   * scrolling until there is none of that group left in the direction being
   * pushed - and only then turns.
   */
  settings = { groupScroll: true, groupScrollAxis: 'vertical' };

  await rest();
  steps.length = 0;
  runs(0);
  flick({ dy: 40 });
  check('a group taller than the window scrolls rather than turning',
    steps.length === 0, JSON.stringify(steps));

  await rest();
  steps.length = 0;
  runs(700);
  flick({ dy: 40 });
  check('and half way down it is still scrolling',
    steps.length === 0, JSON.stringify(steps));

  await rest();
  steps.length = 0;
  runs(1600);
  flick({ dy: 40 });
  check('at the bottom of it, the next push turns the group',
    steps.length === 1 && steps[0] === 1, JSON.stringify(steps));

  await rest();
  steps.length = 0;
  runs(1600);
  flick({ dy: -40 });
  check('scrolling back up from there reads it rather than turning back',
    steps.length === 0, JSON.stringify(steps));

  await rest();
  steps.length = 0;
  runs(0);
  flick({ dy: -40 });
  check('and at the top, going back turns the group',
    steps.length === 1 && steps[0] === -1, JSON.stringify(steps));

  // Arriving at the end is not itself enough to be carried past it: what the
  // page scrolled with does not count towards the turn.
  await rest();
  steps.length = 0;
  runs(1600 - 30);
  handler(wheel({ deltaY: 40 }));   // takes the page to the bottom
  scroller.scrollTop = 1600;
  handler(wheel({ deltaY: 40 }));
  check('the scroll that reached the end does not count towards leaving',
    steps.length === 0, JSON.stringify(steps));

  handler(wheel({ deltaY: 40 }));
  check('but pushing on from there does',
    steps.length === 1, JSON.stringify(steps));

  // A sideways push is nothing the page would have scrolled with, so it has
  // nothing to wait behind.
  settings = { groupScroll: true, groupScrollAxis: 'either' };
  await rest();
  steps.length = 0;
  runs(700);
  flick({ dx: 40 });
  check('a sideways gesture turns a group wherever the page is scrolled to',
    steps.length === 1 && steps[0] === 1, JSON.stringify(steps));

  settings = { groupScroll: true, groupScrollAxis: 'horizontal' };
  await rest();
  steps.length = 0;
  runs(700);
  handler(wheel({ deltaY: 100 }));
  check('but the wheel borrowed for left and right still waits for the page',
    steps.length === 0, JSON.stringify(steps));

  await rest();
  steps.length = 0;
  runs(1600);
  handler(wheel({ deltaY: 100 }));
  check('and turns once there is no more group to read',
    steps.length === 1, JSON.stringify(steps));

  settings = { groupScroll: true, groupScrollAxis: 'vertical' };
  fits();

  // ------------------------------------------------- what it keeps its hands off

  await rest();
  steps.length = 0;
  flick({ dy: 40, events: 10 });
  const acted = steps.length;

  settings = { groupScroll: false, groupScrollAxis: 'vertical' };
  await rest();
  steps.length = 0;
  flick({ dy: 40, events: 10 });
  check('with the setting off the gesture does nothing at all',
    acted === 1 && steps.length === 0, `${acted} with it on, ${steps.length} with it off`);

  settings = { groupScroll: true, groupScrollAxis: 'vertical' };
  await rest();
  steps.length = 0;
  handler(wheel({ deltaY: 40, ctrlKey: true }));
  handler(wheel({ deltaY: 40, ctrlKey: true }));
  check('a pinch to zoom is left to the browser',
    steps.length === 0, JSON.stringify(steps));

  /** A target sitting inside elements carrying `classes`, answering the way
   *  the real closest() does: any one selector in the list is a match. */
  const inside = (...classes) => ({
    closest: sel => (sel.split(',').some(one => classes.includes(one.trim())) ? {} : null)
  });

  ['.modal', '.menu', '.picker'].forEach(where => {
    steps.length = 0;
    for (let i = 0; i < 6; i++) handler(wheel({ deltaY: 40, target: inside(where) }));
    check(`a scroll inside ${where} belongs to ${where}`,
      steps.length === 0, JSON.stringify(steps));
  });

  // And the same target, sitting inside none of them, is the ordinary case.
  await rest();
  steps.length = 0;
  for (let i = 0; i < 6; i++) handler(wheel({ deltaY: 40, target: inside('.page') }));
  check('a scroll over the page itself is the gesture',
    steps.length === 1, JSON.stringify(steps));

  // The block scrolls sideways once it holds more chips than it can show, and
  // that scroll is the one the pointer is over.
  steps.length = 0;
  const overflowing = { scrollWidth: 900, clientWidth: 400 };
  for (let i = 0; i < 6; i++) {
    handler(wheel({
      deltaY: 40,
      target: { closest: sel => (sel === '.groupbar__inner' ? overflowing : null) }
    }));
  }
  check('a scroll over a block with more chips than it can show scrolls the block',
    steps.length === 0, JSON.stringify(steps));

  await rest();
  steps.length = 0;
  const fitting = { scrollWidth: 400, clientWidth: 400 };
  for (let i = 0; i < 6; i++) {
    handler(wheel({
      deltaY: 40,
      target: { closest: sel => (sel === '.groupbar__inner' ? fitting : null) }
    }));
  }
  check('but over a block that fits, it turns a group like anywhere else',
    steps.length === 1, JSON.stringify(steps));

  // -------------------------------------------------------- taking the scroll

  const prevented = wheel({ deltaY: 40 });
  await rest();
  handler(prevented);
  check('an event it acts on is taken off the page',
    prevented.defaultPrevented === true);

  settings = { groupScroll: true, groupScrollAxis: 'vertical' };
  const left = wheel({ deltaX: 40 });
  handler(left);
  check('one it ignores is left alone, so the page can still scroll',
    left.defaultPrevented === false);

  // ---------------------------------------------------------------- report

  let failed = 0;
  for (const result of results) {
    if (!result.pass) failed++;
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
