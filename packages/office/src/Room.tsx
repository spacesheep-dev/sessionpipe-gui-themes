// SPDX-License-Identifier: Apache-2.0
// A room is a machine: nameplate above, then the floor. In the iso style the floor is a
// plate with desks in columns and rows (slot 0 at the back-left; one plate per pair of
// desks on a phone). In the figures style it is pods of two desks in rows with a window
// band across the back wall and a door in the front wall (DESIGN.md §1, §14).
import type { MachineSummary, SessionSummary } from "@sessionpipe-gui/theme-types/api";
import type { CSSProperties } from "react";
import { NavLink } from "./bits";
import { harnessMark } from "./format";
import { IsoPlate } from "./IsoRoom";
import { layout } from "./iso";
import { CELL_H, CELL_W } from "./parts";
import type { HourBand, Posture } from "./posture";
import type { OfficeStyle } from "./style";
import { Cell, type CellPos, cellLeft, DOOR_X, EmptyDesk, PAD, POD_GAP } from "./Worker";

export interface RoomCell {
  s: SessionSummary;
  p: Posture;
  slot: number;
  walk: boolean;
  /** Keyboard order: this desk's index, and the first index of its helpers. */
  index?: number;
  helperBase?: number;
}

const FIG = { aisle: 12, rowGap: 24, top: 14 };

export function Room({
  name,
  machine,
  cells,
  perRow,
  rows,
  gone,
  band,
  now,
  narrow,
  style,
  cursor = -1,
}: {
  name: string;
  machine?: MachineSummary;
  cells: RoomCell[];
  /** Desks per row: pod columns in iso, two per pod in figures. */
  perRow: number;
  rows: number;
  gone: number;
  band: HourBand;
  now: number;
  narrow: boolean;
  style: OfficeStyle;
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

  if (style === "iso") {
    // a phone gets one plate per pair of desks (one column, two rows); a desktop one plate
    const plates: { l: ReturnType<typeof layout>; cells: RoomCell[]; empties: number[] }[] = [];
    if (narrow) {
      const count = Math.max(
        1,
        Math.ceil(Math.max(2, ...shown.map((c) => c.slot + 1), ...empties.map((e) => e + 1)) / 2),
      );
      for (let i = 0; i < count; i++) {
        plates.push({
          l: layout(1, 2),
          cells: shown.filter((c) => Math.floor(c.slot / 2) === i).map((c) => ({ ...c, slot: c.slot % 2 })),
          empties: empties.filter((e) => Math.floor(e / 2) === i).map((e) => e % 2),
        });
      }
    } else {
      plates.push({ l: layout(perRow, Math.max(rows, Math.ceil(2 / perRow))), cells: shown, empties });
    }
    return (
      <section className="room room--iso" aria-label={`${name}: ${cells.length} at desks`}>
        {plate}
        {plates.map((pl, i) => (
          <IsoPlate
            key={i}
            l={pl.l}
            cells={pl.cells}
            empties={pl.empties}
            now={now}
            cursor={cursor}
            tally={i === plates.length - 1 ? gone : undefined}
          />
        ))}
      </section>
    );
  }

  const posOf = (slot: number): CellPos => {
    const pod = Math.floor((slot % perRow) / 2);
    const side = (slot % 2) as 0 | 1;
    const row = Math.floor(slot / perRow);
    const bottom = FIG.aisle + row * (CELL_H + FIG.rowGap);
    return {
      side,
      left: cellLeft(pod, side),
      bottom,
      doorX: DOOR_X,
      aisleX: PAD + pod * (2 * CELL_W + POD_GAP) - 8,
      aisleY: CELL_H + bottom - FIG.aisle / 2,
    };
  };
  const pods = perRow / 2;
  const width = pods * 2 * CELL_W + (pods - 1) * POD_GAP + 2 * PAD;
  const floorH = FIG.top + rows * CELL_H + (rows - 1) * FIG.rowGap + FIG.aisle;

  return (
    <section
      className="room room--figures"
      style={{ "--room-w": `${width}px`, "--floor-h": `${floorH}px` } as CSSProperties}
      aria-label={`${name}: ${cells.length} at desks`}
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
