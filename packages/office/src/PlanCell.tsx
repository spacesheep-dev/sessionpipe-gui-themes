// SPDX-License-Identifier: Apache-2.0
// The plan style (DESIGN.md §13): a floor plan. A desk is a rounded rectangle with a
// monitor line, a person is a head on a shoulder arc in one tone, and state is position
// plus one amber ring. Cells are 160 × 108 in desk coordinates (the desk at x = 0..112).
import type { SessionSummary } from "@sessionpipe-gui/theme-types/api";
import type { CSSProperties } from "react";
import { sessionHref, useApi } from "./api";
import { SessionLink } from "./bits";
import { ATTENTION_LABEL, harnessMark, STATE_LABEL } from "./format";
import { derivePosture, type Posture, screenText } from "./posture";
import { type CellPos, cellLabel, Nameplate, Tooltip } from "./Worker";

/** The plan desk is 112 wide: the left cell's desk sits at its right edge, the right cell's at its left. */
export const planDeskShift = (side: number) => (side === 0 ? 44 : 4);

export const PLAN_CELL_H = 108;
/** The seated person's head centre when pulled in, desk coordinates. */
export const PLAN_HEAD = { x: 56, y: 46 };
const PULL = 12;

export function PlanDefs() {
  return (
    <svg className="office-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <symbol id="pl-desk" overflow="visible">
          <rect
            x="0.5"
            y="4.5"
            width="111"
            height="39"
            rx="4"
            fill="var(--o-top)"
            stroke="var(--o-edge)"
            strokeWidth="1"
          />
        </symbol>
        {/* a person: 8 px head on a 16 × 8 shoulder arc (its lower half), around the head centre;
            the arc is placed separately so the typing shrug can move it alone */}
        <symbol id="pl-arc" overflow="visible">
          <path d="M-8 1 a8 4 0 0 0 16 0 z" fill="var(--pl-arc)" />
        </symbol>
        <symbol id="pl-head" overflow="visible">
          <circle cx="0" cy="0" r="4" fill="var(--pl-head)" />
        </symbol>
        <symbol id="pl-harc" overflow="visible">
          <path d="M-5 0.5 a5 2.5 0 0 0 10 0 z" fill="var(--pl-arc)" />
        </symbol>
        <symbol id="pl-hhead" overflow="visible">
          <circle cx="0" cy="0" r="2.5" fill="var(--pl-head)" />
        </symbol>
        <symbol id="pl-chair" overflow="visible">
          <rect x="0.5" y="0.5" width="15" height="15" rx="6" fill="none" stroke="var(--pl-chair)" strokeWidth="1" />
        </symbol>
        <symbol id="pl-sheet" overflow="visible">
          <rect
            x="0"
            y="0"
            width="6"
            height="4"
            rx="0.5"
            fill="var(--o-top)"
            stroke="var(--o-wood)"
            strokeWidth="0.8"
          />
        </symbol>
        <symbol id="pl-table" overflow="visible">
          <circle cx="0" cy="0" r="10" fill="var(--o-top)" stroke="var(--o-edge)" strokeWidth="1" />
        </symbol>
      </defs>
    </svg>
  );
}

export interface PlanCellProps {
  s: SessionSummary;
  p: Posture;
  slot: number;
  pos: CellPos;
  now: number;
  walk: boolean;
  cursor?: number;
  helperCursor?: (i: number) => number | undefined;
}

/** Where the person stands beside the desk: the outer aisle of its pod. */
const besideX = (side: 0 | 1) => (side === 0 ? -10 : 122);
const tableX = (side: 0 | 1) => (side === 0 ? -24 : 136);

export function PlanCell({ s, p, slot, pos, now, walk, cursor, helperCursor }: PlanCellProps) {
  const api = useApi();
  const title = api.format.title(s);
  const mark = harnessMark(s.harness);
  const dxDesk = planDeskShift(pos.side);
  const standX = besideX(pos.side);
  const style = {
    "--left": `${pos.left}px`,
    "--bottom": `${pos.bottom}px`,
    "--slot4": slot % 4,
    "--dx": `${pos.doorX - (pos.left + dxDesk + PLAN_HEAD.x)}px`,
    "--dx2": `${pos.aisleX - (pos.left + dxDesk + PLAN_HEAD.x)}px`,
    "--dy": `${pos.aisleY - PLAN_HEAD.y}px`,
    "--hue": mark.hue,
    "--bx": `${dxDesk + standX - 16}px`,
    "--by": "4px",
  } as CSSProperties;
  const pulled = p.state === "working" && p.phase === "seated";
  const chairY = 44 + (pulled ? 0 : PULL);
  const classes = [
    "cell",
    "cell--plan",
    `cell--${p.state}`,
    `cell--${p.phase}`,
    walk ? "" : "cell--nowalk",
    p.typing ? "cell--typing" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const lead = p.helpers[0];
  const seated = p.phase === "seated" && p.state !== "needs_you";
  return (
    <div className={classes} style={style} data-cursor={cursor !== undefined ? String(cursor) : undefined}>
      <SessionLink
        to={s.key}
        href={sessionHref(s.harness, s.id)}
        className="cell-link"
        aria-label={cellLabel(title, p)}
      >
        <svg
          className="cell-art"
          viewBox={`0 0 160 ${PLAN_CELL_H}`}
          width="160"
          height={PLAN_CELL_H}
          aria-hidden="true"
        >
          <g transform={`translate(${dxDesk} 0)`}>
            <use href="#pl-desk" />
            <rect className={`pl-line pl-line--${p.screen}`} x="10" y="8" width="28" height="2" />
            {p.tool && p.screen === "lit" && (
              <text key={p.tool} className="pl-tool" x="10" y="21">
                {screenText(p.tool)}
              </text>
            )}
            <text className="pl-mono" x="106" y="16" textAnchor="end">
              {mark.glyph}
            </text>
            <rect className="pl-mat" x="46" y="41" width="20" height="6" rx="1" />
            <circle cx="102" cy="24" r="2.5" fill="var(--o-wood)" />
            {Array.from({ length: p.errors }, (_, i) => (
              <use key={i === p.errors - 1 ? `top-${s.counts.toolErrors}` : i} href="#pl-sheet" x={4 + i} y={22 - i} />
            ))}
            {p.phase !== "gone" && (p.helpers.length > 0 || p.hiddenHelpers > 0) && (
              <g transform={`translate(${tableX(pos.side)} 24)`}>
                {p.helpers.length > 0 && (
                  <>
                    <use href="#pl-table" />
                    <rect
                      className={`pl-lid ${lead?.state === "working" ? "pl-lid--lit" : ""}`}
                      x="-5"
                      y="-1"
                      width="10"
                      height="2"
                    />
                  </>
                )}
                {p.hiddenHelpers > 0 && (
                  <text className="pl-more" x="0" y={p.helpers.length ? 3 : -4} textAnchor="middle">
                    +{p.hiddenHelpers}
                  </text>
                )}
              </g>
            )}
            {/* chair: pulled in while working, pushed back otherwise; outline only when gone */}
            <g className="pl-seat" style={{ "--pull": `${chairY - 44}px` } as CSSProperties}>
              <use href="#pl-chair" x="48" y="44" className={p.phase === "gone" ? "pl-chair--gone" : ""} />
              {seated && (
                <g
                  className={`pl-sitter ${p.state === "stale" ? "pl-sitter--stale" : ""}`}
                  transform={`translate(${PLAN_HEAD.x} ${pulled ? PLAN_HEAD.y : 50})`}
                >
                  <use href="#pl-arc" className="pl-arc" />
                  <use href="#pl-head" />
                  {p.state === "stale" && (
                    <text className="pl-z" x="8" y="2">
                      z
                    </text>
                  )}
                </g>
              )}
            </g>
            {p.phase === "seated" && p.state === "needs_you" && (
              <g className="pl-beside" transform={`translate(${standX} 24)`}>
                <circle className="pl-ring" cx="0" cy="0" r="7" />
                <use href="#pl-arc" className="pl-arc" />
                <use href="#pl-head" />
              </g>
            )}
            {(p.phase === "arriving" || p.phase === "leaving") && (
              <g transform={`translate(${PLAN_HEAD.x} ${PLAN_HEAD.y})`}>
                <g className="walker">
                  <use href="#pl-arc" className="pl-arc" />
                  <use href="#pl-head" />
                </g>
              </g>
            )}
          </g>
        </svg>
        {p.attention && (
          <span className="cell-bubble" key={p.attention.attentionId}>
            {ATTENTION_LABEL[p.attention.kind] ?? p.attention.kind}
          </span>
        )}
        <Nameplate s={s} p={p} />
        <Tooltip s={s} p={p} now={now} />
      </SessionLink>
      {p.phase !== "gone" &&
        p.helpers.map((c, i) => (
          <PlanHelper key={c.key} c={c} i={i} side={pos.side} now={now} cursor={helperCursor?.(i)} />
        ))}
    </div>
  );
}

/** A helper at the round table: the first at its top seat, the second at its bottom. */
export function PlanHelper({
  c,
  i,
  side,
  now,
  cursor,
}: {
  c: SessionSummary;
  i: number;
  side: 0 | 1;
  now: number;
  cursor?: number;
}) {
  const api = useApi();
  const title = api.format.title(c);
  const p = derivePosture(c, undefined, now);
  const tool = c.state === "working" ? c.currentTool?.tool : undefined;
  const cx = planDeskShift(side) + tableX(side);
  const cy = 24 + (i === 0 ? -14 : 14);
  const style = { "--hx": `${cx - 12}px`, "--hy": `${cy - 10}px` } as CSSProperties;
  return (
    <SessionLink
      to={c.key}
      href={sessionHref(c.harness, c.id)}
      className={`cell-helper cell-helper--plan cell-helper--${c.state} ${p.typing ? "cell--typing" : ""}`}
      aria-label={[`subagent ${title}`, STATE_LABEL[c.state], tool ?? ""].filter(Boolean).join(", ")}
      data-cursor={cursor !== undefined ? String(cursor) : undefined}
      style={style}
    >
      <svg className="helper-art" viewBox="-12 -10 24 20" width="24" height="20" aria-hidden="true">
        <g className={c.state === "stale" ? "pl-sitter--stale" : ""} transform={i === 0 ? "" : "scale(1 -1)"}>
          {c.state === "needs_you" && <circle className="pl-ring pl-ring--on" cx="0" cy="0" r="4.5" />}
          <use href="#pl-harc" className="pl-arc" />
          <use href="#pl-hhead" />
        </g>
      </svg>
      <Tooltip s={c} p={p} now={now} helper />
    </SessionLink>
  );
}

export function PlanEmptyDesk({ pos }: { pos: CellPos }) {
  const style = { "--left": `${pos.left}px`, "--bottom": `${pos.bottom}px` } as CSSProperties;
  return (
    <div className="cell cell--plan cell--empty" style={style} aria-hidden="true">
      <svg className="cell-art" viewBox={`0 0 160 ${PLAN_CELL_H}`} width="160" height={PLAN_CELL_H} aria-hidden="true">
        <g transform={`translate(${planDeskShift(pos.side)} 0)`}>
          <use href="#pl-desk" />
          <rect className="pl-line pl-line--off" x="10" y="8" width="28" height="2" />
          <use href="#pl-chair" x="48" y="56" />
        </g>
      </svg>
    </div>
  );
}
