/**
 * Guards the two ways a picture gets onto a tile without a file dialog:
 * pasted SVG source, and a picture pasted straight off the clipboard.
 *
 * What can go quietly wrong here:
 *
 *   - an SVG with no `xmlns` is stored happily and draws nothing. An <img>
 *     refuses an SVG that does not name its namespace, and markup copied out
 *     of a page's DOM never carries one - the page had already established it.
 *     The tile just shows its letter, and nothing says why.
 *   - an SVG with no `viewBox` has a size rather than a shape, so it will not
 *     scale to the tile.
 *   - the running parts of an SVG - a script, an onclick, a javascript: href -
 *     are kept and handed back out in a backup file.
 *   - the source is longer than storage will hold. `sanitizeIcon` drops an
 *     icon over 256 KB by returning '', so the tile saves with no picture and
 *     no complaint. A refusal has to happen before that, where it can say why.
 *   - a paste meant for a text field is swallowed and turned into an icon, so
 *     text vanishes as it is pasted.
 *
 * The real favicons.js runs here against a small stand-in for DOMParser and
 * XMLSerializer, and the paste handler is lifted whole out of newtab.js, so
 * both are the code that ships rather than a copy of it.
 *
 *   node test/paste.test.js [path/to/src]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '..', 'src');
const read = file => fs.readFileSync(path.join(SRC, file), 'utf8');

const js = read('newtab.js');

// ------------------------------------------------------------------ harness

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

// --------------------------------------------------------------- XML shim

/**
 * Just enough of an element for the scrub and the two repairs to work on.
 *
 * Real parsing is the browser's job and is not what this file is about; what
 * is tested is what the module does to the tree once it has one.
 */
class Node {
  constructor(name, attrs = {}, children = []) {
    this.localName = name;
    this.attrs = new Map(Object.entries(attrs));
    this.children = children;
    children.forEach(kid => { kid.parent = this; });
  }

  get attributes() {
    return [...this.attrs].map(([name, value]) => ({ name, value }));
  }

  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }

  remove() {
    if (!this.parent) return;
    const at = this.parent.children.indexOf(this);
    if (at !== -1) this.parent.children.splice(at, 1);
    this.parent = null;
  }

  /** Depth-first over this subtree, this node included. */
  findAll(pred) {
    const out = pred(this) ? [this] : [];
    this.children.forEach(kid => out.push(...kid.findAll(pred)));
    return out;
  }
}

const serialize = el => '<' + el.localName
  + el.attributes.map(a => ` ${a.name}="${a.value}"`).join('')
  + '>' + el.children.map(serialize).join('') + '</' + el.localName + '>';

/** What the next parseFromString hands back. */
let nextTree = null;

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  document: { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) },
  DOMParser: class {
    parseFromString() {
      return {
        documentElement: nextTree,
        querySelector: () => null,
        body: { querySelector: () => nextTree }
      };
    }
  },
  XMLSerializer: class {
    serializeToString(el) { return serialize(el); }
  }
};
vm.createContext(sandbox);
vm.runInContext(read('favicons.js'), sandbox, { filename: 'favicons.js' });

const Favicons = vm.runInContext('Favicons', sandbox);

// --------------------------------------------------------- looksLikeSvg

const SAYS_YES = [
  ['plain markup', '<svg viewBox="0 0 8 8"><path d="M0 0"/></svg>'],
  ['leading space and a newline', '\n   <svg><rect/></svg>'],
  ['an XML prolog', '<?xml version="1.0"?><svg><rect/></svg>'],
  ['a doctype', '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ""><svg><rect/></svg>'],
  ['a comment first', '<!-- drawn by hand --><svg><rect/></svg>'],
  ['a capital tag', '<SVG><rect/></SVG>']
];

const SAYS_NO = [
  ['an address', 'https://example.com/logo.svg'],
  ['a data URI it made earlier', 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E'],
  ['plain words', 'the company logo'],
  ['nothing at all', ''],
  ['a tag that only starts like one', '<svgish>no</svgish>'],
  ['SVG buried in other markup', '<div><svg><rect/></svg></div>']
];

SAYS_YES.forEach(([what, text]) => {
  check(`SVG source is recognised: ${what}`, Favicons.looksLikeSvg(text) === true);
});

SAYS_NO.forEach(([what, text]) => {
  check(`left for the field to paste: ${what}`, Favicons.looksLikeSvg(text) === false);
});

// ------------------------------------------------------------- fromSvg

/** Runs the real fromSvg over a tree the test built. */
function convert(tree, text = '<svg><rect/></svg>') {
  nextTree = tree;
  return Favicons.fromSvg(text);
}

/** The markup back out of the data URI, to read what was kept. */
const markupOf = uri => decodeURIComponent(uri.replace(/^data:image\/svg\+xml,/, ''));

let uri = convert(new Node('svg', { viewBox: '0 0 24 24' }, [new Node('path', { d: 'M0 0' })]));

check('the picture comes back as an SVG data URI',
  uri.startsWith('data:image/svg+xml,'), uri.slice(0, 30));

check('and it is the kind storage will keep',
  /^(https?:\/\/|data:image\/)/i.test(uri));

check('what was drawn is still in it',
  markupOf(uri).includes('<path d="M0 0">'), markupOf(uri));

check('an SVG that never named its namespace is given one',
  markupOf(uri).includes('xmlns="http://www.w3.org/2000/svg"'), markupOf(uri));

uri = convert(new Node('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 8 8' }));
check('one that named it keeps the one it had',
  markupOf(uri).match(/xmlns=/g).length === 1, markupOf(uri));

uri = convert(new Node('svg', { width: '48', height: '24' }));
check('a size with no shape is given the shape it implies',
  markupOf(uri).includes('viewBox="0 0 48 24"'), markupOf(uri));

uri = convert(new Node('svg', { viewBox: '0 0 1 1', width: '48', height: '24' }));
check('a shape it already had is left alone',
  markupOf(uri).includes('viewBox="0 0 1 1"'), markupOf(uri));

uri = convert(new Node('svg', {}));
check('and one with neither is not given an invented shape',
  !markupOf(uri).includes('viewBox'), markupOf(uri));

// ------------------------------------------------------- what is scrubbed

uri = convert(new Node('svg', {}, [
  new Node('script', {}, []),
  new Node('path', { d: 'M1 1' })
]));
check('a script in the picture is taken out',
  !markupOf(uri).includes('script') && markupOf(uri).includes('M1 1'), markupOf(uri));

uri = convert(new Node('svg', {}, [new Node('foreignObject', {}, [])]));
check('so is a foreignObject, which can hold a page',
  !markupOf(uri).toLowerCase().includes('foreignobject'), markupOf(uri));

uri = convert(new Node('svg', { onload: 'steal()' }, [
  new Node('path', { onclick: 'steal()', d: 'M2 2' })
]));
check('an event handler on the root is taken off',
  !markupOf(uri).includes('onload'), markupOf(uri));
check('and one further in',
  !markupOf(uri).includes('onclick') && markupOf(uri).includes('M2 2'), markupOf(uri));

uri = convert(new Node('svg', {}, [
  new Node('a', { href: 'javascript:steal()' }, []),
  new Node('use', { 'xlink:href': '#shape' }, [])
]));
check('a link that runs instead of pointing is taken off',
  !markupOf(uri).includes('javascript:'), markupOf(uri));
check('but an ordinary reference inside the picture is kept',
  markupOf(uri).includes('xlink:href="#shape"'), markupOf(uri));

// -------------------------------------------------------------- refusals

function refusal(run) {
  try {
    run();
    return null;
  } catch (err) {
    return err.message;
  }
}

check('something that is not SVG is refused, and says so',
  /does not look like SVG/.test(refusal(() => Favicons.fromSvg('https://example.com'))),
  String(refusal(() => Favicons.fromSvg('https://example.com'))));

nextTree = null;
check('SVG the parser could not read is refused too',
  /could not be read/.test(refusal(() => Favicons.fromSvg('<svg><rect/></svg>'))),
  String(refusal(() => Favicons.fromSvg('<svg><rect/></svg>'))));

// Storage drops a tile icon over 256 KB by returning '', without a word, so
// the refusal has to come first.
const huge = new Node('svg', {}, [new Node('path', { d: 'M0 0 ' + 'L9 9 '.repeat(40000) })]);
const tooBig = refusal(() => convert(huge));
check('an SVG too long for storage is refused before it can be lost',
  /too long/.test(String(tooBig)), String(tooBig));

const cap = Number((read('favicons.js').match(/OWN_SVG_MAX = (\d+) \* 1024/) || [])[1]);
const store = Number((read('storage.js').match(/MAX_ICON = (\d+) \* 1024/) || [])[1]);
check('and the ceiling it refuses at is under the one storage enforces',
  cap > 0 && store > 0 && cap < store, `${cap} KB refused here, ${store} KB dropped there`);

// ------------------------------------------------------- the paste handler

/*
 * Lifted whole out of newtab.js and run against stubs for the sheet, the
 * field, and the two conversions above.
 */
const from = '  /** Whatever files the clipboard is offering, however it offers them. */';
const to = `    e.preventDefault();
    setIcon(() => Favicons.fromSvg(text));
  });`;

const start = js.indexOf(from);
const end = js.indexOf(to, start);
if (start < 0 || end < 0) throw new Error('the paste handler has moved - update this test');
const block = js.slice(start, end + to.length);

let onPaste = null;
const calls = [];
const fieldIcon = { value: '', tag: 'fieldIcon' };
let status = null;

const build = new Function('modal', 'fieldIcon', 'modalError', 'paintPreview',
  'SettingsUI', 'Favicons',
  block + '\n; return { clipboardFiles };');

build(
  { addEventListener: (type, fn) => { if (type === 'paste') onPaste = fn; } },
  fieldIcon,
  {},
  () => calls.push({ call: 'paintPreview' }),
  { setStatus: (el, next) => { status = next; } },
  {
    looksLikeSvg: Favicons.looksLikeSvg,
    fromFile: file => { calls.push({ call: 'fromFile', file }); return 'data:image/png;base64,AA'; },
    fromSvg: text => { calls.push({ call: 'fromSvg', text }); return 'data:image/svg+xml,%3Csvg%3E'; }
  }
);

check('the sheet listens for a paste', typeof onPaste === 'function');

/** A file on the clipboard, the way a browser hands one over. */
const file = (type, name = 'thing') => ({ type, name });

/** An element inside the sheet that is not the icon field. */
const textField = { closest: sel => (sel.includes('input') ? {} : null) };
/** The sheet itself, with nothing focused. */
const nowhere = { closest: () => null };

function paste({ files = [], items = null, text = '', target = fieldIcon } = {}) {
  calls.length = 0;
  status = null;
  const e = {
    target,
    clipboardData: {
      files,
      items,
      getData: () => text
    },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
  };
  onPaste(e);
  return e;
}

const SVG = '<svg viewBox="0 0 4 4"><rect/></svg>';

let e = paste({ files: [file('image/png')] });
check('a picture on the clipboard becomes the icon',
  calls.some(c => c.call === 'fromFile'), JSON.stringify(calls));
check('and the paste does not also land in the field as text',
  e.defaultPrevented === true);

e = paste({ files: [file('image/png')], target: textField });
check('a picture is taken wherever the caret happens to be',
  calls.some(c => c.call === 'fromFile'), JSON.stringify(calls));

e = paste({ files: [file('application/pdf', 'report.pdf')] });
check('a file that is not a picture is refused, and says so',
  !calls.some(c => c.call === 'fromFile') && status && status.kind === 'error',
  JSON.stringify(status));

e = paste({ items: [{ kind: 'file', getAsFile: () => file('image/png') }] });
check('a clipboard that offers files only as items still works',
  calls.some(c => c.call === 'fromFile'), JSON.stringify(calls));

e = paste({ items: [{ kind: 'string', getAsFile: () => null }], text: SVG });
check('a string item is not mistaken for a file',
  calls.some(c => c.call === 'fromSvg'), JSON.stringify(calls));

e = paste({ text: SVG });
check('SVG code pasted into the icon field becomes the icon',
  calls.some(c => c.call === 'fromSvg'), JSON.stringify(calls));
check('and it is taken off the field rather than pasted as text',
  e.defaultPrevented === true);

e = paste({ text: SVG, target: nowhere });
check('SVG code pasted onto the sheet with nothing focused is the icon too',
  calls.some(c => c.call === 'fromSvg'), JSON.stringify(calls));

e = paste({ text: SVG, target: textField });
check('but SVG code pasted into the address or name field stays text',
  calls.length === 0 && e.defaultPrevented === false, JSON.stringify(calls));

e = paste({ text: 'https://example.com/logo.png' });
check('an address pasted into the icon field is left to paste itself',
  calls.length === 0 && e.defaultPrevented === false, JSON.stringify(calls));

e = paste({ text: '' });
check('an empty clipboard does nothing',
  calls.length === 0 && e.defaultPrevented === false, JSON.stringify(calls));

// ---------------------------------------------------------------- report

(async () => {
  // setIcon awaits the conversion before it writes the field.
  await new Promise(resolve => setTimeout(resolve, 0));

  paste({ text: SVG });
  await new Promise(resolve => setTimeout(resolve, 0));
  check('the converted picture ends up in the icon field',
    fieldIcon.value === 'data:image/svg+xml,%3Csvg%3E', fieldIcon.value);
  check('and the preview is repainted to show it',
    calls.some(c => c.call === 'paintPreview'), JSON.stringify(calls));

  let failed = 0;
  for (const result of results) {
    if (!result.pass) failed++;
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
