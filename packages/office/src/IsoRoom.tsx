// SPDX-License-Identifier: Apache-2.0
// One iso floor plate: the slab, two low walls on its back edges with a gap for the
// door, every desk's art in painter's order (back to front), then the host-text
// overlays. A room is one plate on a desktop; on a phone, one plate per pair of desks.
import type { CSSProperties } from "react";
import { IsoDesk, IsoOverlay, isoGlyph } from "./IsoCell";
import { cellOrigin, faceU, faceV, type IsoLayout, PLATE_H, pt, pts, slotOrigin, top, WALL_H, walkPath } from "./iso";
import type { RoomCell } from "./Room";

const face = (points: string, cls: string) => <polygon points={points} className={cls} />;

export function IsoPlate({
  l,
  cells,
  empties,
  now,
  cursor,
  tally,
}: {
  l: IsoLayout;
  /** Cells with their slot relative to this plate. */
  cells: RoomCell[];
  empties: number[];
  now: number;
  cursor: number;
  tally?: number;
}) {
  const { U, V, door } = l;
  const byDepth = [...cells].sort((a, b) => {
    const oa = slotOrigin(a.slot, l.cols);
    const ob = slotOrigin(b.slot, l.cols);
    return oa.u + oa.v - (ob.u + ob.v) || oa.u - ob.u;
  });
  const doorAt = pt(door + 0.5, -0.9, WALL_H);
  const style = {
    "--room-w": `${l.w}px`,
    "--room-h": `${l.h}px`,
    "--door-x": `${l.origin.x + doorAt.x}px`,
    "--door-y": `${l.origin.y + doorAt.y}px`,
  } as CSSProperties;
  return (
    <div className="iso-box" style={style}>
      <svg className="iso-art" viewBox={`0 0 ${l.w} ${l.h}`} aria-hidden="true">
        <g transform={`translate(${l.origin.x} ${l.origin.y})`}>
          {/* the slab */}
          {face(faceU(U, 0, V, -PLATE_H, 0), "i-plate-side")}
          {face(faceV(0, U, V, -PLATE_H, 0), "i-plate-side")}
          {face(pts([pt(0, 0), pt(U, 0), pt(U, V), pt(0, V)]), "i-plate")}
          {/* the back-left wall (u = 0) and the back-right wall (v = 0) with the door gap */}
          {face(faceU(0, 0, V, 0, WALL_H), "i-wall-u")}
          {face(top(-0.12, 0, 0, V, WALL_H), "i-wall-top")}
          {face(faceV(0, door, 0, 0, WALL_H), "i-wall-v")}
          {face(faceU(door, -0.12, 0, 0, WALL_H), "i-wall-u")}
          {face(top(0, -0.12, door, 0, WALL_H), "i-wall-top")}
          {face(faceV(door + 1, U, 0, 0, WALL_H), "i-wall-v")}
          {face(top(door + 1, -0.12, U, 0, WALL_H), "i-wall-top")}
          {empties.map((slot) => {
            const o = slotOrigin(slot, l.cols);
            const p = pt(o.u, o.v);
            return (
              <g key={`empty-${slot}`} transform={`translate(${p.x} ${p.y})`}>
                <IsoDesk />
              </g>
            );
          })}
          {byDepth.map((c) => {
            const o = slotOrigin(c.slot, l.cols);
            const p = pt(o.u, o.v);
            return (
              <g key={c.s.key} transform={`translate(${p.x} ${p.y})`}>
                <IsoDesk
                  s={c.s}
                  p={c.p}
                  glyph={isoGlyph(c.s)}
                  slot={c.slot}
                  walk={c.walk && c.p.phase !== "seated" ? walkPath(l, c.slot) : undefined}
                />
              </g>
            );
          })}
        </g>
      </svg>
      {cells.map((c) => (
        <IsoOverlay
          key={c.s.key}
          s={c.s}
          p={c.p}
          at={cellOrigin(l, c.slot)}
          now={now}
          cursor={c.index === cursor ? cursor : undefined}
          helperCursor={(i) => (c.helperBase !== undefined && c.helperBase + i === cursor ? cursor : undefined)}
        />
      ))}
      {tally !== undefined && tally > 0 && (
        <span className="iso-home num" title={`${tally} session${tally === 1 ? "" : "s"} done today`}>
          {tally} home
        </span>
      )}
    </div>
  );
}
