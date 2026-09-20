//  Physics tuning panel.
//
//  A side panel of live sliders over TUNING. Everything applies on the next physics step,
//  so the feel can be adjusted while the marble is still moving. Built from TUNING_SPEC so
//  the panel can never drift out of sync with the engine.
//
//  Two things here exist purely for testing: the *range mode* (Normal / Wide / Extreme), which
//  widens every slider outward, and *saved profiles*, named snapshots of the current numbers
//  that can be reloaded later. Both are deliberate: the sliders should be able to reach past
//  what the game considers reasonable, because that is how the edges get found.
//
export function createTuningPanel({ spec, presets, ranges, handlers }) {
  const mount = document.getElementById('tune-panel');
  const rows = new Map();
  let rangeMode = handlers.getRangeMode?.() ?? 'normal';
  const limitsFor = (item) => ranges.limitsFor(item, rangeMode);

  const header = document.createElement('div');
  header.className = 'tune-head';
  header.innerHTML = `<h2>Physics tuning</h2><button id="tune-close" title="Close (T)">close</button>`;
  mount.appendChild(header);

  const explain = document.createElement('p');
  explain.className = 'tune-note';
  explain.textContent =
    'Live sliders over the simulation. Nothing is baked in until you ask for it — tweak, then use Copy JSON to hand me the numbers.';
  mount.appendChild(explain);

  // Range mode: one control for the whole sheet rather than a second set of numbers per row.
  const rangeRow = document.createElement('div');
  rangeRow.className = 'tune-presets tune-ranges';
  const rangeLabel = document.createElement('span');
  rangeLabel.className = 'tune-range-label';
  rangeLabel.textContent = 'Slider range';
  rangeRow.appendChild(rangeLabel);
  const rangeButtons = [];
  for (const key of ranges.keys) {
    const mode = ranges.modes[key];
    const b = document.createElement('button');
    b.textContent = mode.label;
    b.title = mode.hint;
    b.addEventListener('click', () => {
      rangeMode = handlers.onRangeMode(key) ?? key;
      paintRangeMode();
      applyRangeLimits();
      refresh();
    });
    rangeRow.appendChild(b);
    rangeButtons.push([key, b]);
  }
  mount.appendChild(rangeRow);

  function paintRangeMode() {
    for (const [key, b] of rangeButtons) b.classList.toggle('on', key === rangeMode);
  }
  paintRangeMode();

  const presetRow = document.createElement('div');
  presetRow.className = 'tune-presets';
  for (const [key, preset] of Object.entries(presets)) {
    const b = document.createElement('button');
    b.textContent = preset.label;
    b.title = key === 'default' ? 'Reset to the shipped numbers' : 'Live tuning preset';
    b.addEventListener('click', () => {
      handlers.onPreset(key);
      refresh();
    });
    presetRow.appendChild(b);
  }
  mount.appendChild(presetRow);

  const readout = document.createElement('div');
  readout.className = 'tune-readout';
  mount.appendChild(readout);

  const testRow = document.createElement('div');
  testRow.className = 'tune-tests';
  const restart = document.createElement('button');
  restart.textContent = 'restart run';
  restart.addEventListener('click', () => handlers.onRestart());
  const undoTilt = document.createElement('button');
  undoTilt.textContent = 'level the board';
  undoTilt.title = 'Clear any held tilt';
  undoTilt.addEventListener('click', () => handlers.onLevel());
  const copy = document.createElement('button');
  copy.textContent = 'copy JSON';
  copy.addEventListener('click', async () => {
    const json = handlers.onCopy();
    box.value = json;
    let done = false;
    try {
      await navigator.clipboard.writeText(json);
      done = true;
    } catch {
      box.select();
      done = document.execCommand?.('copy') ?? false;
    }
    copy.textContent = done ? 'copied ✓' : 'select + copy';
    setTimeout(() => {
      copy.textContent = 'copy JSON';
    }, 1400);
  });
  const reset = document.createElement('button');
  reset.textContent = 'reset all';
  reset.title = 'Back to the shipped defaults';
  reset.addEventListener('click', () => {
    handlers.onReset();
    refresh();
  });
  testRow.append(restart, undoTilt, copy, reset);
  mount.appendChild(testRow);

  const box = document.createElement('textarea');
  box.className = 'tune-json';
  box.rows = 3;
  box.spellcheck = false;
  box.placeholder = 'paste a physics JSON here, then press Load';
  mount.appendChild(box);

  const loadRow = document.createElement('div');
  loadRow.className = 'tune-tests';
  const load = document.createElement('button');
  load.textContent = 'load pasted JSON';
  load.addEventListener('click', () => {
    const res = handlers.onLoad(box.value);
    load.textContent = res.ok ? (res.unknown?.length ? `loaded (${res.unknown.length} unknown keys ignored)` : 'loaded ✓') : `failed: ${res.error}`;
    refresh();
    setTimeout(() => {
      load.textContent = 'load pasted JSON';
    }, 1800);
  });
  const status = document.createElement('span');
  status.className = 'tune-status';
  loadRow.append(load, status);
  mount.appendChild(loadRow);

  // Saved profiles: a name box, a save button, and the list of what is already stored.
  const profileHead = document.createElement('div');
  profileHead.className = 'tune-profile-head';
  const profileTitle = document.createElement('b');
  profileTitle.textContent = 'Saved profiles';
  const profileNote = document.createElement('span');
  profileNote.className = 'tune-status';
  profileHead.append(profileTitle, profileNote);
  mount.appendChild(profileHead);

  const profileNew = document.createElement('div');
  profileNew.className = 'tune-profile-new';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'tune-profile-name';
  nameInput.placeholder = 'name this profile';
  nameInput.spellcheck = false;
  // Typing a name must not tilt the board either.
  nameInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') saveButton.click();
  });
  const saveButton = document.createElement('button');
  saveButton.textContent = 'save current';
  saveButton.title = 'Store the numbers showing right now (and the slider range) under this name';
  saveButton.addEventListener('click', () => {
    const res = handlers.onSaveProfile(nameInput.value, rangeMode);
    if (res.ok) {
      nameInput.value = '';
      profileNote.textContent = `saved “${res.name}”`;
      renderProfiles();
    } else {
      profileNote.textContent = res.error ?? 'could not save';
    }
    setTimeout(() => {
      profileNote.textContent = '';
    }, 2200);
  });
  profileNew.append(nameInput, saveButton);
  mount.appendChild(profileNew);

  const profileList = document.createElement('div');
  profileList.className = 'tune-profile-list';
  mount.appendChild(profileList);

  function renderProfiles() {
    const names = handlers.listProfiles();
    profileList.replaceChildren();
    if (!names.length) {
      const empty = document.createElement('span');
      empty.className = 'tune-status';
      empty.textContent = 'no profiles saved yet';
      profileList.appendChild(empty);
      return;
    }
    for (const name of names) {
      const row = document.createElement('div');
      row.className = 'tune-profile';
      const label = document.createElement('span');
      label.className = 'tune-profile-label';
      label.textContent = name;
      const loadBtn = document.createElement('button');
      loadBtn.textContent = 'load';
      loadBtn.addEventListener('click', () => {
        const res = handlers.onLoadProfile(name);
        if (res.ok) {
          rangeMode = handlers.getRangeMode();
          paintRangeMode();
          applyRangeLimits();
          refresh();
          profileNote.textContent = `loaded “${name}”`;
          setTimeout(() => {
            profileNote.textContent = '';
          }, 2200);
        } else {
          profileNote.textContent = res.error ?? 'could not load';
        }
      });
      const delBtn = document.createElement('button');
      delBtn.textContent = 'delete';
      delBtn.title = 'Remove this profile from the browser';
      delBtn.addEventListener('click', () => {
        const res = handlers.onDeleteProfile(name);
        if (!res.ok) profileNote.textContent = res.error ?? 'could not delete';
        renderProfiles();
      });
      row.append(label, loadBtn, delBtn);
      profileList.appendChild(row);
    }
  }

  // groups
  spec.forEach((group, gi) => {
    const details = document.createElement('details');
    details.className = 'tune-group';
    // Open the two groups people reach for first; the rest stay folded to keep it short.
    details.open = gi < 2;
    const summary = document.createElement('summary');
    summary.innerHTML = `<span>${group.group}</span><em>${group.items.length}</em>`;
    details.appendChild(summary);
    if (group.note) {
      const n = document.createElement('p');
      n.className = 'tune-group-note';
      n.textContent = group.note;
      details.appendChild(n);
    }
    for (const item of group.items) {
      const row = document.createElement('label');
      row.className = 'tune-row';
      // Which tunable this row is. The panel now has several choice rows (the board finish, the rim
      // grain, the marble look, the indicator mode), so a check that fished its buttons out of the
      // whole document by value picked the wrong row's button the moment a second one appeared.
      row.dataset.path = item.path;
      row.title = item.hint ?? '';
      const top = document.createElement('span');
      top.className = 'tune-row-top';
      const name = document.createElement('b');
      name.textContent = item.label;
      const value = document.createElement('i');
      top.append(name, value);
      // A choice item (the indicator mode) is a row of buttons rather than a slider: it is a mode,
      // not a quantity, and a slider would imply you can be halfway between two of them.
      if (item.options) {
        const seg = document.createElement('div');
        seg.className = 'tune-seg';
        const buttons = [];
        for (const opt of item.options) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = opt.label;
          btn.dataset.value = String(opt.value);
          btn.addEventListener('click', () => {
            handlers.onChange(item.path, opt.value);
            select(opt.value);
            status.textContent = 'custom physics';
            status.classList.add('on');
          });
          btn.addEventListener('keydown', (e) => e.stopPropagation());
          seg.appendChild(btn);
          buttons.push(btn);
        }
        const select = (v) => {
          for (const b of buttons) b.classList.toggle('on', b.dataset.value === String(v));
          value.textContent = String(v);
        };
        const hint = document.createElement('small');
        hint.textContent = item.hint ?? '';
        row.append(top, seg, hint);
        details.appendChild(row);
        rows.set(item.path, { input: null, value, item, select });
        continue;
      }
      // A colour is the third kind of control: a mode is a list of words and a quantity is a slider,
      // but a colour is a hex string, and the browser's own picker beats anything a range input can
      // do with it. It is stored as a string, so the tuning layer validates the hex rather than
      // clamping a number (see `clampValue`).
      if (item.type === 'color') {
        const input = document.createElement('input');
        input.type = 'color';
        input.className = 'tune-color';
        input.dataset.path = item.path;
        input.value = String(handlers.getValue(item.path));
        const select = (v) => {
          input.value = String(v);
          value.textContent = String(v);
        };
        input.addEventListener('input', () => {
          handlers.onChange(item.path, input.value);
          //  Read it back rather than echoing: the tuning layer normalises the hex, and a picker that
          //  shows one value while the marble uses another is worse than no picker.
          select(handlers.getValue(item.path));
          status.textContent = 'custom physics';
          status.classList.add('on');
        });
        input.addEventListener('keydown', (e) => e.stopPropagation());
        const hint = document.createElement('small');
        hint.textContent = item.hint ?? '';
        row.append(top, input, hint);
        details.appendChild(row);
        rows.set(item.path, { input, value, item, select });
        continue;
      }
      const input = document.createElement('input');
      input.type = 'range';
      const lim = limitsFor(item);
      input.min = String(lim.min);
      input.max = String(lim.max);
      input.step = String(lim.step);
      input.dataset.path = item.path;
      input.addEventListener('input', () => {
        const v = Number(input.value);
        handlers.onChange(item.path, v);
        paintValue(item, value, v);
        status.textContent = 'custom physics';
        status.classList.add('on');
      });
      // keep arrow keys inside the slider: the game listens for arrows on window
      input.addEventListener('keydown', (e) => e.stopPropagation());
      const hint = document.createElement('small');
      hint.textContent = item.hint ?? '';
      row.append(top, input, hint);
      details.appendChild(row);
      rows.set(item.path, { input, value, item });
    }
    mount.appendChild(details);
  });

  const footnote = document.createElement('p');
  footnote.className = 'tune-footnote';
  footnote.textContent =
    'The shipped ranges stop where the game stops being reasonable. Switch the slider range to Wide or Extreme to take a knob past that on purpose: the marble will not always survive it, and that is the point.';
  mount.appendChild(footnote);

  document.getElementById('tune-close').addEventListener('click', () => handlers.onClose());

  function paintValue(item, node, v) {
    const shown = item.display ? item.display(v) : `${Number(v).toFixed(item.step < 0.05 ? 3 : 2)}`;
    node.textContent = `${shown}${item.unit ? ' ' + item.unit : ''}`;
  }

  function refresh() {
    for (const r of rows.values()) {
      const v = handlers.getValue(r.item.path);
      if (r.select) {
        //  Both lists and colours land here; a list's `select` paints its buttons, a colour's paints
        //  the picker and the readout.
        r.select(v);
        continue;
      }
      if (typeof v !== 'number') continue;
      r.input.value = String(v);
      paintValue(r.item, r.value, v);
    }
    status.textContent = handlers.isCustomised() ? 'custom physics' : 'shipping defaults';
    status.classList.toggle('on', handlers.isCustomised());
  }

  function setReadout(text) {
    readout.textContent = text;
  }

  // Every numeric slider is given the limits of the current range mode. The choice rows have no
  // range, so they are skipped.
  function applyRangeLimits() {
    for (const r of rows.values()) {
      if (!r.input) continue;
      const lim = limitsFor(r.item);
      r.input.min = String(lim.min);
      r.input.max = String(lim.max);
      r.input.step = String(lim.step);
    }
  }

  function open(on) {
    mount.classList.toggle('show', on);
    if (on) {
      rangeMode = handlers.getRangeMode?.() ?? rangeMode;
      paintRangeMode();
      applyRangeLimits();
      renderProfiles();
      refresh();
    }
  }

  return {
    open,
    toggle() {
      open(!mount.classList.contains('show'));
    },
    get isOpen() {
      return mount.classList.contains('show');
    },
    refresh,
    setReadout,
    openJson(json) {
      box.value = json;
      open(true);
    },
  };
}
