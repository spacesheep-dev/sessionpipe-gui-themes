// SPDX-License-Identifier: Apache-2.0
// The iso style (DESIGN.md §14): a desk is a two-tone box with a monitor on its back
// edge, a person is a capsule and a sphere in one neutral tone, and posture is the
// state. The art of a whole room is one SVG (IsoRoom.tsx); this file draws one desk
// into it (`IsoDesk`, a <g> in desk coordinates: the desk's back-left floor corner at the
// origin) and lays the host-text overlay over it (`IsoOverlay`: link, nameplate,
// bubble, tooltip). Parts are <symbol>s placed with <use>.
import type { SessionSummary } from "@sessionpipe-gui/theme-types/api";
import type { CSSProperties } from "react";
import { sessionHref, useApi } from "./api";
import { SessionLink } from "./bits";
import { ATTENTION_LABEL, harnessMark, STATE_LABEL } from "./format";
import { faceU, faceV, HIT, HIT_POLY, type Pt, pt, top } from "./iso";
import { derivePosture, type Posture, screenText } from "./posture";
import { cellLabel, Nameplate, Tooltip } from "./Worker";

/** Where the chair stands in front of the desk, and the helper's table at its left. */
const SEAT = pt(1, 1.62);
const STAND = pt(1.75, 1.45);
const TABLE = pt(-0.75, 0.55);
const HELPER = [pt(-0.75, 1.15), pt(-1.35, 0.55)];
const POOL = pt(1, 0.2, 14);

/** Tones are presentation attributes reading the room's custom properties: a <use>'s
 *  shadow tree inherits those, while the page's class rules do not reach it. */
type Tone = "top" | "side" | "side2" | "key" | "chair-top" | "chair-side";
const face = (points: string, tone: Tone, edge = true) => (
  <polygon
    points={points}
    fill={`var(--o-${tone})`}
    stroke={edge ? "var(--o-edge)" : "none"}
    strokeWidth="1"
    strokeLinejoin="round"
    vectorEffect="non-scaling-stroke"
  />
);

export function IsoDefs() {
  return (
    <svg className="office-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {/* the desk: a 2 × 1 box, 14 tall, with a keyboard sliver on top */}
        <symbol id="i-desk" overflow="visible">
          {face(faceU(2, 0, 1, 0, 14), "side2")}
          {face(faceV(0, 2, 1, 0, 14), "side")}
          {face(top(0, 0, 2, 1, 14), "top")}
          {face(top(0.74, 0.52, 1.26, 0.7, 14), "key", false)}
        </symbol>
        {/* the monitor's body on the back edge; the screen face is drawn per desk */}
        <symbol id="i-monitor" overflow="visible">
          {face(top(0.9, 0.08, 1.1, 0.24, 14), "side", false)}
          {face(faceV(0.95, 1.05, 0.2, 14, 16.5), "side", false)}
          {face(faceU(1.7, 0.06, 0.2, 16, 28), "side2")}
          {face(top(0.3, 0.06, 1.7, 0.2, 28), "top")}
        </symbol>
        {/* the chair in two halves, the person sits between them; floor centre at the origin */}
        <symbol id="i-chair-seat" overflow="visible">
          <ellipse cx="0" cy="0" rx="4.5" ry="2.25" fill="var(--o-chair-side)" />
          {face(faceV(-0.05, 0.05, 0.05, 0, 5.5), "chair-side", false)}
          {face(faceU(0.17, -0.15, 0.17, 5.5, 7.5), "chair-side", false)}
          {face(faceV(-0.17, 0.17, 0.17, 5.5, 7.5), "chair-side", false)}
          {face(top(-0.17, -0.15, 0.17, 0.17, 7.5), "chair-top", false)}
        </symbol>
        <symbol id="i-chair-back" overflow="visible">
          {face(faceU(0.17, 0.12, 0.2, 7.5, 12.5), "chair-side", false)}
          {face(faceV(-0.17, 0.17, 0.2, 7.5, 12.5), "chair-side", false)}
          {face(top(-0.17, 0.12, 0.17, 0.2, 12.5), "chair-top", false)}
        </symbol>
        {/* the person: a capsule and a sphere, feet (or seat) at the origin */}
        <symbol id="i-torso" overflow="visible">
          <rect x="-3.5" y="-17.5" width="7" height="12" rx="3.5" fill="var(--o-body)" />
        </symbol>
        <symbol id="i-head" overflow="visible">
          <circle cx="0" cy="-21" r="3.5" fill="var(--o-head)" />
        </symbol>
        <symbol id="i-stand" overflow="visible">
          <line x1="-1.8" y1="-10" x2="-1.8" y2="-0.5" stroke="var(--o-body)" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="1.8" y1="-10" x2="1.8" y2="-0.5" stroke="var(--o-body)" strokeWidth="2.4" strokeLinecap="round" />
          <rect x="-3.5" y="-22" width="7" height="13" rx="3.5" fill="var(--o-body)" />
          <circle cx="0" cy="-25.5" r="3.5" fill="var(--o-head)" />
        </symbol>
        <symbol id="i-arm-up" overflow="visible">
          <line x1="3" y1="-19" x2="7.5" y2="-27.5" stroke="var(--o-body)" strokeWidth="2.4" strokeLinecap="round" />
        </symbol>
        <symbol id="i-shadow" overflow="visible">
          <ellipse cx="0" cy="0" rx="8" ry="4" fill="var(--o-shadow)" />
        </symbol>
        {/* the helpers' round table: a cylinder r 0.4 cells, 10 tall */}
        <symbol id="i-table" overflow="visible">
          <path
            d="M-11.3 -10 V0 A11.3 5.66 0 0 0 11.3 0 V-10"
            fill="var(--o-side)"
            stroke="var(--o-edge)"
            vectorEffect="non-scaling-stroke"
          />
          <ellipse
            cx="0"
            cy="-10"
            rx="11.3"
            ry="5.66"
            fill="var(--o-top)"
            stroke="var(--o-edge)"
            vectorEffect="non-scaling-stroke"
          />
        </symbol>
      </defs>
    </svg>
  );
}

const SCREEN_FACE = faceV(0.3, 1.7, 0.2, 16, 28);
const SCREEN_ORIGIN = pt(0.3, 0.2, 16);
const FRONT_FACE_ORIGIN = pt(1.42, 1, 0);

/** The posture classes move the seat group (chair and person) and the head. */
const seatClass = (p: Posture) => {
  if (p.phase === "gone") return "i-seat i-seat--gone";
  switch (p.state) {
    case "working":
      return "i-seat i-seat--in";
    case "stale":
      return "i-seat i-seat--back i-seat--stale";
    case "idle":
      return "i-seat i-seat--back";
    default:
      return "i-seat";
  }
};

/** One desk's art, in desk coordinates. `p` undefined draws an empty desk. */
export function IsoDesk({
  s,
  p,
  glyph,
  slot = 0,
  walk,
}: {
  s?: SessionSummary;
  p?: Posture;
  glyph?: string;
  slot?: number;
  walk?: { door: Pt; corner: Pt };
}) {
  const seated = p && p.phase !== "gone" && p.state !== "needs_you";
  const standing = p?.phase === "seated" && p.state === "needs_you";
  const lit = p?.screen === "lit";
  const walking = p && (p.phase === "arriving" || p.phase === "leaving");
  const style = walk
    ? ({
        "--wx": `${walk.door.x}px`,
        "--wy": `${walk.door.y}px`,
        "--ax": `${walk.corner.x}px`,
        "--ay": `${walk.corner.y}px`,
        "--slot4": slot % 4,
      } as CSSProperties)
    : ({ "--slot4": slot % 4 } as CSSProperties);
  return (
    <g
      className={`i-desk ${p ? `i-desk--${p.state} i-desk--${p.phase}` : "i-desk--empty"} ${walking && !walk ? "i-desk--nowalk" : ""}`}
      style={style}
    >
      <use href="#i-desk" />
      {p && glyph && (
        <text
          className="i-mono"
          transform={`matrix(1 0.5 0 1 ${FRONT_FACE_ORIGIN.x} ${FRONT_FACE_ORIGIN.y})`}
          x="0"
          y="-4"
        >
          {glyph}
        </text>
      )}
      <use href="#i-monitor" />
      <polygon points={SCREEN_FACE} className={`i-screen ${lit ? "i-screen--lit" : ""}`} />
      {lit && p?.tool && (
        <text
          key={p.tool}
          className="i-tool"
          transform={`matrix(1 0.5 0 1 ${SCREEN_ORIGIN.x} ${SCREEN_ORIGIN.y})`}
          x="2.5"
          y="-3.5"
        >
          {screenText(p.tool, 5)}
        </text>
      )}
      {standing && <ellipse className="i-pool" cx={POOL.x} cy={POOL.y} rx="38" ry="19" />}
      {/* the chair and whoever sits in it move together between postures; the posture
          transform is CSS, so it sits inside the placing transform */}
      <g transform={`translate(${SEAT.x} ${SEAT.y})`}>
        <g className={p ? seatClass(p) : "i-seat"}>
          <use href="#i-shadow" />
          <use href="#i-chair-seat" />
          {seated && (
            <g className={`i-person ${p.typing ? "i-person--typing" : ""}`}>
              <use href="#i-torso" />
              <g className="i-headg">
                <use href="#i-head" />
              </g>
            </g>
          )}
          {seated && p.state === "stale" && (
            <text className="i-z" x="5" y="-24">
              z
            </text>
          )}
          <use href="#i-chair-back" />
        </g>
      </g>
      {standing && (
        <g transform={`translate(${STAND.x} ${STAND.y})`}>
          <g className="i-stander">
            <use href="#i-shadow" />
            <use href="#i-stand" />
            <use href="#i-arm-up" className="i-arm" />
          </g>
        </g>
      )}
      {walking && (
        <g transform={`translate(${SEAT.x} ${SEAT.y})`}>
          <g className="i-walker">
            <use href="#i-stand" />
          </g>
        </g>
      )}
      {s && p && p.phase !== "gone" && (p.helpers.length > 0 || p.hiddenHelpers > 0) && (
        <g transform={`translate(${TABLE.x} ${TABLE.y})`}>
          <use href="#i-table" />
          {p.helpers.map((c, i) => (
            <IsoHelperArt key={c.key} c={c} at={HELPER[i]!} origin={TABLE} />
          ))}
          {p.hiddenHelpers > 0 && (
            <text className="i-more" x="0" y={p.helpers.length ? -3 : 2} textAnchor="middle">
              +{p.hiddenHelpers}
            </text>
          )}
        </g>
      )}
    </g>
  );
}

function IsoHelperArt({ c, at, origin }: { c: SessionSummary; at: Pt; origin: Pt }) {
  const typing = c.state === "working" && !c.currentTool;
  const cls = ["i-helper", `i-helper--${c.state}`, typing ? "i-person--typing" : ""].filter(Boolean).join(" ");
  return (
    <g transform={`translate(${at.x - origin.x} ${at.y - origin.y}) scale(0.6)`}>
      <g className={cls}>
        <use href="#i-shadow" />
        {c.state === "needs_you" ? (
          <>
            <use href="#i-stand" />
            <use href="#i-arm-up" className="i-arm" />
          </>
        ) : (
          <>
            <use href="#i-torso" />
            <g className="i-headg">
              <use href="#i-head" />
            </g>
          </>
        )}
      </g>
    </g>
  );
}

export interface IsoOverlayProps {
  s: SessionSummary;
  p: Posture;
  /** The desk's floor origin in the plate's drawing. */
  at: Pt;
  now: number;
  cursor?: number;
  helperCursor?: (i: number) => number | undefined;
}

/** The link over a desk: the hit shape is the desk plus its nameplate; inside it the
 *  nameplate, the attention bubble, the tooltip and the focus ring. */
export function IsoOverlay({ s, p, at, now, cursor, helperCursor }: IsoOverlayProps) {
  const api = useApi();
  const title = api.format.title(s);
  const style = {
    "--x": `${at.x + HIT.x}px`,
    "--y": `${at.y + HIT.y}px`,
  } as CSSProperties;
  const classes = ["icell", `cell--${p.state}`, `cell--${p.phase}`].join(" ");
  return (
    <>
      <div className={classes} style={style} data-cursor={cursor !== undefined ? String(cursor) : undefined}>
        <SessionLink
          to={s.key}
          href={sessionHref(s.harness, s.id)}
          className="icell-link"
          aria-label={cellLabel(title, p)}
        >
          <Nameplate s={s} p={p} />
        </SessionLink>
        <svg className="icell-ring" viewBox={`0 0 ${HIT.w} ${HIT.h}`} aria-hidden="true">
          <polygon points={HIT_POLY} />
        </svg>
        {p.attention && (
          <span className="cell-bubble" key={p.attention.attentionId}>
            {ATTENTION_LABEL[p.attention.kind] ?? p.attention.kind}
          </span>
        )}
        <Tooltip s={s} p={p} now={now} />
      </div>
      {p.phase !== "gone" &&
        p.helpers.map((c, i) => <IsoHelperLink key={c.key} c={c} at={at} i={i} now={now} cursor={helperCursor?.(i)} />)}
    </>
  );
}

const HELPER_HIT = { w: 30, h: 36 };

function IsoHelperLink({
  c,
  at,
  i,
  now,
  cursor,
}: {
  c: SessionSummary;
  at: Pt;
  i: number;
  now: number;
  cursor?: number;
}) {
  const api = useApi();
  const title = api.format.title(c);
  const p = derivePosture(c, undefined, now);
  const tool = c.state === "working" ? c.currentTool?.tool : undefined;
  const h = HELPER[i]!;
  const style = {
    "--x": `${at.x + h.x - HELPER_HIT.w / 2}px`,
    "--y": `${at.y + h.y - 28}px`,
  } as CSSProperties;
  return (
    <SessionLink
      to={c.key}
      href={sessionHref(c.harness, c.id)}
      className={`icell-helper cell-helper--${c.state}`}
      aria-label={[`subagent ${title}`, STATE_LABEL[c.state], tool ?? ""].filter(Boolean).join(", ")}
      data-cursor={cursor !== undefined ? String(cursor) : undefined}
      style={style}
    >
      <Tooltip s={c} p={p} now={now} helper />
    </SessionLink>
  );
}

export const isoGlyph = (s: SessionSummary) => harnessMark(s.harness).glyph;
