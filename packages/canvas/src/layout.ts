// SPDX-License-Identifier: Apache-2.0
// Pure layout math: where a new window goes, tidy columns, bounds. World units throughout.
import type { SessionState, SessionSummary } from "@sessionpipe-gui/theme-types/api";
import { GAP, type WinPos, type Zone } from "./types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: Rect, b: Rect, pad = GAP) =>
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

/** Subagents hang under their parent in rows no wider than it; returns the rows' height. */
export function hangKids(
  kids: SessionSummary[],
  parent: WinPos,
  pos: (key: string) => WinPos,
  out: Map<string, { x: number; y: number }>,
): number {
  let kx = 0;
  let ky = parent.h + 10;
  let rowH = 0;
  for (const c of kids) {
    const cp = pos(c.key);
    if (kx > 0 && kx + cp.w > parent.w) {
      kx = 0;
      ky += rowH + 10;
      rowH = 0;
    }
    out.set(c.key, { x: kx, y: ky });
    kx += cp.w + 10;
    rowH = Math.max(rowH, cp.h);
  }
  return kids.length ? ky + rowH - parent.h : 0;
}

export const STATE_ORDER: SessionState[] = ["needs_you", "working", "stale", "idle"];

/** Columns by state, top-aligned, each column as wide as its widest window. With
 *  `byMachine`, a block of columns per machine and the zones redrawn around the blocks. */
export function tidy(
  sessions: SessionSummary[],
  pos: (key: string) => WinPos,
  byMachine: boolean,
  stack = false,
): { windows: Map<string, { x: number; y: number }>; zones: Map<string, Zone> } {
  const windows = new Map<string, { x: number; y: number }>();
  const zones = new Map<string, Zone>();
  const parents = sessions.filter((s) => !s.parentId && s.state !== "done");
  const children = sessions.filter((s) => s.parentId && s.state !== "done");
  if (stack) {
    // Phones: one column, states in order, children under their parent.
    const order = [...parents].sort(
      (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || b.lastAt.localeCompare(a.lastAt),
    );
    let y = 0;
    for (const s of order) {
      const p = pos(s.key);
      windows.set(s.key, { x: 0, y });
      const kidH = hangKids(
        children.filter((c) => c.parentId === s.id),
        p,
        pos,
        windows,
      );
      y += p.h + kidH + GAP;
    }
    return { windows, zones };
  }
  const groups = new Map<string, SessionSummary[]>();
  for (const s of parents) {
    const g = byMachine ? (s.machine ?? "?") : "";
    const list = groups.get(g) ?? [];
    list.push(s);
    groups.set(g, list);
  }
  let x = 0;
  const ZPAD = 40;
  // A column holds at most `rows` windows, so many sessions spread sideways and Fit
  // stays readable: 4 up to 16 windows, then about the square root.
  const rows = Math.max(4, Math.ceil(Math.sqrt(parents.length * 0.9)));
  for (const [machine, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const x0 = x;
    let maxY = 0;
    for (const state of STATE_ORDER) {
      const col = list
        .filter((s) => s.state === state)
        .sort((a, b) => a.lastAt.localeCompare(b.lastAt))
        .reverse();
      if (!col.length) continue;
      let y = 0;
      let colW = 0;
      let n = 0;
      for (const s of col) {
        if (n === rows) {
          x += colW + GAP;
          y = 0;
          colW = 0;
          n = 0;
        }
        const p = pos(s.key);
        windows.set(s.key, { x, y });
        const kidH = hangKids(
          children.filter((c) => c.parentId === s.id),
          p,
          pos,
          windows,
        );
        y += p.h + kidH + GAP;
        colW = Math.max(colW, p.w);
        n++;
        maxY = Math.max(maxY, y);
      }
      x += colW + GAP;
    }
    if (byMachine) {
      zones.set(machine, { x: x0 - ZPAD, y: -ZPAD - 8, w: x - GAP - x0 + ZPAD * 2, h: maxY - GAP + ZPAD * 2 + 8 });
      x += ZPAD * 2 + GAP;
    }
  }
  return { windows, zones };
}
