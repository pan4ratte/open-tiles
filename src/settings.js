/**
 * Renders the settings dialog from schema.js.
 *
 * Nothing here knows what a setting *means* - it builds a control per field
 * type and hands changes to `ctx.onChange(key, value)`, which returns the value
 * that actually took effect (so a rejected change, like a font that will not
 * load or a permission the user declined, snaps the control back) plus an
 * optional status line to show under the field.
 */
const SettingsUI = (() => {
  /** @typedef {{kind:'ok'|'error'|'loading', text:string}} Status */

  const STATUS_ICONS = {
    loading: 'loader-circle',
    ok: 'check',
    error: 'circle-alert'
  };

  function setStatus(el, status) {
    if (!status) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.className = 'status status--' + status.kind;
    el.textContent = '';
    const icon = Icons.create(STATUS_ICONS[status.kind] || 'circle-alert', { size: 14 });
    if (status.kind === 'loading') icon.classList.add('is-spinning');
    el.append(icon, document.createTextNode(status.text));
    el.hidden = false;
  }

  // ------------------------------------------------------------- controls

  function buildToggle(field, value, commit) {
    const label = document.createElement('label');
    label.className = 'switch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.id = 'set-' + field.key;

    const track = document.createElement('span');
    track.className = 'switch__track';

    const apply = async () => {
      const effective = await commit(input.checked);
      input.checked = effective;
    };

    // A checkbox's `change` event is dispatched outside the window in which
    // Firefox considers itself to be handling user input, which makes
    // permissions.request() fail. `click` is inside it, and the checkbox has
    // already flipped by the time the click handler runs.
    input.addEventListener(field.gesture ? 'click' : 'change', apply);

    label.append(input, track);
    return { control: label, focusId: input.id };
  }

  /**
   * A macOS pop-up button. The <select> keeps its own id and does the work;
   * the wrapper exists to hang the paired chevron beside it, which is the
   * glyph macOS uses for "this opens a menu of one choice".
   */
  function buildChoice(field, value, commit) {
    const wrap = document.createElement('div');
    wrap.className = 'popup';

    const select = document.createElement('select');
    select.className = 'select';
    select.id = 'set-' + field.key;

    field.options.forEach(option => {
      const el = document.createElement('option');
      el.value = String(Schema.optionValue(option));
      el.textContent = Schema.optionLabel(option);
      select.append(el);
    });
    select.value = String(value);

    select.addEventListener('change', async () => {
      const effective = await commit(select.value);
      select.value = String(effective);
    });

    const chevron = Icons.create('chevrons-up-down', { size: 13 });
    chevron.setAttribute('class', 'icon popup__chevron');

    wrap.append(select, chevron);
    return { control: wrap, focusId: select.id };
  }

  function buildSegmented(field, value, commit) {
    const group = document.createElement('div');
    group.className = 'segmented';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', field.label);

    field.options.forEach(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'segmented__item';
      button.title = option.label;
      button.setAttribute('aria-label', option.label);
      button.setAttribute('role', 'radio');
      button.dataset.value = option.value;

      // Icon where there is one, the label itself where there is not: some
      // choices ("Status bar", "On hover") have no picture worth drawing.
      if (option.icon) {
        button.append(Icons.create(option.icon, { size: 16 }));
      } else {
        button.classList.add('segmented__item--text');
        button.append(document.createTextNode(option.label));
      }

      button.addEventListener('click', async () => {
        const effective = await commit(option.value);
        sync(effective);
      });

      group.append(button);
    });

    function sync(current) {
      group.querySelectorAll('.segmented__item').forEach(button => {
        const on = button.dataset.value === current;
        button.classList.toggle('is-on', on);
        button.setAttribute('aria-checked', String(on));
      });
    }
    sync(value);

    return { control: group };
  }

  /**
   * A macOS slider: the part already travelled is filled with the accent. CSS
   * paints that as a gradient stop, so the fraction has to be handed to it -
   * there is no selector for "how far along a range input is".
   */
  function buildRange(field, value, commit) {
    const wrap = document.createElement('div');
    wrap.className = 'range';

    const input = document.createElement('input');
    input.type = 'range';
    input.min = field.min;
    input.max = field.max;
    input.step = field.step || 1;
    input.value = value;
    input.id = 'set-' + field.key;

    const badge = document.createElement('span');
    badge.className = 'range__value';
    badge.textContent = value + (field.unit || '');

    const paint = current => {
      const span = field.max - field.min;
      const fraction = span > 0 ? (Number(current) - field.min) / span : 0;
      input.style.setProperty('--fill', (fraction * 100).toFixed(2) + '%');
    };
    paint(value);

    input.addEventListener('input', () => {
      badge.textContent = input.value + (field.unit || '');
      paint(input.value);
      commit(Number(input.value));
    });

    wrap.append(input, badge);
    return { control: wrap, focusId: input.id };
  }

  /**
   * Colour, the three ways this picker lets one be named.
   *
   * HSV rather than HSL because that is the shape of the control: a square of
   * saturation against value, with hue kept to one side of it. The maths is
   * the standard conversion, written out here so the file carries no
   * dependency for six lines of arithmetic.
   */

  const HEX = /^#?([0-9a-f]{6})$/i;

  function parseHex(text) {
    const hit = HEX.exec(String(text == null ? '' : text).trim());
    return hit ? '#' + hit[1].toLowerCase() : null;
  }

  function hexToHsv(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;

    let h = 0;
    if (chroma) {
      if (max === r) h = (g - b) / chroma + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / chroma + 2;
      else h = (r - g) / chroma + 4;
      h *= 60;
    }

    return { h, s: max ? chroma / max : 0, v: max };
  }

  function hsvToHex(hsv) {
    const channel = n => {
      const k = (n + hsv.h / 60) % 6;
      const value = hsv.v - hsv.v * hsv.s * Math.max(0, Math.min(k, 4 - k, 1));
      return Math.round(value * 255).toString(16).padStart(2, '0');
    };
    return '#' + channel(5) + channel(3) + channel(1);
  }

  const clamp01 = n => Math.min(1, Math.max(0, n));

  /**
   * Shuts whichever picker is open. The popover lives in the body rather than
   * in its row, so re-mounting the dialog would otherwise leave it behind with
   * its listeners still attached and nothing left to answer to.
   */
  let dismissPicker = null;

  /**
   * The accents macOS offers by name, in its order. A row of these is most of
   * what an accent picker needs to be; the rest of the control is there for
   * the one person in ten who wants a colour that is not on the list.
   */
  const ACCENTS = [
    ['#007aff', 'Blue'], ['#5856d6', 'Indigo'], ['#af52de', 'Purple'],
    ['#ff2d55', 'Pink'], ['#ff3b30', 'Red'], ['#ff9500', 'Orange'],
    ['#ffcc00', 'Yellow'], ['#34c759', 'Green'], ['#30b0c7', 'Teal'],
    ['#8e8e93', 'Graphite']
  ];

  /**
   * Drags a knob around a box: a pointer down anywhere in it jumps the knob
   * there and keeps following until the button is let go, which is how every
   * macOS slider and colour area behaves. The handler is given the position as
   * two fractions of the box, so the same code drives the square and the strip.
   */
  function trackDrag(el, onMove) {
    const report = e => {
      const rect = el.getBoundingClientRect();
      onMove(
        rect.width ? clamp01((e.clientX - rect.left) / rect.width) : 0,
        rect.height ? clamp01((e.clientY - rect.top) / rect.height) : 0
      );
    };

    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      report(e);
    });

    el.addEventListener('pointermove', e => {
      if (el.hasPointerCapture(e.pointerId)) report(e);
    });

    el.addEventListener('pointerup', e => el.releasePointerCapture(e.pointerId));
  }

  /**
   * The colour well, and the picker it opens.
   *
   * The platform's own <input type="color"> hands the job to a dialog that
   * belongs to the operating system: it looks nothing like the rest of this
   * window, it cannot be themed, and on Firefox it is a modal that takes the
   * page's focus away. So the well opens a popover of our own instead - the
   * named accents first, then a saturation/value square, a hue strip and the
   * hex, for a colour that is not one of the ten.
   *
   * The popover is placed in the body rather than in the row, because the
   * settings pane scrolls and would otherwise clip it. It is positioned
   * against the well and closes on the first thing that would move it: a click
   * outside, Escape, a scroll, a resize.
   */
  function buildColor(field, value, commit) {
    let current = parseHex(value) || field.default;
    let hsv = hexToHsv(current);

    const wrap = document.createElement('div');
    wrap.className = 'color';

    const well = document.createElement('button');
    well.type = 'button';
    well.className = 'color__well';
    well.id = 'set-' + field.key;
    well.setAttribute('aria-haspopup', 'dialog');
    well.setAttribute('aria-expanded', 'false');

    const swatch = document.createElement('span');
    swatch.className = 'color__swatch';

    const hexLabel = document.createElement('span');
    hexLabel.className = 'color__hex';

    well.append(swatch);
    wrap.append(well, hexLabel);

    // ------------------------------------------------------------ the popover

    const pop = document.createElement('div');
    pop.className = 'picker';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', field.label);

    const presets = document.createElement('div');
    presets.className = 'picker__presets';

    const dots = ACCENTS.map(([hex, name]) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'picker__preset';
      dot.dataset.hex = hex;
      dot.title = name;
      dot.setAttribute('aria-label', name);
      dot.style.setProperty('--preset', hex);
      dot.addEventListener('click', () => set(hex));
      presets.append(dot);
      return dot;
    });

    const area = document.createElement('div');
    area.className = 'picker__area';
    area.tabIndex = 0;
    area.setAttribute('role', 'application');
    area.setAttribute('aria-label', 'Saturation and brightness');

    const areaKnob = document.createElement('span');
    areaKnob.className = 'picker__knob';
    area.append(areaKnob);

    const hue = document.createElement('div');
    hue.className = 'picker__hue';
    hue.tabIndex = 0;
    hue.setAttribute('role', 'slider');
    hue.setAttribute('aria-label', 'Hue');
    hue.setAttribute('aria-valuemin', '0');
    hue.setAttribute('aria-valuemax', '359');

    const hueKnob = document.createElement('span');
    hueKnob.className = 'picker__knob picker__knob--hue';
    hue.append(hueKnob);

    const foot = document.createElement('div');
    foot.className = 'picker__foot';

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'field__input picker__hex';
    hexInput.spellcheck = false;
    hexInput.autocomplete = 'off';
    hexInput.maxLength = 7;
    hexInput.setAttribute('aria-label', 'Hex value');

    foot.append(hexInput);
    pop.append(presets, area, hue, foot);

    // ------------------------------------------------------------- painting

    /** Everything on screen, from `current` and `hsv`, in one pass. */
    function paint() {
      swatch.style.background = current;
      hexLabel.textContent = current.toUpperCase();
      well.title = current.toUpperCase();

      area.style.setProperty('--hue', String(Math.round(hsv.h)));
      areaKnob.style.left = (hsv.s * 100).toFixed(2) + '%';
      areaKnob.style.top = ((1 - hsv.v) * 100).toFixed(2) + '%';
      areaKnob.style.background = current;

      hueKnob.style.left = (hsv.h / 360 * 100).toFixed(2) + '%';
      hue.setAttribute('aria-valuenow', String(Math.round(hsv.h)));

      if (document.activeElement !== hexInput) hexInput.value = current.toUpperCase();

      dots.forEach(dot => {
        const on = dot.dataset.hex === current;
        dot.classList.toggle('is-on', on);
        dot.setAttribute('aria-pressed', String(on));
      });
    }

    /** Takes a hex, tells the page, and shows whatever came back of it. */
    async function set(hex, keepHsv) {
      const clean = parseHex(hex);
      if (!clean) return;

      current = clean;
      if (!keepHsv) hsv = hexToHsv(clean);
      paint();

      const effective = parseHex(await commit(clean));
      if (effective && effective !== current) {
        current = effective;
        hsv = hexToHsv(effective);
        paint();
      }
    }

    /** Moving the square or the strip: the hue is kept as the knob left it,
     *  so a slide down to black and back up does not lose the colour. */
    function setHsv(next) {
      hsv = { ...hsv, ...next };
      set(hsvToHex(hsv), true);
    }

    // -------------------------------------------------------------- gestures

    trackDrag(area, (x, y) => setHsv({ s: x, v: 1 - y }));
    trackDrag(hue, x => setHsv({ h: x * 360 }));

    area.addEventListener('keydown', e => {
      const step = e.shiftKey ? .1 : .02;
      const move = {
        ArrowLeft: { s: hsv.s - step }, ArrowRight: { s: hsv.s + step },
        ArrowUp: { v: hsv.v + step }, ArrowDown: { v: hsv.v - step }
      }[e.key];
      if (!move) return;
      e.preventDefault();
      setHsv({ s: clamp01(move.s === undefined ? hsv.s : move.s),
               v: clamp01(move.v === undefined ? hsv.v : move.v) });
    });

    hue.addEventListener('keydown', e => {
      const step = (e.shiftKey ? 15 : 3) * ({ ArrowLeft: -1, ArrowDown: -1,
                                              ArrowRight: 1, ArrowUp: 1 }[e.key] || 0);
      if (!step) return;
      e.preventDefault();
      setHsv({ h: (hsv.h + step + 360) % 360 });
    });

    hexInput.addEventListener('input', () => {
      const typed = parseHex(hexInput.value);
      if (typed) set(typed);
    });
    hexInput.addEventListener('blur', () => { hexInput.value = current.toUpperCase(); });

    // ------------------------------------------------------------- open/close

    let open = false;

    function place() {
      const rect = well.getBoundingClientRect();
      const gap = 7;
      const width = pop.offsetWidth || 236;
      const height = pop.offsetHeight || 300;

      // Under the well by preference, above it when there is no room below.
      let top = rect.bottom + gap;
      if (top + height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - gap - height);
      }

      // Right edges aligned, the way a macOS popover hangs off its control,
      // but never off the side of the window.
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));

      pop.style.top = Math.round(top) + 'px';
      pop.style.left = Math.round(left) + 'px';
    }

    function onOutside(e) {
      if (!pop.contains(e.target) && !well.contains(e.target)) close();
    }

    function onKey(e) {
      if (e.key !== 'Escape') return;
      // The settings window is listening for Escape too, and would close under
      // the picker; the picker was on top, so the picker is what closes.
      e.stopPropagation();
      close();
      well.focus();
    }

    function show() {
      if (open) return;
      if (dismissPicker) dismissPicker();
      open = true;
      dismissPicker = close;

      document.body.append(pop);
      paint();
      place();
      well.setAttribute('aria-expanded', 'true');
      pop.classList.add('is-open');

      // Capture, so a scroll inside the settings pane is caught as well - it
      // does not bubble to the window.
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', close, true);
      window.addEventListener('resize', close, true);
    }

    function close() {
      if (!open) return;
      open = false;
      if (dismissPicker === close) dismissPicker = null;

      pop.classList.remove('is-open');
      pop.remove();
      well.setAttribute('aria-expanded', 'false');

      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close, true);
    }

    well.addEventListener('click', () => (open ? close() : show()));

    paint();
    return { control: wrap, focusId: well.id };
  }

  /** A button that does something once - reset - rather than holding a value. */
  function buildAction(field, value, commit) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--sm' + (field.danger ? ' btn--danger' : '');
    button.id = 'set-' + field.key;
    if (field.buttonIcon) button.append(Icons.create(field.buttonIcon, { size: 15 }));
    button.append(document.createTextNode(field.buttonLabel || field.label));

    button.addEventListener('click', () => commit(true));

    // No `focusId`: a <label for> only reaches a control that holds a value.
    return { control: button };
  }

  function buildText(field, value, commit) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'field__input';
    input.id = 'set-' + field.key;
    input.value = value || '';
    input.placeholder = field.placeholder || '';
    input.autocomplete = 'off';
    input.spellcheck = false;

    let timer;
    const run = async () => {
      const effective = await commit(input.value);
      if (typeof effective === 'string' && effective !== input.value) {
        input.value = effective;
      }
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 500);
    });
    input.addEventListener('change', () => {
      clearTimeout(timer);
      run();
    });

    return { control: input, focusId: input.id, wide: true };
  }

  /**
   * Blur is a length, so a 40px blur on a 1920px page has to become a 10px one
   * on a 480px preview to look the same. The preview measures itself against
   * the window and writes the ratio out for the stylesheet to multiply by.
   */
  function trackPreviewScale(preview) {
    const update = () => {
      const width = preview.clientWidth;
      if (!width) return;
      preview.style.setProperty('--preview-scale', String(width / window.innerWidth));
    };

    // The dialog is display:none until it opens, so there is nothing to
    // measure at build time - the observer catches the moment there is.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(preview);
    update();
  }

  /**
   * The background picker: what is on screen now, and a file button that
   * doubles as a drop target.
   *
   * The preview is shaped like the window (see --page-ratio) and covers, the
   * same way the page paints the picture, so the crop on show here is the crop
   * that ends up behind the tiles - blur and dim included, both scaled down to
   * the size of the preview so they look the way they will full size.
   *
   * `commit` is handed one of `{action:'file'|'url'|'clear'}` and answers with
   * `{record}` - the picture that took effect, or null. A refusal comes back
   * without a `record`, so the preview keeps showing what is really on screen.
   */
  function buildBackground(field, value, commit) {
    const wrap = document.createElement('div');
    wrap.className = 'bgfield';

    const preview = document.createElement('div');
    preview.className = 'bgfield__preview';

    const caption = document.createElement('p');
    caption.className = 'bgfield__caption';

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.className = 'file-input';
    file.id = 'set-' + field.key;

    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'btn btn--sm';
    choose.append(Icons.create('upload', { size: 15 }), document.createTextNode('Choose file'));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn--sm btn--danger';
    remove.append(Icons.create('trash-2', { size: 15 }), document.createTextNode('Remove'));

    // ------------------------------------------------------------ painting

    function showRecord(record) {
      const has = Boolean(record && record.src);

      preview.textContent = '';
      preview.classList.toggle('is-empty', !has);

      if (has) {
        const img = document.createElement('img');
        img.className = 'bgfield__thumb';
        img.alt = '';
        img.src = record.src;

        // The same veil the page lays over the picture, reading the same
        // custom properties - so the Dim slider moves both at once.
        const veil = document.createElement('div');
        veil.className = 'bgfield__veil';

        preview.append(img, veil);
        caption.textContent = record.name || 'Local image';
      } else {
        preview.append(Icons.create('image', { size: 22 }));
        caption.textContent = 'No picture — drop one here, or choose a file.';
      }

      remove.hidden = !has;
    }

    async function send(payload) {
      const state = (await commit(payload)) || {};
      if ('record' in state) showRecord(state.record);
    }

    // ------------------------------------------------------------- wiring

    choose.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const picked = file.files && file.files[0];
      file.value = '';
      if (picked) send({ action: 'file', file: picked });
    });

    remove.addEventListener('click', () => send({ action: 'clear' }));

    ['dragenter', 'dragover'].forEach(type => {
      preview.addEventListener(type, e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        preview.classList.add('is-over');
      });
    });
    preview.addEventListener('dragleave', () => preview.classList.remove('is-over'));
    preview.addEventListener('drop', e => {
      e.preventDefault();
      preview.classList.remove('is-over');
      const dropped = e.dataTransfer.files && e.dataTransfer.files[0];
      if (dropped) send({ action: 'file', file: dropped });
    });

    // A picture that lives on the web rather than on this computer. It is the
    // second row, not the first: a local file is the case that works offline
    // and the one most people want.
    const address = document.createElement('div');
    address.className = 'bgfield__url';

    const url = document.createElement('input');
    url.type = 'text';
    url.className = 'field__input';
    url.placeholder = 'or paste a web address…';
    url.autocomplete = 'off';
    url.spellcheck = false;

    const useUrl = document.createElement('button');
    useUrl.type = 'button';
    useUrl.className = 'btn btn--sm';
    useUrl.append(document.createTextNode('Use'));

    const sendUrl = () => {
      const value = url.value.trim();
      if (value) send({ action: 'url', url: value });
    };

    useUrl.addEventListener('click', sendUrl);
    url.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      // The dialog is inside a <form>; Enter here means "use this address",
      // not "submit and close".
      e.preventDefault();
      sendUrl();
    });

    address.append(url, useUrl);

    const actions = document.createElement('div');
    actions.className = 'bgfield__actions';
    actions.append(choose, remove, file);

    wrap.append(preview, caption, actions, address);
    showRecord(value);
    trackPreviewScale(preview);

    return { control: wrap, wide: true };
  }

  /**
   * Export and import, as the pair of buttons they are: one writes a file, the
   * other reads one back.
   *
   * Like the background picker this field holds no value - it sends
   * `{action:'export'}` or `{action:'import', file}` and the page does the
   * work, answering with the status line. Nothing here comes back to paint,
   * because a finished import re-mounts the whole dialog: every control on
   * every page is showing a value that just changed underneath it.
   */
  function buildBackup(field, value, commit) {
    const wrap = document.createElement('div');
    wrap.className = 'backupfield';

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.className = 'file-input';
    file.id = 'set-' + field.key;

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'btn btn--sm';
    exportBtn.append(
      Icons.create('download', { size: 15 }),
      document.createTextNode('Export…')
    );

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'btn btn--sm';
    importBtn.append(
      Icons.create('upload', { size: 15 }),
      document.createTextNode('Import…')
    );

    exportBtn.addEventListener('click', () => commit({ action: 'export' }));
    importBtn.addEventListener('click', () => file.click());

    file.addEventListener('change', () => {
      const picked = file.files && file.files[0];
      // Cleared before the commit, so picking the same file twice running is
      // still a change the input will report.
      file.value = '';
      if (picked) commit({ action: 'import', file: picked });
    });

    wrap.append(exportBtn, importBtn, file);

    // No `focusId`: a <label for> only reaches a control that holds a value.
    return { control: wrap, wide: true };
  }

  function buildFont(field, value, commit) {
    const wrap = document.createElement('div');
    wrap.className = 'fontfield';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'field__input';
    input.id = 'set-' + field.key;
    input.value = value;
    input.placeholder = field.default;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('list', 'fontList');

    const list = document.createElement('datalist');
    list.id = 'fontList';
    Fonts.SUGGESTED.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      list.append(option);
    });

    const preview = document.createElement('p');
    preview.className = 'preview';
    preview.textContent = 'The quick brown fox jumps over the lazy dog';
    preview.style.fontFamily = Fonts.stackFor(value);

    let timer;
    const run = async () => {
      preview.style.fontFamily = Fonts.stackFor(input.value);
      const effective = await commit(input.value);
      preview.style.fontFamily = Fonts.stackFor(effective);
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 600);
    });
    input.addEventListener('change', () => {
      clearTimeout(timer);
      run();
    });

    wrap.append(input, list, preview);
    return { control: wrap, focusId: input.id, wide: true };
  }

  const BUILDERS = {
    toggle: buildToggle,
    choice: buildChoice,
    segmented: buildSegmented,
    range: buildRange,
    color: buildColor,
    text: buildText,
    font: buildFont,
    background: buildBackground,
    backup: buildBackup,
    action: buildAction
  };

  // ---------------------------------------------------------------- layout

  function buildField(field, value, ctx) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.field = field.key;

    const main = document.createElement('div');
    main.className = 'row__main';

    const label = document.createElement('label');
    label.className = 'row__label';
    label.textContent = field.label;
    main.append(label);

    if (field.note) {
      const note = document.createElement('span');
      note.className = 'row__note';
      note.textContent = field.note;
      main.append(note);
    }

    const status = document.createElement('p');
    status.className = 'status';
    status.hidden = true;

    const commit = async next => {
      if (field.busyText) setStatus(status, { kind: 'loading', text: field.busyText });
      const result = await ctx.onChange(field.key, next);
      setStatus(status, result.status || null);
      return result.value;
    };

    const built = (BUILDERS[field.type] || buildToggle)(field, value, commit);
    if (built.focusId) label.setAttribute('for', built.focusId);

    row.classList.toggle('row--wide', Boolean(built.wide));

    const control = document.createElement('div');
    control.className = 'row__control';
    control.append(built.control);

    row.append(main, control, status);
    return { row, status };
  }

  /**
   * The tab left open and how far down its pane was, so a re-mount - a reset,
   * or another new-tab page changing something - puts the reader back where
   * they were rather than at the top of the first section.
   */
  let openSection = null;
  let openScroll = 0;

  /** Keys that hold no value in `settings`, so nothing to track for a `when`. */
  const EXTERNAL = new Set(Schema.FIELDS.filter(f => f.external).map(f => f.key));

  /**
   * Builds the window: the sections down the sidebar, one panel of grouped
   * rows each.
   *
   * Every panel is built up front and the inactive ones are hidden, so the
   * controls are all reachable (and testable) whichever tab is showing.
   *
   * `ctx.status` is for the message a change cannot deliver itself: an import
   * re-mounts the dialog from inside its own commit, which throws away the row
   * that was waiting to be told how it went. Handing the line to the new mount
   * puts it back under the right field.
   *
   * @param {HTMLElement} container
   * @param {{values: object, status?: Object<string, Status>,
   *   onChange: (key:string, value:*) =>
   *   Promise<{value:*, status?: Status}>}} ctx
   */
  function mount(container, ctx) {
    if (dismissPicker) dismissPicker();
    container.textContent = '';

    // A field with a `when` follows another field, so the dialog keeps its own
    // copy of what took effect and re-reads the conditions after every change.
    const current = { ...ctx.values };
    const conditional = [];
    const statusOf = {};

    function refresh() {
      conditional.forEach(({ field, row }) => {
        row.hidden = !Object.entries(field.when)
          .every(([key, value]) => current[key] === value);
      });
    }

    const inner = {
      values: ctx.values,
      onChange: async (key, value) => {
        const result = await ctx.onChange(key, value);
        if (!EXTERNAL.has(key)) current[key] = result.value;
        refresh();
        return result;
      }
    };

    const nav = document.createElement('nav');
    nav.className = 'tabs';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Settings sections');

    const panels = document.createElement('div');
    panels.className = 'panels';
    panels.addEventListener('scroll', () => { openScroll = Number(panels.scrollTop) || 0; });

    const tabs = [];

    Schema.SECTIONS.forEach(section => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab';
      tab.id = 'tab-' + section.id;
      tab.dataset.section = section.id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'panel-' + section.id);

      // The glyph rides a tinted rounded square, the way a System Settings
      // sidebar marks its sections: colour is what the eye picks out, and the
      // words are only there to confirm it.
      if (section.icon) {
        const badge = document.createElement('span');
        badge.className = 'tab__icon';
        if (section.tint) badge.style.setProperty('--tab-tint', section.tint);
        badge.append(Icons.create(section.icon, { size: 13 }));
        tab.append(badge);
      }

      tab.append(document.createTextNode(section.label));

      const panel = document.createElement('section');
      panel.className = 'panel';
      panel.id = 'panel-' + section.id;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);

      const heading = document.createElement('h3');
      heading.className = 'panel__title';
      heading.textContent = section.label;
      panel.append(heading);

      // The rows go in grouped boxes rather than straight into the panel: on
      // macOS that container is what says "these belong together", and it is
      // what draws the hairlines between them.
      //
      // A section that was written as subsections gets one box each, under its
      // own heading - the whole page still scrolls as one, which is the point
      // of putting them together rather than on tabs of their own.
      section.groups.forEach(group => {
        if (group.label) {
          const subtitle = document.createElement('h4');
          subtitle.className = 'panel__subtitle';
          subtitle.textContent = group.label;
          panel.append(subtitle);
        }

        const box = document.createElement('div');
        box.className = 'box';

        group.fields.forEach(field => {
          const { row, status } = buildField(field, ctx.values[field.key], inner);
          if (field.when) conditional.push({ field, row });
          statusOf[field.key] = status;
          box.append(row);
        });

        panel.append(box);
      });

      tab.addEventListener('click', () => show(section.id));
      tabs.push({ id: section.id, tab, panel });

      nav.append(tab);
      panels.append(panel);
    });

    function show(id) {
      // Moving to another section is a fresh page, so it starts at the top;
      // only coming back to the one already open keeps its place.
      if (id !== openSection) openScroll = 0;
      openSection = id;

      tabs.forEach(entry => {
        const on = entry.id === id;
        entry.tab.classList.toggle('is-on', on);
        entry.tab.setAttribute('aria-selected', String(on));
        entry.tab.setAttribute('tabindex', on ? '0' : '-1');
        entry.panel.hidden = !on;
      });
      panels.scrollTop = openScroll;
    }

    // The strip runs down the side of a wide dialog and across the top of a
    // narrow one, so both axes are wired to step through the tabs.
    nav.addEventListener('keydown', e => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const at = tabs.findIndex(entry => entry.id === openSection);
      const next = tabs[(at + step + tabs.length) % tabs.length];
      show(next.id);
      next.tab.focus();
    });

    refresh();
    container.append(nav, panels);

    const known = tabs.some(entry => entry.id === openSection);
    show(known ? openSection : tabs[0].id);

    Object.entries(ctx.status || {}).forEach(([key, status]) => {
      if (statusOf[key]) setStatus(statusOf[key], status);
    });
  }

  /**
   * The colour picker on its own, for a dialog built by hand rather than from
   * the schema - the tile sheet's background well. Same control, same popover,
   * same one-open-at-a-time rule, so there is only ever one of these to fix.
   *
   * @param {{key:string, label:string, default:string}} field
   * @param {string} value
   * @param {(hex:string) => *} commit answers with the colour that took, if it
   *   differs from the one sent
   */
  const colorControl = (field, value, commit) => buildColor(field, value, commit);

  return { mount, setStatus, colorControl, closePicker: () => dismissPicker && dismissPicker() };
})();
