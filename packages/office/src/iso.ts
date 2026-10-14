// SPDX-License-Identifier: Apache-2.0
// The iso style's geometry (DESIGN.md §14): a 2:1 isometric grid, one cell a diamond
// 2K wide and K tall. World coordinates are (u, v, h): u runs to the lower right of the
// screen, v to the lower left, h straight up. Everything here is in logical px at
// scale 1; the room's --o-scale multiplies on the way to the page.

/** Half a cell's screen width: a cell is 40 × 20. */
export const K = 20;
/** Pod columns along u are this many cells apart: 160 px, room for a 150 px nameplate. */
export const COL = 8;
/** Desks along v are this many cells apart: 60 px left and 30 px down per desk. */
export const ROW = 3;
export const MAX_COLS = 3;
/** The desk slab's height, the walls' height, the plate's thickness. */
export const DESK_H = 14;
export const WALL_H = 6;
export const PLATE_H = 6;
/** The nameplate under a desk: left-aligned to the desk's left corner, under its front edge. */
export const PLATE_W = 150;
export const LABEL = { x: -K, y: 1.5 * K + 8 };
/** The overlay link's box around one desk, in desk coordinates. */
export const HIT = { x: -30, y: -34, w: 160, h: 96 };
/** The hit polygon: the desk and its chair, then the nameplate; link-local points. */
export const HIT_POLY = "0,38 28,0 72,24 72,60 58,72 160,72 160,96 10,96";

export interface Pt {
  x: number;
  y: number;
}

/** World → screen, in px at scale 1. */
export const pt = (u: number, v: number, h = 0): Pt => ({ x: (u - v) * K, y: ((u + v) * K) / 2 - h });

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
export const pts = (list: Pt[]) => list.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ");

/** The top face of a box u0..u1 × v0..v1 at height h. */
export const top = (u0: number, v0: number, u1: number, v1: number, h: number) =>
  pts([pt(u0, v0, h), pt(u1, v0, h), pt(u1, v1, h), pt(u0, v1, h)]);
/** The face at v = const (facing the lower left), u0..u1 wide, h0..h1 tall. */
export const faceV = (u0: number, u1: number, v: number, h0: number, h1: number) =>
  pts([pt(u0, v, h0), pt(u1, v, h0), pt(u1, v, h1), pt(u0, v, h1)]);
/** The face at u = const (facing the lower right), v0..v1 deep, h0..h1 tall. */
export const faceU = (u: number, v0: number, v1: number, h0: number, h1: number) =>
  pts([pt(u, v0, h0), pt(u, v1, h0), pt(u, v1, h1), pt(u, v0, h1)]);

/** Text on a v-face follows the u axis: `matrix(1 0.5 0 1 x y)`, a skew down to the right. */

// ---------- the room ----------

export interface IsoLayout {
  cols: number;
  rows: number;
  /** Plate extent in cells. */
  U: number;
  V: number;
  /** Screen size of the whole drawing, and where world (0, 0, 0) sits in it. */
  w: number;
  h: number;
  origin: Pt;
  /** The door's u on the back-right wall (v = 0), one cell wide from here. */
  door: number;
}

/** Columns first across the back, then the next row toward the front. */
export const slotCell = (slot: number, cols: number) => ({ col: slot % cols, row: Math.floor(slot / cols) });

/** A desk's floor origin (its back-left corner) for a slot. */
export const slotOrigin = (slot: number, cols: number) => {
  const { col, row } = slotCell(slot, cols);
  return { u: 1 + col * COL, v: 1 + row * ROW };
};

/** The plate for `cols` × `rows` desk slots: one cell of margin at the back, the
 *  nameplates' footprint at the front. */
export function layout(cols: number, rows: number): IsoLayout {
  const U = cols * COL;
  const V = rows * ROW + 1.5;
  // the diamond spans x ∈ [-V·K, U·K] and y ∈ [0, (U+V)·K/2]; the walls rise above it,
  // the slab hangs below
  const origin = { x: V * K, y: WALL_H + 6 };
  return {
    cols,
    rows,
    U,
    V,
    w: (U + V) * K,
    h: origin.y + ((U + V) * K) / 2 + PLATE_H,
    origin,
    door: U - 2,
  };
}

/** A cell's screen origin in the plate's drawing. */
export const cellOrigin = (l: IsoLayout, slot: number): Pt => {
  const { u, v } = slotOrigin(slot, l.cols);
  const p = pt(u, v);
  return { x: l.origin.x + p.x, y: l.origin.y + p.y };
};

/** The walk: from just inside the door, along the back wall to the desk's column, then
 *  down the aisle to the chair. Returned as offsets from the seat, in px. */
export function walkPath(l: IsoLayout, slot: number): { door: Pt; corner: Pt } {
  const { u, v } = slotOrigin(slot, l.cols);
  const seat = pt(u + 1, v + 1.62);
  const door = pt(l.door + 0.5, 0.6);
  const corner = pt(u + 1, 0.6);
  return {
    door: { x: door.x - seat.x, y: door.y - seat.y },
    corner: { x: corner.x - seat.x, y: corner.y - seat.y },
  };
}
