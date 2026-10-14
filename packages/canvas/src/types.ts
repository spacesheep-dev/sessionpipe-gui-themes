// SPDX-License-Identifier: Apache-2.0
// The canvas's own state: what it keeps in api.storage (layout, shared across devices)
// and api.local (viewport, per device).
import type { SessionKey, SessionState } from "@sessionpipe-gui/theme-types/api";

export interface WinPos {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Set while the window is closed; the state it had, so a change of state reopens it. */
  hidden?: SessionState;
  expanded?: boolean;
  /** Subagents: x/y are relative to the parent, so they follow it. */
  rel?: boolean;
  /** Size while expanded, once the person resized it in that mode. */
  ew?: number;
  eh?: number;
}

export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A node the person drew: anything the GUI cannot infer (a mic, a pen, a note). */
export interface CustomNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

/** A line the person drew between two nodes (inferred, custom, or a session window). */
export interface Link {
  id: string;
  from: string;
  to: string;
}

export interface Layout {
  v: 1;
  windows: Record<SessionKey, WinPos>;
  zones: Record<string, Zone>;
  zonesOn: boolean;
  shelfOpen: boolean;
  /** The infrastructure map around the sessions. */
  mapOn?: boolean;
  /** Where the lanes sit: the bottom of the agents lane and the top of the machines lane. */
  lanes?: { top: number; bottom: number };
  /** Inferred map nodes the person moved, by node id: x within the lane (y for custom). */
  nodes?: Record<string, { x: number }>;
  custom?: Record<string, CustomNode>;
  links?: Link[];
  /** Parents whose finished subagents are shown instead of folded into the chip. */
  showDone?: Record<SessionKey, true>;
}

export interface Viewport {
  /** Screen = world * k + (x, y). */
  x: number;
  y: number;
  k: number;
}

export const emptyLayout = (): Layout => ({ v: 1, windows: {}, zones: {}, zonesOn: false, shelfOpen: false });

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;
export const GRID = 8;
/** Default window sizes, world units. */
export const WIN_W = 280;
export const WIN_H = 212;
export const SUB_W = 224;
export const SUB_H = 68;
export const EXP_W = 580;
export const EXP_H = 440;
export const MIN_W = 200;
export const MIN_H = 110;
export const MAX_W = 1400;
export const MAX_H = 1000;
export const GAP = 16;
/** Subagents: the gap between a parent's right edge and its column of children. */
export const TREE_GAP = 28;
export const TREE_ROW = 8;
/** Map lanes: band height, node height, spacing. */
export const LANE_H = 64;
export const LANE_GAP = 40;
export const NODE_H = 36;
export const NODE_GAP = 20;
