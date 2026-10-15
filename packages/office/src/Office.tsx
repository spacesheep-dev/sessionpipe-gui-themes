// SPDX-License-Identifier: Apache-2.0
// The office: one room per machine, one desk per live session, a helper per live
// subagent, an empty chair for a while after a session ends. Facts come from the
// ThemeApi's snapshot (useSnapshot / useSessionTree); postures from posture.ts; seating
// is stable per session. This file composes and budgets.
import type { ThemeApi } from "@sessionpipe-gui/theme-types";
import type { SessionKey, SessionSummary } from "@sessionpipe-gui/theme-types/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Segmented } from "./bits";
import { useContainerWidth, useNow, usePageHidden, useSessionTree, useSnapshot } from "./hooks";
import { IsoDefs } from "./IsoCell";
import { useListNav } from "./keys";
import { Legend } from "./Legend";
import { figuresFit, isoFit } from "./layout";
import { OfficeDefs } from "./parts";
import { derivePosture, hourBand, MAX_TYPING, type Phase, type Posture, reserveWalk, useSeating } from "./posture";
import { Room, type RoomCell, type RoomFit } from "./Room";
import { type OfficeStyle, useOfficeStyle } from "./style";

const UNNAMED = "unnamed";
const ARRIVE_MS = 1800;
const LEAVE_MS = 1300;
/** Rows are added as desks come; past this the room label says "+n more". */
const MAX_ROWS = 40;
const CHAIR_MS = 30 * 60_000;

const roomOf = (s: SessionSummary) => s.machine || UNNAMED;

const roomFit = (style: OfficeStyle, width: number, desks: number): RoomFit =>
  style === "iso" ? { kind: "iso", fit: isoFit(width, desks) } : { kind: "figures", fit: figuresFit(width, desks) };
const fitCols = (f: RoomFit) => (f.kind === "iso" ? (f.fit.mode === "plate" ? f.fit.cols : 1) : f.fit.cols);
const endedAt = (s: SessionSummary) => Date.parse(s.endedAt ?? s.stateSince);

/** Sessions that just left the live set, kept for the walk out. */
function useLeaving(live: ReadonlyMap<SessionKey, SessionSummary>) {
  const [leaving, setLeaving] = useState<ReadonlyMap<SessionKey, SessionSummary>>(new Map());
  const prev = useRef<ReadonlyMap<SessionKey, SessionSummary>>(new Map());
  useEffect(() => {
    const gone = [...prev.current.values()].filter((s) => !live.has(s.key));
    prev.current = live;
    if (gone.length === 0) return;
    setLeaving((m) => new Map([...m, ...gone.map((s) => [s.key, s] as const)]));
    const t = setTimeout(() => {
      setLeaving((m) => {
        const n = new Map(m);
        for (const s of gone) n.delete(s.key);
        return n;
      });
    }, LEAVE_MS);
    return () => clearTimeout(t);
  }, [live]);
  return leaving;
}

const midnight = (at: number) => {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function Office({ api }: { api: ThemeApi }) {
  const snap = useSnapshot(api);
  const { machines, connection, scheme } = snap;
  const { roots, childrenOf, all } = useSessionTree(snap.sessions);
  const now = useNow();
  const root = useRef<HTMLDivElement>(null);
  const measured = useContainerWidth(root);
  const width = measured || 1200;
  const hidden = usePageHidden();
  const [legend, setLegend] = useState(false);
  const [style, setStyle] = useOfficeStyle(api);

  const live = useMemo(() => roots.filter((s) => s.state !== "done" && !s.backfilled), [roots]);
  const liveMap = useMemo(() => new Map(live.map((s) => [s.key, s] as const)), [live]);
  const leaving = useLeaving(liveMap);

  // rooms, in name order; sessions with no machine share the last one
  const roomNames = useMemo(() => {
    const names = new Set<string>([...machines.keys()]);
    for (const s of all) if (s.machine) names.add(s.machine);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    if (all.some((s) => !s.machine)) sorted.push(UNNAMED);
    return sorted;
  }, [machines, all]);

  const occupied = useMemo(
    () =>
      roomNames.map((room) => ({
        room,
        keys: [
          ...live.filter((s) => roomOf(s) === room).map((s) => s.key),
          ...[...leaving.values()].filter((s) => roomOf(s) === room).map((s) => s.key),
        ],
      })),
    [roomNames, live, leaving],
  );
  const slots = useSeating(api, occupied);

  // the last slot a session held, so its chair can stay pushed in after it ends
  const lastSlot = useRef(new Map<SessionKey, number>());
  for (const [k, v] of slots) lastSlot.current.set(k, v);

  // The first snapshot has arrived once the stream is live (the host's store sets both
  // together); from then on, newcomers walk in (within the calm budget).
  const booted = useRef(false);
  if (connection === "live") booted.current = true;
  const seen = useRef(new Map<SessionKey, { at: number; walk: boolean }>());
  for (const s of live) {
    if (!seen.current.has(s.key)) {
      const t = Date.now();
      seen.current.set(s.key, booted.current ? { at: t, walk: reserveWalk(t) } : { at: 0, walk: false });
    }
  }
  for (const k of [...seen.current.keys()]) if (!liveMap.has(k) && !leaving.has(k)) seen.current.delete(k);

  // postures, with the typing budget (newest progress keeps typing)
  const postures = useMemo(() => {
    const out = new Map<SessionKey, Posture>();
    for (const s of live) {
      const entry = seen.current.get(s.key);
      const phase: Phase = entry && entry.at > 0 && now - entry.at < ARRIVE_MS ? "arriving" : "seated";
      out.set(s.key, derivePosture(s, childrenOf.get(s.key), now, phase));
    }
    for (const s of leaving.values()) out.set(s.key, derivePosture(s, undefined, now, "leaving"));
    const typing = [...out.entries()].filter(([, p]) => p.typing);
    if (typing.length > MAX_TYPING) {
      typing.sort((a, b) =>
        (liveMap.get(b[0])?.progress?.at ?? "").localeCompare(liveMap.get(a[0])?.progress?.at ?? ""),
      );
      for (const [k, p] of typing.slice(MAX_TYPING)) out.set(k, { ...p, typing: false });
    }
    return out;
  }, [live, leaving, childrenOf, now, liveMap]);

  // rooms: pods and rows, cells by slot, one pushed-in chair per pod, keyboard order
  const rooms = useMemo(() => {
    const keys: SessionKey[] = [];
    const since = midnight(now);
    const list = roomNames.map((name) => {
      const here = [...live, ...leaving.values()].filter((s) => roomOf(s) === name);
      // desks per row from the width the room has
      const fit = roomFit(style, width, here.length);
      const perRow = fitCols(fit);
      const maxRows = MAX_ROWS;
      const held = new Set(here.map((s) => slots.get(s.key) ?? 0));
      let maxSlot = here.reduce((m, s) => Math.max(m, slots.get(s.key) ?? 0), 0);
      const recent = all
        .filter(
          (s) =>
            s.state === "done" &&
            !s.backfilled &&
            !s.parentId &&
            roomOf(s) === name &&
            now - endedAt(s) < CHAIR_MS &&
            lastSlot.current.has(s.key),
        )
        .sort((a, b) => endedAt(b) - endedAt(a));
      const chairs: SessionSummary[] = [];
      const podsUsed = new Set<number>();
      for (const s of recent) {
        const slot = lastSlot.current.get(s.key)!;
        const pod = Math.floor(slot / 2);
        if (held.has(slot) || podsUsed.has(pod) || slot >= perRow * maxRows) continue;
        held.add(slot);
        podsUsed.add(pod);
        chairs.push(s);
        maxSlot = Math.max(maxSlot, slot);
      }
      const rows = Math.max(1, Math.min(maxRows, Math.ceil((maxSlot + 1) / perRow)));
      const cells: RoomCell[] = [
        ...here.map((s) => ({
          s,
          p: postures.get(s.key)!,
          slot: slots.get(s.key) ?? 0,
          walk: seen.current.get(s.key)?.walk ?? false,
        })),
        ...chairs.map((s) => ({
          s,
          p: derivePosture(s, undefined, now, "gone"),
          slot: lastSlot.current.get(s.key)!,
          walk: false,
        })),
      ]
        .sort((a, b) => a.slot - b.slot)
        .map((c) => {
          if (c.slot >= perRow * rows) return c;
          const index = keys.length;
          keys.push(c.s.key);
          const helperBase = keys.length;
          for (const h of c.p.helpers) keys.push(h.key);
          return { ...c, index, helperBase };
        });
      const gone = all.filter(
        (s) => s.state === "done" && !s.backfilled && !s.parentId && roomOf(s) === name && endedAt(s) >= since,
      ).length;
      return { name, machine: machines.get(name), cells, perRow, rows, gone, fit };
    });
    return { list, keys };
  }, [roomNames, live, leaving, slots, postures, width, style, machines, all, now]);

  const open = useCallback((key: SessionKey) => api.openSession(key), [api]);
  const { cursor } = useListNav(rooms.keys, open, true, api.shortcuts);
  const needs = live.filter((s) => s.state === "needs_you").length;
  const working = live.filter((s) => s.state === "working").length;

  useEffect(() => {
    const t = setTimeout(() => {
      document.title = `${needs > 0 ? `(${needs}) ` : ""}Office · sessionpipe`;
    }, 0);
    return () => clearTimeout(t);
  }, [needs]);

  // `?` toggles the legend, through the host's keymap when it has one (listed in `?`,
  // rebindable), else a window listener; Esc closes it (the host's Esc also clicks
  // [data-dismiss]).
  useEffect(() => {
    const viaHost = api.shortcuts?.register([
      { id: "legend", label: "Legend", keys: ["?"], run: () => setLegend((v) => !v), hint: "what the postures mean" },
    ]);
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;
      if (e.key === "?" && !viaHost) {
        e.preventDefault();
        setLegend((v) => !v);
      } else if (e.key === "Escape") {
        setLegend(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      viaHost?.();
    };
  }, [api]);

  const band = hourBand(now);
  const classes = ["sp-office", hidden ? "office--paused" : ""].filter(Boolean).join(" ");

  if (!booted.current)
    return (
      <div className={classes} data-scheme={scheme}>
        <div className="office" ref={root}>
          <p className="page-note">
            {connection === "connecting" ? "Waiting for the first snapshot…" : "No connection to the receiver yet."}
          </p>
        </div>
      </div>
    );

  const summary = [
    needs > 0 ? `${needs} need${needs === 1 ? "s" : ""} you` : "",
    working > 0 ? `${working} working` : "",
    live.length - needs - working > 0 ? `${live.length - needs - working} idle or stale` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={classes} data-scheme={scheme}>
      <div className="office" ref={root}>
        <OfficeDefs />
        <IsoDefs />
        <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
          <clipPath id="o-screen-clip">
            <rect x="36" y="15" width="24" height="16" />
          </clipPath>
        </svg>
        <header className="office-head">
          <h1 className="office-title">Office</h1>
          <span className="office-xp">experimental</span>
          <span className="office-sum">{summary || (roomNames.length ? "nobody is in right now" : "")}</span>
          <div className="office-tools">
            <Segmented<OfficeStyle>
              value={style}
              options={[
                { value: "iso", label: "iso" },
                { value: "figures", label: "figures" },
              ]}
              onChange={setStyle}
              label="Drawing style"
            />
            <Legend open={legend} onToggle={() => setLegend((v) => !v)} style={style} />
          </div>
        </header>

        {roomNames.length === 0 ? (
          <EmptyOffice band={band} now={now} width={width} style={style} />
        ) : (
          <div className="rooms">
            {rooms.list.map((r) => (
              <Room
                key={r.name}
                name={r.name}
                machine={r.machine}
                cells={r.cells}
                perRow={r.perRow}
                rows={r.rows}
                gone={r.gone}
                band={band}
                now={now}
                fit={r.fit}
                cursor={cursor}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyOffice({
  band,
  now,
  width,
  style,
}: {
  band: ReturnType<typeof hourBand>;
  now: number;
  width: number;
  style: OfficeStyle;
}) {
  const fit = roomFit(style, width, 2);
  const perRow = fitCols(fit);
  return (
    <div className="office-empty">
      <Room
        name="no machines yet"
        cells={[]}
        perRow={perRow}
        rows={Math.ceil(2 / perRow)}
        gone={0}
        band={band}
        now={now}
        fit={fit}
      />
      <ul className="office-ways">
        <li>
          <strong>This machine.</strong> Run <code>npx sessionpipe install</code> once; the GUI tails the local outbox.
        </li>
        <li>
          <strong>Another machine.</strong> Point its sink here with the one line on the Connect page.
        </li>
        <li>
          <strong>Demo mode.</strong> Synthetic sessions to look around with, on and off from Connect.
        </li>
      </ul>
      <NavLink to="/connect" className="btn btn--primary">
        Open Connect
      </NavLink>
    </div>
  );
}
