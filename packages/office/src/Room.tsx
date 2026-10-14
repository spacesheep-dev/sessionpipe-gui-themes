// SPDX-License-Identifier: Apache-2.0
// A room is a machine: nameplate above, then the floor, laid out from the width the room
// was given (layout.ts). Iso: a plate with desks in columns and rows (slot 0 at the
// back-left), or under 700 px a list of desks with their nameplates beside them. Figures:
// 150 px cells in rows with a window band across the back wall and a door in the front
// wall (DESIGN.md §1, §14). Slots are stable, so a reflow only moves desks.
import type { MachineSummary, SessionSummary } from "@sessionpipe-gui/theme-types/api";
import type { CSSProperties } from "react";
import { NavLink } from "./bits";
import { harnessMark } from "./format";
import { IsoList, IsoPlate } from "./IsoRoom";
import { layout } from "./iso";
import { FIG, type FiguresFit, figuresCellLeft, figuresRoomWidth, type IsoFit } from "./layout";
import { CELL_H } from "./parts";
import type { HourBand, Posture } from "./posture";
import { Cell, type CellPos, DOOR_X, EmptyDesk } from "./Worker";

export interface RoomCell {
  s: SessionSummary;
  p: Posture;
  slot: number;
  walk: boolean;
  /** Keyboard order: this desk's index, and the first index of its helpers. */
  index?: number;
  helperBase?: number;
}

export type RoomFit = { kind: "iso"; fit: IsoFit } | { kind: "figures"; fit: FiguresFit };

export function Room({
  name,
  machine,
  cells,
  perRow,
  rows,
  gone,
  band,
  now,
  fit,
  cursor = -1,
}: {
  name: string;
  machine?: MachineSummary;
  cells: RoomCell[];
  /** Desks per row, from the width (layout.ts). */
  perRow: number;
  rows: number;
  gone: number;
  band: HourBand;
  now: number;
  fit: RoomFit;
  cursor?: number;
}) {
  const capacity = perRow * rows;
  const shown = cells.filter((c) => c.slot < capacity);
  const hidden = cells.length - shown.length;
  const taken = new Set(shown.map((c) => c.slot));
  const empties: number[] = [];
  for (let i = 0; i < 2 && shown.length + empties.length < 2; i++) if (!taken.has(i)) empties.push(i);

  const pairs = machine
    ? Object.entries(machine.harnesses)
    : [...new Map(cells.map((c) => [c.s.harness, c.s.harnessVersion])).entries()];
  const online = machine?.control?.online === true;

  const plate = (
    <NavLink to="/machines" className="room-plate">
      <span className="room-name">{name}</span>
      {pairs.map(([h, v]) => (
        <span key={h} className="room-pair">
          <b>{harnessMark(h).glyph}</b> {v ?? ""}
        </span>
      ))}
      <span
        className={`room-dot ${online ? "room-dot--on" : ""}`}
        role="img"
        aria-label={machine?.control ? (online ? "control online" : "control offline") : "no control daemon"}
      />
      {hidden > 0 && <span className="room-more">+{hidden} more</span>}
    </NavLink>
  );
  const label = `${name}: ${cells.length} at desks`;

  if (fit.kind === "iso") {
    if (fit.fit.mode === "list")
      return (
        <section className="room room--iso room--list" aria-label={label}>
          {plate}
          <IsoList cells={shown} empties={empties} now={now} cursor={cursor} tally={gone} />
        </section>
      );
    const l = layout(perRow, Math.max(rows, Math.ceil(2 / perRow)));
    return (
      <section className="room room--iso" style={{ "--o-scale": fit.fit.scale } as CSSProperties} aria-label={label}>
        {plate}
        <IsoPlate l={l} cells={shown} empties={empties} now={now} cursor={cursor} tally={gone} />
      </section>
    );
  }

  // figures: uniform cells; positions in logical px, the CSS multiplies by --o-scale
  const f = fit.fit;
  // the back row fills first, so a partial row is the front one
  const posOf = (slot: number): CellPos => {
    const col = slot % perRow;
    const row = Math.floor(slot / perRow);
    const left = figuresCellLeft(f, col) / f.scale;
    const bottom = FIG.aisle + (rows - 1 - row) * (CELL_H + FIG.rowGap);
    return { left, bottom, doorX: DOOR_X, aisleX: left - 8, aisleY: CELL_H + bottom - FIG.aisle / 2 };
  };
  const colsUsed = Math.min(
    perRow,
    Math.max(2, Math.max(0, ...shown.map((c) => c.slot + 1), ...empties.map((e) => e + 1))),
  );
  const width = figuresRoomWidth(f, colsUsed);
  const floorH = FIG.top + rows * CELL_H + (rows - 1) * FIG.rowGap + FIG.aisle;

  return (
    <section
      className="room room--figures"
      style={{ "--room-w": `${width}px`, "--floor-h": `${floorH}px`, "--o-scale": f.scale } as CSSProperties}
      aria-label={label}
    >
      {plate}
      <div className={`room-box room-box--figures window--${band}`}>
        <span className="room-window" />
        <div className="room-floor">
          {shown.map((c) => (
            <Cell
              key={c.s.key}
              s={c.s}
              p={c.p}
              slot={c.slot}
              pos={posOf(c.slot)}
              now={now}
              walk={c.walk}
              cursor={c.index === cursor ? cursor : undefined}
              helperCursor={(i) => (c.helperBase !== undefined && c.helperBase + i === cursor ? cursor : undefined)}
            />
          ))}
          {empties.map((i) => (
            <EmptyDesk key={`empty-${i}`} pos={posOf(i)} />
          ))}
        </div>
        <span className="room-door" aria-hidden="true" />
        {gone > 0 && (
          <span className="room-home num" title={`${gone} session${gone === 1 ? "" : "s"} done today`}>
            {gone} home
          </span>
        )}
      </div>
    </section>
  );
}
