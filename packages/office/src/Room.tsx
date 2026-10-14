// SPDX-License-Identifier: Apache-2.0
// A room is a machine: nameplate above, pods of two desks in rows (slot 0 front-left), a
// door in the front wall with the "n home" tally beside it. The figures style adds a
// window band across the back wall; the plan style draws the room as lines on paper with
// a window line, a door arc, a small clock and a plant (DESIGN.md §1, §13).
import type { MachineSummary, SessionSummary } from "@sessionpipe-gui/theme-types/api";
import type { CSSProperties } from "react";
import { NavLink } from "./bits";
import { harnessMark } from "./format";
import { PLAN_CELL_H, PlanCell, PlanEmptyDesk } from "./PlanCell";
import { CELL_H, CELL_W } from "./parts";
import { clockAngles, type HourBand, type Posture } from "./posture";
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

interface Dims {
  cellH: number;
  aisle: number;
  rowGap: number;
  top: number;
}
const DIMS: Record<OfficeStyle, Dims> = {
  figures: { cellH: CELL_H, aisle: 12, rowGap: 24, top: 14 },
  plan: { cellH: PLAN_CELL_H, aisle: 20, rowGap: 16, top: 8 },
};

export function Room({
  name,
  machine,
  cells,
  pods,
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
  pods: number;
  rows: number;
  gone: number;
  band: HourBand;
  now: number;
  narrow: boolean;
  style: OfficeStyle;
  cursor?: number;
}) {
  const d = DIMS[style];
  const perRow = pods * 2;
  const capacity = perRow * rows;
  const shown = cells.filter((c) => c.slot < capacity);
  const hidden = cells.length - shown.length;
  const taken = new Set(shown.map((c) => c.slot));
  const empties: number[] = [];
  for (let i = 0; i < 2 && shown.length + empties.length < 2; i++) if (!taken.has(i)) empties.push(i);
  const posOf = (slot: number): CellPos => {
    const pod = Math.floor((slot % perRow) / 2);
    const side = (slot % 2) as 0 | 1;
    const row = Math.floor(slot / perRow);
    const bottom = d.aisle + row * (d.cellH + d.rowGap);
    return {
      side,
      left: cellLeft(pod, side),
      bottom,
      doorX: DOOR_X,
      aisleX: PAD + pod * (2 * CELL_W + POD_GAP) - 8,
      aisleY: d.cellH + bottom - d.aisle / 2,
    };
  };

  const pairs = machine
    ? Object.entries(machine.harnesses)
    : [...new Map(cells.map((c) => [c.s.harness, c.s.harnessVersion])).entries()];
  const online = machine?.control?.online === true;
  const clock = clockAngles(now);
  const width = pods * 2 * CELL_W + (pods - 1) * POD_GAP + 2 * PAD;
  const floorH = d.top + rows * d.cellH + (rows - 1) * d.rowGap + d.aisle;
  const plan = style === "plan";

  return (
    <section
      className={`room room--${style}`}
      style={{ "--room-w": `${width}px`, "--floor-h": `${floorH}px` } as CSSProperties}
      aria-label={`${name}: ${cells.length} at desks`}
    >
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
        {plan && narrow && <span className="room-clock-text num">{clock.text}</span>}
        {hidden > 0 && <span className="room-more">+{hidden} more</span>}
      </NavLink>
      <div className={`room-box room-box--${style} window--${band}`}>
        <span className="room-window" />
        {plan && !narrow && (
          <svg className="room-clock" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <use href="#o-clock" />
            <line x1="6" y1="6" x2="6" y2="3.6" transform={`rotate(${clock.hour} 6 6)`} className="clock-hand" />
            <line x1="6" y1="6" x2="6" y2="2.4" transform={`rotate(${clock.minute} 6 6)`} className="clock-hand" />
          </svg>
        )}
        <div className="room-floor">
          {shown.map((c) =>
            plan ? (
              <PlanCell
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
            ) : (
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
            ),
          )}
          {empties.map((i) =>
            plan ? (
              <PlanEmptyDesk key={`empty-${i}`} pos={posOf(i)} />
            ) : (
              <EmptyDesk key={`empty-${i}`} pos={posOf(i)} />
            ),
          )}
          {plan && <span className="room-plant" aria-hidden="true" />}
        </div>
        <span className="room-door" aria-hidden="true" />
        {plan && (
          <svg className="room-door-arc" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
            <path d="M18 18 A18 18 0 0 0 0 0" fill="none" stroke="var(--line-2)" strokeWidth="1" />
          </svg>
        )}
        {gone > 0 && (
          <span className="room-home num" title={`${gone} session${gone === 1 ? "" : "s"} done today`}>
            {gone} home
          </span>
        )}
      </div>
    </section>
  );
}
