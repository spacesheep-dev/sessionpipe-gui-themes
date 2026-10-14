// SPDX-License-Identifier: Apache-2.0
// Theme-neutral readings of a session (DESIGN.md §8). A style draws a Posture; it never
// derives one. Also here: stable seating (a session keeps its slot while alive, kept per
// device in api.local), the calm budget for walks, and the viewer's hour band for the
// window.
import type { ThemeApi } from "@sessionpipe-gui/theme-types";
import type { Attention, SessionKey, SessionState, SessionSummary } from "@sessionpipe-gui/theme-types/api";
import { useMemo, useRef } from "react";

export type Screen = "lit" | "dim" | "pale" | "off";
export type Phase = "arriving" | "seated" | "leaving" | "gone";

/** How a person looks, fixed for the session's life (DESIGN.md §2). */
export interface Look {
  shirt: number;
  hair: number;
  hairColour: number;
  skin: number;
  glasses: boolean;
}

export interface Posture {
  state: SessionState;
  /** The model is writing: progress.assistant grew in the last 3 s and no tool runs. */
  typing: boolean;
  screen: Screen;
  /** The tool on the screen (working only). */
  tool?: string;
  /** The numeral under the desk: a tool running past a minute (working), or the silence
   *  since the last event (stale). */
  elapsedMs?: number;
  /** Error sheets on the desk: 0, or 1 for 1–2 errors, 2 for 3–5, 3 for 6+. */
  errors: 0 | 1 | 2 | 3;
  attention?: Attention;
  /** Live subagent summaries, state order; `hiddenHelpers` counts beyond the drawn ones. */
  helpers: SessionSummary[];
  hiddenHelpers: number;
  phase: Phase;
  look: Look;
}

export const SCREEN_BY_STATE: Record<SessionState, Screen> = {
  working: "lit",
  needs_you: "dim",
  stale: "off",
  idle: "off",
  done: "off",
};

export const MAX_HELPERS = 2;
const TYPING_WINDOW_MS = 3000;
const LONG_RUNNING_MS = 60_000;

/** Previous progress length per session, to tell growth from a repeat. */
const growth = new Map<SessionKey, { len: number; grewAt: number }>();

export function sheets(errors: number): 0 | 1 | 2 | 3 {
  if (errors <= 0) return 0;
  if (errors <= 2) return 1;
  if (errors <= 5) return 2;
  return 3;
}

export function derivePosture(
  s: SessionSummary,
  children: SessionSummary[] | undefined,
  now: number,
  phase: Phase = "seated",
): Posture {
  const len = s.progress?.assistant?.length ?? 0;
  const prev = growth.get(s.key);
  let grewAt = prev?.grewAt ?? 0;
  if (!prev) grewAt = len > 0 ? now : 0;
  else if (len > prev.len) grewAt = now;
  growth.set(s.key, { len, grewAt });

  const live = (children ?? []).filter((c) => c.state !== "done");
  const helpers = live.slice(0, MAX_HELPERS);
  const hidden = live.length > MAX_HELPERS ? live.length - MAX_HELPERS : live.length === 0 ? s.children : 0;
  const toolMs = s.currentTool ? now - Date.parse(s.currentTool.since) : 0;

  return {
    state: s.state,
    typing: s.state === "working" && !s.currentTool && now - grewAt < TYPING_WINDOW_MS,
    screen: phase === "seated" ? SCREEN_BY_STATE[s.state] : "off",
    tool: s.state === "working" ? s.currentTool?.tool : undefined,
    elapsedMs:
      s.state === "working" && toolMs > LONG_RUNNING_MS
        ? toolMs
        : s.state === "stale"
          ? Math.max(0, now - Date.parse(s.stateSince))
          : undefined,
    errors: sheets(s.counts.toolErrors),
    attention: s.state === "needs_you" ? s.openAttentions[0] : undefined,
    helpers,
    hiddenHelpers: hidden,
    phase,
    look: lookOf(s.id),
  };
}

/** FNV-1a, 32-bit: one stable number per session id. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function lookOf(id: string): Look {
  const h = fnv1a(id);
  return {
    shirt: h % 6,
    hair: (h >>> 3) & 3,
    hairColour: (h >>> 5) & 1,
    skin: (h >>> 6) & 1,
    glasses: ((h >>> 7) & 3) === 0,
  };
}

/** Hour and minute hand angles for the viewer's local time, stepped to the minute. */
export function clockAngles(at: number): { hour: number; minute: number; text: string } {
  const d = new Date(Math.floor(at / 60_000) * 60_000);
  const h = d.getHours();
  const m = d.getMinutes();
  return {
    hour: ((h % 12) + m / 60) * 30,
    minute: m * 6,
    text: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
  };
}

/** `WebFetch` → `WebF…`: a screen holds five characters. */
export function screenText(tool: string | undefined, max = 5): string {
  if (!tool) return "";
  return tool.length > max ? `${tool.slice(0, max - 1)}…` : tool;
}

/** Ellipsis from the left so the branch end stays: `…pipe @ mp/office`. */
export function cutLeft(text: string, max: number): string {
  return text.length > max ? `…${text.slice(-(max - 1))}` : text;
}

// ---------- seating ----------

const SLOTS_KEY = "slots";
type SlotMap = Record<string, Record<SessionKey, number>>;

function readSlots(api: ThemeApi): SlotMap {
  const v = api.local.get<unknown>(SLOTS_KEY);
  return v && typeof v === "object" ? (v as SlotMap) : {};
}

/** Stable slots per room: the lowest free index when first seen alive, kept until the
 *  session leaves (DESIGN.md §1). `occupied` lists, per room, every key that holds a
 *  seat right now (live sessions plus ones still walking out). */
export function useSeating(
  api: ThemeApi,
  occupied: { room: string; keys: SessionKey[] }[],
): ReadonlyMap<SessionKey, number> {
  const slots = useRef<SlotMap | null>(null);
  if (slots.current === null) slots.current = readSlots(api);
  return useMemo(() => {
    const all = slots.current!;
    const out = new Map<SessionKey, number>();
    let changed = false;
    const rooms = new Set(occupied.map((o) => o.room));
    for (const room of Object.keys(all)) {
      if (!rooms.has(room)) {
        delete all[room];
        changed = true;
      }
    }
    for (const { room, keys } of occupied) {
      const seated = all[room] ?? {};
      const keep = new Set(keys);
      for (const k of Object.keys(seated)) {
        if (!keep.has(k)) {
          delete seated[k];
          changed = true;
        }
      }
      const taken = new Set(Object.values(seated));
      for (const k of keys) {
        if (seated[k] === undefined) {
          let i = 0;
          while (taken.has(i)) i++;
          seated[k] = i;
          taken.add(i);
          changed = true;
        }
        out.set(k, seated[k]!);
      }
      all[room] = seated;
    }
    if (changed) api.local.set(SLOTS_KEY, all);
    return out;
  }, [api, occupied]);
}

// ---------- calm budget ----------

export const MAX_WALKS = 6;
export const MAX_TYPING = 12;
export const BREATHE_UNTIL = 24;
export const WALK_MS = 800;
const walks: number[] = [];

/** Reserve a walk if fewer than MAX_WALKS are under way; otherwise the figure fades in. */
export function reserveWalk(now: number): boolean {
  while (walks.length && walks[0]! < now - WALK_MS) walks.shift();
  if (walks.length >= MAX_WALKS) return false;
  walks.push(now);
  return true;
}

// ---------- the window ----------

export type HourBand = "morning" | "day" | "evening" | "night";

export function hourBand(at: number): HourBand {
  const h = new Date(at).getHours();
  if (h >= 6 && h < 11) return "morning";
  if (h >= 11 && h < 17) return "day";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}
