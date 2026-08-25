/**
 * The scrap of DOM the settings dialog needs to build itself under `node`.
 *
 * Just enough to let settings.js run for real: elements that remember their
 * children, classes, listeners and properties, plus `fire()` and `find()` so a
 * test can poke at what came out.
 */
class El {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.listeners = {};
    this.style = { setProperty() {} };
    this.dataset = {};
    this.attrs = {};
    this.hidden = false;
    this._text = '';
    this._class = '';
    this.classList = {
      toggle: (name, on) => {
        this.classList.remove(name);
        if (on) this._class += ' ' + name;
      },
      add: name => { this._class += ' ' + name; },
      remove: name => { this._class = this._class.split(name).join(''); },
      contains: name => this._class.includes(name)
    };
  }

  set className(v) { this._class = v; }
  get className() { return this._class; }

  /** Assigning it drops the children, the way the real thing does. */
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }

  get textContent() {
    return this._text + this.children.map(kid => kid.textContent || kid.text || '').join('');
  }

  append(...kids) { this.children.push(...kids); }
  prepend(...kids) { this.children.unshift(...kids); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  setAttribute(k, v) { this.attrs[k] = v; }
  click() { this.fire('click', event('click')); }

  querySelectorAll(sel) {
    const want = sel.replace('.', '');
    const out = [];
    const walk = node => node.children.forEach(kid => {
      if (kid._class && kid._class.includes(want)) out.push(kid);
      if (kid.children) walk(kid);
    });
    walk(this);
    return out;
  }

  fire(type, ...args) {
    (this.listeners[type] || []).forEach(fn => fn(...args));
  }

  /** Depth-first search over this subtree, this element included. */
  find(pred) {
    if (pred(this)) return this;
    for (const kid of this.children) {
      const hit = kid.find ? kid.find(pred) : null;
      if (hit) return hit;
    }
    return null;
  }

  findAll(pred) {
    const out = pred(this) ? [this] : [];
    this.children.forEach(kid => {
      if (kid.findAll) out.push(...kid.findAll(pred));
    });
    return out;
  }
}

/** An event object with the bits the handlers actually read. */
function event(type, props = {}) {
  return {
    type,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...props
  };
}

const document = {
  createElement: tag => new El(tag),
  createTextNode: text => ({ text, children: [] }),
  createElementNS: () => new El('svg')
};

module.exports = { El, event, document };
