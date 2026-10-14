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

export interface Layout {
  v: 1;
  windows: Record<SessionKey, WinPos>;
  zones: Record<string, Zone>;
  zonesOn: boolean;
  shelfOpen: boolean;
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
export const WIN_H = 172;
export const SUB_W = 196;
export const SUB_H = 68;
export const EXP_W = 580;
export const EXP_H = 440;
export const MIN_W = 200;
export const MIN_H = 110;
export const MAX_W = 1400;
export const MAX_H = 1000;
export const GAP = 16;
