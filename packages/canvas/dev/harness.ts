// SPDX-License-Identifier: Apache-2.0
// Mounts the theme against a fake ThemeApi. Query: ?scheme=light|dark (default: the OS),
// ?tick=0 to freeze the world (tests), ?speed=N ticks per second, ?extra=N more sessions,
// ?room=<id> to share the stored document with another page (two devices; default: a
// room of its own), ?layout=<json> to seed it, ?control=0 for a host without control.
// The stored document lives in scripts/dev.mjs with the host's ETag rules; the menus,
// the confirm and the labels are small stand-ins for the host's, recorded for the tests.
import type { ThemeApi, ThemeManifest, ThemeSnapshot, ViewMenuItem } from "@sessionpipe-gui/theme-types";
import {
  LABEL_COLORS,
  LABEL_DEFAULT_NAMES,
  type LabelColor,
  type SessionKey,
  type SessionSummary,
} from "@sessionpipe-gui/theme-types/api";
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
const room = q.get("room") ?? `r${Math.random().toString(36).slice(2, 10)}`;

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

// ---------- the stored document: the dev server's, per room ----------

const stateUrl = `/__state?room=${encodeURIComponent(room)}`;
const storageLog: unknown[] = [];
// As the host does: the version this page last read or wrote; a write's announcement
// is checked only once no write of ours is in flight, so our own never echo.
let etag: string | null = null;
let writing = 0;
let announced: string | null = null;
async function read(): Promise<{ value: unknown; etag: string | null }> {
  const r = await fetch(stateUrl);
  return { value: r.status === 204 ? null : await r.json(), etag: r.headers.get("etag") };
}
async function write(value: unknown, ifMatch?: string | null): Promise<boolean> {
  writing++;
  try {
    const r = await fetch(stateUrl, {
      method: "PUT",
      headers: { "content-type": "application/json", ...(ifMatch ? { "if-match": ifMatch } : {}) },
      body: JSON.stringify(value ?? null),
    });
    if (r.status === 412) return false;
    etag = r.headers.get("etag") ?? etag;
    storageLog.push(JSON.parse(JSON.stringify(value ?? null)));
    return true;
  } finally {
    writing--;
    if (!writing) check();
  }
}
const seed = q.get("layout");
if (seed) await write(JSON.parse(seed));
const stateListeners = new Set<(v: unknown) => void>();
function check() {
  if (writing || !announced || announced === etag) return;
  announced = null;
  void read().then((r) => {
    etag = r.etag;
    for (const l of stateListeners) l(r.value);
  });
}
const events = new EventSource(`/__state/events?room=${encodeURIComponent(room)}`);
events.onmessage = (m) => {
  announced = (JSON.parse(m.data) as { etag: string }).etag;
  check();
};

// ---------- labels, the host's way ----------

const labelSessions = new Map<SessionKey, LabelColor>();
const labelNames: Record<LabelColor, string> = { ...LABEL_DEFAULT_NAMES };
let labels = { sessions: new Map(labelSessions), names: { ...labelNames } };
const labelCalls: unknown[] = [];

// ---------- the menus, recorded and drawn ----------

interface MenuCall {
  kind: "open" | "session" | "confirm";
  key?: string;
  at?: { x: number; y: number };
  source?: string;
  title?: string;
  items: string[];
  answer?: string[];
  extra?: string[];
}
const menus: MenuCall[] = [];
let menuEl: HTMLElement | undefined;
const closeMenu = () => {
  menuEl?.remove();
  menuEl = undefined;
};
document.addEventListener(
  "pointerdown",
  (e) => {
    if (menuEl && !menuEl.contains(e.target as Node)) closeMenu();
  },
  true,
);
// The host's menu keeps its Escape to itself.
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape" && menuEl) {
      closeMenu();
      e.stopPropagation();
    }
  },
  true,
);
const names = (items: readonly ViewMenuItem[]) =>
  items.map((i) => ("sep" in i ? "—" : "heading" in i ? `# ${i.heading}` : "items" in i ? `${i.label} ›` : i.label));

function drawMenu(items: readonly ViewMenuItem[], at: { x: number; y: number }, sheet: boolean, title?: string) {
  closeMenu();
  const m = document.createElement("div");
  m.className = `hm${sheet ? " is-sheet" : ""}`;
  m.setAttribute("role", "menu");
  if (!sheet) {
    m.style.left = `${at.x}px`;
    m.style.top = `${at.y}px`;
  } else m.style.left = "0";
  const fill = (list: readonly ViewMenuItem[]) => {
    m.replaceChildren();
    if (title) {
      const h = document.createElement("div");
      h.className = "hm-head";
      h.textContent = title;
      m.append(h);
    }
    for (const i of list) {
      if ("sep" in i) {
        m.append(document.createElement("hr"));
        continue;
      }
      if ("heading" in i) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "radio" in i && i.radio ? "menuitemradio" : "menuitem");
      if ("checked" in i && i.checked !== undefined) b.setAttribute("aria-checked", String(!!i.checked));
      const label = "items" in i ? `${i.label} ›` : i.label;
      b.append(document.createTextNode(label));
      if ("swatch" in i && i.swatch) b.dataset.swatch = i.swatch;
      if ("danger" in i && i.danger) b.classList.add("is-danger");
      if (i.disabled) b.setAttribute("aria-disabled", "true");
      if ("keys" in i && i.keys) {
        const k = document.createElement("span");
        k.className = "hm-keys";
        k.textContent = i.keys;
        b.append(k);
      }
      b.addEventListener("click", () => {
        if (i.disabled) return;
        if ("items" in i) fill(i.items);
        else {
          closeMenu();
          void i.run();
        }
      });
      m.append(b);
    }
  };
  fill(items);
  document.body.append(m);
  menuEl = m;
  // Clamped inside the window, as the host's is.
  if (!sheet) {
    const r = m.getBoundingClientRect();
    m.style.top = `${Math.max(8, Math.min(at.y, innerHeight - r.height - 8))}px`;
    m.style.left = `${Math.max(8, Math.min(at.x, innerWidth - r.width - 8))}px`;
  }
}

const menu: NonNullable<ThemeApi["menu"]> = {
  open(items, at, o = {}) {
    menus.push({ kind: "open", at, source: o.source, title: o.title, items: names(items) });
    drawMenu(items, at, o.source === "touch", o.title);
  },
  session(key, at, o = {}) {
    const s = world.sessions().get(key);
    if (!s) return;
    const current = labelSessions.get(key) ?? null;
    const items: ViewMenuItem[] = [
      { label: "Open as page", run: () => api.openSession(key) },
      { label: "Open beside", run: () => api.openSession(key, { split: true }) },
      { sep: true },
      ...(o.answer ?? []),
      ...(o.answer?.length ? [{ sep: true } as const] : []),
      {
        label: "Label",
        items: [
          ...LABEL_COLORS.map((c) => ({
            label: labelNames[c],
            swatch: c,
            radio: true,
            checked: current === c,
            run: () => api.labels!.set(key, c),
          })),
          { sep: true as const },
          { label: "None", radio: true, checked: current === null, run: () => api.labels!.set(key, null) },
        ],
      },
      ...(o.extra ?? []),
      { sep: true },
      { label: "Copy", items: [{ label: "Session ID", run: () => {} }] },
      { sep: true },
      { label: "Forget…", danger: true, run: () => world.forget(key) },
    ];
    menus.push({
      kind: "session",
      key,
      at,
      source: o.source,
      items: names(items),
      answer: names(o.answer ?? []),
      extra: names(o.extra ?? []),
    });
    drawMenu(items, at, o.source === "touch", s.title);
  },
  async confirm(o) {
    menus.push({ kind: "confirm", title: o.title, items: [o.action] });
    return (window as unknown as { __confirm?: boolean }).__confirm ?? true;
  },
};

// ---------- the API ----------

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
  labels,
});
let current = snap();
world.onChange = () => {
  current = snap();
  for (const l of listeners) l(current);
};
const relabel = () => {
  labels = { sessions: new Map(labelSessions), names: { ...labelNames } };
  world.onChange();
};

const ICONS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
  cursor: "Cursor",
};
const lsKey = (k: string) => `canvas-harness.${room}.${k}`;

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
    say(`openSession(${key}${opts?.split ? " · split" : ""}${opts?.agent ? ` · agent ${opts.agent}` : ""})`);
  },
  tokens: ["--bg", "--bg-2", "--bg-3", "--line", "--line-2", "--fg", "--fg-2", "--fg-3", "--fg-4", "--needs", "--err"],
  storage: {
    async get<T>() {
      const r = await read();
      etag = r.etag;
      return r.value as T | null;
    },
    async set(value) {
      await write(value);
    },
    async update<T>(change: (cur: T | null) => T): Promise<T> {
      for (let i = 0; i < 5; i++) {
        const r = await read();
        const next = change(r.value as T | null);
        if (await write(next, r.etag ?? '"0"')) return next;
      }
      throw new Error("theme storage: another device kept writing; try again");
    },
    subscribe(l) {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
  },
  local: {
    get: <T>(k: string) => {
      const v = localStorage.getItem(lsKey(k));
      return v === null ? null : (JSON.parse(v) as T);
    },
    set: (k, v) => {
      if (v === null || v === undefined) localStorage.removeItem(lsKey(k));
      else localStorage.setItem(lsKey(k), JSON.stringify(v));
    },
  },
  labels: {
    async set(keys, color) {
      const list = typeof keys === "string" ? [keys] : [...keys];
      labelCalls.push({ keys: list, color });
      for (const k of list) {
        if (color) labelSessions.set(k, color);
        else labelSessions.delete(k);
      }
      relabel();
    },
    async rename(color, name) {
      labelNames[color] = name?.trim() || LABEL_DEFAULT_NAMES[color];
      relabel();
    },
    edit(color) {
      labelCalls.push({ edit: color ?? null });
    },
  },
  menu,
  shortcuts: undefined,
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
      return r && s.branch ? `${r}/${s.branch}` : r || s.branch || "";
    },
    monogram: (h) => ({ "claude-code": "Cl", codex: "Cx", "gemini-cli": "Ge", cursor: "Cu" })[h] ?? h.slice(0, 2),
    harnessIcon: (h) =>
      ICONS[h]
        ? {
            name: ICONS[h]!,
            svg: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="7" r="4.5"/></svg>',
          }
        : null,
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
      room: string;
      unmount: () => void;
      stored: () => Promise<unknown>;
      etag: () => Promise<string | null>;
      storageLog: unknown[];
      sessions: () => SessionSummary[];
      lastOpen: () => { key: string; opts?: unknown } | null;
      menus: MenuCall[];
      labelCalls: unknown[];
      labels: () => Record<string, string>;
    };
  }
}
window.__harness = {
  api,
  world,
  room,
  unmount,
  stored: async () => (await read()).value,
  etag: async () => (await read()).etag,
  storageLog,
  sessions: () => [...world.sessions().values()],
  lastOpen: () => lastOpen,
  menus,
  labelCalls,
  labels: () => Object.fromEntries(labelSessions),
};
