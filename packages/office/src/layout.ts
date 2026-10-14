// SPDX-License-Identifier: Apache-2.0
// How a room lays out from the width it actually has (the theme root's measured width;
// the host narrows it when the split panel opens). Both styles pick a scale and a column
// count here; rows follow from the seat count, the page scrolls. Nothing reads the
// viewport.
import { COL, K, ROW } from "./iso";

/** Figures: a 150 × 120 cell at scale 1 with the nameplate inside it, 16 px between cells. */
export const FIG = { cell: 150, h: 120, gap: 16, pad: 12, rowGap: 24, top: 14, aisle: 12 };
const FIG_SCALES = [1.4, 1.25, 1] as const;

export interface FiguresFit {
  scale: number;
  cols: number;
}

/** The largest scale that still seats three abreast (or every desk, if fewer); columns
 *  from the width at that scale, never more than there are desks. */
export function figuresFit(width: number, desks: number): FiguresFit {
  const n = Math.max(2, desks);
  const want = Math.min(n, 3);
  let last: FiguresFit = { scale: 1, cols: 1 };
  for (const scale of FIG_SCALES) {
    const cols = Math.floor((width - 2 * FIG.pad + FIG.gap) / (FIG.cell * scale + FIG.gap));
    last = { scale, cols: Math.max(1, Math.min(cols, n)) };
    if (cols >= want) return last;
  }
  return last;
}

/** Real px: the room's width and the cell's left edge for a column. */
export const figuresRoomWidth = (f: FiguresFit, cols: number) =>
  2 * FIG.pad + cols * FIG.cell * f.scale + (cols - 1) * FIG.gap;
export const figuresCellLeft = (f: FiguresFit, col: number) => FIG.pad + col * (FIG.cell * f.scale + FIG.gap);

export type IsoFit = { mode: "plate"; scale: number; cols: number } | { mode: "list" };

/** The widest plate that fits: 1.25× before 1×, four columns before two, never more
 *  columns than half the desks; under 700 px (or when nothing fits) one desk per row
 *  with the nameplate beside it. */
export function isoFit(width: number, desks: number): IsoFit {
  if (width < 700) return { mode: "list" };
  const n = Math.max(2, desks);
  const maxCols = Math.max(2, Math.ceil(n / 2));
  for (const scale of [1.25, 1]) {
    for (const cols of [4, 3, 2]) {
      if (cols > maxCols) continue;
      const rows = Math.ceil(n / cols);
      const w = (cols * COL + rows * ROW + 1.5) * K * scale;
      if (w <= width) return { mode: "plate", scale, cols };
    }
  }
  return { mode: "list" };
}
