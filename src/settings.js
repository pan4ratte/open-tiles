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

  function buildChoice(field, value, commit) {
    const select = document.createElement('select');
    select.className = 'select';
    select.id = 'set-' + field.key;

    field.options.forEach(option => {
      const el = document.createElement('option');
      el.value = String(option);
      el.textContent = option === 'auto' ? 'Auto' : String(option);
      select.append(el);
    });
    select.value = String(value);

    select.addEventListener('change', async () => {
      const effective = await commit(select.value);
      select.value = String(effective);
    });

    return { control: select, focusId: select.id };
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
      if (option.icon) button.append(Icons.create(option.icon, { size: 16 }));

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

    input.addEventListener('input', () => {
      badge.textContent = input.value + (field.unit || '');
      commit(Number(input.value));
    });

    wrap.append(input, badge);
    return { control: wrap, focusId: input.id };
  }

  function buildColor(field, value, commit) {
    const wrap = document.createElement('div');
    wrap.className = 'color';

    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'color__input';
    input.value = value;
    input.id = 'set-' + field.key;

    const hex = document.createElement('span');
    hex.className = 'color__hex';
    hex.textContent = value;

    input.addEventListener('input', () => {
      hex.textContent = input.value;
      commit(input.value);
    });

    wrap.append(input, hex);
    return { control: wrap, focusId: input.id };
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
   * The background picker: what is on screen now, a file button that doubles
   * as a drop target, and an Unsplash search.
   *
   * `commit` is handed one of `{action:'file'|'photo'|'search'|'clear'}` and
   * answers with `{record}` (the picture that took effect, or null) and/or
   * `{results}` (photos to show). Neither this file nor the schema knows where
   * any of it is stored.
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
    file.className = 'bgfield__file';
    file.id = 'set-' + field.key;

    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'btn btn--sm';
    choose.append(Icons.create('upload', { size: 15 }), document.createTextNode('Choose file'));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn--sm btn--danger';
    remove.append(Icons.create('trash-2', { size: 15 }), document.createTextNode('Remove'));

    const query = document.createElement('input');
    query.type = 'search';
    query.className = 'field__input';
    query.placeholder = 'Search Unsplash — "mountains", "quiet street"…';
    query.autocomplete = 'off';

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn btn--sm';
    go.title = 'Search Unsplash';
    go.setAttribute('aria-label', 'Search Unsplash');
    go.append(Icons.create('search', { size: 15 }));

    const results = document.createElement('div');
    results.className = 'bgfield__results';
    results.hidden = true;

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
        preview.append(img);
        caption.textContent = record.credit && record.credit.name
          ? `Photo by ${record.credit.name} on Unsplash`
          : (record.name || 'Local image');
      } else {
        preview.append(Icons.create('image', { size: 22 }));
        caption.textContent = 'No picture — drop one here, or pick one below.';
      }

      remove.hidden = !has;
    }

    function showResults(photos) {
      results.textContent = '';
      photos.forEach(photo => {
        const hit = document.createElement('button');
        hit.type = 'button';
        hit.className = 'bgfield__hit';
        hit.title = `${photo.alt} — ${photo.credit.name}`;

        // A dozen thumbnails, all of them asked for - nothing to defer.
        const img = document.createElement('img');
        img.src = photo.thumb;
        img.alt = photo.alt;
        img.referrerPolicy = 'no-referrer';

        hit.append(img);
        hit.addEventListener('click', () => send({ action: 'photo', photo }));
        results.append(hit);
      });
      results.hidden = photos.length === 0;
    }

    async function send(payload) {
      const state = (await commit(payload)) || {};
      if (state.results) showResults(state.results);
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

    const run = () => {
      const q = query.value.trim();
      if (q) send({ action: 'search', query: q });
    };
    go.addEventListener('click', run);
    // The dialog is a <form>, so Enter would otherwise close it.
    query.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      run();
    });

    const actions = document.createElement('div');
    actions.className = 'bgfield__actions';
    actions.append(choose, remove, file);

    const search = document.createElement('div');
    search.className = 'bgfield__search';
    search.append(query, go);

    wrap.append(preview, caption, actions, search, results);
    showRecord(value);

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
    background: buildBackground
  };

  // ---------------------------------------------------------------- layout

  function buildField(field, value, ctx) {
    const row = document.createElement('div');
    row.className = 'row';

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
    return row;
  }

  /**
   * @param {HTMLElement} container
   * @param {{values: object, onChange: (key:string, value:*) =>
   *   Promise<{value:*, status?: Status}>}} ctx
   */
  function mount(container, ctx) {
    container.textContent = '';

    Schema.SECTIONS.forEach(section => {
      const wrap = document.createElement('section');
      wrap.className = 'section';

      const heading = document.createElement('h3');
      heading.className = 'section__title';
      if (section.icon) heading.append(Icons.create(section.icon, { size: 15 }));
      heading.append(document.createTextNode(section.label));
      wrap.append(heading);

      section.fields.forEach(field => {
        wrap.append(buildField(field, ctx.values[field.key], ctx));
      });

      container.append(wrap);
    });
  }

  return { mount, setStatus };
})();
