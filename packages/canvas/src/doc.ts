// SPDX-License-Identifier: Apache-2.0
// The canvas document as operations. Every change the person makes is one Op, applied
// to the page's copy at once and written with api.storage.update, which applies the same
// Op to whatever the server holds now: two devices editing different things merge
// instead of overwriting each other. `exec` mutates and returns the inverse, which is
// what undo replays. Everything here is pure data; no DOM.
import { LABEL_COLORS, type LabelColor, type SessionKey, type SessionState } from "@sessionpipe-gui/theme-types/api";
import {
  type Area,
  type Doc,
  emptyDoc,
  type LayoutV1,
  type MapDoc,
  NOTE_MAX,
  type Note,
  TITLE_MAX,
  type WinEntry,
} from "./types";

export type Member = { dx: number; dy: number };

export type Op =
  | { t: "win"; set: Record<SessionKey, WinEntry | null> }
  /** Create, replace or delete an area. */
  | { t: "area"; id: string; set: Area | null }
  /** Change some of an area's fields (null clears `label`) and some of its members. */
  | {
      t: "areaPatch";
      id: string;
      patch: Partial<Omit<Area, "members" | "label">> & { label?: LabelColor | null };
      members?: Record<SessionKey, Member | null>;
    }
  | { t: "note"; id: string; set: Note | null }
  | { t: "notePatch"; id: string; patch: Partial<Omit<Note, "label">> & { label?: LabelColor | null } }
  | { t: "hidden"; set: Record<SessionKey, SessionState | null> }
  | { t: "showDone"; key: SessionKey; on: boolean }
  | { t: "map"; set: MapDoc }
  /** My layout wholesale (Reset, and its undo). */
  | { t: "restore"; windows: Doc["windows"]; areas: Doc["areas"]; notes: Doc["notes"] }
  | { t: "batch"; ops: Op[] };

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Applies `op` to `doc` in place; returns the Op that undoes it. */
export function exec(doc: Doc, op: Op): Op {
  switch (op.t) {
    case "win": {
      const inv: Record<SessionKey, WinEntry | null> = {};
      for (const [k, v] of Object.entries(op.set)) {
        inv[k] = doc.windows[k] ? clone(doc.windows[k]!) : null;
        if (v) doc.windows[k] = clone(v);
        else delete doc.windows[k];
      }
      return { t: "win", set: inv };
    }
    case "area": {
      const prev = doc.areas[op.id];
      if (op.set) doc.areas[op.id] = clone(op.set);
      else delete doc.areas[op.id];
      return { t: "area", id: op.id, set: prev ? clone(prev) : null };
    }
    case "areaPatch": {
      const a = doc.areas[op.id];
      // Deleted on another device meanwhile: nothing to change, nothing to undo.
      if (!a) return { t: "batch", ops: [] };
      const patch: Record<string, unknown> = {};
      for (const [f, v] of Object.entries(op.patch)) {
        const cur = (a as unknown as Record<string, unknown>)[f];
        patch[f] = cur === undefined ? null : cur;
        if (v === null || v === undefined) delete (a as unknown as Record<string, unknown>)[f];
        else (a as unknown as Record<string, unknown>)[f] = v;
      }
      let members: Record<SessionKey, Member | null> | undefined;
      if (op.members) {
        members = {};
        for (const [k, m] of Object.entries(op.members)) {
          members[k] = a.members[k] ? { ...a.members[k]! } : null;
          if (m) a.members[k] = { dx: m.dx, dy: m.dy };
          else delete a.members[k];
        }
      }
      return { t: "areaPatch", id: op.id, patch: patch as never, members };
    }
    case "note": {
      const prev = doc.notes[op.id];
      if (op.set) doc.notes[op.id] = clone(op.set);
      else delete doc.notes[op.id];
      return { t: "note", id: op.id, set: prev ? clone(prev) : null };
    }
    case "notePatch": {
      const n = doc.notes[op.id];
      if (!n) return { t: "batch", ops: [] };
      const patch: Record<string, unknown> = {};
      for (const [f, v] of Object.entries(op.patch)) {
        const cur = (n as unknown as Record<string, unknown>)[f];
        patch[f] = cur === undefined ? null : cur;
        if (v === null || v === undefined) delete (n as unknown as Record<string, unknown>)[f];
        else (n as unknown as Record<string, unknown>)[f] = v;
      }
      return { t: "notePatch", id: op.id, patch: patch as never };
    }
    case "hidden": {
      const inv: Record<SessionKey, SessionState | null> = {};
      for (const [k, v] of Object.entries(op.set)) {
        inv[k] = doc.hidden[k] ?? null;
        if (v) doc.hidden[k] = v;
        else delete doc.hidden[k];
      }
      return { t: "hidden", set: inv };
    }
    case "showDone": {
      const was = doc.showDone.includes(op.key);
      doc.showDone = doc.showDone.filter((k) => k !== op.key);
      if (op.on) doc.showDone.push(op.key);
      return { t: "showDone", key: op.key, on: was };
    }
    case "map": {
      const prev = clone(doc.map);
      doc.map = clone(op.set);
      return { t: "map", set: prev };
    }
    case "restore": {
      const inv: Op = { t: "restore", windows: doc.windows, areas: doc.areas, notes: doc.notes };
      doc.windows = clone(op.windows);
      doc.areas = clone(op.areas);
      doc.notes = clone(op.notes);
      return inv;
    }
    case "batch":
      return { t: "batch", ops: op.ops.map((o) => exec(doc, o)).reverse() };
  }
}

/** Whether an Op changes nothing (an empty batch, an empty set). */
export function isEmpty(op: Op): boolean {
  if (op.t === "batch") return op.ops.every(isEmpty);
  if (op.t === "win" || op.t === "hidden") return Object.keys(op.set).length === 0;
  if (op.t === "areaPatch") return Object.keys(op.patch).length === 0 && !Object.keys(op.members ?? {}).length;
  if (op.t === "notePatch") return Object.keys(op.patch).length === 0;
  return false;
}

/** Whether an Op moves or sizes something (a phone never writes those). */
export function isPositional(op: Op): boolean {
  switch (op.t) {
    case "win":
    case "restore":
      return true;
    case "area":
    case "note":
      return op.set !== null;
    case "areaPatch":
      return ["x", "y", "w", "h"].some((f) => f in op.patch) || !!op.members;
    case "notePatch":
      return ["x", "y", "w", "h"].some((f) => f in op.patch);
    case "batch":
      return op.ops.some(isPositional);
    default:
      return false;
  }
}

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const label = (v: unknown): LabelColor | undefined =>
  typeof v === "string" && (LABEL_COLORS as readonly string[]).includes(v) ? (v as LabelColor) : undefined;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Whatever storage holds, as a v2 document: a v2 checked field by field, a v1 migrated,
 *  anything else empty. Returns a fresh object (safe to mutate). */
export function normalize(raw: unknown): Doc {
  const r = obj(raw);
  if (r.v === 1) return migrate(r as unknown as LayoutV1);
  if (r.v !== 2) return emptyDoc();
  const d = emptyDoc();
  for (const [k, v] of Object.entries(obj(r.windows))) {
    const w = obj(v);
    const e: WinEntry = { x: num(w.x), y: num(w.y) };
    if (typeof w.w === "number") e.w = num(w.w);
    if (typeof w.h === "number") e.h = num(w.h);
    if (w.expanded === true) e.expanded = true;
    d.windows[k] = e;
  }
  for (const [id, v] of Object.entries(obj(r.areas))) {
    const a = obj(v);
    const members: Area["members"] = {};
    for (const [k, m] of Object.entries(obj(a.members))) members[k] = { dx: num(obj(m).dx), dy: num(obj(m).dy) };
    const area: Area = {
      title: str(a.title, TITLE_MAX),
      x: num(a.x),
      y: num(a.y),
      w: num(a.w, 320),
      h: num(a.h, 200),
      members,
      z: num(a.z),
    };
    const l = label(a.label);
    if (l) area.label = l;
    d.areas[id] = area;
  }
  for (const [id, v] of Object.entries(obj(r.notes))) {
    const n = obj(v);
    const note: Note = {
      text: str(n.text, NOTE_MAX),
      x: num(n.x),
      y: num(n.y),
      w: num(n.w, 220),
      h: num(n.h, 140),
      z: num(n.z),
    };
    const l = label(n.label);
    if (l) note.label = l;
    d.notes[id] = note;
  }
  const m = obj(r.map);
  d.map = {
    custom: obj(m.custom) as MapDoc["custom"],
    links: Array.isArray(m.links) ? (m.links as MapDoc["links"]) : [],
    nodes: obj(m.nodes) as MapDoc["nodes"],
  };
  for (const [k, v] of Object.entries(obj(r.hidden))) if (typeof v === "string") d.hidden[k] = v as SessionState;
  if (Array.isArray(r.showDone)) d.showDone = r.showDone.filter((k): k is string => typeof k === "string");
  return d;
}

/** v1 → v2: positions of top-level windows (a subagent's relative one goes: pills derive
 *  from their parent now), hidden ones, the map's hand-drawn parts; zones are dropped
 *  (the views replace them). */
export function migrate(v1: LayoutV1): Doc {
  const d = emptyDoc();
  for (const [k, w] of Object.entries(v1.windows ?? {})) {
    if (!w || typeof w !== "object") continue;
    if (w.hidden) d.hidden[k] = w.hidden;
    if (w.rel) continue;
    const e: WinEntry = { x: num(w.x), y: num(w.y) };
    if (w.expanded) e.expanded = true;
    d.windows[k] = e;
  }
  d.map = { custom: { ...(v1.custom ?? {}) }, links: [...(v1.links ?? [])], nodes: { ...(v1.nodes ?? {}) } };
  d.showDone = Object.keys(v1.showDone ?? {});
  return d;
}

/** Whether a stored v1 layout had any window placed by hand. */
export const v1HasPositions = (raw: unknown): boolean =>
  obj(raw).v === 1 && Object.values(obj(obj(raw).windows)).some((w) => !obj(w).rel);

/** The Op that forgets sessions the host forgot: their window, hidden mark, area
 *  memberships and unfolded agents. Null when there is nothing of theirs. */
export function pruneOp(doc: Doc, gone: Iterable<SessionKey>): Op | null {
  const ops: Op[] = [];
  const win: Record<SessionKey, null> = {};
  const hid: Record<SessionKey, null> = {};
  const keys = [...gone];
  for (const k of keys) {
    if (doc.windows[k]) win[k] = null;
    if (doc.hidden[k]) hid[k] = null;
    if (doc.showDone.includes(k)) ops.push({ t: "showDone", key: k, on: false });
  }
  if (Object.keys(win).length) ops.push({ t: "win", set: win });
  if (Object.keys(hid).length) ops.push({ t: "hidden", set: hid });
  for (const [id, a] of Object.entries(doc.areas)) {
    const members: Record<SessionKey, null> = {};
    for (const k of keys) if (a.members[k]) members[k] = null;
    if (Object.keys(members).length) ops.push({ t: "areaPatch", id, patch: {}, members });
  }
  return ops.length ? { t: "batch", ops } : null;
}

/** "a_" / "n_" + 8 base36. */
export function newId(prefix: "a" | "n"): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 36).toString(36);
  return `${prefix}_${s}`;
}

/** The area a session is a member of, if any. */
export function areaOf(doc: Doc, key: SessionKey): string | undefined {
  for (const [id, a] of Object.entries(doc.areas)) if (a.members[key]) return id;
  return undefined;
}
