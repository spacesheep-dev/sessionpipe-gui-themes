// SPDX-License-Identifier: Apache-2.0
// One iso floor plate: the slab, two low walls on its back edges with a gap for the
// door, every desk's art in painter's order (back to front), then the host-text
// overlays. Under 700 px the room is a list instead: each desk on its own small tile
// with the nameplate beside it (IsoList).
import type { CSSProperties } from "react";
import { sessionHref, useApi } from "./api";
import { SessionLink } from "./bits";
import { ATTENTION_LABEL } from "./format";
import { IsoDesk, IsoHelperLink, IsoOverlay, isoGlyph } from "./IsoCell";
import { cellOrigin, faceU, faceV, type IsoLayout, PLATE_H, pt, pts, slotOrigin, top, WALL_H, walkPath } from "./iso";
import type { RoomCell } from "./Room";
import { cellLabel, Nameplate, Tooltip } from "./Worker";

const face = (points: string, cls: string) => <polygon points={points} className={cls} />;

/** A desk's place in the plate as CSS custom properties, so a reflow can transition. */
const slotStyle = (x: number, y: number) => ({ "--sx": `${x}px`, "--sy": `${y}px` }) as CSSProperties;

export function IsoPlate({
  l,
  cells,
  empties,
  now,
  cursor,
  tally,
}: {
  l: IsoLayout;
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
              <g key={`empty-${slot}`} className="i-slot" style={slotStyle(p.x, p.y)}>
                <IsoDesk />
              </g>
            );
          })}
          {byDepth.map((c) => {
            const o = slotOrigin(c.slot, l.cols);
            const p = pt(o.u, o.v);
            return (
              <g key={c.s.key} className="i-slot" style={slotStyle(p.x, p.y)}>
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

// ---------- the list ----------

/** The tile: a 4 × 3.2 cell slab with one desk at (1, 0.6); viewBox around it at scale 1. */
const TILE = { U: 4, V: 3.2, desk: pt(1, 0.6), view: "-66 -16 148 96", w: 148, h: 96 };
/** The desk's floor origin inside the tile's box, for the helper links. */
const TILE_DESK = { x: 66 + TILE.desk.x, y: 16 + TILE.desk.y };

function IsoTile({ cell }: { cell?: RoomCell }) {
  const { U, V, desk } = TILE;
  return (
    <svg className="ilist-art" viewBox={TILE.view} width={TILE.w} height={TILE.h} aria-hidden="true">
      {face(faceU(U, 0, V, -PLATE_H, 0), "i-plate-side")}
      {face(faceV(0, U, V, -PLATE_H, 0), "i-plate-side")}
      {face(pts([pt(0, 0), pt(U, 0), pt(U, V), pt(0, V)]), "i-plate")}
      <g transform={`translate(${desk.x} ${desk.y})`}>
        {cell ? <IsoDesk s={cell.s} p={cell.p} glyph={isoGlyph(cell.s)} slot={cell.slot} /> : <IsoDesk />}
      </g>
    </svg>
  );
}

export function IsoList({
  cells,
  empties,
  now,
  cursor,
  tally,
}: {
  cells: RoomCell[];
  empties: number[];
  now: number;
  cursor: number;
  tally?: number;
}) {
  const rows = [...cells].sort((a, b) => a.slot - b.slot);
  return (
    <div className="ilist">
      {rows.map((c) => (
        <IsoListRow key={c.s.key} c={c} now={now} cursor={cursor} />
      ))}
      {empties.map((i) => (
        <div key={`empty-${i}`} className="ilist-row" aria-hidden="true">
          <IsoTile />
        </div>
      ))}
      {tally !== undefined && tally > 0 && (
        <span className="ilist-home num" title={`${tally} session${tally === 1 ? "" : "s"} done today`}>
          {tally} home
        </span>
      )}
    </div>
  );
}

function IsoListRow({ c, now, cursor }: { c: RoomCell; now: number; cursor: number }) {
  const api = useApi();
  const title = api.format.title(c.s);
  const mine = c.index === cursor;
  return (
    <div className={`ilist-row cell--${c.p.state} cell--${c.p.phase}`} data-cursor={mine ? String(cursor) : undefined}>
      <SessionLink
        to={c.s.key}
        href={sessionHref(c.s.harness, c.s.id)}
        className="ilist-link"
        aria-label={cellLabel(title, c.p)}
      >
        <IsoTile cell={c} />
        <Nameplate s={c.s} p={c.p} />
      </SessionLink>
      {c.p.attention && (
        <span className="cell-bubble" key={c.p.attention.attentionId}>
          {ATTENTION_LABEL[c.p.attention.kind] ?? c.p.attention.kind}
        </span>
      )}
      <Tooltip s={c.s} p={c.p} now={now} />
      {c.p.phase !== "gone" &&
        c.p.helpers.map((h, i) => (
          <IsoHelperLink
            key={h.key}
            c={h}
            at={TILE_DESK}
            i={i}
            now={now}
            cursor={c.helperBase !== undefined && c.helperBase + i === cursor ? cursor : undefined}
          />
        ))}
    </div>
  );
}
