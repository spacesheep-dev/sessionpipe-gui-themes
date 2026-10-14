// SPDX-License-Identifier: Apache-2.0
// React bindings for the ThemeApi's snapshot, the session tree the board derives from it
// (the GUI's useSessionTree, one to one), a shared one-second clock, and two small
// browser observers.
import type { ThemeApi, ThemeSnapshot } from "@sessionpipe-gui/theme-types";
import type { SessionKey, SessionState, SessionSummary } from "@sessionpipe-gui/theme-types/api";
import { SESSION_STATES } from "@sessionpipe-gui/theme-types/api";
import { type RefObject, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";

export function useSnapshot(api: ThemeApi): ThemeSnapshot {
  return useSyncExternalStore(api.state.subscribe, api.state.get, api.state.get);
}

const STATE_RANK: Record<SessionState, number> = Object.fromEntries(SESSION_STATES.map((s, i) => [s, i])) as Record<
  SessionState,
  number
>;

export const byStateThenRecent = (a: SessionSummary, b: SessionSummary) =>
  STATE_RANK[a.state] - STATE_RANK[b.state] || b.lastAt.localeCompare(a.lastAt);

/** All sessions, top-level ones sorted by state then recency, with children attached. */
export function useSessionTree(sessions: ReadonlyMap<SessionKey, SessionSummary>): {
  all: SessionSummary[];
  roots: SessionSummary[];
  childrenOf: ReadonlyMap<SessionKey, SessionSummary[]>;
} {
  return useMemo(() => {
    const all = [...sessions.values()];
    const childrenOf = new Map<SessionKey, SessionSummary[]>();
    const roots: SessionSummary[] = [];
    for (const s of all) {
      if (s.parentId) {
        const pk: SessionKey = `${s.harness}:${s.parentId}`;
        if (sessions.has(pk)) {
          const list = childrenOf.get(pk) ?? [];
          list.push(s);
          childrenOf.set(pk, list);
          continue;
        }
      }
      roots.push(s);
    }
    roots.sort(byStateThenRecent);
    for (const list of childrenOf.values()) list.sort(byStateThenRecent);
    return { all, roots, childrenOf };
  }, [sessions]);
}

// ---------- the clock ----------

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

const subscribeNow = (l: () => void) => {
  listeners.add(l);
  if (!timer) {
    timer = setInterval(() => {
      now = Date.now();
      for (const fn of listeners) fn();
    }, 1000);
  }
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
};

/** Re-renders the caller every second; the interval stops with the last subscriber. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeNow,
    () => now,
    () => now,
  );
}

// ---------- the browser ----------

/** True while the media query matches; re-renders on change. */
export function useMediaQuery(query: string): boolean {
  const mql = useMemo(() => window.matchMedia(query), [query]);
  return useSyncExternalStore(
    (l) => {
      mql.addEventListener("change", l);
      return () => mql.removeEventListener("change", l);
    },
    () => mql.matches,
    () => false,
  );
}

/** The element's content-box width, measured before paint and on every resize (the host
 *  narrows the theme root when its split panel opens). 0 until the first measure. */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setWidth(Math.max(0, el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

export function usePageHidden(): boolean {
  return useSyncExternalStore(
    (l) => {
      document.addEventListener("visibilitychange", l);
      return () => document.removeEventListener("visibilitychange", l);
    },
    () => document.hidden,
    () => false,
  );
}
