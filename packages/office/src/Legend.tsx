// SPDX-License-Identifier: Apache-2.0
// The legend behind `?`: the postures of the current style at reading size with
// STATE_HINT, then the marks, one line each. The page must read without it.
import type { SessionState } from "@sessionpipe-gui/theme-types/api";
import { STATE_HINT, STATE_LABEL } from "./format";
import { IsoDesk } from "./IsoCell";
import type { Posture } from "./posture";
import type { OfficeStyle } from "./style";
import { Seated } from "./Worker";

const LOOK = { shirt: 0, hair: 0, hairColour: 0, skin: 0, glasses: false };
const POSTURES: SessionState[] = ["working", "needs_you", "idle", "stale"];

const posture = (state: SessionState, gone = false): Posture => ({
  state,
  typing: false,
  screen: state === "working" ? "lit" : state === "needs_you" ? "dim" : "off",
  tool: state === "working" ? "Edit" : undefined,
  errors: 0,
  helpers: [],
  hiddenHelpers: 0,
  phase: gone ? "gone" : "seated",
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

/** The iso desk at 0.75×: the whole desk with its chair, 72 × 52. */
function IsoMini({ state }: { state: SessionState | "gone" }) {
  const p = posture(state === "gone" ? "idle" : state, state === "gone");
  return (
    <svg className="legend-art legend-art--iso" viewBox="-44 -34 96 70" width="72" height="52" aria-hidden="true">
      <IsoDesk p={p} glyph="Cl" />
    </svg>
  );
}

export function Legend({ open, onToggle, style }: { open: boolean; onToggle: () => void; style: OfficeStyle }) {
  const iso = style === "iso";
  const Mini = iso ? IsoMini : FigureMini;
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
                <b>gone home</b> the chair stays pushed in for a while after a session ends; the tally by the door
                counts the day.
              </span>
            </li>
            <li>
              <span className="legend-bubble">permission</span>
              <span>
                <b>bubble</b> over someone standing: the kind of attention; the full message is in the tooltip.
              </span>
            </li>
            {iso ? (
              <>
                <li>
                  <svg className="legend-art" viewBox="-16 -22 32 26" width="32" height="26" aria-hidden="true">
                    <use href="#i-table" />
                    <g transform="translate(-10 4) scale(0.6)">
                      <use href="#i-torso" />
                      <use href="#i-head" />
                    </g>
                  </svg>
                  <span>
                    <b>round table</b> a subagent sits here, half size, left of its parent's desk; two seats, then +n.
                  </span>
                </li>
                <li>
                  <span className="legend-mono">Cl</span>
                  <span>
                    <b>monogram</b> the harness, on the desk's front; the tool runs on a lit screen.
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
                    <b>lamp</b> amber only while someone needs you.
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
