//  Level editor — application.
//
//  Two kinds of position live in a draft and they are deliberately different things:
//    * the paint grid is per CELL (walls, surfaces, belts, fans) — you cannot have half a
//      wall cell, and the engine agrees;
//    * pits and objects sit at exact positions in CELL SPACE, snapped to the authoring grid
//      (an eighth of a cell by default). An integer is a cell centre, so a whole-cell snap
//      reproduces the classic cell-by-cell authoring, and 0.125 lets things be placed
//      between cells.
//  Overlapping pit centres merge into one slot, which is drawn as a rounded slot and
//  exported as `centers`. A slot exported to a level needs the board's slot wells, which
//  `docs/DESIGN.md` describes.
//
//  One authoritative draft, rebuilt into a spec and a real `buildLevel()` result on every
//  edit. Everything drawn on the canvas comes from the built level, so the editor shows the
//  engine's reading of the draft rather than the draft's intentions.

import { LEVELS, cellIndex, PLATE, PIT, PAD, SPAWN, GOAL, OUTSIDE } from '../../src/engine/levels.js';
import {
  PAINT_CELLS,
  PIT_TOOL,
  OBJECT_CELLS,
  PAIR_OBJECTS,
  SHAPES,
  SHAPE_LABEL,
  SNAP_STEPS,
  DEFAULT_SNAP,
  blankDraft,
  specToDraft,
  draftToSpec,
  specToJson,
  specToSource,
  resizeDraft,
  setCell,
  charAt,
  inside,
  key,
  snap,
  snapPair,
  addPitCenter,
  removePitCenter,
  removePitsInCell,
  pitAt,
  isSlot,
  addPlate,
  plateAt,
  platesOverCell,
  removePlate,
  PLATE_MATERIALS,
  PAINT_BY_CHAR,
  spawnsOf,
  spawnAt,
  spawnFits,
  addSpawn,
  moveSpawn,
  removeSpawn,
  MIN_SPAWN_GAP,
} from './model.js';
import { METALS, DEFAULT_METAL, metalById } from '../../src/engine/metals.js';
import { BUTTON_R_MAX } from '../../src/engine/constants.js';
import { STORE_KEY, SESSION_KEY } from '../../src/engine/drafts.js';
import { validateDraft, summarise } from './validate.js';
import { draw, computeLayout, pxToCell, pxToCellSpace, COLORS } from './render.js';

//  The page is built in JS rather than markup: one source of truth for every control, and
//  the editor keeps its own DOM entirely separate from the game's index.html.

/** Every named control the UI needs. Filled by buildUI(). */
const el = {};

function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'id') { node.id = v; el[v] = node; }
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

const label = (text, control, cls = 'field') => h('label', { class: cls }, text, control);

/** A readable name for a grid character, for the footer's "what is under the cursor" readout. */
const CHAR_LABEL = {
  [PLATE]: 'pressure button',
  [PIT]: 'pit',
  [PAD]: 'teleport pad',
  [SPAWN]: 'marble',
  [GOAL]: 'goal cup',
  [OUTSIDE]: 'off-board',
};
function charName(ch) {
  return PAINT_BY_CHAR[ch]?.label ?? CHAR_LABEL[ch] ?? ch;
}

/** The keyboard shortcuts the editor answers to, shown so they are discoverable. */
const KEYS = [
  ['f w i s t c v', 'paint floor / wall / ice / sand / steel / conveyor / fan'],
  ['o', 'pit & slot brush'],
  ['g', 'goal-cup tool'],
  ['e', 'erase tool'],
  ['Esc', 'select / edit'],
  ['⌫', 'delete the selected object'],
  ['⌘Z', 'undo  ·  ⇧⌘Z redo'],
];

function buildUI() {
  document.body.append(
    h('header', { class: 'top' },
      h('h1', { text: 'Marble Maze — level editor' }),
      label('start from', h('select', { id: 'start-from' })),
      h('button', { id: 'btn-new', title: 'Start a blank level', text: 'new' }),
      h('a', { id: 'btn-play', class: 'play', href: '../../index.html?draft=session', title: 'Play the draft you are editing in the game itself', text: 'play this draft' }),
      h('button', { id: 'btn-undo', title: 'Undo (⌘Z / Ctrl+Z)', text: '↶ undo' }),
      h('button', { id: 'btn-redo', title: 'Redo (⇧⌘Z / Ctrl+Y)', text: 'redo ↷' }),
      h('span', { class: 'grow' }),
      //  One live status chip instead of a badge plus a dead button: it says what is wrong with
      //  the draft right now, and clicking it jumps to the ledger that explains it.
      h('button', { id: 'status-chip', class: 'chip', title: 'Jump to the rules that produced this verdict', text: '—' }),
      h('button', { id: 'btn-validate', title: 'Re-run every rule against the draft', text: 're-validate' }),
    ),
    h('main', {},
      // ---- left: level, paint, place -------------------------------------
      h('aside', {},
        h('h2', { text: 'Level' }),
        label('id', h('input', { type: 'text', id: 'nl-id' })),
        h('div', { class: 'hint idnote', id: 'id-note' }),
        label('name', h('input', { type: 'text', id: 'nl-name' })),
        label('shape', h('select', { id: 'nl-shape' },
          ...SHAPES.map((s) => h('option', { value: s, text: SHAPE_LABEL[s] ?? s })),
        )),
        label('width', h('input', { type: 'number', id: 'nl-w', min: 4, max: 40 })),
        label('height', h('input', { type: 'number', id: 'nl-h', min: 4, max: 40 })),
        label('difficulty', h('input', { type: 'number', id: 'nl-diff', min: 1, max: 10 })),
        label('par (s)', h('input', { type: 'number', id: 'nl-par', min: 5, max: 900 })),
        label('hint', h('input', { type: 'text', id: 'nl-hint', style: 'width:100%' })),
        h('div', { class: 'checks' },
          h('label', {}, h('input', { type: 'checkbox', id: 'chk-open' }), ' board has intentional open edges'),
          h('label', {}, h('input', { type: 'checkbox', id: 'chk-moving' }), ' moving pit visual (required for moving pits)'),
        ),
        h('h2', { text: 'Paint' }),
        h('div', { class: 'palette', id: 'palette' }),
        h('div', { class: 'row tight' }, h('span', { class: 'hint', text: 'belt / fan direction' }), h('span', { class: 'row tight', id: 'dir-buttons' })),
        h('div', { class: 'row tight' },
          label('pit radius', h('input', { type: 'range', id: 'pit-radius', min: 0.2, max: 0.48, step: 0.01 })),
          h('output', { class: 'mono', id: 'pit-radius-out', text: '0.42' }),
        ),
        h('h2', { text: 'Place' }),
        label('snap', h('select', { id: 'snap' }, ...SNAP_STEPS.map((s) => h('option', { value: s.id, text: s.label, selected: s.step === DEFAULT_SNAP ? 'selected' : null })))),
        h('div', { class: 'toolgrid', id: 'object-tools' }),
        h('button', { id: 'btn-select', style: 'width:100%;margin-top:4px', text: 'select / edit' }),
        h('h2', { text: 'Pairs' }),
        h('div', { class: 'toolgrid', id: 'pair-tools' }),
        h('h2', { text: 'Keys' }),
        h('ul', { class: 'keys', id: 'key-legend' },
          ...KEYS.map(([k, what]) => h('li', {}, h('kbd', { text: k }), h('span', { text: what }))),
        ),
      ),
      // ---- middle: the board ---------------------------------------------
      h('section', { id: 'stage' },
        h('canvas', { id: 'board' }),
        //  The active tool and what it will do, next to the board rather than at the bottom of a
        //  scrolling column: the guidance belongs where the cursor is.
        h('div', { id: 'stagehelp' },
          h('span', { class: 'tool', id: 'tool-name', text: 'select' }),
          h('span', { id: 'tool-hint' }),
        ),
        h('div', { id: 'stagefoot' }),
      ),
      // ---- right: rules, obstacles, export, import, storage ----------------
      h('aside', { class: 'right' },
        h('h2', { class: 'sticky' }, 'Rules ', h('span', { class: 'badge', id: 'valid-count', text: '—' }), h('span', { class: 'badge warn', id: 'solver-badge', title: 'The autopilot solver is disabled — see the note below.', text: 'solver off' })),
        h('p', { class: 'hint', id: 'solver-note' }, SOLVER_NOTE),
        label('show passing checks', h('input', { type: 'checkbox', id: 'chk-showoks' })),
        h('ul', { class: 'ledger', id: 'ledger' }),
        h('h2', { class: 'sticky', text: 'Obstacles' }),
        h('div', { class: 'objlist', id: 'object-list' }),
        h('h2', { class: 'sticky', text: 'Properties' }),
        h('div', { class: 'props', id: 'props' }),
        h('h2', { class: 'sticky' }, 'Export ', h('span', { class: 'hint', id: 'export-info' })),
        h('div', { class: 'tabs' },
          h('button', { id: 'tab-source', text: 'LEVELS entry' }),
          h('button', { id: 'tab-json', text: 'JSON' }),
          h('span', { class: 'grow' }),
          h('button', { id: 'btn-copy', text: 'copy' }),
          h('button', { id: 'btn-download', text: 'save file' }),
        ),
        h('textarea', { id: 'export-text', spellcheck: 'false', 'data-tab': 'source' }),
        h('p', { class: 'hint' }, 'Paste the LEVELS entry into the LEVELS array in src/engine/levels.js, then check it with the headless suite (node tests/run.js). The autopilot in that suite is the engine\u2019s own probe, not this editor\u2019s playability answer.'),
        h('h2', { class: 'sticky', text: 'Import' }),
        h('div', { class: 'row tight' },
          h('button', { id: 'btn-example', text: 'show current JSON' }),
          h('button', { id: 'btn-import', class: 'primary', text: 'load JSON' }),
        ),
        h('textarea', { id: 'import-text', placeholder: 'paste a level spec (JSON) here', spellcheck: 'false' }),
        h('p', { class: 'hint', id: 'import-note' }),
        h('h2', { class: 'sticky', text: 'Saved drafts' }),
        h('div', { class: 'row tight' },
          h('button', { id: 'btn-save', text: 'save draft' }),
          h('span', { class: 'hint', id: 'save-note' }),
        ),
        h('div', { class: 'saved', id: 'saved' }),
      ),
    ),
  );
}

const state = {
  draft: blankDraft(),
  spec: null,
  level: null,
  buildError: null,
  validation: [],
  tool: { kind: 'cell', id: 'wall' },
  snap: DEFAULT_SNAP,
  plateDraft: null, // the plate rectangle being dragged out right now, in cell-edge coordinates
  at: null, // the snapped position under the cursor, in cell space
  dir: [0, 1],
  selection: null, // { list, index }
  pending: null, // first cell of a pair tool
  drag: null,
  hover: null,
  exportTab: 'source',
};

const PROP_SCHEMA = {
  peg: [
    ['r', 'radius', 0.12, 0.48, 0.01],
    ['kick', 'kick', 0, 2.5, 0.05],
  ],
  windmill: [
    ['arms', 'arms', 1, 6, 1],
    ['len', 'arm length', 0.3, 2.2, 0.05],
    ['omega', 'omega', 0.2, 4, 0.05],
  ],
  pendulum: [
    ['len', 'length', 0.4, 2.6, 0.05],
    ['amp', 'amplitude', 0.1, 1.4, 0.05],
    ['freq', 'frequency', 0.1, 3, 0.05],
    ['phase', 'phase', 0, 6.28, 0.05],
  ],
  magnet: [
    ['radius', 'radius', 0.5, 4, 0.1],
    ['strength', 'strength (− repels)', -3, 3, 0.1],
  ],
  button: [['hold', 'hold (s)', 0.5, 12, 0.5]],
  mover: [
    ['len', 'bar length', 0.2, 3.5, 0.05],
    ['speed', 'speed', 0.1, 4, 0.1],
    ['phase', 'phase', 0, 1, 0.05],
  ],
  gate: [],
  lift: [],
  oneway: [],
  teleport: [],
};

const OBJECT_LISTS = [
  ['pegs', 'Bumper post', 'peg'],
  ['windmills', 'Windmill', 'windmill'],
  ['pendulums', 'Pendulum', 'pendulum'],
  ['magnets', 'Magnet', 'magnet'],
  ['buttons', 'Pressure button', 'button'],
  ['lifts', 'Lift wall', 'lift'],
  ['movers', 'Sliding bar', 'mover'],
  ['teleports', 'Teleport pair', 'teleport'],
  ['gates', 'Gate', 'gate'],
  ['oneways', 'One-way flap', 'oneway'],
];

const SOLVER_NOTE =
  'The autopilot solver is switched off and its verdicts are not to be trusted: it has not kept ' +
  'up with the engine (vials, slot pits, sub-unit placement and the obstacle vocabulary all keep ' +
  'changing), so a solved or not-solved answer would call a level broken when it is only a level ' +
  'the solver has not caught up with. Playability is answered from the geometry instead, by the ' +
  'rules below: the goal must be reachable, a pit must leave the marble room to get past, and the ' +
  'floor must be wide enough for it.';


/** A shipped level id used as a draft id is worth flagging: the saved copy is an edit. */
const isShipped = (id) => LEVELS.some((l) => l.id === id);

// ---------------------------------------------------------------------------
//  Build / validate / render
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
//  Undo / redo
// ---------------------------------------------------------------------------
//
//  History is kept as whole draft specs - the same shape `draftToSpec` emits and `specToDraft`
//  eats - so an undo is just "load the previous spec". A canvas gesture records ONE entry for the
//  whole drag (the spec before the first mutation), and a burst of rebuilds from a slider is
//  coalesced by time, so undo steps line up with what a person thinks of as one edit.

const HISTORY_MAX = 150;
const HISTORY_COALESCE_MS = 600;
const history = [];
const future = [];
let suppressHistory = false;
let gestureActive = false;
let gestureRecorded = false;
let lastHistoryAt = 0;

function recordHistory(before, after) {
  if (suppressHistory || !before || before === after) return;
  const now = performance.now();
  if (gestureActive) {
    // One entry per gesture: the first rebuild of a drag keeps the pre-drag spec, the rest are
    // the same edit in progress.
    if (gestureRecorded) return;
    gestureRecorded = true;
  } else if (now - lastHistoryAt < HISTORY_COALESCE_MS) {
    // A slider dragged across many `input` events is one edit, not thirty.
    return;
  }
  history.push(before);
  if (history.length > HISTORY_MAX) history.shift();
  future.length = 0;
  lastHistoryAt = now;
  renderHistory();
}

function renderHistory() {
  const u = el['btn-undo'];
  const r = el['btn-redo'];
  if (!u || !r) return;
  u.disabled = history.length === 0;
  r.disabled = future.length === 0;
  u.title = history.length
    ? `Undo (\u2318Z / Ctrl+Z) \u2014 ${history.length} step${history.length === 1 ? '' : 's'}`
    : 'Nothing to undo';
  r.title = future.length
    ? `Redo (\u21e7\u2318Z / Ctrl+Y) \u2014 ${future.length} step${future.length === 1 ? '' : 's'}`
    : 'Nothing to redo';
}

function restoreHistory(json) {
  suppressHistory = true;
  try {
    loadFromSpec(JSON.parse(json));
  } finally {
    suppressHistory = false;
  }
  renderHistory();
}

function undo() {
  if (!history.length || !state.spec) return;
  future.push(JSON.stringify(state.spec));
  restoreHistory(history.pop());
}

function redo() {
  if (!future.length || !state.spec) return;
  history.push(JSON.stringify(state.spec));
  restoreHistory(future.pop());
}

function rebuild() {
  const before = state.spec ? JSON.stringify(state.spec) : null;
  state.spec = draftToSpec(state.draft);
  const { level, results, spec } = safeValidate(state.spec);
  state.spec = spec;
  state.level = level;
  state.validation = results;
  state.buildError = results.find((r) => r.level === 'error' && r.name.startsWith('the level builds'))?.message ?? null;
  recordHistory(before, JSON.stringify(state.spec));
  render();
  renderPanels();
  autosave();
}

function safeValidate() {
  try {
    return validateDraft(state.draft);
  } catch (err) {
    // validateDraft itself failing is a bug in the editor; show it rather than a blank canvas.
    return {
      spec: state.spec,
      level: null,
      results: [{ level: 'error', name: 'the editor could not validate this draft', message: err.message }],
    };
  }
}

function render() {
  const canvas = el['board'];
  if (!state.level) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.fillStyle = '#8a4a3a';
    ctx.font = '13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(state.buildError ?? 'the draft does not build', canvas.clientWidth / 2, canvas.clientHeight / 2);
    renderFoot();
    return;
  }
  const layout = computeLayout(state.level, canvas);
  state.layout = layout;
  draw(canvas.getContext('2d'), {
    level: state.level,
    layout,
    hover: state.hover,
    pending: state.pending,
    snap: state.snap,
    at: state.at,
    pitTool: state.tool.kind === 'pit',
    plates: state.draft.plates ?? [],
    plateDraft: state.plateDraft,
    selection: state.selection,
  });
  //  The footer carries the live cursor readout, so it has to be refreshed with the canvas, not
  //  only when a panel rebuilds.
  renderFoot();
}

let rafHandle = 0;
function scheduleRender() {
  if (rafHandle) return;
  rafHandle = requestAnimationFrame(() => {
    rafHandle = 0;
    render();
  });
}

// ---------------------------------------------------------------------------
//  Panels
// ---------------------------------------------------------------------------

function renderPanels() {
  // Level identity
  el['nl-id'].value = state.draft.id;
  el['nl-name'].value = state.draft.name;
  el['nl-shape'].value = state.draft.board.shape;
  el['nl-w'].value = state.draft.board.w;
  el['nl-h'].value = state.draft.board.h;
  el['nl-diff'].value = state.draft.difficulty;
  el['nl-par'].value = state.draft.par;
  el['nl-hint'].value = state.draft.hint;
  el['chk-open'].checked = !!state.draft.openEdges;
  el['chk-moving'].checked = !!state.draft.movingPitVisual;
  renderIdNote();

  renderValidation();
  renderObjects();
  renderProps();
  renderExport();
  renderFoot();
}

/** The key that selects each paint cell, matching the keydown map in `wireCanvas`. */
const PAINT_KEY = { floor: 'f', wall: 'w', ice: 'i', sand: 's', steel: 't', belt: 'c', vent: 'v' };

/** A little key-cap badge, so the shortcuts are visible on the tools themselves. */
function kbd(text) {
  const k = document.createElement('kbd');
  k.textContent = text;
  return k;
}

const OBJECT_LABEL = Object.fromEntries(OBJECT_LISTS.map(([n, lbl]) => [n, lbl]));

/** What the current selection is, as a short phrase for the footer. */
function selectionLabel() {
  const s = state.selection;
  if (!s) return '';
  if (s.list === '__spawn') return `marble ${s.index + 1}`;
  if (s.list === '__goal') return 'goal cup';
  if (s.list === '__pit') return 'pit';
  if (s.list === '__plate') return state.draft.plates?.[s.index]?.mat ?? 'plate';
  const o = state.draft[s.list]?.[s.index];
  const kind = OBJECT_LABEL[s.list] ?? s.list;
  return o?.id ? `${kind} '${o.id}'` : kind;
}

/** Warn when the draft's id would collide with a shipped level. */
function renderIdNote() {
  const note = el['id-note'];
  if (!note) return;
  const id = (state.draft.id ?? '').trim();
  if (id && isShipped(id)) {
    note.textContent = `‘${id}’ is a shipped level id — exporting and pasting this would replace that level.`;
    note.classList.add('warn');
  } else {
    note.textContent = '';
    note.classList.remove('warn');
  }
}

function renderFoot() {
  const { errors, warnings } = summarise(state.validation);
  const cells = state.level ? `${state.level.w}×${state.level.h}` : '—';
  const slots = state.draft.pits.filter(isSlot).length;
  const bits = [
    `board <b>${cells}</b>`,
    `walls <b>${state.level ? state.level.segments.length : 0}</b>`,
    `pits <b>${state.level ? state.level.pits.length : 0}</b>${slots ? ` (${slots} slot${slots === 1 ? '' : 's'})` : ''}`,
    `snap <b>${state.snap === 1 ? 'cell' : state.snap}</b>`,
  ];
  //  What is actually under the cursor, not just where it is: the plan view is a diagram and the
  //  char under the pointer is the ground truth for "did I paint the right thing".
  if (state.at && state.level) {
    const ch = charAt(state.draft, cellIndex(state.at[0]), cellIndex(state.at[1]));
    bits.push(`at <b>${state.at[0]}, ${state.at[1]}</b> · <b>${charName(ch)}</b>`);
  }
  if (state.selection) bits.push(`selected <b>${selectionLabel()}</b>`);
  bits.push(`<span class="badge ${errors ? 'err' : 'ok'}">${errors} error${errors === 1 ? '' : 's'}</span>`);
  if (warnings) bits.push(`<span class="badge warn">${warnings} warning${warnings === 1 ? '' : 's'}</span>`);
  el['stagefoot'].innerHTML = bits.filter(Boolean).join(' &nbsp;·&nbsp; ');
}

/** The header's one live verdict chip: colour carries the state, the text carries the count. */
function updateStatusChip() {
  const chip = el['status-chip'];
  if (!chip) return;
  const { errors, warnings } = summarise(state.validation);
  chip.classList.remove('ok', 'warn', 'err');
  if (errors) {
    chip.classList.add('err');
    chip.textContent = `✗ ${errors} error${errors === 1 ? '' : 's'}`;
  } else if (warnings) {
    chip.classList.add('warn');
    chip.textContent = `! ${warnings} warning${warnings === 1 ? '' : 's'}`;
  } else {
    chip.classList.add('ok');
    chip.textContent = '✓ draft is valid';
  }
}

function renderValidation() {
  const root = el['ledger'];
  root.innerHTML = '';
  const { errors, warnings } = summarise(state.validation);
  el['valid-count'].textContent = `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`;
  updateStatusChip();
  const order = { error: 0, warning: 1, ok: 2 };
  const sorted = [...state.validation].sort((a, b) => order[a.level] - order[b.level]);
  for (const r of sorted) {
    if (r.level === 'ok' && !el['chk-showoks'].checked) continue;
    const li = document.createElement('li');
    li.className = r.level;
    li.textContent = r.name;
    if (r.message) {
      const why = document.createElement('span');
      why.className = 'why';
      why.textContent = r.message;
      li.appendChild(why);
    }
    root.appendChild(li);
  }
}

function cellLabel(o) {
  if (o.cell) return `${o.cell[0]},${o.cell[1]}`;
  if (o.a) return `${o.a[0]},${o.a[1]} → ${o.b[0]},${o.b[1]}`;
  if (o.from) return `${o.from[0]},${o.from[1]} → ${o.to[0]},${o.to[1]}`;
  if (o.seg) return `${o.seg[0][0]},${o.seg[0][1]} – ${o.seg[1][0]},${o.seg[1][1]}`;
  return '';
}

/**
 * Properties for one material plate: its material, and its four edges.
 *
 * The edges are cell-EDGE coordinates, so at whole cells they are cell boundaries and an eighth is
 * an eighth. Editing them numerically is the precise way to place a plate; dragging sets them too.
 */
function renderPlateProps(index) {
  const root = el['props'];
  const plate = state.draft.plates?.[index];
  if (!plate) {
    state.selection = null;
    return renderProps();
  }
  const head = document.createElement('div');
  head.className = 'hint';
  head.textContent =
    plate.mat === 'ramp'
      ? `ramp — footprint ${plate.c0}, ${plate.r0} → ${plate.c1}, ${plate.r1} (cell edges)`
      : `material plate ${plate.mat} — edges ${plate.c0}, ${plate.r0} → ${plate.c1}, ${plate.r1} (cell edges)`;
  root.appendChild(head);

  const refresh = () => {
    renderObjects();
    rebuild();
  };

  const matRow = document.createElement('div');
  matRow.className = 'prow';
  const matLabel = document.createElement('label');
  matLabel.textContent = 'material';
  const sel = document.createElement('select');
  for (const m of PLATE_MATERIALS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    if (m.id === plate.mat) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.onchange = () => {
    plate.mat = sel.value;
    refresh();
  };
  matRow.append(matLabel, sel);
  root.appendChild(matRow);

  for (const [prop, label] of [
    ['c0', 'left edge'],
    ['r0', 'top edge'],
    ['c1', 'right edge'],
    ['r1', 'bottom edge'],
  ]) {
    const row = document.createElement('div');
    row.className = 'prow';
    const lab = document.createElement('label');
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.125';
    input.value = String(plate[prop]);
    input.oninput = () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      plate[prop] = v;
      refresh();
    };
    const out = document.createElement('output');
    out.className = 'mono';
    out.textContent = String(plate[prop]);
    input.oninput = () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      plate[prop] = v;
      out.textContent = String(v);
      refresh();
    };
    row.append(lab, input, out);
    root.appendChild(row);
  }

  if (plate.mat === 'ramp') {
    //  A ramp's two extra numbers. The direction is the way the marble *traverses* the wedge -
    //  uphill, from the low edge to the crest. Unlike a belt or a fan, which point the way they
    //  push, the arrow points the way the ride goes, so a marble launched off the crest is
    //  heading the way the arrow points rather than back against it. Spelled out for that reason.
    const dirRow = document.createElement('div');
    dirRow.className = 'prow';
    const dirLabel = document.createElement('label');
    dirLabel.textContent = 'traverse';
    const dirOut = document.createElement('output');
    dirOut.className = 'mono';
    dirOut.textContent = `[${(plate.dir ?? [0, 1]).join(', ')}]`;
    dirRow.append(dirLabel, dirOut);
    root.appendChild(dirRow);
    const dirBtns = document.createElement('div');
    dirBtns.className = 'row tight';
    for (const [glyph, dir] of [
      ['→', [1, 0]],
      ['←', [-1, 0]],
      ['↓', [0, 1]],
      ['↑', [0, -1]],
    ]) {
      const b = document.createElement('button');
      b.textContent = glyph;
      b.setAttribute('aria-pressed', String((plate.dir ?? [0, 1]).join(',') === dir.join(',')));
      b.onclick = () => {
        plate.dir = [...dir];
        state.draft.rampDir = [...dir];
        renderProps();
        rebuild();
      };
      dirBtns.appendChild(b);
    }
    root.appendChild(dirBtns);

    const hRow = document.createElement('div');
    hRow.className = 'prow';
    const hLab = document.createElement('label');
    hLab.textContent = 'height';
    const hIn = document.createElement('input');
    hIn.type = 'number';
    hIn.step = '0.05';
    hIn.min = '0.1';
    hIn.max = '0.9';
    hIn.value = String(plate.height ?? RAMP_HEIGHT);
    const hOut = document.createElement('output');
    hOut.className = 'mono';
    hOut.textContent = `${Number(plate.height ?? RAMP_HEIGHT).toFixed(2)} u`;
    hIn.oninput = () => {
      const v = Number(hIn.value);
      if (!Number.isFinite(v) || v <= 0) return;
      plate.height = v;
      state.draft.rampHeight = v;
      hOut.textContent = `${v.toFixed(2)} u`;
      rebuild();
    };
    hRow.append(hLab, hIn, hOut);
    root.appendChild(hRow);
  }

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent =
    plate.mat === 'ramp'
      ? 'A ramp is a one-way hill: the arrow points the way the marble traverses it, climbing to the tall edge and launching off. It cannot climb back up that face or the stepped half of its side walls, and the taller it is for its run the steeper it is.'
      : 'A plate may cover a pit: the hole is cut out of the plate, so the ground stays ice right up to the hole.';
  root.appendChild(note);

  const del = document.createElement('button');
  del.className = 'primary';
  del.style.width = '100%';
  del.textContent = plate.mat === 'ramp' ? 'delete this ramp' : 'delete this plate';
  del.onclick = () => {
    removePlate(state.draft, index);
    state.selection = null;
    refresh();
    renderProps();
  };
  root.appendChild(del);
}

/**
 * Properties for one marble (a spawn point): its exact cell-space position, and a delete button.
 * A marble is moved by dragging it on the board or by typing a position here; the position fields
 * are the precise way to land it on a fraction of a cell.
 */
function renderSpawnProps(index) {
  const root = el['props'];
  const spawns = spawnsOf(state.draft);
  const spawn = spawns[index];
  if (!spawn) {
    state.selection = null;
    return renderProps();
  }
  const head = document.createElement('div');
  head.className = 'hint';
  head.textContent = `marble ${index + 1} of ${spawns.length} — drag it on the board, or type its position. Every marble must reach the cup.`;
  root.appendChild(head);

  const refresh = () => {
    renderObjects();
    rebuild();
  };

  for (const [prop, label] of [
    [0, 'cell c'],
    [1, 'cell r'],
  ]) {
    const row = document.createElement('div');
    row.className = 'prow';
    const lab = document.createElement('label');
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.125';
    input.value = String(spawn[prop]);
    const out = document.createElement('output');
    out.className = 'mono';
    out.textContent = String(spawn[prop]);
    input.oninput = () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      const next = prop === 0 ? [v, spawn[1]] : [spawn[0], v];
      if (moveSpawn(state.draft, index, next)) out.textContent = String(v);
    };
    input.onchange = refresh;
    row.append(lab, input, out);
    root.appendChild(row);
  }

  if (spawns.length > 1) {
    const del = document.createElement('button');
    del.className = 'primary';
    del.style.width = '100%';
    del.textContent = 'delete this marble';
    del.onclick = () => {
      if (removeSpawn(state.draft, index)) {
        state.selection = null;
        refresh();
        renderProps();
      }
    };
    root.appendChild(del);
  }
}

/** Properties for the cup: its position, and where the marbles must all arrive. */
function renderGoalProps() {
  const root = el['props'];
  const goal = state.draft.goal;
  const head = document.createElement('div');
  head.className = 'hint';
  head.textContent = 'the cup — every marble must end here. Drag it on the board, or type its position.';
  root.appendChild(head);
  const refresh = () => {
    renderObjects();
    rebuild();
  };
  for (const [prop, label] of [
    [0, 'cell c'],
    [1, 'cell r'],
  ]) {
    const row = document.createElement('div');
    row.className = 'prow';
    const lab = document.createElement('label');
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.125';
    input.value = String(goal[prop]);
    const out = document.createElement('output');
    out.className = 'mono';
    out.textContent = String(goal[prop]);
    input.oninput = () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      goal[prop] = v;
      out.textContent = String(v);
      refresh();
    };
    row.append(lab, input, out);
    root.appendChild(row);
  }
}

/** Properties for one pit: a round hole, or a slot with a chain of centres. */
function renderPitProps(index) {
  const root = el['props'];
  const pit = state.draft.pits[index];
  if (!pit) {
    state.selection = null;
    return renderProps();
  }
  const move = pit.move;
  const head = document.createElement('div');
  head.className = 'hint';
  head.textContent = isSlot(pit)
    ? `slot: ${pit.centers.length} centres, radius ${pit.r} — drawn as one rounded slot`
    : `round pit, radius ${pit.r}`;
  root.appendChild(head);

  const radRow = document.createElement('div');
  radRow.className = 'prow';
  const radLab = document.createElement('label');
  radLab.textContent = 'radius';
  const rad = document.createElement('input');
  rad.type = 'range';
  rad.min = 0.2;
  rad.max = 0.48;
  rad.step = 0.01;
  rad.value = pit.r;
  const radOut = document.createElement('output');
  radOut.textContent = Number(pit.r).toFixed(2);
  rad.oninput = () => {
    pit.r = Number(rad.value);
    state.draft.pitRadius = pit.r;
    radOut.textContent = rad.value;
    syncPitRadius();
  };
  rad.onchange = () => rebuild();
  radRow.append(radLab, rad, radOut);
  root.appendChild(radRow);

  const centerRow = document.createElement('div');
  centerRow.className = 'objlist';
  pit.centers.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'objrow';
    const span = document.createElement('span');
    span.className = 'label';
    span.textContent = `centre ${i}: ${c[0]}, ${c[1]}`;
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'remove this centre';
    del.onclick = () => {
      removePitCenter(state.draft, c);
      rebuild();
    };
    row.append(span, del);
    centerRow.appendChild(row);
  });
  root.appendChild(centerRow);

  const row = document.createElement('div');
  row.className = 'prow';
  const lab = document.createElement('label');
  lab.textContent = 'sliding';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = !!move;
  check.onchange = () => {
    if (check.checked) pit.move = { move: [1, 0], speed: 0.6, period: 4, phase: 0 };
    else pit.move = null;
    rebuild();
  };
  const txt = document.createElement('output');
  txt.textContent = move ? 'sliding' : 'static';
  row.append(lab, check, txt);
  root.appendChild(row);

  if (move) {
    for (const [prop, label_, min, max, step] of [
      ['speed', 'speed', 0.1, 3, 0.05],
      ['period', 'period (s)', 0.5, 12, 0.5],
      ['phase', 'phase', 0, 1, 0.05],
    ]) {
      const r = document.createElement('div');
      r.className = 'prow';
      const l = document.createElement('label');
      l.textContent = label_;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min;
      input.max = max;
      input.step = step;
      input.value = move[prop] ?? min;
      const out = document.createElement('output');
      out.textContent = move[prop];
      input.oninput = () => {
        move[prop] = Number(input.value);
        out.textContent = input.value;
      };
      input.onchange = () => rebuild();
      r.append(l, input, out);
      root.appendChild(r);
    }
    for (const [i, axis] of [[0, 'dx'], [1, 'dy']]) {
      const r = document.createElement('div');
      r.className = 'prow';
      const l = document.createElement('label');
      l.textContent = `slide ${axis}`;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = -3;
      input.max = 3;
      input.step = 0.25;
      input.value = move.move[i];
      const out = document.createElement('output');
      out.textContent = move.move[i];
      input.oninput = () => {
        move.move[i] = Number(input.value);
        out.textContent = input.value;
      };
      input.onchange = () => rebuild();
      r.append(l, input, out);
      root.appendChild(r);
    }
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = 'A sliding pit needs “moving pit visual” ticked in the level panel.';
    root.appendChild(note);
  }
}

function renderObjects() {
  const root = el['object-list'];
  root.innerHTML = '';
  let any = false;
  //  Marbles come first: they are the level's starting points, and a multi-marble level lists
  //  every one so it is obvious how many must reach the cup.
  const spawns = spawnsOf(state.draft);
  spawns.forEach((s, index) => {
    any = true;
    const row = document.createElement('div');
    row.className = 'objrow';
    const sel = state.selection && state.selection.list === '__spawn' && state.selection.index === index;
    if (sel) row.style.borderColor = 'var(--accent)';
    const name = document.createElement('span');
    name.className = 'label';
    name.textContent = `${spawns.length > 1 ? `Marble ${index + 1}` : 'Marble'} @ ${s[0]}, ${s[1]}`;
    const selBtn = document.createElement('button');
    selBtn.textContent = 'edit';
    selBtn.onclick = () => {
      state.selection = { list: '__spawn', index };
      renderObjects();
      renderProps();
    };
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = spawns.length > 1 ? 'delete this marble' : 'a level keeps at least one marble';
    del.disabled = spawns.length <= 1;
    del.onclick = () => {
      if (removeSpawn(state.draft, index)) {
        state.selection = null;
        rebuild();
      }
    };
    row.append(name, selBtn, del);
    root.appendChild(row);
  });
  state.draft.pits.forEach((pit, index) => {
    any = true;
    const row = document.createElement('div');
    row.className = 'objrow';
    const sel = state.selection && state.selection.list === '__pit' && state.selection.index === index;
    if (sel) row.style.borderColor = 'var(--accent)';
    const name = document.createElement('span');
    name.className = 'label';
    const where = pit.centers.map(([c, r]) => `${c},${r}`).join(' → ');
    name.textContent = `${isSlot(pit) ? `Slot (${pit.centers.length})` : 'Pit'} @ ${where}`;
    const selBtn = document.createElement('button');
    selBtn.textContent = 'edit';
    selBtn.onclick = () => {
      state.selection = { list: '__pit', index };
      renderObjects();
      renderProps();
    };
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'delete';
    del.onclick = () => {
      state.draft.pits.splice(index, 1);
      state.selection = null;
      rebuild();
    };
    row.append(name, selBtn, del);
    root.appendChild(row);
  });
  (state.draft.plates ?? []).forEach((p, index) => {
    any = true;
    const row = document.createElement('div');
    row.className = 'objrow';
    const sel = state.selection && state.selection.list === '__plate' && state.selection.index === index;
    if (sel) row.style.borderColor = 'var(--accent)';
    const name = document.createElement('span');
    name.className = 'label';
    name.textContent = `${p.mat === 'ramp' ? 'ramp' : `${p.mat} plate`} ${p.c0}, ${p.r0} → ${p.c1}, ${p.r1}`;
    const selBtn = document.createElement('button');
    selBtn.textContent = 'edit';
    selBtn.onclick = () => {
      state.selection = { list: '__plate', index };
      renderObjects();
      renderProps();
    };
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'delete';
    del.onclick = () => {
      state.draft.plates.splice(index, 1);
      state.selection = null;
      rebuild();
    };
    row.append(name, selBtn, del);
    root.appendChild(row);
  });
  for (const [listName, label] of OBJECT_LISTS) {
    const arr = state.draft[listName] ?? [];
    arr.forEach((o, index) => {
      any = true;
      const row = document.createElement('div');
      row.className = 'objrow';
      const sel = state.selection && state.selection.list === listName && state.selection.index === index;
      if (sel) row.style.borderColor = 'var(--accent)';
      const name = document.createElement('span');
      name.className = 'label';
      name.textContent = `${label} @ ${cellLabel(o)}`;
      const selBtn = document.createElement('button');
      selBtn.textContent = 'edit';
      selBtn.onclick = () => {
        state.selection = { list: listName, index };
        renderObjects();
        renderProps();
      };
      const del = document.createElement('button');
      del.textContent = '✕';
      del.title = 'delete';
      del.onclick = () => {
        arr.splice(index, 1);
        state.selection = null;
        rebuild();
      };
      row.append(name, selBtn, del);
      root.appendChild(row);
    });
  }
  if (!any) {
    const p = document.createElement('div');
    p.className = 'hint';
    p.textContent = 'No obstacles placed yet. Use the Marble tool to drop one, or click the board to start.';
    root.appendChild(p);
  }
}

function renderProps() {
  const root = el['props'];
  root.innerHTML = '';
  if (!state.selection) {
    const p = document.createElement('div');
    p.className = 'hint';
    p.textContent = 'Click an obstacle with “select / edit”, or pick one above, to change its properties. A pit can be selected too: it carries an optional slow slide.';
    root.appendChild(p);
    return;
  }
  if (state.selection.list === '__pit') return renderPitProps(state.selection.index);
  if (state.selection.list === '__plate') return renderPlateProps(state.selection.index);
  if (state.selection.list === '__spawn') return renderSpawnProps(state.selection.index);
  if (state.selection.list === '__goal') return renderGoalProps();
  const { list, index } = state.selection;
  const o = state.draft[list]?.[index];
  if (!o) {
    state.selection = null;
    return renderProps();
  }
  const kind = OBJECT_LISTS.find(([n]) => n === list)[2];
  const schema = PROP_SCHEMA[kind] ?? [];
  for (const [prop, label, min, max, step] of schema) {
    if (o[prop] === undefined) o[prop] = min;
    const row = document.createElement('div');
    row.className = 'prow';
    const lab = document.createElement('label');
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = o[prop];
    const out = document.createElement('output');
    out.textContent = o[prop];
    input.oninput = () => {
      o[prop] = Number(input.value);
      out.textContent = input.value;
    };
    input.onchange = () => rebuild();
    row.append(lab, input, out);
    root.appendChild(row);
  }
  // Plate id and gate id for plates; gate id text for gates; plate + mode for lifts.
  if (kind === 'button') {
    const idRow = document.createElement('div');
    idRow.className = 'prow';
    const idLab = document.createElement('label');
    idLab.textContent = 'plate id';
    const idInput = document.createElement('input');
    idInput.type = 'text';
    idInput.value = o.id ?? '';
    idInput.onchange = () => {
      o.id = idInput.value.trim();
      rebuild();
    };
    idRow.append(idLab, idInput);
    root.appendChild(idRow);

    const row = document.createElement('div');
    row.className = 'prow';
    const lab = document.createElement('label');
    lab.textContent = 'gate id';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '(none: this plate only drives lifts)';
    input.value = o.gate ?? '';
    input.onchange = () => {
      o.gate = input.value.trim();
      rebuild();
    };
    row.append(lab, input);
    root.appendChild(row);

    //  The radius: a button may be authored a little larger or smaller, exactly as a pit may, so
    //  it can be tuned to the ground it sits on.
    const radiusRow = document.createElement('div');
    radiusRow.className = 'prow';
    const radiusLab = document.createElement('label');
    radiusLab.textContent = 'radius';
    const radius = document.createElement('input');
    radius.type = 'range';
    radius.min = 0.2;
    radius.max = BUTTON_R_MAX;
    radius.step = 0.01;
    radius.value = o.radius ?? 0.36;
    const radiusOut = document.createElement('output');
    radiusOut.textContent = Number(radius.value).toFixed(2);
    radius.oninput = () => {
      o.radius = Number(radius.value);
      radiusOut.textContent = radius.value;
    };
    radius.onchange = () => rebuild();
    radiusRow.append(radiusLab, radius, radiusOut);
    root.appendChild(radiusRow);

    //  The metal: the finish of this button AND of every lift wall it drives, so the wall you
    //  raise is cut from the same metal as the button that raises it. Each option carries its own
    //  swatch, so the choice is a colour, not an id.
    const metalRow = document.createElement('div');
    metalRow.className = 'prow';
    const metalLab = document.createElement('label');
    metalLab.textContent = 'metal';
    const metalSel = document.createElement('select');
    for (const m of METALS) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      opt.style.color = m.css;
      metalSel.appendChild(opt);
    }
    metalSel.value = metalById(o.metal).id;
    metalSel.onchange = () => {
      o.metal = metalSel.value;
      rebuild();
    };
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = metalById(o.metal).css;
    metalRow.append(metalLab, metalSel, swatch);
    root.appendChild(metalRow);
  }
  if (kind === 'lift') {
    const idRow = document.createElement('div');
    idRow.className = 'prow';
    const idLab = document.createElement('label');
    idLab.textContent = 'lift id';
    const idInput = document.createElement('input');
    idInput.type = 'text';
    idInput.value = o.id ?? '';
    idInput.onchange = () => {
      o.id = idInput.value.trim();
      rebuild();
    };
    idRow.append(idLab, idInput);
    root.appendChild(idRow);

    const plateRow = document.createElement('div');
    plateRow.className = 'prow';
    const plateLab = document.createElement('label');
    plateLab.textContent = 'plate';
    const plateSel = document.createElement('select');
    const plates = state.draft.buttons ?? [];
    if (!plates.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(place a plate first)';
      plateSel.appendChild(opt);
    }
    for (const p of plates) {
      const opt = document.createElement('option');
      opt.value = p.id ?? '';
      opt.textContent = p.id ? `${p.id} @ ${p.cell[0]},${p.cell[1]}` : `(unnamed plate @ ${p.cell[0]},${p.cell[1]})`;
      plateSel.appendChild(opt);
    }
    plateSel.value = o.plate ?? '';
    plateSel.onchange = () => {
      o.plate = plateSel.value;
      rebuild();
    };
    plateRow.append(plateLab, plateSel);
    root.appendChild(plateRow);

    const modeRow = document.createElement('div');
    modeRow.className = 'prow';
    const modeLab = document.createElement('label');
    modeLab.textContent = 'on press';
    const modeSel = document.createElement('select');
    for (const [value, text] of [['lower', 'lowers (wall rests up)'], ['raise', 'raises (wall rests flush)']]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      modeSel.appendChild(opt);
    }
    modeSel.value = o.mode ?? 'lower';
    modeSel.onchange = () => {
      o.mode = modeSel.value;
      rebuild();
    };
    modeRow.append(modeLab, modeSel);
    root.appendChild(modeRow);
  }
  if (kind === 'gate') {
    const row = document.createElement('div');
    row.className = 'prow';
    const lab = document.createElement('label');
    lab.textContent = 'gate id';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = o.id ?? '';
    input.onchange = () => {
      o.id = input.value.trim();
      rebuild();
    };
    row.append(lab, input);
    root.appendChild(row);
  }
  if (kind === 'oneway') {
    const row = document.createElement('div');
    row.className = 'prow';
    const lab = document.createElement('label');
    lab.textContent = 'normal (dc,dr)';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = (o.normal ?? [0, 1]).join(', ');
    input.onchange = () => {
      const parts = input.value.split(/[,\s]+/).map(Number).filter((n) => !Number.isNaN(n));
      if (parts.length === 2) {
        o.normal = parts;
        rebuild();
      }
    };
    row.append(lab, input);
    root.appendChild(row);
  }
  if (!schema.length && !['button', 'gate', 'lift', 'oneway'].includes(kind)) {
    const p = document.createElement('div');
    p.className = 'hint';
    p.textContent = 'This obstacle has no adjustable properties.';
    root.appendChild(p);
  }
}

let exportCache = { source: '', json: '' };

function renderExport() {
  if (!state.spec) return;
  exportCache = { source: specToSource(state.spec), json: specToJson(state.spec) };
  const json = state.exportTab === 'json';
  const text = json ? exportCache.json : exportCache.source;
  el['export-text'].value = text;
  const lines = text ? text.split('\n').length : 0;
  el['export-info'].textContent = `${json ? 'JSON' : 'LEVELS entry'} · ${lines} line${lines === 1 ? '' : 's'} · ${text.length} chars`;
}

// ---------------------------------------------------------------------------
//  Toolbar wiring
// ---------------------------------------------------------------------------

function buildToolbars() {
  const palette = el['palette'];
  palette.innerHTML = '';
  //  The pit brush comes first: it is the one tool that paints positions rather than cells.
  const pitBtn = document.createElement('button');
  pitBtn.title = `${PIT_TOOL.hint} (key: o)`;
  pitBtn.dataset.tool = PIT_TOOL.id;
  const pitSw = document.createElement('span');
  pitSw.className = 'swatch';
  pitSw.style.background = COLORS.o;
  const pitLabel = document.createElement('span');
  pitLabel.textContent = PIT_TOOL.label;
  pitBtn.append(pitSw, pitLabel, kbd('o'));
  pitBtn.onclick = () => selectTool({ kind: 'pit' });
  palette.appendChild(pitBtn);

  //  Material plates: the second brush that paints a shape rather than a cell. A plate is a
  //  rectangle in cell-EDGE space, so at “whole cells” its edges land on cell boundaries — which
  //  is what the cell form of a material means — and at an eighth they land on eighths.
  const plateHead = document.createElement('div');
  plateHead.className = 'palette-head';
  plateHead.textContent = 'material plates — drag a rectangle';
  palette.appendChild(plateHead);
  for (const pl of PLATE_MATERIALS) {
    const b = document.createElement('button');
    b.title = `${pl.hint}. Drag a rectangle; its edges snap to the authoring grid in cell-edge coordinates.`;
    b.dataset.tool = `plate-${pl.id}`;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = pl.swatch ?? COLORS[pl.char] ?? '#888';
    const t = document.createElement('span');
    t.textContent = pl.label;
    b.append(sw, t);
    b.onclick = () => selectTool({ kind: 'plate', mat: pl.id, id: `plate-${pl.id}` });
    palette.appendChild(b);
  }

  const cellsHead = document.createElement('div');
  cellsHead.className = 'palette-head';
  cellsHead.textContent = 'cells — click or drag to paint';
  palette.appendChild(cellsHead);
  for (const p of PAINT_CELLS) {
    const b = document.createElement('button');
    const k = PAINT_KEY[p.id];
    b.title = `${p.label} — ${p.hint}${k ? ` (key: ${k})` : ''}`;
    b.dataset.tool = p.id;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = COLORS[p.char] ?? '#888';
    const t = document.createElement('span');
    t.textContent = p.label;
    b.append(sw, t);
    if (k) b.append(kbd(k));
    b.onclick = () => selectTool({ kind: 'cell', id: p.id });
    palette.appendChild(b);
  }

  const objects = el['object-tools'];
  objects.innerHTML = '';
  for (const o of OBJECT_CELLS) {
    const b = document.createElement('button');
    b.title = o.hint;
    b.dataset.tool = o.id;
    const g = document.createElement('span');
    g.className = 'glyph';
    g.textContent = o.glyph;
    const t = document.createElement('span');
    t.textContent = o.label;
    b.append(g, t);
    b.onclick = () => selectTool(o.id === 'erase' ? { kind: 'erase' } : { kind: 'object', id: o.id });
    objects.appendChild(b);
  }

  const pairs = el['pair-tools'];
  pairs.innerHTML = '';
  for (const o of PAIR_OBJECTS) {
    const b = document.createElement('button');
    b.title = o.hint;
    b.dataset.tool = o.id;
    const t = document.createElement('span');
    t.textContent = `${o.label} — ${o.hint}`;
    b.appendChild(t);
    b.onclick = () => selectTool({ kind: 'pair', id: o.id });
    pairs.appendChild(b);
  }

  const sel = el['btn-select'];
  sel.replaceChildren(document.createTextNode('select / edit'), kbd('Esc'));
  sel.title = 'Click obstacles to edit them (key: Esc) — drag a marble, the cup or a cell obstacle to move it';
  sel.onclick = () => selectTool({ kind: 'select' });

  const dirBtns = el['dir-buttons'];
  dirBtns.innerHTML = '';
  for (const [label, dir] of [['→', [1, 0]], ['←', [-1, 0]], ['↓', [0, 1]], ['↑', [0, -1]]]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.dir = dir.join(',');
    b.onclick = () => {
      state.dir = dir;
      for (const el of dirBtns.children) el.setAttribute('aria-pressed', String(el.dataset.dir === dir.join(',')));
      // Re-point the cell under the cursor if it already holds a belt/vent.
      if (state.hover && (charAt(state.draft, ...state.hover) === 'c' || charAt(state.draft, ...state.hover) === 'v')) {
        setCell(state.draft, state.hover[0], state.hover[1], charAt(state.draft, ...state.hover));
        state.draft.dirs[key(...state.hover)] = [...dir];
        rebuild();
        return;
      }
      // A ramp carries its direction too, and for a ramp the arrow points the way the marble
      // traverses it (uphill). If one is selected, re-point it, so the arrow buttons are how a
      // ramp is aimed rather than only how it is created.
      state.draft.rampDir = [...dir];
      if (state.selection?.list === '__plate') {
        const plate = state.draft.plates?.[state.selection.index];
        if (plate?.mat === 'ramp') {
          plate.dir = [...dir];
          rebuild();
        }
      }
    };
    dirBtns.appendChild(b);
  }
  dirBtns.children[2].setAttribute('aria-pressed', 'true');
}

function selectTool(tool) {
  state.tool = tool;
  state.pending = null;
  state.plateDraft = null;
  const id = tool.kind === 'cell' || tool.kind === 'object' ? tool.id : tool.kind === 'pit' ? 'pit' : tool.id ?? null;
  for (const el of document.querySelectorAll('[data-tool]')) {
    el.setAttribute('aria-pressed', String(el.dataset.tool === id));
  }
  el['btn-select'].setAttribute('aria-pressed', String(tool.kind === 'select'));
  hint();
  render();
}

/** Drop or remove a pit centre at an exact position. */
function paintPit(at, erase) {
  if (erase) {
    removePitCenter(state.draft, at);
    return;
  }
  const before = state.draft.pits.length;
  const res = addPitCenter(state.draft, at, state.draft.pitRadius ?? 0.42);
  if (res.merged && res.pit.centers.length > 1) {
    el['tool-hint'].textContent = `merged into one slot (${res.pit.centers.length} centres, radius ${res.pit.r})${res.grew ? ' — the slot took the larger radius' : ''}`;
  } else if (state.draft.pits.length !== before) {
    el['tool-hint'].textContent = `pit centre dropped at ${at[0]}, ${at[1]}`;
  }
  syncPitRadius();
}

function syncPitRadius() {
  el['pit-radius'].value = state.draft.pitRadius ?? 0.42;
  el['pit-radius-out'].textContent = Number(state.draft.pitRadius ?? 0.42).toFixed(2);
}

/** The active tool's name, shown as a chip beside the guidance. */
function toolTitle(t) {
  if (!t) return '—';
  if (t.kind === 'pit') return 'pit / slot';
  if (t.kind === 'plate') return `${t.mat} plate`;
  if (t.kind === 'cell') return PAINT_CELLS.find((p) => p.id === t.id)?.label ?? t.id;
  if (t.kind === 'object') return OBJECT_CELLS.find((o) => o.id === t.id)?.label ?? t.id;
  if (t.kind === 'pair') return PAIR_OBJECTS.find((o) => o.id === t.id)?.label ?? t.id;
  if (t.kind === 'erase') return 'erase';
  return 'select / edit';
}

function hint() {
  const t = state.tool;
  el['tool-name'].textContent = toolTitle(t);
  let text = '';
  if (t.kind === 'pit') {
    const step = state.snap === 1 ? 'cell centres' : `${state.snap} of a cell`;
    text = `Pit brush, snapped to ${step}. Drag to lay a slot; overlapping centres merge into one rounded slot. Right-drag removes a centre.`;
  } else if (t.kind === 'plate') {
    const step = state.snap === 1 ? 'whole cells' : `${state.snap} of a cell`;
    text = `Material plate (${t.mat}), edges snapped to ${step}. Drag a rectangle in cell-EDGE coordinates — ${state.snap === 1 ? 'so its edges land on cell boundaries' : 'so an eighth of a cell is a legitimate edge'}. A plate may cover a pit: the pit is cut out of it, not erased by it.`;
  } else if (t.kind === 'cell') {
    text = `Painting ${PAINT_CELLS.find((p) => p.id === t.id)?.label}. Drag to paint; right-drag or hold Alt to erase.`;
  } else if (t.kind === 'object') {
    const step = state.snap === 1 ? 'cell centres' : `${state.snap} of a cell`;
    if (t.id === 'spawn') {
      const n = spawnsOf(state.draft).length;
      text = `Marble tool, snapped to ${step}. Click empty floor to add another (${n} so far); drag a marble to move it, or right-drag / Alt-click one to remove it. A level always keeps at least one marble.`;
    } else {
      text = `Placing ${OBJECT_CELLS.find((o) => o.id === t.id)?.label}. Click a cell, or drag an existing one to move it.`;
    }
  } else if (t.kind === 'pair') {
    text = state.pending ? 'Now click the second cell.' : `${PAIR_OBJECTS.find((o) => o.id === t.id)?.hint}. Click the first cell.`;
  } else if (t.kind === 'erase') {
    text = 'Click or drag to erase cells back to floor and remove obstacles. Material plates are left alone — pick one with select / edit to move or delete it.';
  } else {
    text = 'Select: click an obstacle to edit it.';
  }
  el['tool-hint'].textContent = text;
}

// ---------------------------------------------------------------------------
//  Canvas interaction
// ---------------------------------------------------------------------------

function eventCell(ev) {
  if (!state.layout || !state.level) return null;
  const rect = el['board'].getBoundingClientRect();
  const [c, r] = pxToCell(state.layout, state.level, ev.clientX - rect.left, ev.clientY - rect.top);
  if (c < 0 || r < 0 || c >= state.level.w || r >= state.level.h) return null;
  return [c, r];
}

/** The cursor as an exact position in cell space, snapped to the authoring grid. */
function eventAt(ev) {
  if (!state.layout || !state.level) return null;
  const rect = el['board'].getBoundingClientRect();
  const [c, r] = pxToCellSpace(state.layout, ev.clientX - rect.left, ev.clientY - rect.top);
  // Cell space runs from -0.5 (the outer edge of cell 0) to w - 0.5 (the outer edge of the
  // last cell) — not ±w/2, which is the *world* convention.
  if (c < -0.5 || r < -0.5 || c > state.level.w - 0.5 || r > state.level.h - 0.5) return null;
  return snapPair([c, r], state.snap);
}

const coverOf = (at) => [cellIndex(at[0]), cellIndex(at[1])];

/**
 * Where the pointer is, in cell-EDGE coordinates, snapped to the authoring grid.
 *
 * Plates live on edges, so this is the one place that snaps in edge space rather than centre
 * space: at `whole cells` an edge lands on a cell boundary, and at an eighth it lands on an eighth.
 */
function eventEdge(ev) {
  if (!state.layout || !state.level) return null;
  const rect = el['board'].getBoundingClientRect();
  const [c, r] = pxToCellSpace(state.layout, ev.clientX - rect.left, ev.clientY - rect.top);
  return [snap(c + 0.5, state.snap), snap(r + 0.5, state.snap)];
}

/** The rectangle between two edge positions, ordered, and clipped to the board. */
function rectOf(from, to) {
  const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
  const c0 = clamp(Math.min(from[0], to[0]), state.level.w);
  const c1 = clamp(Math.max(from[0], to[0]), state.level.w);
  const r0 = clamp(Math.min(from[1], to[1]), state.level.h);
  const r1 = clamp(Math.max(from[1], to[1]), state.level.h);
  return [c0, r0, c1, r1];
}

function applyCell(cell, erase) {
  if (!cell) return;
  const [c, r] = cell;
  if (!inside(state.draft, c, r)) return;
  const t = state.tool;
  if (t.kind === 'erase' || erase) {
    setCell(state.draft, c, r, '.');
    removeObstacleAt(c, r);
    removePitsInCell(state.draft, c, r);
    return;
  }
  if (t.kind !== 'cell') return;
  const char = PAINT_CELLS.find((p) => p.id === t.id)?.char;
  if (!char) return;
  setCell(state.draft, c, r, char);
  if (char === 'c' || char === 'v') state.draft.dirs[key(c, r)] = [...state.dir];
  if (char === '#') {
    removeObstacleAt(c, r);
    // A plate cannot overlap a wall (the engine refuses it), so painting a wall pushes the
    // plates it lands on out of the way rather than leaving a draft that will not build.
    for (const i of platesOverCell(state.draft, c, r).reverse()) removePlate(state.draft, i);
  }
}

function removeObstacleAt(c, r) {
  const match = (o) => o.cell && coverOf(o.cell)[0] === c && coverOf(o.cell)[1] === r;
  for (const listName of ['pegs', 'windmills', 'pendulums', 'magnets', 'buttons']) {
    const arr = state.draft[listName];
    for (let i = arr.length - 1; i >= 0; i--) if (match(arr[i])) arr.splice(i, 1);
  }
}

/** Place an obstacle at an exact (possibly fractional) position in cell space. */
function placeObjectAt(at) {
  const t = state.tool;
  const draft = state.draft;
  const [c, r] = coverOf(at);
  const hit = (o) => o.cell && Math.abs(o.cell[0] - at[0]) < 1e-9 && Math.abs(o.cell[1] - at[1]) < 1e-9;
  if (t.id === 'spawn') {
    //  Empty floor adds a marble; an existing marble is picked up by the drag path in
    //  wireCanvas, so clicking one moves it rather than stacking a second on the same cell.
    const index = addSpawn(draft, at);
    if (index !== null) {
      state.selection = { list: '__spawn', index };
      setCell(draft, c, r, '.');
    } else {
      el['tool-hint'].textContent = 'a marble needs its own floor, at least a marble away from the others';
    }
  } else if (t.id === 'goal') {
    draft.goal = [...at];
    setCell(draft, c, r, '.');
  } else if (t.id === 'peg') {
    if (!draft.pegs.some(hit)) draft.pegs.push({ cell: [...at], r: 0.26, kick: 0 });
  } else if (t.id === 'windmill') {
    if (!draft.windmills.some(hit)) draft.windmills.push({ cell: [...at], arms: 2, len: 1.1, omega: 1.4 });
  } else if (t.id === 'pendulum') {
    if (!draft.pendulums.some(hit)) draft.pendulums.push({ cell: [...at], len: 1.5, amp: 0.6, freq: 1.2, phase: 0 });
  } else if (t.id === 'magnet') {
    if (!draft.magnets.some(hit)) draft.magnets.push({ cell: [...at], radius: 1.6, strength: 1 });
  } else if (t.id === 'button') {
    if (!draft.buttons.some(hit)) {
      //  A plate gets an id so a lift can name it. Its gate is optional: a plate that only
      //  drives lifts has no gate at all, and the ledger allows that.
      draft.buttons.push({ id: nextPlateId(), cell: [...at], gate: draft.gates[0]?.id ?? '', hold: 4, metal: DEFAULT_METAL });
    }
  }
}

function nextPlateId() {
  const used = new Set(state.draft.buttons.map((b) => b.id).filter(Boolean));
  for (let i = 1; i < 100; i++) if (!used.has(`p${i}`)) return `p${i}`;
  return `p${Date.now()}`;
}

function nextLiftId() {
  const used = new Set((state.draft.lifts ?? []).map((l) => l.id).filter(Boolean));
  for (let i = 1; i < 100; i++) if (!used.has(`w${i}`)) return `w${i}`;
  return `w${Date.now()}`;
}

function placePair(cell) {
  const t = state.tool;
  const draft = state.draft;
  if (!state.pending) {
    state.pending = cell;
    hint();
    return;
  }
  const a = state.pending;
  const b = cell;
  state.pending = null;
  if (a[0] === b[0] && a[1] === b[1]) {
    hint();
    return;
  }
  if (t.id === 'teleport') draft.teleports.push({ a: [...a], b: [...b] });
  else if (t.id === 'mover') draft.movers.push({ from: [...a], to: [...b], len: 1, speed: 1, phase: 0 });
  else if (t.id === 'gate') draft.gates.push({ id: nextGateId(), seg: [[...a], [...b]] });
  else if (t.id === 'lift') {
    //  Default to the first plate; the property sheet re-points it and picks the mode.
    const plate = draft.buttons.find((p) => p.id)?.id ?? '';
    draft.lifts.push({ id: nextLiftId(), seg: [[...a], [...b]], plate, mode: 'lower' });
  } else if (t.id === 'oneway') draft.oneways.push({ seg: [[...a], [...b]], normal: [0, 1] });
  hint();
}

function nextGateId() {
  const used = new Set(state.draft.gates.map((g) => g.id));
  for (let i = 1; i < 100; i++) if (!used.has(`g${i}`)) return `g${i}`;
  return `g${Date.now()}`;
}

/** The obstacle under an authored position, topmost-first, or null. */
function pointHit(at) {
  const draft = state.draft;
  const near = (p) => Math.hypot(p[0] - at[0], p[1] - at[1]) < 0.5;
  const spawns = spawnsOf(draft);
  for (let i = 0; i < spawns.length; i++) if (near(spawns[i])) return { list: '__spawn', index: i };
  if (near(draft.goal)) return { list: '__goal', index: 0 };
  for (const [listName] of OBJECT_LISTS) {
    const arr = draft[listName] ?? [];
    for (let i = 0; i < arr.length; i++) {
      const o = arr[i];
      const has =
        (o.cell && near(o.cell)) ||
        (o.a && (near(o.a) || near(o.b))) ||
        (o.from && (near(o.from) || near(o.to))) ||
        (o.seg && o.seg.some(near));
      if (has) return { list: listName, index: i };
    }
  }
  return null;
}

/**
 * Read/write the position of a hit. Spawns go through `moveSpawn`, which refuses a move onto
 * another marble, so a drag keeps the last legal spot rather than drawing a bad draft.
 */
function hitPosition(hit) {
  const draft = state.draft;
  if (hit.list === '__spawn') {
    return { get: () => draft.spawns[hit.index], set: (v) => moveSpawn(draft, hit.index, v) };
  }
  if (hit.list === '__goal') {
    return { get: () => draft.goal, set: (v) => { draft.goal = [...v]; return true; } };
  }
  const o = draft[hit.list]?.[hit.index];
  if (!o?.cell) return null;
  return { get: () => o.cell, set: (v) => { o.cell = [...v]; return true; } };
}

/** Begin dragging a single-point obstacle (a marble, the cup, or a cell object). */
function startMove(hit, at) {
  const pos = hitPosition(hit);
  if (!pos || !pos.get()) return false;
  state.selection = { list: hit.list, index: hit.index ?? 0 };
  state.drag = { mode: 'move', hit, grab: [...at], origin: [...pos.get()] };
  renderObjects();
  renderProps();
  scheduleRender();
  return true;
}

function selectAt(at) {
  // A pit is picked by its own geometry, so a slot is one clickable thing anywhere on it.
  const pit = pitAt(state.draft, at);
  if (pit !== null) {
    state.selection = { list: '__pit', index: pit };
    renderObjects();
    renderProps();
    return;
  }
  // Then the ground under it: a plate is selected by clicking inside it, and pits win because
  // they are the smaller, more deliberate thing to click.
  const plate = plateAt(state.draft, at);
  if (plate !== null) {
    state.selection = { list: '__plate', index: plate };
    renderObjects();
    renderProps();
    return;
  }
  const hit = pointHit(at);
  state.selection = hit ? { list: hit.list, index: hit.index } : null;
  renderObjects();
  renderProps();
}

/**
 * Delete whatever is selected, if the kind can be deleted at all. The goal cup cannot (the level
 * needs one), and neither can the last marble; both return false rather than half-deleting.
 */
function deleteSelection() {
  const s = state.selection;
  if (!s) return false;
  if (s.list === '__goal') return false;
  if (s.list === '__spawn') {
    if (!removeSpawn(state.draft, s.index)) return false;
  } else if (s.list === '__pit') {
    if (!state.draft.pits[s.index]) return false;
    state.draft.pits.splice(s.index, 1);
  } else if (s.list === '__plate') {
    if (!removePlate(state.draft, s.index)) return false;
  } else {
    const arr = state.draft[s.list];
    if (!Array.isArray(arr) || !arr[s.index]) return false;
    arr.splice(s.index, 1);
  }
  state.selection = null;
  rebuild();
  renderObjects();
  return true;
}

function wireCanvas() {
  const canvas = el['board'];
  const isErase = (ev) => ev.button === 2 || ev.altKey;

  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  canvas.addEventListener('pointerdown', (ev) => {
    const cell = eventCell(ev);
    const at = eventAt(ev);
    if (!cell || !at) return;
    canvas.setPointerCapture(ev.pointerId);
    //  One undo entry per gesture: `recordHistory` keeps the spec from before the first mutation
    //  of this drag and ignores the rest, so a painted stroke undoes in one step.
    gestureActive = true;
    gestureRecorded = false;
    const erase = isErase(ev);
    const t = state.tool;
    if (t.kind === 'pair') {
      placePair(at);
      rebuild();
      return;
    }
    if (t.kind === 'object') {
      //  A marble (or the cup) under the cursor is picked up and dragged, so the same click
      //  that places the first one repositions it — and every later one — without a mode switch.
      const movable = t.id === 'spawn' || t.id === 'goal';
      if (movable) {
        let hit = null;
        if (t.id === 'spawn') {
          const i = spawnAt(state.draft, at);
          if (i !== null) hit = { list: '__spawn', index: i };
        } else if (pointHit(at)?.list === '__goal') {
          hit = { list: '__goal', index: 0 };
        }
        if (hit) {
          // Right-click / Alt drops a marble (the last one stays); otherwise the click picks it up.
          if (erase && hit.list === '__spawn' && removeSpawn(state.draft, hit.index)) {
            state.selection = null;
            state.drag = null;
            rebuild();
            return;
          }
          if (!erase && startMove(hit, at)) return;
        }
      }
      placeObjectAt(at);
      rebuild();
      return;
    }
    if (t.kind === 'select') {
      const hit = pointHit(at);
      //  Clicking a marble (or the cup, or a cell obstacle) with the select tool also starts a
      //  drag, so repositioning is one gesture anywhere in the editor.
      if (hit && startMove(hit, at)) return;
      selectAt(at);
      return;
    }
    if (t.kind === 'pit') {
      state.drag = { mode: erase ? 'pit-erase' : 'pit', at };
      paintPit(at, erase);
      rebuild();
      return;
    }
    if (t.kind === 'plate') {
      const edge = eventEdge(ev);
      if (!edge) return;
      state.drag = { mode: 'plate', from: edge };
      const [c0, r0, c1, r1] = rectOf(edge, edge);
      state.plateDraft = { mat: t.mat, c0, r0, c1, r1 };
      scheduleRender();
      return;
    }
    state.drag = { mode: erase || t.kind === 'erase' ? 'erase' : 'paint', last: cell };
    applyCell(cell, erase);
    rebuild();
  });

  canvas.addEventListener('pointermove', (ev) => {
    const cell = eventCell(ev);
    const at = eventAt(ev);
    const changed = JSON.stringify(cell) !== JSON.stringify(state.hover);
    state.hover = cell;
    state.at = at;
    if (state.drag?.mode === 'plate') {
      const edge = eventEdge(ev);
      if (edge) {
        const [c0, r0, c1, r1] = rectOf(state.drag.from, edge);
        state.plateDraft = { mat: state.tool.mat, c0, r0, c1, r1 };
        scheduleRender();
      }
      return;
    }
    if (state.drag?.mode === 'move') {
      if (!at) return;
      const pos = hitPosition(state.drag.hit);
      if (!pos) return;
      const next = snapPair(
        [state.drag.origin[0] + (at[0] - state.drag.grab[0]), state.drag.origin[1] + (at[1] - state.drag.grab[1])],
        state.snap,
      );
      if (pos.set(next)) {
        state.at = next;
        rebuild();
      }
      return;
    }
    if (state.drag) {
      if (state.drag.mode === 'pit' || state.drag.mode === 'pit-erase') {
        // A pit brush lays centres along the path: only drop one when the cursor has moved
        // far enough for the new centre to matter, so a slow drag cannot pile up duplicates.
        const need = Math.max(0.125, state.draft.pitRadius * 0.5);
        if (at && Math.hypot(at[0] - state.drag.at[0], at[1] - state.drag.at[1]) >= need) {
          paintPit(at, state.drag.mode === 'pit-erase');
          state.drag.at = at;
          rebuild();
        }
      } else if (cell) {
        const [c, r] = cell;
        const [lc, lr] = state.drag.last;
        if (c !== lc || r !== lr) {
          // Interpolate so a fast drag does not skip cells.
          const steps = Math.max(Math.abs(c - lc), Math.abs(r - lr));
          for (let i = 1; i <= steps; i++) {
            applyCell([Math.round(lc + ((c - lc) * i) / steps), Math.round(lr + ((r - lr) * i) / steps)], state.drag.mode === 'erase');
          }
          state.drag.last = cell;
          rebuild();
        }
      }
    } else if (changed || at) {
      scheduleRender();
    }
  });

  const end = (ev) => {
    if (state.drag?.mode === 'plate') {
      const draft = state.plateDraft;
      state.drag = null;
      state.plateDraft = null;
      // A click without a drag is not a plate: it would be a zero-area rectangle.
      if (draft && draft.c1 - draft.c0 > 1e-9 && draft.r1 - draft.r0 > 1e-9) {
        const index = addPlate(state.draft, draft.mat, [draft.c0, draft.r0, draft.c1, draft.r1], {
          dir: state.draft.rampDir,
          height: state.draft.rampHeight,
        });
        state.selection = { list: '__plate', index };
        const what = draft.mat === 'ramp' ? 'ramp' : `${draft.mat} plate`;
        el['tool-hint'].textContent = `${what} ${draft.c0}, ${draft.r0} → ${draft.c1}, ${draft.r1}`;
        renderObjects();
        renderProps();
      } else {
        el['tool-hint'].textContent = 'a plate needs some area: drag a rectangle';
      }
      rebuild();
    } else if (state.drag?.mode === 'move') {
      // Drop the obstacle on plain floor: a marble must not land on a wall it is dragged over.
      const pos = hitPosition(state.drag.hit);
      const p = pos?.get();
      if (p) setCell(state.draft, cellIndex(p[0]), cellIndex(p[1]), '.');
      state.drag = null;
      rebuild();
    } else if (state.drag) {
      state.drag = null;
      rebuild();
    }
    if (ev.pointerId !== undefined && canvas.hasPointerCapture?.(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    gestureActive = false;
    gestureRecorded = false;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => {
    state.hover = null;
    state.at = null;
    scheduleRender();
  });

  window.addEventListener('resize', () => render());
  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
    const mod = ev.metaKey || ev.ctrlKey;
    // Undo / redo first, so a browser default is never the thing that happens.
    if (mod && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      redo();
      return;
    }
    if (mod) return;
    if (ev.key === 'Escape') {
      if (state.pending) {
        state.pending = null;
        hint();
        render();
      } else if (state.selection) {
        //  Escape drops the selection before it changes tools, so a stray click is reversible
        //  without leaving the tool you are painting with.
        state.selection = null;
        renderObjects();
        renderProps();
        scheduleRender();
      } else {
        selectTool({ kind: 'select' });
      }
      return;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      if (deleteSelection()) ev.preventDefault();
      return;
    }
    const k = ev.key.toLowerCase();
    const byKey = { f: 'floor', w: 'wall', i: 'ice', s: 'sand', t: 'steel', c: 'belt', v: 'vent' };
    if (k === 'o') selectTool({ kind: 'pit' });
    else if (k === 'g') selectTool({ kind: 'object', id: 'goal' });
    else if (k === 'e') selectTool({ kind: 'erase' });
    else if (byKey[k]) selectTool({ kind: 'cell', id: byKey[k] });
  });
}

// ---------------------------------------------------------------------------
//  Solver: disabled
// ---------------------------------------------------------------------------
//
//  There is no Solve button any more. The tilt autopilot in src/engine/autopilot.js was a
//  useful probe when the engine was stable and small; it is not that any longer (vials, slot
//  pits, sub-unit placement, and an obstacle vocabulary that keeps growing), so a "solved / not
//  solved" verdict from it is worse than no verdict: it would tell you a level is broken when
//  it is only a level the solver has not caught up with.
//
//  Playability is answered from the geometry instead, in the rule ledger: the goal must be
//  reachable over walkable cells, pits must leave the marble a way past, and the floor must be
//  wide enough for it. Those checks are computed from the level the engine builds, so they
//  cannot fall behind it. `tests/solver.test.js` and `tools/solve.js` still exercise the
//  autopilot inside the repo for the engine's own suite — the editor simply does not call it.



// ---------------------------------------------------------------------------
//  Storage / import / export
// ---------------------------------------------------------------------------

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function writeStore(data) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked — the editor still works */
  }
}

let autosaveTimer = 0;
/** The working draft goes into one session slot; named drafts are only written on demand. */
function autosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    if (!state.spec) return;
    const store = readStore();
    store[SESSION_KEY] = state.spec;
    writeStore(store);
    renderSaved();
  }, 400);
}

/** Write the current draft to the session slot immediately, so Play opens what is on screen. */
function saveSession() {
  if (!state.spec) return;
  const store = readStore();
  store[SESSION_KEY] = state.spec;
  writeStore(store);
  renderSaved();
}

function saveDraft() {
  if (!state.spec) return;
  const store = readStore();
  store[state.draft.id || 'untitled'] = state.spec;
  writeStore(store);
  renderSaved();
  el['save-note'].textContent = `saved “${state.draft.id}”`;
  setTimeout(() => (el['save-note'].textContent = ''), 2000);
}

function renderSaved() {
  const store = readStore();
  const root = el['saved'];
  root.innerHTML = '';
  const ids = Object.keys(store).sort();
  if (!ids.length) {
    const p = document.createElement('div');
    p.className = 'hint';
    p.textContent = 'No drafts saved in this browser yet.';
    root.appendChild(p);
    return;
  }
  for (const id of ids) {
    const row = document.createElement('div');
    row.className = 'objrow';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = id === SESSION_KEY || isShipped(id) ? `${id} (edited)` : id;
    if (id === SESSION_KEY) label.style.opacity = '0.8';
    const load = document.createElement('button');
    load.textContent = 'load';
    load.onclick = () => {
      state.draft = specToDraft(store[id]);
      rebuild();
    };
    const del = document.createElement('button');
    del.textContent = '✕';
    del.onclick = () => {
      const s = readStore();
      delete s[id];
      writeStore(s);
      renderSaved();
    };
    row.append(label, load, del);
    root.appendChild(row);
  }
}

function loadFromSpec(spec) {
  state.draft = specToDraft(spec);
  rebuild();
}

function wireControls() {
  const bind = (id, apply) => {
    el[id].addEventListener('change', () => {
      apply(el[id].value);
      rebuild();
    });
  };
  bind('nl-id', (v) => (state.draft.id = v.trim()));
  bind('nl-name', (v) => (state.draft.name = v));
  bind('nl-shape', (v) => {
    resizeDraft(state.draft, { shape: v });
  });
  bind('nl-w', (v) => resizeDraft(state.draft, { w: Math.max(4, Math.min(40, Number(v) || 4)) }));
  bind('nl-h', (v) => resizeDraft(state.draft, { h: Math.max(4, Math.min(40, Number(v) || 4)) }));
  bind('nl-diff', (v) => (state.draft.difficulty = Number(v)));
  bind('nl-par', (v) => (state.draft.par = Number(v)));
  bind('nl-hint', (v) => (state.draft.hint = v));
  el['chk-open'].addEventListener('change', () => {
    state.draft.openEdges = el['chk-open'].checked;
    rebuild();
  });
  el['chk-moving'].addEventListener('change', () => {
    state.draft.movingPitVisual = el['chk-moving'].checked;
    rebuild();
  });
  el['chk-showoks'].addEventListener('change', renderValidation);

  el['btn-undo'].onclick = undo;
  el['btn-redo'].onclick = redo;
  el['status-chip'].onclick = () => el['ledger'].scrollIntoView({ block: 'start' });
  el['btn-new'].onclick = () => {
    if (!confirm('Start a new blank level? The current draft stays in browser storage.')) return;
    state.draft = blankDraft({ id: `level-${Date.now().toString(36)}`, name: 'New Level' });
    rebuild();
  };
  el['btn-validate'].onclick = () => rebuild();

  //  The id is what a saved best and a `?level=` URL point at, so it matters when an id collides
  //  with a shipped level: exporting and pasting it would replace that level.
  el['nl-id'].addEventListener('input', () => renderIdNote());
  el['btn-save'].onclick = saveDraft;
  //  Playing flushes the working draft into the session slot and hands off to the game itself
  //  (`index.html?draft=session`), so there is exactly one play path and it is the shipped one.
  el['btn-play'].onclick = () => {
    saveSession();
  };
  el['snap'].onchange = () => {
    const found = SNAP_STEPS.find((s) => s.id === el['snap'].value) ?? SNAP_STEPS[SNAP_STEPS.length - 1];
    state.snap = found.step;
    // Everything that has a continuous position moves onto the new grid, so the whole draft
    // stays on one authoring step.
    state.draft.spawns = spawnsOf(state.draft).map((s) => snapPair(s, found.step));
    state.draft.goal = snapPair(state.draft.goal, found.step);
    for (const pit of state.draft.pits) pit.centers = pit.centers.map((c) => snapPair(c, found.step));
    for (const listName of ['pegs', 'windmills', 'pendulums', 'magnets', 'buttons']) {
      for (const o of state.draft[listName]) o.cell = snapPair(o.cell, found.step);
    }
    for (const t of state.draft.teleports) {
      t.a = snapPair(t.a, found.step);
      t.b = snapPair(t.b, found.step);
    }
    for (const m of state.draft.movers) {
      m.from = snapPair(m.from, found.step);
      m.to = snapPair(m.to, found.step);
    }
    for (const g of [...state.draft.gates, ...state.draft.oneways]) g.seg = g.seg.map((s) => snapPair(s, found.step));
    hint();
    rebuild();
  };
  el['pit-radius'].oninput = () => {
    const v = Number(el['pit-radius'].value);
    state.draft.pitRadius = v;
    el['pit-radius-out'].textContent = v.toFixed(2);
    if (state.selection?.list === '__pit') {
      const pit = state.draft.pits[state.selection.index];
      if (pit) pit.r = v;
      rebuild();
    }
  };
  el['pit-radius'].onchange = () => rebuild();

  const startSel = el['start-from'];
  startSel.innerHTML = '<option value="">Start from…</option>';
  for (const spec of LEVELS) {
    const opt = document.createElement('option');
    opt.value = spec.id;
    opt.textContent = `${spec.id} — ${spec.name}`;
    startSel.appendChild(opt);
  }
  const blank = document.createElement('option');
  blank.value = '__blank';
  blank.textContent = 'blank rectangle 16×11';
  startSel.appendChild(blank);
  startSel.onchange = () => {
    if (!startSel.value) return;
    if (startSel.value === '__blank') state.draft = blankDraft({ id: `level-${Date.now().toString(36)}`, name: 'New Level' });
    else loadFromSpec(JSON.parse(JSON.stringify(LEVELS.find((l) => l.id === startSel.value))));
    startSel.value = '';
    rebuild();
  };

  el['tab-source'].onclick = () => {
    state.exportTab = 'source';
    el['tab-source'].setAttribute('aria-pressed', 'true');
    el['tab-json'].setAttribute('aria-pressed', 'false');
    renderExport();
  };
  el['tab-json'].onclick = () => {
    state.exportTab = 'json';
    el['tab-source'].setAttribute('aria-pressed', 'false');
    el['tab-json'].setAttribute('aria-pressed', 'true');
    renderExport();
  };
  el['tab-source'].setAttribute('aria-pressed', 'true');

  el['btn-copy'].onclick = async () => {
    try {
      await navigator.clipboard.writeText(el['export-text'].value);
      el['btn-copy'].textContent = 'copied';
      setTimeout(() => (el['btn-copy'].textContent = 'copy'), 1200);
    } catch {
      el['export-text'].select();
      el['btn-copy'].textContent = 'press ⌘C';
    }
  };

  el['btn-download'].onclick = () => {
    const blob = new Blob([state.exportTab === 'json' ? exportCache.json : exportCache.source], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.draft.id || 'level'}.${state.exportTab === 'json' ? 'json' : 'js'}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  el['btn-import'].onclick = () => {
    const text = el['import-text'].value.trim();
    if (!text) return;
    try {
      const spec = JSON.parse(text);
      if (!spec.board?.shape || !spec.spawn || !spec.goal) throw new Error('that JSON has no board, spawn or goal');
      loadFromSpec(spec);
      el['import-note'].textContent = `loaded ${spec.id ?? 'level'}`;
    } catch (err) {
      el['import-note'].textContent = `could not load: ${err.message}`;
    }
  };

  el['btn-example'].onclick = () => {
    el['import-text'].value = specToJson(state.spec);
  };
}

// ---------------------------------------------------------------------------

buildUI();
buildToolbars();
wireControls();
wireCanvas();
renderSaved();

//  Reopen the most recent autosaved draft, so leaving to Play and coming back does not
//  silently reset the editor to level 1. Only fall back to the first shipped level when
//  there is no usable session draft at all.
function openOnStartup() {
  const session = readStore()[SESSION_KEY];
  if (session) {
    try {
      loadFromSpec(session);
      return;
    } catch {
      /* a session draft the editor cannot read falls through to the shipped level */
    }
  }
  loadFromSpec(JSON.parse(JSON.stringify(LEVELS[0])));
}
openOnStartup();

//  Navigation away — the Play link, a reload, or closing the tab — must never lose the
//  working draft to a pending debounce. Flush it synchronously on the way out.
function flushBeforeUnload() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = 0;
  }
  saveSession();
}
window.addEventListener('pagehide', flushBeforeUnload);
window.addEventListener('beforeunload', flushBeforeUnload);

//  A hook for the browser checks, the same idea as the game's window.__maze: they inspect the
//  draft and drive the same functions the UI does, instead of guessing at pixels.
window.__editor = {
  get state() {
    return state;
  },
  get draft() {
    return state.draft;
  },
  get spec() {
    return state.spec;
  },
  get level() {
    return state.level;
  },
  get validation() {
    return state.validation;
  },
  selectTool,
  rebuild,
  // Editing actions, so a browser check can drive the editor the same way the buttons do.
  undo,
  redo,
  deleteSelection,
  get history() {
    return { past: history.length, future: future.length };
  },
  // Marble helpers, so a browser check can place and move marbles the same way the tools do.
  spawnsOf,
  addSpawn,
  moveSpawn,
  removeSpawn,
};
