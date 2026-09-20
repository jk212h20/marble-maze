//  Level editor — 2D board view.
//
//  Draws the level the way the *engine* sees it (from `buildLevel()` output), not the way
//  the paint grid looks, so automatic rim walls, hole radii and obstacle contacts are all
//  visible while authoring. No three.js, no renderer imports: this is a plan view.

import {
  FLOOR,
  WALL,
  PIT,
  ICE,
  SAND,
  STEEL,
  BELT,
  VENT,
  PAD,
  PLATE,
  SPAWN,
  GOAL,
  OUTSIDE,
} from '../../src/engine/levels.js';
import { combineHoleRings } from '../../src/engine/hole-ring.js';

export const COLORS = {
  [FLOOR]: '#d8b98b',
  [WALL]: '#8d5f3a',
  [ICE]: '#b9e2f2',
  [SAND]: '#e6d6a2',
  [STEEL]: '#c6cbd2',
  [BELT]: '#6d7178',
  [VENT]: '#7ed3c6',
  [PAD]: '#49cbe4',
  [PLATE]: '#e7c152',
  [PIT]: '#2b2b30',
  [SPAWN]: '#2e9e4f',
  [GOAL]: '#f2c14e',
  [OUTSIDE]: 'rgba(0,0,0,0)',
};

/** Plate tints on the plan view: strong enough to see over a cell colour, light enough to read under. */
export const PLATE_TINT = {
  ice: 'rgba(150,215,240,0.42)',
  sand: 'rgba(230,214,162,0.42)',
  steel: 'rgba(198,203,210,0.46)',
  ramp: 'rgba(201,130,47,0.55)',
};

export function computeLayout(level, canvas, padding = 16) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  const cell = Math.max(6, Math.min((cssW - padding * 2) / level.w, (cssH - padding * 2) / level.h));
  const ox = (cssW - cell * level.w) / 2;
  const oy = (cssH - cell * level.h) / 2;
  return { cell, ox, oy, dpr, cssW, cssH };
}

export function boardToPx(layout, level, x, z) {
  return [layout.ox + (x + level.w / 2) * layout.cell, layout.oy + (z + level.h / 2) * layout.cell];
}

export function cellToPx(layout, level, c, r) {
  return [layout.ox + c * layout.cell, layout.oy + r * layout.cell];
}

export function pxToCell(layout, level, px, py) {
  return [Math.floor((px - layout.ox) / layout.cell), Math.floor((py - layout.oy) / layout.cell)];
}

/**
 * The same point in *cell space* — where an integer is a cell centre and a fraction is a
 * real position, which is the space the level format uses for pits and objects.
 */
export function pxToCellSpace(layout, px, py) {
  return [(px - layout.ox) / layout.cell - 0.5, (py - layout.oy) / layout.cell - 0.5];
}

export function cellSpaceToPx(layout, level, c, r) {
  return [layout.ox + (c + 0.5) * layout.cell, layout.oy + (r + 0.5) * layout.cell];
}

export function draw(
  ctx,
  {
    level,
    layout,
    hover = null,
    pending = null,
    showGrid = true,
    snap = 1,
    at = null,
    pitTool = false,
    plates = [],
    plateDraft = null,
    plateTool = null,
    selection = null,
  },
) {
  const { cell } = layout;
  ctx.save();
  ctx.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0);
  ctx.clearRect(0, 0, layout.cssW, layout.cssH);

  // Cells.
  for (let r = 0; r < level.h; r++) {
    for (let c = 0; c < level.w; c++) {
      const ch = level.grid[r][c];
      if (ch === OUTSIDE) continue;
      const [x, y] = cellToPx(layout, level, c, r);
      ctx.fillStyle = COLORS[ch] ?? '#999';
      ctx.fillRect(x, y, cell + 0.5, cell + 0.5);
      if (ch === WALL) {
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(x, y, cell, Math.max(1.5, cell * 0.16));
      } else if (ch === PIT) {
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
      }
    }
  }

  // Material plates: drawn as the rectangles they ARE, in cell-edge coordinates, so a plate
  // whose edge is an eighth of a cell reads as exactly that. Drawn before the pits, because a
  // pit cut into a plate is a hole in it, and the hole has to be visible as one.
  const plateBox = (p) => {
    const [x0, y0] = cellToPx(layout, level, p.c0, p.r0);
    const [x1, y1] = cellToPx(layout, level, p.c1, p.r1);
    return [x0, y0, x1 - x0, y1 - y0];
  };
  for (const p of plates) {
    if (p.mat === 'ramp') continue; // drawn as a slope, below
    const [x, y, w, h] = plateBox(p);
    const tint = PLATE_TINT[p.mat] ?? 'rgba(255,255,255,0.4)';
    ctx.fillStyle = tint;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
  }

  // The authoring grid: whole cells as lines, and the finer steps as dots so an eighth of a
  // cell is visible while placing things.
  if (snap < 1) {
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    const R = Math.max(1, cell * 0.02);
    for (let r = -level.h / 2 + 0.5; r <= level.h / 2 - 0.5 + 1e-9; r += snap) {
      for (let c = -level.w / 2 + 0.5; c <= level.w / 2 - 0.5 + 1e-9; c += snap) {
        const [x, y] = cellSpaceToPx(layout, level, c, r);
        ctx.beginPath();
        ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Grid.
  if (showGrid) {
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= level.w; c++) {
      const [x, y0] = cellToPx(layout, level, c, 0);
      const [, y1] = cellToPx(layout, level, c, level.h);
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let r = 0; r <= level.h; r++) {
      const [x0, y] = cellToPx(layout, level, 0, r);
      const [x1] = cellToPx(layout, level, level.w, r);
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
  }

  // Conveyor / vent directions.
  const arrow = (x, y, dir, color) => {
    const [dx, dz] = dir;
    const len = cell * 0.34;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.5, cell * 0.09);
    ctx.beginPath();
    ctx.moveTo(x - dx * len, y - dz * len);
    ctx.lineTo(x + dx * len, y + dz * len);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + (dx + dz * 0.6) * len, y + (dz - dx * 0.6) * len);
    ctx.lineTo(x + (dx - dz * 0.6) * len, y + (dz + dx * 0.6) * len);
    ctx.lineTo(x + dx * len * 1.45, y + dz * len * 1.45);
    ctx.closePath();
    ctx.fill();
  };
  for (let r = 0; r < level.h; r++) {
    for (let c = 0; c < level.w; c++) {
      const ch = level.grid[r][c];
      if (ch !== BELT && ch !== VENT) continue;
      const [x, y] = cellToPx(layout, level, c, r);
      const mid = [x + cell / 2, y + cell / 2];
      let dir = [0, 1];
      if (ch === BELT) dir = level.features.belts.find((b) => b.cells.some(([bc, br]) => bc === c && br === r))?.dir ?? [0, 1];
      else dir = level.features.vents.find((v) => v.cells.some(([bc, br]) => bc === c && br === r))?.dir ?? [0, 1];
      arrow(mid[0], mid[1], dir, ch === BELT ? '#e9eef5' : '#0d5f57');
    }
  }

  //  Ramps. Drawn from the engine's own ramp geometry, so the rectangle, the traversal arrow
  //  and the tall edge are the ones the marble will actually meet. The fill runs from a heavy
  //  amber at the tall (crest) edge to almost nothing at the low edge, and the crest gets a
  //  solid bar, because that face is a step the marble cannot climb back up. The arrow points
  //  along `dir` - the way the marble travels when it climbs the wedge.
  for (const rp of level.features.ramps ?? []) {
    const [x0, y0] = boardToPx(layout, level, rp.x0, rp.z0);
    const [x1, y1] = boardToPx(layout, level, rp.x1, rp.z1);
    //  `dir` is uphill, so the crest is the far end along it. The gradient runs from there down,
    //  so the dark end of the amber is the crest.
    const alongX = rp.dir[0] !== 0;
    const uphillFirst = alongX ? rp.dir[0] > 0 : rp.dir[1] > 0;
    const [ga, gb] = alongX
      ? uphillFirst
        ? [x1, x0]
        : [x0, x1]
      : uphillFirst
        ? [y1, y0]
        : [y0, y1];
    const g = alongX ? ctx.createLinearGradient(ga, 0, gb, 0) : ctx.createLinearGradient(0, ga, 0, gb);
    g.addColorStop(0, 'rgba(176,104,26,0.80)');
    g.addColorStop(0.55, 'rgba(214,150,74,0.42)');
    g.addColorStop(1, 'rgba(240,214,170,0.10)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    // The tall edge, drawn as the solid bar it is in the engine: a step, not a slope.
    const tall = alongX ? (uphillFirst ? x1 : x0) : uphillFirst ? y1 : y0;
    ctx.strokeStyle = '#3d2408';
    ctx.lineWidth = Math.max(3, cell * 0.16);
    ctx.beginPath();
    if (alongX) {
      ctx.moveTo(tall, y0);
      ctx.lineTo(tall, y1);
    } else {
      ctx.moveTo(x0, tall);
      ctx.lineTo(x1, tall);
    }
    ctx.stroke();
    arrow((x0 + x1) / 2, (y0 + y1) / 2, rp.dir, '#6b3f10');
    ctx.strokeStyle = 'rgba(90,52,10,0.7)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 + 0.75, y0 + 0.75, x1 - x0 - 1.5, y1 - y0 - 1.5);
  }

  //  Pits and slots. A slot is the union of overlapping circles, so it is drawn as a thick
  //  polyline with round caps and round joins: a brass rim first, then the dark hole inside
  //  it. One centre with r < half a cell comes out as the plain round hole it always was.
  const strokeChain = (pts, width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], width / 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  };
  const holeWidth = (r) => Math.max(3, r * 2 * cell);
  const rimWidth = Math.max(2, cell * 0.11);
  const tracePx = (ring) => {
    ring.forEach(([x, z], i) => {
      const [px, py] = boardToPx(layout, level, x, z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  };
  //  Holes that overlap are one region: unioned, so the rim runs round the combined outside only
  //  and no rim is drawn across the ground two pits share. A lone pit comes back as its own ring,
  //  bit for bit, so a single round hole or slot is drawn exactly as it always was.
  const still = level.pits.filter((pit) => !pit.move);
  const pieces = combineHoleRings(
    still.map((pit) => ({ centers: (pit.centers ?? [[pit.x, pit.z]]).map(([x, z]) => [x, z]), r: pit.r })),
  );
  for (const piece of pieces) {
    ctx.strokeStyle = '#f0e2c8';
    ctx.lineWidth = rimWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    tracePx(piece.outer);
    ctx.stroke();
    ctx.fillStyle = '#17171a';
    ctx.beginPath();
    tracePx(piece.outer);
    for (const loop of piece.voids) tracePx(loop);
    ctx.fill('evenodd');
  }
  for (const pit of level.pits.filter((p) => p.move)) {
    const pts = (pit.centers ?? [[pit.x, pit.z]]).map(([x, z]) => boardToPx(layout, level, x, z));
    strokeChain(pts, holeWidth(pit.r) + rimWidth, '#f0e2c8');
    strokeChain(pts, holeWidth(pit.r), '#17171a');
    const [x, y] = pts[pts.length - 1];
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(240,226,200,0.75)';
    ctx.lineWidth = Math.max(1, cell * 0.06);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + pit.move[0] * cell, y + pit.move[1] * cell);
    ctx.stroke();
    ctx.restore();
  }

  // Obstacles -------------------------------------------------------------
  const circle = (x, y, r, fill, stroke) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, cell * 0.06);
      ctx.stroke();
    }
  };

  for (const p of level.features.pegs) {
    const [x, y] = boardToPx(layout, level, p.x, p.z);
    circle(x, y, (p.r ?? 0.26) * cell, '#d8a83a', '#7a5410');
  }
  for (const m of level.features.magnets) {
    const [x, y] = boardToPx(layout, level, m.x, m.z);
    const positive = (m.strength ?? 1) >= 0;
    circle(x, y, m.radius * cell, positive ? 'rgba(216,168,58,0.22)' : 'rgba(70,80,110,0.22)', positive ? '#d8a83a' : '#4a5570');
    circle(x, y, Math.max(3, cell * 0.12), positive ? '#d8a83a' : '#4a5570');
  }
  for (const w of level.features.windmills) {
    const [x, y] = boardToPx(layout, level, w.x, w.z);
    circle(x, y, cell * 0.14, '#8b8f96');
    ctx.strokeStyle = '#3f4348';
    ctx.lineWidth = Math.max(2, cell * 0.1);
    const arms = w.arms ?? 2;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2 + (w.angle ?? 0);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * (w.len ?? 1) * cell, y + Math.sin(a) * (w.len ?? 1) * cell);
      ctx.stroke();
    }
  }
  for (const p of level.features.pendulums) {
    const [x, y] = boardToPx(layout, level, p.x, p.z);
    const len = (p.len ?? 1.4) * cell;
    const a = (p.phase ?? 0) + Math.PI / 2;
    const bx = x + Math.cos(a) * len;
    const by = y + Math.sin(a) * len;
    ctx.strokeStyle = '#3f4348';
    ctx.lineWidth = Math.max(2, cell * 0.09);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(bx, by);
    ctx.stroke();
    circle(bx, by, Math.max(4, cell * 0.16), '#c8392f');
  }
  for (const m of level.features.movers) {
    const [x0, y0] = boardToPx(layout, level, m.from[0], m.from[1]);
    const [x1, y1] = boardToPx(layout, level, m.to[0], m.to[1]);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
    const t = 0.5;
    const mx = x0 + (x1 - x0) * t;
    const my = y0 + (y1 - y0) * t;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.hypot(dx, dy) || 1;
    const half = ((m.len ?? 1) * cell) / 2;
    const nx = (-dy / d) * half;
    const ny = (dx / d) * half;
    ctx.strokeStyle = '#c8392f';
    ctx.lineWidth = Math.max(3, cell * 0.16);
    ctx.beginPath();
    ctx.moveTo(mx + nx, my + ny);
    ctx.lineTo(mx - nx, my - ny);
    ctx.stroke();
  }
  for (const t of level.features.pads) {
    const [ax, ay] = boardToPx(layout, level, t.a.x, t.a.z);
    const [bx, by] = boardToPx(layout, level, t.b.x, t.b.z);
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = '#1c8fa8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.restore();
    circle(ax, ay, cell * 0.26, '#49cbe4', '#0f6070');
    circle(bx, by, cell * 0.26, '#49cbe4', '#0f6070');
  }
  for (const g of level.features.gates) {
    for (const seg of g.segments) {
      const [ax, ay] = boardToPx(layout, level, seg.a[0], seg.a[1]);
      const [bx, by] = boardToPx(layout, level, seg.b[0], seg.b[1]);
      ctx.strokeStyle = '#c8392f';
      ctx.lineWidth = Math.max(3, cell * 0.18);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.fillStyle = '#c8392f';
      ctx.font = `${Math.max(9, cell * 0.3)}px ui-monospace, monospace`;
      ctx.fillText(g.id, Math.min(ax, bx), Math.min(ay, by) - 3);
    }
  }
  //  Lifts: a bar like a gate, but coloured by what the plate does to it (a lowering wall rests
  //  up and sinks, a raising wall rests flush and stands up), with a dashed link to its plate so
  //  the pairing is visible at a glance.
  for (const l of level.features.lifts ?? []) {
    const seg = l.segments[0];
    const [ax, ay] = boardToPx(layout, level, seg.a[0], seg.a[1]);
    const [bx, by] = boardToPx(layout, level, seg.b[0], seg.b[1]);
    const colour = l.mode === 'raise' ? '#d08327' : '#8a2f8f';
    const plate = level.features.plates.find((p) => p.id && p.id === l.plate);
    if (plate) {
      const [px, py] = boardToPx(layout, level, plate.x, plate.z);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo((ax + bx) / 2, (ay + by) / 2);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(4, cell * 0.2);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  for (const o of level.features.oneways) {
    for (const seg of o.segments) {
      const [ax, ay] = boardToPx(layout, level, seg.a[0], seg.a[1]);
      const [bx, by] = boardToPx(layout, level, seg.b[0], seg.b[1]);
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#7a4ec8';
      ctx.lineWidth = Math.max(3, cell * 0.16);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.restore();
    }
  }
  for (const p of level.features.plates) {
    const [x, y] = boardToPx(layout, level, p.x, p.z);
    circle(x, y, cell * 0.3, '#e7c152', '#8a6a10');
  }

  // Marbles and the goal. A multi-marble level draws one green disc per spawn, numbered so the
  // list on the right and the board name the same marble; the selected one gets a white ring.
  const spawns = level.spawns ?? [level.spawn];
  ctx.font = `bold ${Math.max(9, cell * 0.32)}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  spawns.forEach((s, i) => {
    const [sx, sy] = boardToPx(layout, level, s.x, s.z);
    circle(sx, sy, cell * 0.24, '#2e9e4f', '#0d4d20');
    if (selection?.list === '__spawn' && selection.index === i) {
      ctx.beginPath();
      ctx.arc(sx, sy, cell * 0.33, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.fillText(spawns.length > 1 ? String(i + 1) : 'S', sx, sy + 0.5);
  });
  const [gx, gy] = boardToPx(layout, level, level.goal.x, level.goal.z);
  circle(gx, gy, cell * 0.32, 'rgba(242,193,78,0.35)', '#f2c14e');
  circle(gx, gy, cell * 0.16, '#f2c14e', '#8a6a10');
  if (selection?.list === '__goal') {
    ctx.beginPath();
    ctx.arc(gx, gy, cell * 0.42, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Pending click for pair tools.
  if (pending) {
    const [x, y] = cellToPx(layout, level, pending[0], pending[1]);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
    ctx.setLineDash([]);
  }

  // Pit chain vertices, so a slot's centres can be seen and removed one at a time.
  if (pitTool && level.pits) {
    for (const pit of level.pits) {
      for (const [pc, pr] of pit.centers ?? []) {
        const [x, y] = cellSpaceToPx(layout, level, pc, pr);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.5, cell * 0.06), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fill();
      }
    }
  }

  // The plate being dragged out right now.
  if (plateDraft) {
    const [x, y, w, h] = plateBox(plateDraft);
    ctx.fillStyle = PLATE_TINT[plateDraft.mat] ?? 'rgba(255,255,255,0.35)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.max(9, cell * 0.28)}px ui-monospace, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${plateDraft.c0} ${plateDraft.r0} → ${plateDraft.c1} ${plateDraft.r1}`, x + 3, y + 2);
  }

  // Hover cell (the whole cell) and, when a sub-cell grid is in use, the exact position that
  // a click would land on.
  if (hover) {
    const [x, y] = cellToPx(layout, level, hover[0], hover[1]);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
  }
  if (at) {
    const [x, y] = cellSpaceToPx(layout, level, at[0], at[1]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    const s = Math.max(4, cell * 0.18);
    ctx.beginPath();
    ctx.moveTo(x - s, y);
    ctx.lineTo(x + s, y);
    ctx.moveTo(x, y - s);
    ctx.lineTo(x, y + s);
    ctx.stroke();
  }

  ctx.restore();
}
