// SPDX-License-Identifier: Apache-2.0
// The contract between the server (server/) and the web app (web/). Both import from
// here and nowhere else for anything that crosses the wire. Change it deliberately:
// a field added here is a field both sides must handle.
//
// Protocol events themselves are the sessionpipe v1 envelope (spec/PROTOCOL.md §2);
// the shapes below are the GUI's *readings* of them (spec §1: a receiver's readings
// are its own, never part of the protocol).

export type Tier = 0 | 1 | 2 | 3;

/** A protocol event as stored: the envelope, plus when it arrived here. */
export interface StoredEvent extends ProtocolEvent {
  /** Receiver arrival time (HTTP.md §2 "Time"), ISO 8601. */
  arrivedAt: string;
  /** Where it came from: the HTTP events endpoint, the local outbox tailer, or demo mode. */
  source: EventSource;
  /** Present on events from the stream and the feed, which are *slim*: data.input,
   *  data.output, data.user and data.assistant may be cut to a preview; this maps each
   *  cut key to its original length. The session detail route returns the full event. */
  preview?: Record<string, number>;
}

export type EventSource = "http" | "outbox" | "demo";

/** The sessionpipe v1 envelope. Kept structural (not imported from sessionpipe-core) so
 *  the web bundle never pulls the core package in. */
export interface ProtocolEvent {
  protocol: 1;
  id: string;
  type: string;
  time: string;
  tier: Tier;
  harness: { name: string; version?: string; event?: string };
  session: ProtocolSession;
  privacy: { rulesets: string[]; pii: boolean };
  data: Record<string, unknown>;
}

export interface ProtocolSession {
  id: string;
  seq: number;
  machine?: string;
  cwd?: string;
  repo?: string;
  branch?: string;
  model?: string;
  title?: string;
  title_source?: "custom" | "harness" | "first-ask";
  url?: string;
  account_id?: string;
  parent_id?: string | null;
}

/** The GUI's reading of a session's state (spec §1: made from the facts, never sent).
 *  needs_you: an attention is open. working: a turn started and nothing ended it, with
 *  an event in the last STALE_AFTER_MS. stale: working, but silent longer than that.
 *  idle: the last turn ended and the session did not. done: session.ended arrived, or
 *  only a backfill is known, or nothing for DONE_AFTER_MS. */
export type SessionState = "needs_you" | "working" | "stale" | "idle" | "done";

export const STALE_AFTER_MS = 10 * 60_000;
export const DONE_AFTER_MS = 6 * 3600_000;

export const SESSION_STATES: SessionState[] = ["needs_you", "working", "stale", "idle", "done"];

export type AttentionKind = "permission" | "question" | "elicitation" | "idle" | "error";

export interface Attention {
  attentionId: string;
  kind: AttentionKind;
  tool?: string;
  message?: string;
  at: string;
}

/** `${harness}:${id}` — the key everything in the UI API uses for a session. */
export type SessionKey = string;
export const sessionKey = (harness: string, id: string): SessionKey => `${harness}:${id}`;
export const splitKey = (key: SessionKey): { harness: string; id: string } => {
  const i = key.indexOf(":");
  return { harness: key.slice(0, i), id: key.slice(i + 1) };
};

export interface SessionSummary {
  key: SessionKey;
  harness: string;
  harnessVersion?: string;
  id: string;
  /** Session block, COALESCE-merged across events (spec §3). */
  machine?: string;
  cwd?: string;
  repo?: string;
  branch?: string;
  model?: string;
  title?: string;
  titleSource?: "custom" | "harness" | "first-ask";
  url?: string;
  accountId?: string;
  parentId?: string | null;

  state: SessionState;
  /** When the current state began (ISO). */
  stateSince: string;
  startedAt: string;
  lastAt: string;
  endedAt?: string;
  /** The highest tier any event of this session arrived at: what the UI can show. */
  maxTier: Tier;
  /** Backfill-only sessions have no live events. */
  backfilled: boolean;
  source: EventSource;

  counts: {
    events: number;
    turns: number;
    tools: number;
    toolErrors: number;
    subagents: number;
    compactions: number;
    filesChanged: number;
    attentions: number;
  };
  /** The tool running right now (tool.started without its tool.ended), if any. */
  currentTool?: { tool: string; callId?: string; since: string; agentId?: string };
  /** The turn running right now, if any. */
  currentTurn?: { turnId?: string; since: string; promptChars?: number };
  openAttentions: Attention[];
  /** Latest turn.progress until its turn.transcript lands (spec §4). */
  progress?: { turn: number; user: string; assistant: string; at: string };
  /** From the latest turn.transcript, each cut to SNIPPET_CHARS. */
  lastUser?: string;
  lastAssistant?: string;
  /** Number of subagent sessions whose parent_id is this session. */
  children: number;
  /** Last tool names, newest last, at most 8 — for a sparkline of activity. */
  recentTools: { tool: string; ok: boolean; ms?: number }[];
}

export const SNIPPET_CHARS = 280;

export interface MachineSummary {
  name: string;
  lastAt: string;
  /** harness name → version last seen. */
  harnesses: Record<string, string | undefined>;
  sessions: number;
  working: number;
  needsYou: number;
  /** Present once the machine's control daemon paired with this receiver. */
  control?: MachineControl;
}

export interface MachineControl {
  machineId: string;
  online: boolean;
  lastPollAt?: string;
  lastHelloAt?: string;
  mode?: "safe" | "auto";
  folders?: string[];
  harnesses?: string[];
  modes?: string[];
  version?: string;
  accounts?: { harness: string; id: string; email: string }[];
  keys: { id: string; alg: number; name?: string; addedAt: string }[];
  /** Messages queued for it and not yet finally acked. */
  queued: number;
}

export interface Stats {
  events: number;
  sessions: number;
  machines: number;
  eventsLastMinute: number;
  /** Median event.time → arrivedAt over the last 200 HTTP events, ms. */
  latencyP50Ms?: number;
  storageBytes: number;
  uptimeS: number;
}

export interface Snapshot {
  at: string;
  sessions: SessionSummary[];
  machines: MachineSummary[];
  stats: Stats;
  viewers?: Viewer[];
}

/** What `GET /api/ui/stream` (SSE) sends. The `event:` field of each SSE frame is the
 *  `kind`; the `data:` field is the JSON of the whole message. The first frame is
 *  always a snapshot. */
export type StreamMessage =
  | { kind: "snapshot"; snapshot: Snapshot }
  | { kind: "event"; event: StoredEvent; session: SessionSummary }
  | { kind: "session"; session: SessionSummary }
  | { kind: "forgotten"; key: SessionKey }
  | { kind: "machine"; machine: MachineSummary }
  | { kind: "stats"; stats: Stats }
  | { kind: "control"; message: ControlActivity }
  | { kind: "viewers"; viewers: Viewer[] };

/** A browser connected to this GUI's stream right now: a phone on the LAN, this
 *  laptop's own tab. The receiver's reading of "devices", from the connection only;
 *  nothing is installed on the device. */
export interface Viewer {
  /** Per connection; stable while the SSE stream stays open. */
  id: string;
  /** Remote address as seen by the server; "this machine" when loopback. */
  ip: string;
  loopback: boolean;
  device: "phone" | "tablet" | "laptop" | "desktop" | "unknown";
  /** Short human label from the user agent, e.g. "iPhone · Safari", "Mac · Chrome". */
  label: string;
  connectedAt: string;
  lastSeenAt: string;
  /** True in the copy sent to that very connection. */
  current?: boolean;
}

export interface SessionDetail {
  session: SessionSummary;
  /** Ordered by seq. Paged: `after` is the last seq the client has. */
  events: StoredEvent[];
  total: number;
  /** Subagent sessions of this one. */
  children: SessionSummary[];
}

export interface FeedPage {
  events: StoredEvent[];
  /** Pass back as `before` for the next (older) page; absent when exhausted. */
  cursor?: string;
}

export interface FeedQuery {
  limit?: number;
  before?: string;
  harness?: string;
  machine?: string;
  type?: string;
  session?: SessionKey;
  q?: string;
}

export interface Info {
  name: "sessionpipe-gui";
  version: string;
  startedAt: string;
  port: number;
  urls: { local: string; lan: string[] };
  /** The `sessionpipe sink add …` line for another machine, with the LAN URL and the token. */
  sinkCommand: string;
  sinkToken: string;
  /** Appended as `?k=` to the LAN URL so a phone can open the UI; embedded in the QR. */
  uiKey: string;
  sources: {
    http: true;
    outbox: { path: string; sessions: number; enabled: boolean; events?: number } | null;
    demo: boolean;
  };
  storage: { dir: string; bytes: number };
  wellKnown: Record<string, unknown>;
  control: { enabled: boolean; rpId: string; machines: number };
}

// ---------- control (phase 2; shapes fixed now so both sides can plan) ----------

export type ControlKind = "prompt" | "permission.answer" | "cancel" | "start" | "key.add";
export type ControlOutcome = "progress" | "taken" | "delivered" | "expired" | "unsupported" | "failed" | "refused";

/** A control message the receiver carries, as the UI sees it (never the raw signature). */
export interface ControlActivity {
  id: string;
  machineId: string;
  kind: ControlKind;
  session?: SessionKey;
  text?: string;
  at: string;
  expiresAt: string;
  outcome?: ControlOutcome;
  mode?: string;
  code?: string;
  detail?: string;
  reply?: string;
  replySeq?: number;
  /** The session the final ack named (a fork, or the session a start created), when it differs. */
  ackSession?: string;
  takenAt?: string;
  ackedAt?: string;
}

// ---------- routes ----------

export const ROUTES = {
  wellKnown: "/.well-known/sessionpipe",
  events: "/api/sessionpipe/v1/events",
  control: "/api/sessionpipe/v1/control",
  native: "/api/sessionpipe/v1/native",
  ui: {
    info: "/api/ui/info",
    snapshot: "/api/ui/snapshot",
    stream: "/api/ui/stream",
    /** GET /api/ui/sessions/:harness/:id?after=<seq>&limit=<n> → SessionDetail */
    session: "/api/ui/sessions",
    /** GET /api/ui/events?<FeedQuery> → FeedPage */
    feed: "/api/ui/events",
    /** POST /api/ui/sessions/:harness/:id/forget */
    forget: "/api/ui/sessions",
    /** POST → { sinkToken } */
    rotateToken: "/api/ui/token/rotate",
    /** POST { on: boolean } → Info.sources.demo */
    demo: "/api/ui/demo",
    /** GET → image/svg+xml: the LAN URL with the UI key, for a phone camera. */
    qr: "/api/ui/qr.svg",
    control: "/api/ui/control",
    /** GET → { viewers: Viewer[] } */
    viewers: "/api/ui/viewers",
  },
} as const;

export const DEFAULT_PORT = 7373;
export const UI_KEY_COOKIE = "spgui";
export const UI_KEY_PARAM = "k";
