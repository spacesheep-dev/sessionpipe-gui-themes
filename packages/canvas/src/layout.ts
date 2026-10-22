// SPDX-License-Identifier: Apache-2.0
// Pure layout math, world units throughout: where a new window goes, and the grid every
// preset view and Tidy lay windows out in (cells in rows inside labelled groups, groups
// packed as shelves).
import { COL_GAP, GROUP_GAP, HEAD_GAP, HEAD_H, type Rect, ROW_GAP, SHELF_MIN, WIN_W } from "./types";

const GAP_DEFAULT = 16;

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

/** One thing in the grid: a window (1 column) or a parent with its pills (a tree cell,
 *  2 columns). `h` is the cell's height (a tree cell: the taller of window and pills). */
export interface Cell {
  key: string;
  span: 1 | 2;
  h: number;
}

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

const UNIT = WIN_W + COL_GAP;

/** `cols = clamp(round(sqrt(units × 1.6)), 1, 6)`, a tree cell counting as 2. */
export const colsFor = (units: number) => Math.max(1, Math.min(6, Math.round(Math.sqrt(units * 1.6))));

/** One group's cells, row-major from (0, 0), `cols` columns wide (a tree cell that would
 *  overflow a row wraps to the next); each row as tall as its tallest cell. */
export function gridCells(
  cells: Cell[],
  cols: number,
  out: Map<string, { x: number; y: number }>,
  ox = 0,
  oy = 0,
): { w: number; h: number } {
  let col = 0;
  let y = 0;
  let rowH = 0;
  let maxUnits = 0;
  for (const c of cells) {
    if (col > 0 && col + c.span > cols) {
      y += rowH + ROW_GAP;
      col = 0;
      rowH = 0;
    }
    out.set(c.key, { x: ox + col * UNIT, y: oy + y });
    col += c.span;
    maxUnits = Math.max(maxUnits, col);
    rowH = Math.max(rowH, c.h);
  }
  return { w: cells.length ? maxUnits * UNIT - COL_GAP : 0, h: cells.length ? y + rowH : 0 };
}

/** The preset grid: each group under its heading, groups packed left to right as shelves
 *  while a shelf stays under the target width, then a new shelf 48 px below. `target` is
 *  the viewport width at the zoom where the tallest group fits (at least SHELF_MIN).
 *  `stack` (a phone) gives every group one column, one under another. */
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
      for (const c of g.cells) {
        inner.set(c.key, { x: 0, y: gy });
        gy += c.h + COL_GAP;
      }
      for (const [k, p] of inner) cells.set(k, { x: p.x, y: y + head + p.y });
      const h = head + Math.max(0, gy - COL_GAP);
      boxes.push({ id: g.id, x: 0, y, w: WIN_W, h });
      y += h + GROUP_GAP - 16;
    }
    return { cells, boxes };
  }
  // Size each group first, then pack.
  const sized = groups.map((g) => {
    const units = g.cells.reduce((n, c) => n + c.span, 0);
    const wide = g.cells.some((c) => c.span === 2);
    const cols = Math.max(colsFor(units), wide ? 2 : 1);
    const inner = new Map<string, { x: number; y: number }>();
    const { w, h } = gridCells(g.cells, cols, inner);
    return { g, inner, w, h: h + head };
  });
  const tallest = Math.max(1, ...sized.map((s) => s.h));
  const kFit = Math.min(1, Math.max(0.25, (opts.viewH - 120) / tallest));
  const target = Math.max(SHELF_MIN, opts.viewW / kFit);
  let x = 0;
  let y = 0;
  let shelfH = 0;
  for (const s of sized) {
    if (x > 0 && x + s.w > target) {
      x = 0;
      y += shelfH + GROUP_GAP;
      shelfH = 0;
    }
    for (const [k, p] of s.inner) cells.set(k, { x: x + p.x, y: y + head + p.y });
    boxes.push({ id: s.g.id, x, y, w: s.w, h: s.h });
    x += s.w + GROUP_GAP;
    shelfH = Math.max(shelfH, s.h);
  }
  return { cells, boxes };
}
