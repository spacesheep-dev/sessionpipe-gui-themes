// SPDX-License-Identifier: Apache-2.0
// Pure layout math, world units throughout: where a new window goes, and the grid every
// preset view and Tidy lay windows out in (cells in rows inside labelled groups, groups
// packed as shelves).
import { COL_GAP, GROUP_GAP, HEAD_GAP, HEAD_H, type Rect, ROW_GAP, SHELF_MIN, WIN_W } from "./types";

const GAP_DEFAULT = 16;
const UNIT = WIN_W + COL_GAP;

export type { Rect };

export const overlaps = (a: Rect, b: Rect, pad = GAP_DEFAULT) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

export function bounds(rects: Iterable<Rect>): Rect | null {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const r of rects) {
    any = true;
    if (r.x < x0) x0 = r.x;
    if (r.y < y0) y0 = r.y;
    if (r.x + r.w > x1) x1 = r.x + r.w;
    if (r.y + r.h > y1) y1 = r.y + r.h;
  }
  return any ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** The nearest free spot to `centre` for a w×h box: a square spiral over a coarse grid,
 *  the first cell whose box touches nothing taken wins. Deterministic, O(cells × taken). */
export function findFree(centre: { x: number; y: number }, w: number, h: number, taken: Rect[], step = 40): Rect {
  const cx = Math.round((centre.x - w / 2) / step) * step;
  const cy = Math.round((centre.y - h / 2) / step) * step;
  const free = (x: number, y: number) => {
    const r = { x, y, w, h };
    for (const t of taken) if (overlaps(r, t)) return false;
    return true;
  };
  if (free(cx, cy)) return { x: cx, y: cy, w, h };
  for (let ring = 1; ring < 80; ring++) {
    // Walk the ring; prefer spots to the right and below (reads as a growing grid).
    const candidates: [number, number][] = [];
    for (let i = -ring; i <= ring; i++) {
      candidates.push([cx + ring * step, cy + i * step]);
      candidates.push([cx - ring * step, cy + i * step]);
      if (Math.abs(i) !== ring) {
        candidates.push([cx + i * step, cy + ring * step]);
        candidates.push([cx + i * step, cy - ring * step]);
      }
    }
    candidates.sort((a, b) => dist(a, cx, cy) - dist(b, cx, cy));
    for (const [x, y] of candidates) if (free(x, y)) return { x, y, w, h };
  }
  return { x: cx + 80 * step, y: cy, w, h };
}

const dist = (p: [number, number], x: number, y: number) => (p[0] - x) ** 2 + (p[1] - y) ** 2;

/** One thing in the grid: a window (1 column), or as many columns as it needs (an
 *  expanded window, a parent with its pills beside it). `h` is the cell's height (a tree
 *  cell: the taller of window and pills). */
export interface Cell {
  key: string;
  span: number;
  h: number;
}

/** The columns a thing `w` wide takes. */
export const spanOf = (w: number) => Math.max(1, Math.ceil((w + COL_GAP) / UNIT - 0.001));

export interface Group {
  id: string;
  cells: Cell[];
}

export interface GroupBox {
  id: string;
  /** Where the heading sits: the group's top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `cols = clamp(round(sqrt(units × 1.6)), 1, 6)`, a tree cell counting as 2. */
export const colsFor = (units: number) => Math.max(1, Math.min(6, Math.round(Math.sqrt(units * 1.6))));

/** Where each cell goes in a `cols`-wide grid: row-major in the given order, except that a
 *  hole a two-column cell leaves at a row's end is filled by the next one-column cell, so
 *  a row is never left half empty while a window waits below it. */
function place(cells: Cell[], cols: number): { cell: Cell; row: number; col: number }[] {
  const out: { cell: Cell; row: number; col: number }[] = [];
  const queue = [...cells];
  let row = 0;
  let col = 0;
  while (queue.length) {
    let i = queue.findIndex((c) => col + c.span <= cols);
    if (i < 0) {
      if (col === 0) i = 0;
      else {
        row++;
        col = 0;
        continue;
      }
    }
    const [c] = queue.splice(i, 1) as [Cell];
    out.push({ cell: c, row, col });
    col += c.span;
    if (col >= cols) {
      row++;
      col = 0;
    }
  }
  return out;
}

/** The empty slots a grid of `cols` leaves (the last row's too), for choosing a width. */
function waste(cells: Cell[], cols: number): number {
  const rows = new Map<number, number>();
  for (const p of place(cells, cols)) rows.set(p.row, (rows.get(p.row) ?? 0) + p.cell.span);
  let n = 0;
  for (const used of rows.values()) n += Math.max(0, cols - used);
  return n;
}

/** A group's width in columns: the square-ish one (colsFor), or one fewer when that fills
 *  its rows evenly (three windows and a tree read as 2 + 2, not 3 + 1). */
export function chooseCols(cells: Cell[]): number {
  const units = cells.reduce((n, c) => n + c.span, 0);
  const min = Math.max(1, ...cells.map((c) => c.span));
  const base = Math.max(colsFor(units), min);
  const fewer = base - 1;
  if (fewer >= min && waste(cells, fewer) < waste(cells, base)) return fewer;
  return base;
}

/** One group's cells from (ox, oy), `cols` columns wide; each row as tall as its tallest
 *  cell, or as `rowH` says (a shelf's shared rows, so neighbouring groups' rows line up). */
export function gridCells(
  cells: Cell[],
  cols: number,
  out: Map<string, { x: number; y: number }>,
  ox = 0,
  oy = 0,
  rowH?: number[],
): { w: number; h: number; rows: number[] } {
  const placed = place(cells, cols);
  const own: number[] = [];
  let maxUnits = 0;
  for (const p of placed) {
    own[p.row] = Math.max(own[p.row] ?? 0, p.cell.h);
    maxUnits = Math.max(maxUnits, p.col + p.cell.span);
  }
  const heights = own.map((h, r) => Math.max(h, rowH?.[r] ?? 0));
  const top: number[] = [];
  let y = 0;
  for (let r = 0; r < heights.length; r++) {
    top[r] = y;
    y += (heights[r] ?? 0) + ROW_GAP;
  }
  for (const p of placed) out.set(p.cell.key, { x: ox + p.col * UNIT, y: oy + (top[p.row] ?? 0) });
  const last = heights.length - 1;
  return {
    w: cells.length ? maxUnits * UNIT - COL_GAP : 0,
    h: cells.length ? (top[last] ?? 0) + (own[last] ?? 0) : 0,
    rows: own,
  };
}

/** The preset grid: each group under its heading, groups packed left to right as shelves
 *  while a shelf stays under the target width, then a new shelf 48 px below. In a shelf
 *  every group's headings share one line and their rows share their tops (the tallest
 *  window of a row sets it for the shelf), so the grid reads as one grid. `target` is the
 *  viewport width at the zoom where the tallest group fits (at least SHELF_MIN). `stack`
 *  (a phone) gives every group one column, one under another, its rows touching. */
export function gridLayout(
  groups: Group[],
  opts: { viewW: number; viewH: number; stack?: boolean; headings?: boolean },
): { cells: Map<string, { x: number; y: number }>; boxes: GroupBox[] } {
  const cells = new Map<string, { x: number; y: number }>();
  const boxes: GroupBox[] = [];
  const head = opts.headings === false ? 0 : HEAD_H + HEAD_GAP;
  if (opts.stack) {
    let y = 0;
    for (const g of groups) {
      const inner = new Map<string, { x: number; y: number }>();
      let gy = 0;
      // A phone's group is one inset table: its rows touch, a hairline between them.
      for (const c of g.cells) {
        inner.set(c.key, { x: 0, y: gy });
        gy += c.h;
      }
      for (const [k, p] of inner) cells.set(k, { x: p.x, y: y + head + p.y });
      const h = head + gy;
      boxes.push({ id: g.id, x: 0, y, w: WIN_W, h });
      y += h + GROUP_GAP - 16;
    }
    return { cells, boxes };
  }
  // Size each group first (its columns and its own rows), then pack.
  const sized = groups.map((g) => {
    const cols = chooseCols(g.cells);
    const { w, h, rows } = gridCells(g.cells, cols, new Map());
    return { g, cols, w, h: h + head, rows };
  });
  const tallest = Math.max(1, ...sized.map((s) => s.h));
  const kFit = Math.min(1, Math.max(0.25, (opts.viewH - 120) / tallest));
  const target = Math.max(SHELF_MIN, opts.viewW / kFit);
  const shelves: (typeof sized)[] = [];
  let x = 0;
  for (const s of sized) {
    if (!shelves.length || (x > 0 && x + s.w > target)) {
      shelves.push([]);
      x = 0;
    }
    shelves[shelves.length - 1]!.push(s);
    x += s.w + GROUP_GAP;
  }
  let y = 0;
  for (const shelf of shelves) {
    const rowH: number[] = [];
    for (const s of shelf)
      s.rows.forEach((h, r) => {
        rowH[r] = Math.max(rowH[r] ?? 0, h);
      });
    let gx = 0;
    let shelfH = 0;
    for (const s of shelf) {
      const inner = new Map<string, { x: number; y: number }>();
      const { h } = gridCells(s.g.cells, s.cols, inner, 0, 0, rowH);
      for (const [k, p] of inner) cells.set(k, { x: gx + p.x, y: y + head + p.y });
      boxes.push({ id: s.g.id, x: gx, y, w: s.w, h: h + head });
      gx += s.w + GROUP_GAP;
      shelfH = Math.max(shelfH, h + head);
    }
    y += shelfH + GROUP_GAP;
  }
  return { cells, boxes };
}
