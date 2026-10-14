// SPDX-License-Identifier: Apache-2.0
// The figures style's desk cell (160 × 128): desk, monitor, the person in their posture,
// the chair behind them, the side table with helpers, the nameplate. Also the pieces both
// styles share: positions (`CellPos`), the nameplate, the tooltip and the aria label.
import type { SessionSummary } from "@sessionpipe-gui/theme-types/api";
import type { CSSProperties } from "react";
import { sessionHref, useApi } from "./api";
import { Redacted, SessionLink } from "./bits";
import { ATTENTION_LABEL, durShort, harnessMark, modelShort, STATE_LABEL, since } from "./format";
import { CELL_H, CELL_W, FEET, HEAD } from "./parts";
import { cutLeft, derivePosture, type Look, type Posture, screenText } from "./posture";

/** The door's centre line in room coordinates (an 18 px gap at x = 16). */
export const DOOR_X = 16 + 9;
const TITLE_LINE = 26;

/** Where a cell sits in its room, and where its walker enters: all in logical px (the
 *  room's --o-scale multiplies on the way to the page). */
export interface CellPos {
  left: number;
  bottom: number;
  /** The door's x and the pod's aisle x, room coordinates. */
  doorX: number;
  aisleX: number;
  /** The front aisle's y, cell coordinates (below the cell's bottom edge). */
  aisleY: number;
}

/** The desk sits 8 px into its 150 px cell; the side table takes the room to its right. */
const DESK_X = 8;
const SIDE_SHIFT = 112 - 118 - DESK_X;

const plural = (n: number, word: string) => (n ? `${n} ${word}${n === 1 ? "" : "s"}` : "");
const lookClass = (l: Look) => `look-s${l.shirt % 3} look-k${l.skin}`;

export const cellLabel = (title: string, p: Posture) =>
  [title, STATE_LABEL[p.state], p.tool ?? (p.attention ? ATTENTION_LABEL[p.attention.kind] : "")]
    .filter(Boolean)
    .join(", ");

export interface CellProps {
  s: SessionSummary;
  p: Posture;
  slot: number;
  pos: CellPos;
  now: number;
  walk: boolean;
  cursor?: number;
  helperCursor?: (i: number) => number | undefined;
}

export function Cell({ s, p, slot, pos, now, walk, cursor, helperCursor }: CellProps) {
  const api = useApi();
  const title = api.format.title(s);
  const mark = harnessMark(s.harness);
  const dxDesk = DESK_X;
  const sideShift = SIDE_SHIFT;
  const feetX = pos.left + dxDesk + FEET.x;
  const style = {
    "--left": `${pos.left}px`,
    "--bottom": `${pos.bottom}px`,
    "--slot4": slot % 4,
    "--slot3": slot % 3,
    "--dx": `${pos.doorX - feetX}px`,
    "--dx2": `${pos.aisleX - feetX}px`,
    "--dy": `${pos.aisleY - FEET.y}px`,
    "--bx": `${dxDesk + FEET.x + 10}px`,
    "--by": "30px",
    "--hx": `${dxDesk + sideShift + 112}px`,
  } as CSSProperties;
  const classes = [
    "cell",
    "cell--figures",
    `cell--${p.state}`,
    `cell--${p.phase}`,
    walk ? "" : "cell--nowalk",
    p.typing ? "cell--typing" : "",
    lookClass(p.look),
  ]
    .filter(Boolean)
    .join(" ");
  const lead = p.helpers[0];
  return (
    <div className={classes} style={style} data-cursor={cursor !== undefined ? String(cursor) : undefined}>
      <SessionLink
        to={s.key}
        href={sessionHref(s.harness, s.id)}
        className="cell-link"
        aria-label={cellLabel(title, p)}
      >
        <svg className="cell-art" viewBox={`0 0 ${CELL_W} ${CELL_H}`} width={CELL_W} height={CELL_H} aria-hidden="true">
          <g transform={`translate(${dxDesk} 0)`}>
            <use href="#o-desk" />
            {p.phase === "gone" && <use href="#o-chair-in" className="cell-chair-in" />}
            <use href="#o-monitor" />
            <rect className={`cell-screen cell-screen--${p.screen}`} x="36" y="15" width="24" height="16" />
            {p.screen === "lit" && (
              <g className="cell-lines" clipPath="url(#o-screen-clip)">
                <rect x="38" y="18" width="14" height="1" />
                <rect x="38" y="22" width="9" height="1" />
                <rect x="38" y="26" width="11" height="1" />
                <rect x="38" y="30" width="13" height="1" />
              </g>
            )}
            {p.tool && p.screen === "lit" && (
              <text key={p.tool} className="cell-tool" x="48" y="25.5" textAnchor="middle">
                {screenText(p.tool)}
              </text>
            )}
            <text className="cell-mono" x="78" y="41" textAnchor="middle">
              {mark.glyph}
            </text>
            {p.state === "needs_you" && <use href="#o-lamp" className="cell-lamp cell-lamp--on" />}
            {Array.from({ length: p.errors }, (_, i) => (
              <use
                key={i === p.errors - 1 ? `top-${s.counts.toolErrors}` : i}
                href="#o-sheet"
                className={`cell-sheet ${i === p.errors - 1 ? "cell-sheet--top" : ""}`}
                x={2 + i}
                y={38 - i}
              />
            ))}
            {(p.helpers.length > 0 || p.hiddenHelpers > 0) && p.phase !== "gone" && (
              <g transform={`translate(${sideShift} 0)`}>
                {p.helpers.length > 0 && (
                  <>
                    <use href="#o-side" />
                    <rect
                      className={`cell-lid ${lead?.state === "working" ? "cell-lid--lit" : ""}`}
                      x="125"
                      y="31"
                      width="10"
                      height="6.5"
                    />
                  </>
                )}
                {p.hiddenHelpers > 0 && (
                  <text
                    className="cell-more"
                    x={p.helpers.length ? 151 : 94 - sideShift}
                    y={p.helpers.length ? 45 : 28}
                    textAnchor="end"
                  >
                    +{p.hiddenHelpers}
                  </text>
                )}
              </g>
            )}
            {p.phase !== "gone" && (
              <g className="seated">
                <Seated p={p} />
              </g>
            )}
            {(p.phase === "arriving" || p.phase === "leaving") && (
              <g transform={`translate(${FEET.x} ${FEET.y})`}>
                <g className="walker">
                  <Standing look={p.look} walking />
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
        p.helpers.map((c, i) => <Helper key={c.key} c={c} i={i} now={now} cursor={helperCursor?.(i)} />).reverse()}
    </div>
  );
}

/** The two-line floor label: title (wraps to two lines when long), else repo @ branch. */
export function Nameplate({ s, p }: { s: SessionSummary; p: Posture }) {
  const api = useApi();
  const title = api.format.title(s);
  const repo = api.format.repoBranch(s);
  const fits = title.length <= TITLE_LINE;
  return (
    <span className="cell-plate">
      <span className="plate-row">
        <span className={`plate-title ${fits ? "" : "plate-title--two"}`}>{title}</span>
        {p.elapsedMs !== undefined && p.phase === "seated" && (
          <span className="plate-elapsed num">{durShort(api, p.elapsedMs)}</span>
        )}
      </span>
      {fits && repo && <span className="plate-repo">{cutLeft(repo, 24)}</span>}
    </span>
  );
}

export function Tooltip({ s, p, now, helper }: { s: SessionSummary; p: Posture; now: number; helper?: boolean }) {
  const api = useApi();
  const mark = harnessMark(s.harness);
  const repo = api.format.repoBranch(s);
  return (
    <span className="cell-tip" role="tooltip">
      <b>{api.format.title(s)}</b>
      <span>
        {helper ? "subagent · " : ""}
        {mark.label}
        {s.model ? ` · ${modelShort(s.model)}` : ""}
      </span>
      <span>
        {STATE_LABEL[p.state]} · {since(api, s.stateSince, now)}
      </span>
      {s.currentTool && (
        <span>
          <code>{s.currentTool.tool}</code> · {since(api, s.currentTool.since, now)}
        </span>
      )}
      {p.attention && (
        <span className="cell-tip-attn">
          {ATTENTION_LABEL[p.attention.kind] ?? p.attention.kind}
          {p.attention.message ? (
            <>
              {" · "}
              <Redacted text={p.attention.message} />
            </>
          ) : null}
        </span>
      )}
      {repo && <span className="mono">{repo}</span>}
      <span className="num">
        {[
          plural(s.counts.turns, "turn"),
          plural(s.counts.tools, "tool"),
          plural(s.counts.toolErrors, "error"),
          plural(s.counts.filesChanged, "file"),
          plural(s.children, "subagent"),
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </span>
  );
}

function Head({ look }: { look: Look }) {
  return (
    <>
      <use href="#o-head" />
      <use href={`#o-hair-${look.hair}`} />
      {look.glasses && <use href="#o-glasses" />}
    </>
  );
}

/** The seated postures around HEAD, the chair back behind the torso. */
export function Seated({ p }: { p: Posture }) {
  const { look } = p;
  switch (p.state) {
    case "working":
      return (
        <g className="fig fig--in">
          <use href="#o-chair" />
          <g transform={`translate(${HEAD.x} ${HEAD.y + 2})`}>
            <use href="#o-torso" />
            <use href="#o-neck" />
            <Head look={look} />
            <g className="hands">
              <use href="#o-arm-key" />
            </g>
          </g>
        </g>
      );
    case "needs_you":
      return (
        <g className="fig fig--up">
          <use href="#o-chair" />
          <g className="stander" transform={`translate(${FEET.x + 24} ${FEET.y})`}>
            <Standing look={look} raised />
          </g>
        </g>
      );
    case "stale":
      return (
        <g className="fig fig--down">
          <use href="#o-chair" />
          <g transform={`translate(${HEAD.x} ${HEAD.y - 3})`}>
            <use href="#o-torso" transform="translate(0 -2) scale(1 1.4)" />
            <use href="#o-arms-desk" />
            <g className="head-down">
              <use href="#o-neck" transform="translate(0 -1)" />
              <Head look={look} />
            </g>
            <text className="cell-z" x="7" y="-8">
              z
            </text>
          </g>
        </g>
      );
    default:
      return (
        <g className="fig fig--back">
          <use href="#o-chair" />
          <g transform={`translate(${HEAD.x} ${HEAD.y - 2})`}>
            <use href="#o-torso" transform="scale(1 1.08)" />
            <use href="#o-neck" />
            <Head look={look} />
            <use href="#o-arm-mug" />
            <use href="#o-mug" className="cell-mug-hand" x="7" y="-6" />
          </g>
        </g>
      );
  }
}

/** A standing figure, feet at the origin: walking (two leg frames) or still, arm raised or down. */
export function Standing({ look, walking, raised }: { look: Look; walking?: boolean; raised?: boolean }) {
  return (
    <>
      {walking ? (
        <>
          <use href="#o-legs-a" className="legs-a" />
          <use href="#o-legs-b" className="legs-b" />
        </>
      ) : (
        <use href="#o-legs" />
      )}
      <use href="#o-stand" />
      {raised ? (
        <>
          <use href="#o-arm-down" />
          <g className="arm-raise">
            <use href="#o-arm-up" />
          </g>
        </>
      ) : (
        <use href="#o-arms-stand" />
      )}
      <g transform="translate(0 -22.5)">
        <Head look={look} />
      </g>
    </>
  );
}

/** A subagent at the side table: its own look, posture and link. */
export function Helper({ c, i, now, cursor }: { c: SessionSummary; i: number; now: number; cursor?: number }) {
  const api = useApi();
  const title = api.format.title(c);
  const p = derivePosture(c, undefined, now);
  const tool = c.state === "working" ? c.currentTool?.tool : undefined;
  const x = i === 0 ? 134 : 146;
  const y = i === 0 ? 54 : 49;
  return (
    <SessionLink
      to={c.key}
      href={sessionHref(c.harness, c.id)}
      className={`cell-helper cell-helper--${c.state} ${p.typing ? "cell--typing" : ""} ${lookClass(p.look)}`}
      aria-label={[`subagent ${title}`, STATE_LABEL[c.state], tool ?? ""].filter(Boolean).join(", ")}
      data-cursor={cursor !== undefined ? String(cursor) : undefined}
      style={{ "--i": i } as CSSProperties}
    >
      <svg className="helper-art" viewBox="112 24 48 56" width="48" height="56" aria-hidden="true">
        {c.state === "needs_you" ? (
          <g transform={`translate(${x + 14} ${y + 22}) scale(0.72)`}>
            <circle cx="14" cy="-30" r="1.6" className="helper-lamp" />
            <Standing look={p.look} raised />
          </g>
        ) : (
          <g transform={`translate(${x} ${y}) scale(0.72)`}>
            <use href="#o-stool" x="-5" y="16" />
            <SeatedSmall p={p} />
          </g>
        )}
      </svg>
      <Tooltip s={c} p={p} now={now} helper />
    </SessionLink>
  );
}

function SeatedSmall({ p }: { p: Posture }) {
  const { look } = p;
  if (p.state === "working")
    return (
      <g transform="translate(0 2)">
        <use href="#o-torso" />
        <use href="#o-neck" />
        <Head look={look} />
        <g className="hands">
          <use href="#o-arm-key" />
        </g>
      </g>
    );
  if (p.state === "stale")
    return (
      <g transform="translate(0 -3)">
        <use href="#o-torso" transform="translate(0 -2) scale(1 1.4)" />
        <use href="#o-arms-desk" />
        <use href="#o-neck" transform="translate(0 -1)" />
        <Head look={look} />
      </g>
    );
  return (
    <g transform="translate(0 -2)">
      <use href="#o-torso" transform="scale(1 1.08)" />
      <use href="#o-neck" />
      <Head look={look} />
    </g>
  );
}

export function EmptyDesk({ pos }: { pos: CellPos }) {
  const style = { "--left": `${pos.left}px`, "--bottom": `${pos.bottom}px` } as CSSProperties;
  return (
    <div className="cell cell--figures cell--empty" style={style} aria-hidden="true">
      <svg className="cell-art" viewBox={`0 0 ${CELL_W} ${CELL_H}`} width={CELL_W} height={CELL_H} aria-hidden="true">
        <g transform={`translate(${DESK_X} 0)`}>
          <use href="#o-desk" />
          <use href="#o-monitor" />
          <rect className="cell-screen cell-screen--off" x="36" y="15" width="24" height="16" />
          <use href="#o-chair" />
        </g>
      </svg>
    </div>
  );
}
