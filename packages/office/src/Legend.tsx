// SPDX-License-Identifier: Apache-2.0
// The legend behind `?`: the postures of the current style at reading size with
// STATE_HINT, then the marks, one line each. The page must read without it.
import type { SessionState } from "@sessionpipe-gui/theme-types/api";
import type { CSSProperties } from "react";
import { STATE_HINT, STATE_LABEL } from "./format";
import type { Posture } from "./posture";
import type { OfficeStyle } from "./style";
import { Seated } from "./Worker";

const LOOK = { shirt: 0, hair: 0, hairColour: 0, skin: 0, glasses: false };
const POSTURES: SessionState[] = ["working", "needs_you", "idle", "stale"];

const posture = (state: SessionState): Posture => ({
  state,
  typing: false,
  screen: state === "working" ? "lit" : state === "needs_you" ? "dim" : "off",
  errors: 0,
  helpers: [],
  hiddenHelpers: 0,
  phase: "seated",
  look: LOOK,
});

function FigureMini({ state }: { state: SessionState | "gone" }) {
  const p = posture(state === "gone" ? "idle" : state);
  return (
    <svg
      className={`legend-art look-s0 look-k0 cell--${state}`}
      viewBox="0 2 96 70"
      width="33"
      height="24"
      aria-hidden="true"
    >
      <use href="#o-desk" />
      <use href="#o-monitor" />
      <rect className={`cell-screen cell-screen--${p.screen}`} x="36" y="15" width="24" height="16" />
      {state === "needs_you" && <use href="#o-lamp" />}
      {state === "gone" ? <use href="#o-chair-in" /> : <Seated p={p} />}
    </svg>
  );
}

/** The plan marks at 16 px: desk 56 × 20, head 4 px (half the cell's scale). */
function PlanMini({ state }: { state: SessionState | "gone" }) {
  const pulled = state === "working";
  const chairY = pulled ? 44 : 56;
  return (
    <svg
      className={`legend-art legend-art--plan cell--${state}`}
      viewBox="-16 2 144 76"
      width="54"
      height="29"
      aria-hidden="true"
    >
      <use href="#pl-desk" />
      <rect
        className={`pl-line pl-line--${pulled ? "lit" : state === "needs_you" ? "dim" : "off"}`}
        x="10"
        y="8"
        width="28"
        height="2"
      />
      <use href="#pl-chair" x="48" y={chairY} className={state === "gone" ? "pl-chair--gone" : ""} />
      {state !== "gone" && state !== "needs_you" && (
        <g
          className={state === "stale" ? "pl-sitter--stale" : ""}
          transform={`translate(56 ${pulled ? 46 : chairY + 6})`}
        >
          <use href="#pl-arc" />
          <use href="#pl-head" />
          {state === "stale" && (
            <text className="pl-z" x="8" y="2">
              z
            </text>
          )}
        </g>
      )}
      {state === "needs_you" && (
        <g transform="translate(122 24)">
          <circle className="pl-ring pl-ring--on" cx="0" cy="0" r="7" />
          <use href="#pl-arc" />
          <use href="#pl-head" />
        </g>
      )}
    </svg>
  );
}

export function Legend({ open, onToggle, style }: { open: boolean; onToggle: () => void; style: OfficeStyle }) {
  const plan = style === "plan";
  const Mini = plan ? PlanMini : FigureMini;
  return (
    <>
      <button
        type="button"
        className="legend-btn"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="office-legend"
        title="Legend (?)"
      >
        ?
      </button>
      {open && (
        <div className="legend" id="office-legend" role="dialog" aria-label="Legend">
          <div className="legend-head">
            <span>How to read the office</span>
            <button type="button" className="legend-close" onClick={onToggle} data-dismiss aria-label="Close legend">
              ×
            </button>
          </div>
          <ul className="legend-list">
            {POSTURES.map((st) => (
              <li key={st}>
                <Mini state={st} />
                <span>
                  <b>{STATE_LABEL[st]}</b> {STATE_HINT[st]}
                </span>
              </li>
            ))}
            <li>
              <Mini state="gone" />
              <span>
                <b>gone home</b> the chair stays {plan ? "as an outline" : "pushed in"} for a while after a session
                ends; the tally by the door counts the day.
              </span>
            </li>
            {plan ? (
              <>
                <li>
                  <svg className="legend-art" viewBox="-9 -9 18 18" width="18" height="18" aria-hidden="true">
                    <circle className="pl-ring pl-ring--on" cx="0" cy="0" r="7" />
                    <use href="#pl-head" />
                  </svg>
                  <span>
                    <b>ring</b> amber only around someone who needs you; the bubble names what for.
                  </span>
                </li>
                <li>
                  <span className="legend-bubble">permission</span>
                  <span>
                    <b>bubble</b> the kind of attention; the full message is in the tooltip.
                  </span>
                </li>
                <li>
                  <svg className="legend-art" viewBox="44 40 24 8" width="24" height="8" aria-hidden="true">
                    <rect
                      className="pl-mat"
                      x="46"
                      y="41"
                      width="20"
                      height="6"
                      rx="1"
                      style={{ "--hue": 40 } as CSSProperties}
                    />
                  </svg>
                  <span>
                    <b>mat</b> the mat's hue and the corner monogram are the harness.
                  </span>
                </li>
                <li>
                  <svg className="legend-art" viewBox="-11 -11 22 22" width="22" height="22" aria-hidden="true">
                    <use href="#pl-table" />
                    <rect className="pl-lid pl-lid--lit" x="-5" y="-1" width="10" height="2" />
                  </svg>
                  <span>
                    <b>round table</b> subagents sit here with a laptop line, lit while one works; two seats, then +n.
                  </span>
                </li>
                <li>
                  <svg className="legend-art" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
                    <path d="M18 18 A18 18 0 0 0 0 0" fill="none" stroke="var(--line-2)" strokeWidth="1" />
                    <path d="M0 18 h18" stroke="var(--line-2)" strokeWidth="1" />
                  </svg>
                  <span>
                    <b>door</b> front-left, with its swing; people walk in and out here.
                  </span>
                </li>
                <li>
                  <span className="legend-line" />
                  <span>
                    <b>window</b> the line in the back wall, tinted by your hour; the clock is your local time.
                  </span>
                </li>
                <li>
                  <span className="legend-plant" />
                  <span>
                    <b>plant</b> one per room, so the room reads as a room.
                  </span>
                </li>
              </>
            ) : (
              <>
                <li>
                  <svg className="legend-art" viewBox="58 2 18 10" width="27" height="15" aria-hidden="true">
                    <use href="#o-lamp" />
                  </svg>
                  <span>
                    <b>lamp</b> amber only while someone needs you; the bubble names what for.
                  </span>
                </li>
                <li>
                  <span className="legend-bubble">permission</span>
                  <span>
                    <b>bubble</b> the kind of attention; the full message is in the tooltip.
                  </span>
                </li>
                <li>
                  <svg className="legend-art" viewBox="116 28 40 24" width="30" height="18" aria-hidden="true">
                    <use href="#o-side" />
                    <rect className="cell-lid cell-lid--lit" x="125" y="31" width="10" height="6.5" />
                  </svg>
                  <span>
                    <b>side table</b> a subagent works here on a laptop; two at most, then +n.
                  </span>
                </li>
                <li>
                  <svg className="legend-art" viewBox="-1 -1 9 8" width="14" height="13" aria-hidden="true">
                    <use href="#o-mug" />
                  </svg>
                  <span>
                    <b>mug</b> in the hand of someone idle.
                  </span>
                </li>
                <li>
                  <svg className="legend-art" viewBox="0 33 10 10" width="16" height="16" aria-hidden="true">
                    <use href="#o-sheet" x="2" y="38" />
                    <use href="#o-sheet" x="3" y="37" />
                  </svg>
                  <span>
                    <b>sheets</b> tool errors on the desk corner: one for 1–2, two for 3–5, three for more.
                  </span>
                </li>
                <li>
                  <span className="legend-mono">Cl</span>
                  <span>
                    <b>monogram</b> the harness, under the monitor.
                  </span>
                </li>
              </>
            )}
            <li>
              <span className="legend-num num">2m10s</span>
              <span>
                <b>elapsed</b> beside the title: a tool past a minute, or how long a desk has been stale.
              </span>
            </li>
          </ul>
        </div>
      )}
    </>
  );
}
