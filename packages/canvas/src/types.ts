// SPDX-License-Identifier: Apache-2.0
// The canvas's own state: the document it keeps in api.storage (My layout, the map's
// hand-drawn parts, hidden windows; shared across devices) and the sizes everything is
// laid out with. The view, the viewport and small preferences live in api.local.
import type { LabelColor, SessionKey, SessionState } from "@sessionpipe-gui/theme-types/api";

/** The views, in the order of the segmented control (keys 1–7): the default (State)
 *  first, then the other groupings, then the person's own layout and the map. */
export type ViewId = "layout" | "state" | "machine" | "harness" | "repo" | "label" | "map";
export const VIEWS: readonly { id: ViewId; label: string }[] = [
  { id: "state", label: "State" },
  { id: "machine", label: "Machine" },
  { id: "harness", label: "Harness" },
  { id: "repo", label: "Repo" },
  { id: "label", label: "Label" },
  { id: "layout", label: "My layout" },
  { id: "map", label: "Map" },
];
/** Computed views: a clean grid in labelled groups, the same on every device, never stored. */
export const isPreset = (v: ViewId) => v !== "layout" && v !== "map";

/** A window's place in My layout (world px). w/h only once an expanded window was resized. */
export interface WinEntry {
  x: number;
  y: number;
  w?: number;
  h?: number;
  expanded?: boolean;
}

/** A titled container the person drew. Members are kept by session key with their offset
 *  inside the area, so moving the area carries them and nothing depends on geometry. */
export interface Area {
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: LabelColor;
  members: Record<SessionKey, { dx: number; dy: number }>;
  z: number;
}

/** A sticky note of plain text. */
export interface Note {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: LabelColor;
  z: number;
}

/** A node the person drew on the map: anything the GUI cannot infer (a mic, a pen). */
export interface CustomNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

/** A line the person drew between two map nodes (inferred, custom, or a session row). */
export interface Link {
  id: string;
  from: string;
  to: string;
}

/** The Map view's own state: hand-drawn nodes and links, and where inferred nodes were
 *  dragged along their lane (x from the lane's left edge). */
export interface MapDoc {
  custom: Record<string, CustomNode>;
  links: Link[];
  nodes: Record<string, { x: number }>;
}

/** The document in api.storage. */
export interface Doc {
  v: 2;
  windows: Record<SessionKey, WinEntry>;
  areas: Record<string, Area>;
  notes: Record<string, Note>;
  map: MapDoc;
  /** Windows the person hid, and the state each was hidden in: a change of state shows it again. */
  hidden: Record<SessionKey, SessionState>;
  /** Parents whose finished subagents are unfolded. */
  showDone: SessionKey[];
}

export const emptyDoc = (): Doc => ({
  v: 2,
  windows: {},
  areas: {},
  notes: {},
  map: { custom: {}, links: [], nodes: {} },
  hidden: {},
  showDone: [],
});

/** What an earlier build stored (v1), read once for the migration. */
export interface LayoutV1 {
  v: 1;
  windows?: Record<
    SessionKey,
    { x: number; y: number; w?: number; h?: number; hidden?: SessionState; expanded?: boolean; rel?: boolean }
  >;
  custom?: Record<string, CustomNode>;
  links?: Link[];
  nodes?: Record<string, { x: number }>;
  showDone?: Record<SessionKey, true>;
}

export interface Viewport {
  /** Screen = world * k + (x, y). */
  x: number;
  y: number;
  k: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;
export const GRID = 8;

/** A window: fixed sizes by kind, so a grid is clean. 100 = the 32 px bar, the 20 px
 *  line, two lines of body and the bottom inset: a window that has only "Thinking" to
 *  say keeps one quiet line of room, not a third of the window empty. */
export const WIN_W = 280;
export const WIN_H = 100;
/** A window on a phone is a row of the group's inset table: title, meta, one line. */
export const PHONE_ROW_H = 78;
/** Needs you and answerable: two lines of the request and the actions row under it. */
export const WIN_H_ASK = 132;
export const EXP_W = 360;
export const EXP_H = 420;
export const EXP_MAX_W = 1400;
export const EXP_MAX_H = 1000;
/** A session row in the Map view. */
export const ROW_W = 240;
export const ROW_H = 32;

/** Agent pills beside their orchestrator. */
export const PILL_W = 240;
export const PILL_H = 48;
export const PILL_GAP = 8;
export const PILL_MORE_H = 28;
export const PILLS_SHOWN = 4;
/** From the window's right edge to the pills, and to the tether's trunk. */
export const PILL_OFF = 36;
export const TRUNK_OFF = 18;
/** On a phone the pills stack under the window, indented. */
export const PILL_INDENT = 24;

/** The grid of the preset views. */
export const COL_GAP = 16;
export const ROW_GAP = 24;
export const GROUP_GAP = 48;
export const HEAD_H = 28;
export const HEAD_GAP = 12;
export const SHELF_MIN = 1200;

/** Areas and notes. */
export const AREA_MIN_W = 320;
export const AREA_MIN_H = 200;
export const AREA_PAD = 24;
export const AREA_HEAD = 28;
export const NOTE_W = 220;
export const NOTE_H = 140;
export const NOTE_MIN_W = 140;
export const NOTE_MIN_H = 80;
export const NOTE_MAX = 2000;
export const TITLE_MAX = 80;

/** The chrome: the toolbar at the top, the status bar at the bottom. */
export const BAR_H = 48;
export const BAR_H_PHONE = 44;
export const STATUS_H = 28;
/** Below this canvas width it is a phone: one column, nothing stored. */
export const PHONE_W = 600;
/** Below this the view control is a pop-up. */
export const NARROW_W = 1100;
/** Below this there is no minimap. */
export const MINIMAP_W = 900;

/** Map lanes: node height, spacing. */
export const LANE_GAP = 40;
export const NODE_H = 36;
export const NODE_GAP = 20;
