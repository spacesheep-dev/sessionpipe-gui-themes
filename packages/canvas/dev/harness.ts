// SPDX-License-Identifier: Apache-2.0
// Mounts the theme against a fake ThemeApi. Query: ?scheme=light|dark (default: the OS),
// ?tick=0 to freeze the world (tests), ?speed=N ticks per second, ?extra=N more sessions.
import type { ThemeApi, ThemeManifest, ThemeSnapshot } from "@sessionpipe-gui/theme-types";
import type { SessionSummary } from "@sessionpipe-gui/theme-types/api";
import theme from "../src/index";
import manifest from "../theme.json";
import { World } from "./mock";

const q = new URLSearchParams(location.search);
const scheme: "dark" | "light" =
  q.get("scheme") === "light" || q.get("scheme") === "dark"
    ? (q.get("scheme") as "dark" | "light")
    : matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
document.documentElement.dataset.theme = scheme;

const world = new World({
  extra: Number(q.get("extra") ?? 0),
  seed: Number(q.get("seed") ?? 7),
  small: q.get("world") === "small",
  repos: Number(q.get("repos") ?? 0),
});
const log = document.getElementById("log")!;
const say = (s: string) => {
  log.textContent = s;
  clearTimeout((say as unknown as { t?: number }).t);
  (say as unknown as { t?: number }).t = window.setTimeout(() => {
    log.textContent = "";
  }, 1500);
};

// Fake storage: in memory, with a per-call delay like a server round trip.
let stored: unknown = null;
// `?layout=` pre-seeds it (JSON), the way a layout saved by an earlier build would be there.
try {
  const seed = q.get("layout");
  if (seed) stored = JSON.parse(seed);
} catch {}
const storageLog: unknown[] = [];
const local = new Map<string, unknown>();

let lastOpen: { key: string; opts?: unknown } | null = null;
const listeners = new Set<(s: ThemeSnapshot) => void>();
const snap = (): ThemeSnapshot => ({
  connection: "live",
  sessions: world.sessions(),
  machines: world.machines(),
  stats: world.stats(),
  control: world.control,
  recent: world.recent.slice(0, 50),
  scheme,
  viewers: world.viewers,
});
let current = snap();
world.onChange = () => {
  current = snap();
  for (const l of listeners) l(current);
};

const api: ThemeApi = {
  version: 1,
  host: { name: "sessionpipe-gui", version: "0.0.0-harness" },
  manifest: manifest as ThemeManifest,
  baseUrl: `${location.origin}/`,
  state: {
    get: () => current,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  },
  onEvent(l) {
    return world.onEvent(l);
  },
  fetch: {
    async session(key, opts) {
      await new Promise((r) => setTimeout(r, 120));
      return world.detail(key, opts);
    },
    async forget(key) {
      world.forget(key);
    },
  },
  control:
    q.get("control") === "0"
      ? undefined
      : {
          availability: (t) => world.availability(t),
          send: (k, text) => world.send(k, text),
          answer: (k, id, d, note) => world.answer(k, id, d, note),
          cancel: (k) => world.cancel(k),
          start: (m, o) => world.start(m, o),
        },
  navigate: (path) => say(`navigate(${path})`),
  openSession: (key, opts) => {
    lastOpen = { key, opts };
    say(`openSession(${key}${opts?.split ? " · split" : ""})`);
  },
  tokens: [
    "--bg",
    "--bg-2",
    "--bg-3",
    "--line",
    "--line-2",
    "--fg",
    "--fg-2",
    "--fg-3",
    "--fg-4",
    "--needs",
    "--ok",
    "--err",
  ],
  storage: {
    async get<T>() {
      await new Promise((r) => setTimeout(r, 30));
      return stored as T | null;
    },
    async set(value) {
      await new Promise((r) => setTimeout(r, 30));
      stored = JSON.parse(JSON.stringify(value));
      storageLog.push(stored);
    },
  },
  local: {
    get: <T>(k: string) => (local.get(k) as T) ?? null,
    set: (k, v) => void local.set(k, v),
  },
  format: {
    ago: (iso, now = Date.now()) => ago(iso, now),
    duration: (ms) => dur(ms),
    title: (s) => s.title?.trim() || (s.cwd ? s.cwd.split("/").pop()! : s.id.slice(0, 8)),
    repoBranch: (s) => {
      const r = (s.repo ?? "")
        .replace(/^[a-z]+:\/\//, "")
        .split("/")
        .filter(Boolean)
        .slice(-2)
        .join("/");
      return r && s.branch ? `${r} @ ${s.branch}` : r || s.branch || "";
    },
    monogram: (h) => ({ "claude-code": "Cl", codex: "Cx", "gemini-cli": "Ge", cursor: "Cu" })[h] ?? h.slice(0, 2),
  },
};

function ago(iso: string, now: number): string {
  const d = Math.max(0, now - Date.parse(iso));
  if (d < 60_000) return "just now";
  if (d < 3600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3600_000)} h ago`;
  return `${Math.round(d / 86_400_000)} d ago`;
}
function dur(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

const host = document.getElementById("host")!;
const unmount = await theme.mount(host, api);

const speed = Number(q.get("speed") ?? 1);
const tick = q.get("tick") !== "0";
if (tick) setInterval(() => world.tick(), 1400 / Math.max(0.1, speed));

declare global {
  interface Window {
    __harness: {
      api: ThemeApi;
      world: World;
      unmount: () => void;
      stored: () => unknown;
      storageLog: unknown[];
      local: Map<string, unknown>;
      sessions: () => SessionSummary[];
      lastOpen: () => { key: string; opts?: unknown } | null;
    };
  }
}
window.__harness = {
  api,
  world,
  unmount,
  stored: () => stored,
  storageLog,
  local,
  sessions: () => [...world.sessions().values()],
  lastOpen: () => lastOpen,
};
