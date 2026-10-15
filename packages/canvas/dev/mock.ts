// SPDX-License-Identifier: Apache-2.0
// A small live world for the harness: sessions in every state on two machines, with
// subagents, an event backlog per session, and a tick that moves things along. Also the
// knobs the Playwright tests turn (raise, clear, end, start).
import type {
  Attention,
  ControlActivity,
  MachineControl,
  MachineSummary,
  SessionDetail,
  SessionKey,
  SessionState,
  SessionSummary,
  Stats,
  StoredEvent,
  Viewer,
} from "@sessionpipe-gui/theme-types/api";

const MACHINES = ["misha-air", "studio"] as const;
const TOOLS: Record<string, string[]> = {
  "claude-code": ["Bash", "Read", "Edit", "Grep", "Write", "Glob"],
  codex: ["shell", "apply_patch", "read_file"],
  "gemini-cli": ["run_shell_command", "read_file", "replace"],
  cursor: ["Read", "Edit", "Search"],
};
const INPUTS: Record<string, () => Record<string, unknown>> = {
  Bash: () => ({
    command: pick(["npm test", "git status", "node scripts/build.mjs", "npx vitest run core", "ls dist"]),
  }),
  shell: () => ({ command: pick(["cargo build", "pytest -q", "make lint"]) }),
  run_shell_command: () => ({ command: "npm run typecheck" }),
  Read: () => ({ file_path: pick(["server/receiver.ts", "web/src/app.tsx", "shared/api.ts", "core/src/outbox.ts"]) }),
  read_file: () => ({ path: pick(["src/main.rs", "src/lib.rs"]) }),
  Edit: () => ({ file_path: pick(["server/receiver.ts", "web/src/pages/board.tsx"]) }),
  Grep: () => ({ pattern: pick(["flushOutbox", "THEME_ROUTES", "sessionKey\\("]) }),
  Glob: () => ({ pattern: "**/*.spec.ts" }),
  Write: () => ({ file_path: "docs/themes.md" }),
  Search: () => ({ query: "storage adapter" }),
};
const PROSE = [
  "Looking at the receiver's flush path first. The outbox tailer reads in 64 KB chunks and the batch window is 200 ms, so a burst of hook events gets coalesced before the POST.",
  "The failing test expects the 429 to back off exponentially; the current code retries at a fixed 500 ms. I'll change the schedule to 0.5, 1, 2, 4 s with jitter and cap it at five attempts.",
  "Three call sites build the session key by hand. I'll route them through sessionKey() so the harness name is always the prefix.",
  "I reproduced it: the SSE stream drops the first frame when the client reconnects within the same tick. Moving the snapshot write after the headers flush fixes it.",
  "The landing page hero reads fine at 1440 but the lead wraps to three lines on a phone; shortening it to one clause keeps the rhythm.",
  "Done. Typecheck and the e2e suite pass; the diff is 41 lines across two files.",
];
const ASKS: { kind: Attention["kind"]; tool?: string; message: string }[] = [
  { kind: "permission", tool: "Bash", message: "rm -rf dist && npm run build" },
  { kind: "permission", tool: "Edit", message: "Write to server/receiver.ts outside the allowed folders?" },
  { kind: "question", message: "Should the retry cap be five attempts or unlimited with a ceiling?" },
  { kind: "error", message: "ENOSPC: no space left on device while writing the outbox" },
  { kind: "elicitation", message: "Which port should the dev server use?" },
];
const TITLES = [
  "Refactor the receiver's flush path",
  "Theme loader: manifest and routes",
  "Landing page hero copy",
  "Flaky e2e on the phone project",
  "DCO check in CI",
  "Migrate storage to SQLite",
  "Backoff on 429 from the sink",
  "Snapshot drops the first SSE frame",
  "Playwright flake hunt",
  "Type the control message shapes",
  "Outbox tailer chunk size",
  "Tidy the board's state columns",
  "Replace moment with Intl",
  "QR for the LAN URL",
  "Session title from the first ask",
];
const REPOS = [
  ["github.com/spacesheep-dev/sessionpipe", "mp/flush"],
  ["github.com/spacesheep-dev/sessionpipe-gui", "mp/themes"],
  ["github.com/spacesheep-dev/sessionpipe", "mp/landing-page"],
  ["github.com/spacesheep-dev/sessionpipe-gui", "main"],
  ["github.com/spacesheep-dev/spacesheep", "feat/sink-backoff"],
];
const HARNESSES = ["claude-code", "codex", "gemini-cli", "cursor"];
/** Accounts per harness; claude-code has two so the agents lane shows a group. */
const ACCOUNTS: Record<string, { id: string; email: string }[]> = {
  "claude-code": [
    { id: "acct_7f3a9c", email: "dev@example.com" },
    { id: "acct_21bd04", email: "dev.home@example.com" },
  ],
  codex: [{ id: "org-9kq2", email: "dev@example.com" }],
  "gemini-cli": [{ id: "ge-114", email: "" }],
  cursor: [{ id: "cu-02", email: "" }],
};
const FOLDERS: Record<string, string[]> = {
  "misha-air": [
    "/Users/misha/Desktop/Projects/sessionpipe",
    "/Users/misha/Desktop/Projects/sessionpipe-gui",
    "/Users/misha/Desktop/Projects/spacesheep",
  ],
  studio: ["/home/misha/work/spacesheep", "/home/misha/work/sessionpipe"],
};
const MODELS: Record<string, string> = {
  "claude-code": "claude-fable-5-1",
  codex: "gpt-5-codex",
  "gemini-cli": "gemini-2.5-pro",
  cursor: "claude-sonnet-4-5",
};

let rnd = () => Math.random();
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
const iso = (t: number) => new Date(t).toISOString();

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

interface Rec {
  s: SessionSummary;
  events: StoredEvent[];
  seq: number;
  turn: number;
  toolAt?: number;
  prose: string;
  proseAt: number;
}

export interface ControlCall {
  kind: "send" | "answer" | "cancel" | "start";
  args: unknown[];
}

export class World {
  private recs = new Map<SessionKey, Rec>();
  private eventListeners = new Set<(e: StoredEvent, s: SessionSummary) => void>();
  private n = 0;
  recent: StoredEvent[] = [];
  /** Newest first, like the host's snapshot.control. */
  control: ControlActivity[] = [];
  /** Every control call the theme made, for the tests. */
  calls: ControlCall[] = [];
  /** Which machines' daemons answer right now. */
  online: Record<string, boolean> = { "misha-air": true, studio: false };
  viewers: Viewer[] = [
    {
      id: "v1",
      ip: "this machine",
      loopback: true,
      device: "laptop",
      label: "Mac · Chrome",
      connectedAt: iso(Date.now() - 3600_000),
      lastSeenAt: iso(Date.now()),
      current: true,
    },
    {
      id: "v2",
      ip: "192.168.1.24",
      loopback: false,
      device: "phone",
      label: "iPhone · Safari",
      connectedAt: iso(Date.now() - 900_000),
      lastSeenAt: iso(Date.now() - 20_000),
    },
    {
      id: "v3",
      ip: "192.168.1.31",
      loopback: false,
      device: "tablet",
      label: "iPad · Safari",
      connectedAt: iso(Date.now() - 300_000),
      lastSeenAt: iso(Date.now() - 5_000),
    },
  ];
  onChange: () => void = () => {};
  startedAt = Date.now();
  private ticks = 0;

  constructor(opts: { extra?: number; seed?: number; small?: boolean; repos?: number } = {}) {
    rnd = seeded(opts.seed ?? 7);
    const now = Date.now();
    const m = (i: number) => MACHINES[i % 2]!;
    if (opts.small) {
      // Two machines, three accounts, two repos: the map test's fixture.
      const a = this.spawn({
        harness: "claude-code",
        machine: m(0),
        title: TITLES[0],
        state: "working",
        at: now - 42 * 60_000,
        repo: 0,
        account: 0,
      });
      this.spawnSub(a, "Explore");
      this.spawnSub(a, "Plan");
      this.spawn({
        harness: "claude-code",
        machine: m(0),
        title: TITLES[2],
        state: "idle",
        at: now - 70 * 60_000,
        repo: 1,
        account: 1,
      });
      this.spawn({
        harness: "codex",
        machine: m(0),
        title: TITLES[1],
        state: "needs_you",
        at: now - 18 * 60_000,
        repo: 1,
        ask: 0,
        account: 0,
      });
      this.spawn({
        harness: "claude-code",
        machine: m(1),
        title: TITLES[8],
        state: "working",
        at: now - 9 * 60_000,
        repo: 0,
        account: 0,
      });
      this.moreRepos(opts.repos ?? 0, now);
      return;
    }
    const parent = this.spawn({
      harness: "claude-code",
      machine: m(0),
      title: TITLES[0],
      state: "working",
      at: now - 42 * 60_000,
      repo: 0,
    });
    this.spawnSub(parent, "Explore");
    this.spawnSub(parent, "Plan");
    this.spawn({
      harness: "codex",
      machine: m(1),
      title: TITLES[1],
      state: "needs_you",
      at: now - 18 * 60_000,
      repo: 1,
      ask: 0,
    });
    this.spawn({
      harness: "claude-code",
      machine: m(0),
      title: TITLES[2],
      state: "idle",
      at: now - 70 * 60_000,
      repo: 2,
    });
    this.spawn({
      harness: "gemini-cli",
      machine: m(1),
      title: TITLES[3],
      state: "stale",
      at: now - 25 * 60_000,
      repo: 3,
    });
    this.spawn({
      harness: "claude-code",
      machine: m(0),
      title: TITLES[4],
      state: "working",
      at: now - 6 * 60_000,
      repo: 1,
      writing: true,
    });
    this.spawn({
      harness: "cursor",
      machine: m(1),
      title: TITLES[5],
      state: "working",
      at: now - 90 * 60_000,
      repo: 4,
    });
    this.spawn({
      harness: "claude-code",
      machine: m(1),
      title: TITLES[8],
      state: "needs_you",
      at: now - 9 * 60_000,
      repo: 3,
      ask: 2,
    });
    this.spawn({ harness: "codex", machine: m(0), title: TITLES[9], state: "idle", at: now - 130 * 60_000, repo: 1 });
    this.spawn({
      harness: "claude-code",
      machine: m(1),
      title: TITLES[10],
      state: "working",
      at: now - 3 * 60_000,
      repo: 0,
    });
    for (let i = 0; i < 3; i++) {
      this.spawn({
        harness: pick(HARNESSES),
        machine: m(i),
        title: TITLES[11 + i],
        state: "done",
        at: now - (3 + i) * 3600_000,
        repo: i,
      });
    }
    for (let i = 0; i < (opts.extra ?? 0); i++) {
      this.spawn({
        harness: pick(HARNESSES),
        machine: m(i),
        title: `${pick(TITLES)} #${i + 1}`,
        state: pick(["working", "working", "idle", "stale"]),
        at: now - Math.floor(rnd() * 120) * 60_000,
        repo: i % REPOS.length,
      });
    }
  }

  /** N more idle sessions, each in a repo of its own: the storage lane gets crowded. */
  private moreRepos(n: number, now: number) {
    for (let i = 0; i < n; i++) {
      const key = this.spawn({
        harness: "claude-code",
        machine: MACHINES[i % 2]!,
        title: `Repo ${i + 1} chores`,
        state: "idle",
        at: now - (30 + i) * 60_000,
        repo: 0,
        account: 0,
      });
      const r = this.recs.get(key)!;
      r.s.repo = `github.com/acme/service-${String(i + 1).padStart(2, "0")}`;
      r.s.branch = "main";
    }
  }

  // ---------- reads ----------

  sessions(): Map<SessionKey, SessionSummary> {
    const out = new Map<SessionKey, SessionSummary>();
    for (const [k, r] of this.recs) out.set(k, r.s);
    return out;
  }

  machines(): Map<string, MachineSummary> {
    const out = new Map<string, MachineSummary>();
    for (const name of MACHINES) {
      const mine = [...this.recs.values()].filter((r) => r.s.machine === name);
      out.set(name, {
        name,
        lastAt: iso(Date.now()),
        harnesses: { "claude-code": "2.1.290", codex: "0.157.1" },
        sessions: mine.length,
        working: mine.filter((r) => r.s.state === "working").length,
        needsYou: mine.filter((r) => r.s.state === "needs_you").length,
        control: this.machineControl(name),
      });
    }
    return out;
  }

  private machineControl(name: string): MachineControl {
    const seen = new Set<string>();
    const accounts: { harness: string; id: string; email: string }[] = [];
    for (const r of this.recs.values()) {
      if (r.s.machine !== name || !r.s.accountId || seen.has(r.s.accountId)) continue;
      seen.add(r.s.accountId);
      const a = ACCOUNTS[r.s.harness]?.find((x) => x.id === r.s.accountId);
      accounts.push({ harness: r.s.harness, id: r.s.accountId, email: a?.email ?? "" });
    }
    return {
      machineId: `m_${name}`,
      online: this.online[name] ?? false,
      lastPollAt: iso(Date.now() - (this.online[name] ? 2000 : 3 * 3600_000)),
      mode: "safe",
      folders: FOLDERS[name] ?? [],
      harnesses: ["claude-code", "codex"],
      version: "0.7.2",
      accounts,
      keys:
        name === "misha-air"
          ? [
              { id: "k1", alg: -7, name: "Misha's iPhone", addedAt: iso(Date.now() - 86_400_000) },
              { id: "k2", alg: -7, name: "MacBook Touch ID", addedAt: iso(Date.now() - 86_400_000 * 3) },
            ]
          : [{ id: "k3", alg: -7, name: "Misha's iPhone", addedAt: iso(Date.now() - 86_400_000) }],
      queued: this.control.filter((a) => a.machineId === `m_${name}` && !a.outcome).length,
    };
  }

  // ---------- the fake control channel ----------

  availability(target: { session?: SessionKey; machineId?: string }): { ok: boolean; reason?: string } {
    let machine: string | undefined;
    if (target.session) {
      const r = this.recs.get(target.session);
      if (!r) return { ok: false, reason: "the session is gone" };
      if (r.s.state === "done") return { ok: false, reason: "the session has ended" };
      machine = r.s.machine;
    } else if (target.machineId) {
      machine = MACHINES.find((n) => `m_${n}` === target.machineId);
      if (!machine) return { ok: false, reason: "this machine is not paired here" };
    }
    if (!machine) return { ok: false, reason: "no machine" };
    if (!this.online[machine]) return { ok: false, reason: `${machine}'s daemon is offline` };
    return { ok: true };
  }

  private activity(
    kind: ControlActivity["kind"],
    machine: string,
    session: SessionKey | undefined,
    text?: string,
  ): ControlActivity {
    const now = Date.now();
    const a: ControlActivity = {
      id: `msg_${(++this.n).toString(36)}`,
      machineId: `m_${machine}`,
      kind,
      session,
      text,
      at: iso(now),
      expiresAt: iso(now + 15 * 60_000),
      mode: "safe",
    };
    this.control = [a, ...this.control].slice(0, 200);
    return a;
  }

  /** queued → taken → working (the reply growing) → delivered, over about three seconds. */
  private carry(a: ControlActivity, reply: string | undefined, onDelivered?: () => void) {
    const step = (patch: Partial<ControlActivity>, ms: number) =>
      new Promise<void>((r) =>
        setTimeout(() => {
          Object.assign(a, patch);
          this.control = [...this.control];
          this.onChange();
          r();
        }, ms),
      );
    void (async () => {
      await step({ outcome: "taken", takenAt: iso(Date.now()) }, 500);
      if (reply) {
        await step({ reply: reply.slice(0, Math.ceil(reply.length / 3)) }, 700);
        await step({ reply: reply.slice(0, Math.ceil((reply.length * 2) / 3)) }, 700);
      }
      await step({ outcome: "delivered", ackedAt: iso(Date.now()), reply }, 700);
      onDelivered?.();
    })();
  }

  send(session: SessionKey, text: string): Promise<ControlActivity> {
    this.calls.push({ kind: "send", args: [session, text] });
    const av = this.availability({ session });
    if (!av.ok) return Promise.reject(new Error(av.reason));
    const r = this.recs.get(session)!;
    const a = this.activity("prompt", r.s.machine!, session, text);
    this.carry(a, undefined, () => {
      // The prompt lands: a new turn starts on the session.
      if (r.s.state === "done") return;
      r.turn++;
      r.prose = pick(PROSE);
      r.proseAt = 0;
      r.s.currentTurn = { turnId: `t_${r.turn}`, since: iso(Date.now()), promptChars: text.length };
      r.s.counts.turns++;
      r.s.progress = { turn: r.turn, user: text, assistant: "", at: iso(Date.now()) };
      r.s.openAttentions = [];
      this.setState(r, "working");
      this.emit(r, "turn.started", { turn_id: `t_${r.turn}`, prompt_chars: text.length });
      this.onChange();
    });
    this.onChange();
    return Promise.resolve(a);
  }

  answer(
    session: SessionKey,
    attentionId: string,
    decision: "allow" | "deny",
    note?: string,
  ): Promise<ControlActivity> {
    this.calls.push({ kind: "answer", args: [session, attentionId, decision, note] });
    const av = this.availability({ session });
    if (!av.ok) return Promise.reject(new Error(av.reason));
    const r = this.recs.get(session)!;
    if (!r.s.openAttentions.some((x) => x.attentionId === attentionId)) {
      return Promise.reject(new Error("that permission is no longer open"));
    }
    const a = this.activity("permission.answer", r.s.machine!, session, decision);
    this.carry(a, undefined, () => this.clear(session));
    this.onChange();
    return Promise.resolve(a);
  }

  cancel(session: SessionKey): Promise<ControlActivity> {
    this.calls.push({ kind: "cancel", args: [session] });
    const av = this.availability({ session });
    if (!av.ok) return Promise.reject(new Error(av.reason));
    const r = this.recs.get(session)!;
    const a = this.activity("cancel", r.s.machine!, session);
    this.carry(a, undefined, () => {
      if (r.s.currentTool) this.endTool(r);
      if (r.s.currentTurn) this.emit(r, "turn.ended", { reason: "cancel", ms: 1000 });
      r.s.currentTurn = undefined;
      r.s.progress = undefined;
      this.setState(r, "idle");
      this.onChange();
    });
    this.onChange();
    return Promise.resolve(a);
  }

  start(
    machineId: string,
    opts: { harness: string; cwd: string; text: string },
  ): Promise<ControlActivity & { session: SessionKey }> {
    this.calls.push({ kind: "start", args: [machineId, opts] });
    const av = this.availability({ machineId });
    if (!av.ok) return Promise.reject(new Error(av.reason));
    const machine = MACHINES.find((n) => `m_${n}` === machineId)!;
    const id = `${opts.harness.slice(0, 2)}_start${(++this.n).toString(36)}`;
    const session = `${opts.harness}:${id}`;
    const a = this.activity("start", machine, session, opts.text) as ControlActivity & { session: SessionKey };
    a.session = session;
    this.carry(a, "Starting…", () => {
      const key = this.spawnWithId(id, {
        harness: opts.harness,
        machine,
        title: opts.text,
        state: "working",
        at: Date.now(),
        repo: 0,
        cwd: opts.cwd,
        account: 0,
      });
      a.ackSession = key;
      this.onChange();
    });
    this.onChange();
    return Promise.resolve(a);
  }

  private forcedId: string | undefined;
  private spawnWithId(id: string, o: Parameters<World["spawn"]>[0]): SessionKey {
    this.forcedId = id;
    try {
      return this.spawn(o);
    } finally {
      this.forcedId = undefined;
    }
  }

  stats(): Stats {
    return {
      events: this.recent.length,
      sessions: this.recs.size,
      machines: 2,
      eventsLastMinute: 12,
      storageBytes: 1 << 20,
      uptimeS: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  detail(key: SessionKey, opts?: { after?: number; limit?: number }): SessionDetail {
    const r = this.recs.get(key);
    if (!r) throw new Error(`no session ${key}`);
    const after = opts?.after ?? -1;
    const limit = opts?.limit ?? 200;
    const events = r.events.filter((e) => e.session.seq > after).slice(-limit);
    return {
      session: r.s,
      events,
      total: r.events.length,
      children: [...this.recs.values()].filter((x) => x.s.parentId === r.s.id).map((x) => x.s),
    };
  }

  onEvent(l: (e: StoredEvent, s: SessionSummary) => void) {
    this.eventListeners.add(l);
    return () => void this.eventListeners.delete(l);
  }

  forget(key: SessionKey) {
    this.recs.delete(key);
    this.onChange();
  }

  // ---------- knobs ----------

  /** Push a session's last event back in time (for the age fade). */
  age(key: SessionKey, ms: number) {
    const r = this.recs.get(key);
    if (!r) return;
    r.s.lastAt = iso(Date.now() - ms);
    r.s.stateSince = iso(Date.now() - ms);
    this.onChange();
  }

  /** Touch a session: a heartbeat lands and it becomes the latest. */
  touch(key: SessionKey) {
    const r = this.recs.get(key);
    if (!r) return;
    this.emit(r, "session.heartbeat", {});
    this.onChange();
  }

  keys(state?: SessionState): SessionKey[] {
    return [...this.recs.values()].filter((r) => !state || r.s.state === state).map((r) => r.s.key);
  }

  raise(key: SessionKey, i = 0) {
    const r = this.recs.get(key);
    if (!r || r.s.state === "done") return;
    const ask = ASKS[i % ASKS.length]!;
    const att: Attention = {
      attentionId: `att_${++this.n}`,
      kind: ask.kind,
      tool: ask.tool,
      message: ask.message,
      at: iso(Date.now()),
    };
    r.s.openAttentions = [att];
    r.s.counts.attentions++;
    this.setState(r, "needs_you");
    this.emit(r, "attention.needed", {
      attention_id: att.attentionId,
      kind: att.kind,
      tool: att.tool,
      message: att.message,
    });
    this.onChange();
  }

  clear(key: SessionKey) {
    const r = this.recs.get(key);
    if (!r?.s.openAttentions.length) return;
    const att = r.s.openAttentions[0]!;
    r.s.openAttentions = [];
    this.setState(r, r.s.currentTurn ? "working" : "idle");
    this.emit(r, "attention.cleared", { attention_id: att.attentionId, how: "answered" });
    this.onChange();
  }

  end(key: SessionKey) {
    const r = this.recs.get(key);
    if (!r) return;
    if (r.s.currentTool) this.endTool(r);
    if (r.s.currentTurn) this.emit(r, "turn.ended", { reason: "stop", ms: 1200 });
    r.s.currentTool = undefined;
    r.s.currentTurn = undefined;
    r.s.openAttentions = [];
    r.s.endedAt = iso(Date.now());
    this.setState(r, "done");
    this.emit(r, "session.ended", { reason: "other" });
    for (const c of this.recs.values()) if (c.s.parentId === r.s.id && c.s.state !== "done") this.end(c.s.key);
    this.onChange();
  }

  spawnSession(opts: { harness?: string; machine?: string; title?: string; state?: SessionState } = {}): SessionKey {
    const key = this.spawn({
      harness: opts.harness ?? pick(HARNESSES),
      machine: opts.machine ?? pick(MACHINES),
      title: opts.title ?? pick(TITLES),
      state: opts.state ?? "working",
      at: Date.now(),
      repo: Math.floor(rnd() * REPOS.length),
    });
    this.onChange();
    return key;
  }

  startSub(parentKey: SessionKey, type = "Explore"): SessionKey | undefined {
    const p = this.recs.get(parentKey);
    if (!p) return undefined;
    const key = this.spawnSub(parentKey, type);
    this.onChange();
    return key;
  }

  /** One step of the world: tools turn over, prose grows, an ask comes and goes, a
   *  session ends and another starts. */
  tick() {
    this.ticks++;
    const now = Date.now();
    for (const r of this.recs.values()) {
      if (r.s.state !== "working") continue;
      if (r.s.currentTool) {
        if (rnd() < 0.45) {
          this.endTool(r);
          if (rnd() < 0.7) this.startTool(r);
        }
      } else if (rnd() < 0.35) {
        this.startTool(r);
      } else {
        this.grow(r, now);
      }
      r.s.lastAt = iso(now);
    }
    if (this.ticks % 9 === 4) {
      const w = this.keys("working").filter((k) => !this.recs.get(k)!.s.parentId);
      if (w.length) this.raise(pick(w), this.ticks % ASKS.length);
    }
    if (this.ticks % 9 === 0) {
      const n = this.keys("needs_you");
      if (n.length > 1) this.clear(pick(n));
    }
    if (this.ticks % 23 === 11) {
      const w = this.keys("working").filter((k) => !this.recs.get(k)!.s.parentId);
      if (w.length > 2) this.end(pick(w));
      this.spawnSession();
    }
    if (this.ticks % 17 === 8) {
      const w = this.keys("working").filter((k) => !this.recs.get(k)!.s.parentId);
      if (w.length) this.startSub(pick(w), pick(["Explore", "Plan", "general-purpose"]));
    }
    if (this.ticks % 13 === 6) {
      const subs = [...this.recs.values()].filter((r) => r.s.parentId && r.s.state !== "done");
      if (subs.length > 2) this.end(pick(subs).s.key);
    }
    this.onChange();
  }

  // ---------- internals ----------

  private spawn(o: {
    harness: string;
    machine: string;
    title?: string;
    state: SessionState;
    at: number;
    repo: number;
    ask?: number;
    writing?: boolean;
    parent?: Rec;
    account?: number;
    cwd?: string;
  }): SessionKey {
    const id =
      this.forcedId ??
      `${o.harness.slice(0, 2)}_${(++this.n).toString(36).padStart(4, "0")}${Math.floor(rnd() * 1e6).toString(36)}`;
    const key = `${o.harness}:${id}`;
    const [repo, branch] = REPOS[o.repo % REPOS.length] as [string, string];
    const sub = !!o.parent;
    const accounts = ACCOUNTS[o.harness] ?? [];
    const account = o.parent?.s.accountId ?? accounts[(o.account ?? this.n) % Math.max(1, accounts.length)]?.id;
    const s: SessionSummary = {
      key,
      harness: o.harness,
      harnessVersion: "2.1.290",
      id,
      machine: o.machine,
      cwd: o.cwd ?? `/Users/misha/Desktop/Projects/${repo.split("/").pop()}`,
      accountId: account,
      repo,
      branch,
      model: MODELS[o.harness],
      title: o.title,
      titleSource: "first-ask",
      parentId: o.parent?.s.id ?? null,
      state: o.state,
      stateSince: iso(o.at + 60_000),
      startedAt: iso(o.at),
      lastAt: iso(Date.now() - (o.state === "stale" ? 14 * 60_000 : 0)),
      endedAt: o.state === "done" ? iso(o.at + 50 * 60_000) : undefined,
      maxTier: 3,
      backfilled: false,
      source: "demo",
      counts: {
        events: 0,
        turns: 0,
        tools: 0,
        toolErrors: 0,
        subagents: 0,
        compactions: 0,
        filesChanged: 0,
        attentions: 0,
      },
      openAttentions: [],
      children: 0,
      recentTools: [],
    };
    const r: Rec = { s, events: [], seq: 0, turn: 0, prose: pick(PROSE), proseAt: 0 };
    this.recs.set(key, r);
    // A backlog so the expanded window has something to show.
    let t = o.at;
    this.emit(r, "session.started", { source: "startup" }, t);
    const turns = sub ? 1 : 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < turns; i++) {
      t += 20_000;
      r.turn++;
      const prompt = pick(TITLES);
      this.emit(r, "turn.started", { turn_id: `t_${r.turn}`, prompt_chars: prompt.length }, t);
      r.s.counts.turns++;
      const tools = 2 + Math.floor(rnd() * 5);
      for (let j = 0; j < tools; j++) {
        t += 4000 + rnd() * 20_000;
        const tool = pick(TOOLS[o.harness] ?? ["Bash"]);
        const input = INPUTS[tool]?.() ?? {};
        const callId = `toolu_${this.n}_${i}_${j}`;
        this.emit(r, "tool.started", { tool, call_id: callId, input }, t);
        t += 300 + rnd() * 6000;
        const ok = rnd() > 0.1;
        this.emit(
          r,
          "tool.ended",
          { tool, call_id: callId, ms: 300 + Math.floor(rnd() * 6000), ok, error: ok ? undefined : "exit 1" },
          t,
        );
        r.s.counts.tools++;
        if (!ok) r.s.counts.toolErrors++;
        r.s.recentTools.push({ tool, ok, ms: 1200 });
        if (tool === "Edit" || tool === "apply_patch" || tool === "Write") {
          r.s.counts.filesChanged++;
          this.emit(r, "files.changed", { paths: [(input.file_path as string) ?? "src/x.ts"] }, t + 10);
        }
      }
      const last = i === turns - 1;
      const keepOpen = last && (o.state === "working" || o.state === "needs_you" || o.state === "stale");
      if (!keepOpen) {
        t += 3000;
        this.emit(r, "turn.ended", { turn_id: `t_${r.turn}`, reason: "stop", ms: 60_000 }, t);
        const reply = pick(PROSE);
        this.emit(r, "turn.transcript", { turn: r.turn, user: prompt, assistant: reply, at: iso(t) }, t + 500);
        r.s.lastUser = prompt;
        r.s.lastAssistant = reply;
      } else {
        r.s.currentTurn = { turnId: `t_${r.turn}`, since: iso(t - 30_000), promptChars: prompt.length };
        r.s.progress = {
          turn: r.turn,
          user: prompt,
          assistant: o.writing ? r.prose.slice(0, 80) : r.prose.slice(0, 40),
          at: iso(Date.now() - 1000),
        };
        r.proseAt = r.s.progress.assistant.length;
        if (o.state === "working" && !o.writing) this.startTool(r);
      }
    }
    r.s.recentTools = r.s.recentTools.slice(-8);
    if (o.state === "needs_you") this.raise(key, o.ask ?? 0);
    if (o.state === "done") this.emit(r, "session.ended", { reason: "other" }, t + 5000);
    if (o.parent) {
      o.parent.s.counts.subagents++;
      o.parent.s.children++;
      this.emit(o.parent, "subagent.started", { agent_id: id, agent_type: o.title });
    }
    return key;
  }

  private spawnSub(parentKey: SessionKey, type: string): SessionKey {
    const p = this.recs.get(parentKey)!;
    return this.spawn({
      harness: p.s.harness,
      machine: p.s.machine!,
      title: type,
      state: "working",
      at: Date.now() - 90_000,
      repo: 0,
      parent: p,
    });
  }

  private setState(r: Rec, state: SessionState) {
    if (r.s.state === state) return;
    r.s.state = state;
    r.s.stateSince = iso(Date.now());
  }

  private startTool(r: Rec) {
    const tool = pick(TOOLS[r.s.harness] ?? ["Bash"]);
    const callId = `toolu_${++this.n}`;
    const input = INPUTS[tool]?.() ?? {};
    r.s.currentTool = { tool, callId, since: iso(Date.now()) };
    r.toolAt = Date.now();
    this.emit(r, "tool.started", { tool, call_id: callId, input });
  }

  private endTool(r: Rec) {
    const t = r.s.currentTool;
    if (!t) return;
    const ok = rnd() > 0.12;
    const ms = Date.now() - (r.toolAt ?? Date.now());
    this.emit(r, "tool.ended", {
      tool: t.tool,
      call_id: t.callId,
      ms,
      ok,
      error: ok ? undefined : pick(["exit 1", "ENOENT: no such file", "timeout after 30 s"]),
    });
    r.s.counts.tools++;
    if (!ok) r.s.counts.toolErrors++;
    r.s.recentTools = [...r.s.recentTools, { tool: t.tool, ok, ms }].slice(-8);
    if (t.tool === "Edit" || t.tool === "Write" || t.tool === "apply_patch" || t.tool === "replace") {
      r.s.counts.filesChanged++;
      this.emit(r, "files.changed", { paths: ["server/receiver.ts"] });
    }
    r.s.currentTool = undefined;
  }

  private grow(r: Rec, now: number) {
    if (!r.s.progress) return;
    if (r.proseAt >= r.prose.length) {
      // The turn ends; a transcript lands; the session goes idle until the next prompt.
      this.emit(r, "turn.ended", { turn_id: `t_${r.turn}`, reason: "stop", ms: 45_000 });
      this.emit(r, "turn.transcript", { turn: r.turn, user: r.s.progress.user, assistant: r.prose, at: iso(now) });
      r.s.lastUser = r.s.progress.user;
      r.s.lastAssistant = r.prose;
      r.s.progress = undefined;
      r.s.currentTurn = undefined;
      this.setState(r, "idle");
      // …and comes back a few ticks later with a new prompt.
      setTimeout(
        () => {
          if (r.s.state !== "idle" || !this.recs.has(r.s.key)) return;
          r.turn++;
          const prompt = pick(TITLES);
          r.prose = pick(PROSE);
          r.proseAt = 0;
          r.s.currentTurn = { turnId: `t_${r.turn}`, since: iso(Date.now()), promptChars: prompt.length };
          r.s.counts.turns++;
          r.s.progress = { turn: r.turn, user: prompt, assistant: "", at: iso(Date.now()) };
          this.setState(r, "working");
          this.emit(r, "turn.started", { turn_id: `t_${r.turn}`, prompt_chars: prompt.length });
          this.onChange();
        },
        6000 + rnd() * 8000,
      );
      return;
    }
    r.proseAt = Math.min(r.prose.length, r.proseAt + 12 + Math.floor(rnd() * 30));
    r.s.progress = { ...r.s.progress, assistant: r.prose.slice(0, r.proseAt), at: iso(now) };
    this.emit(r, "turn.progress", {
      turn: r.turn,
      user: r.s.progress.user,
      assistant: r.s.progress.assistant,
      at: iso(now),
    });
  }

  private emit(r: Rec, type: string, data: Record<string, unknown>, at = Date.now()) {
    r.seq++;
    const e: StoredEvent = {
      protocol: 1,
      id: `01J${(this.n++).toString(36).padStart(8, "0")}`,
      type,
      time: iso(at),
      tier: 3,
      harness: { name: r.s.harness, version: r.s.harnessVersion },
      session: {
        id: r.s.id,
        seq: r.seq,
        machine: r.s.machine,
        cwd: r.s.cwd,
        repo: r.s.repo,
        branch: r.s.branch,
        model: r.s.model,
        title: r.s.title,
        parent_id: r.s.parentId,
      },
      privacy: { rulesets: [], pii: false },
      data,
      arrivedAt: iso(at),
      source: "demo",
    };
    r.events.push(e);
    r.s.counts.events++;
    if (at > Date.now() - 5000) {
      r.s.lastAt = iso(at);
      this.recent.unshift(e);
      if (this.recent.length > 300) this.recent.length = 300;
      for (const l of this.eventListeners) l(e, r.s);
    }
  }
}
