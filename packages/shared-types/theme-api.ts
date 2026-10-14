// SPDX-License-Identifier: Apache-2.0
// The theme plugin contract. A theme is an ES module, installed under
// <stateDir>/themes/<id>/ beside a theme.json manifest, served by the GUI at
// /themes/<id>/ and imported at runtime. It renders into a container the host gives
// it and talks to the host only through the ThemeApi it is handed. Nothing here
// depends on React: a theme may use the host's React (api.react), its own bundled
// framework, plain DOM or a <canvas>.
//
// Versioning: `ThemeApi.version` is bumped on a breaking change; a manifest's
// `api` says which version the theme was written for; the host refuses a theme
// whose major is newer than its own.

import type {
  ControlActivity,
  MachineSummary,
  SessionDetail,
  SessionKey,
  SessionSummary,
  Stats,
  StoredEvent,
  Viewer,
} from "./api.js";

export const THEME_API_VERSION = 1 as const;

/** theme.json, next to the entry module. */
export interface ThemeManifest {
  /** `[a-z][a-z0-9-]{1,40}`; also the route segment: /t/<id>. */
  id: string;
  name: string;
  version: string;
  description?: string;
  /** Relative path of the ES module; defaults to "index.js". */
  entry?: string;
  /** Optional stylesheet the host links before mounting (scoped by the theme itself). */
  style?: string;
  /** Inline SVG for the nav entry (24×24 viewBox, currentColor). */
  icon?: string;
  /** Shown under an "experimental" divider in the nav. */
  experimental?: boolean;
  /** The ThemeApi version this theme targets. */
  api: number;
  /** Where it came from (filled by the host on install, not by the author). */
  source?: string;
}

export type ConnectionState = "connecting" | "live" | "offline";

/** What the host knows right now. Immutable: every change produces a new object. */
export interface ThemeSnapshot {
  connection: ConnectionState;
  sessions: ReadonlyMap<SessionKey, SessionSummary>;
  machines: ReadonlyMap<string, MachineSummary>;
  stats: Stats;
  /** Newest first, at most a few hundred. */
  control: readonly ControlActivity[];
  /** Newest first, at most a few hundred: the live tail of the event stream. */
  recent: readonly StoredEvent[];
  /** "dark" | "light", the resolved scheme the page renders in. */
  scheme: "dark" | "light";
  /** Browsers connected to this GUI right now (phones, laptops); `current` marks this one. */
  viewers: readonly Viewer[];
}

/** What a control call can do from this page. `ok: false` carries the reason the host
 *  would show (not a secure context, machine not paired, daemon offline). */
export interface ControlAvailability {
  ok: boolean;
  reason?: string;
}

export interface ThemeApi {
  version: typeof THEME_API_VERSION;
  /** Host name and version, e.g. { name: "sessionpipe-gui", version: "0.1.0" }. */
  host: { name: string; version: string };
  /** This theme's manifest, as installed. */
  manifest: ThemeManifest;
  /** The absolute URL prefix of the theme's own files (assets, workers). */
  baseUrl: string;

  /** Current state, and a subscription that fires with the new snapshot on every change. */
  state: {
    get(): ThemeSnapshot;
    subscribe(listener: (snapshot: ThemeSnapshot) => void): () => void;
  };
  /** Every live event as it arrives, with the session summary after applying it. */
  onEvent(listener: (event: StoredEvent, session: SessionSummary) => void): () => void;

  /** Typed reads of the UI API. */
  fetch: {
    session(key: SessionKey, opts?: { after?: number; limit?: number }): Promise<SessionDetail>;
    forget(key: SessionKey): Promise<void>;
  };

  /** Host navigation. */
  navigate(path: string): void;
  /** Open a session: as the page (default), or `split` beside the current view in a
   *  side panel the host slides in; `from` is the rectangle (viewport px) the panel
   *  should animate out of, e.g. the card that was clicked. */
  openSession(key: SessionKey, opts?: OpenSessionOptions): void;

  /** Design tokens as CSS custom property names the theme may use in its own CSS
   *  (e.g. "--bg", "--fg", "--fg-2", "--line", "--needs", "--err"); the host keeps them
   *  defined on :root for both schemes. */
  tokens: readonly string[];

  /** Per-theme JSON kept by the server (shared across devices), ≤ 256 KB. */
  storage: {
    get<T = unknown>(): Promise<T | null>;
    set(value: unknown): Promise<void>;
  };
  /** Per-device convenience storage (localStorage, namespaced); may be unavailable. */
  local: {
    get<T = unknown>(key: string): T | null;
    set(key: string, value: unknown): void;
  };

  /** The control channel, signed by the host with the person's passkey and day key
   *  (CONTROL.md). Present when the host supports it; each call rejects with an Error
   *  whose message is what the host would show. */
  control?: {
    /** Whether a command to this session's machine (or this machine id) can be signed and sent now. */
    availability(target: { session?: SessionKey; machineId?: string }): ControlAvailability;
    /** A prompt for the session's next turn. */
    send(session: SessionKey, text: string): Promise<ControlActivity>;
    /** Allow or deny an open permission attention. */
    answer(
      session: SessionKey,
      attentionId: string,
      decision: "allow" | "deny",
      note?: string,
    ): Promise<ControlActivity>;
    cancel(session: SessionKey): Promise<ControlActivity>;
    /** A new session on a paired machine; the returned activity names the session key the host chose. */
    start(
      machineId: string,
      opts: { harness: string; cwd: string; text: string },
    ): Promise<ControlActivity & { session: SessionKey }>;
  };

  /** The host's React and ReactDOM, for themes that want them without bundling their
   *  own. A theme built with JSX can map `react` and `react-dom` to these. */
  react?: { React: unknown; ReactDOM: unknown; createRoot: unknown };

  /** Shared helpers the host already has: relative time, durations, titles. */
  format: {
    ago(iso: string, now?: number): string;
    duration(ms: number): string;
    title(session: SessionSummary): string;
    repoBranch(session: SessionSummary): string;
    /** "Cl" for claude-code, "Cx" for codex, … */
    monogram(harness: string): string;
  };
}

export interface OpenSessionOptions {
  split?: boolean;
  from?: { x: number; y: number; width: number; height: number };
  /** With `split`: add the session as a tab without switching to it. */
  background?: boolean;
}

/** The module's default export. `mount` returns the function that unmounts. */
export interface Theme {
  mount(container: HTMLElement, api: ThemeApi): (() => void) | Promise<() => void>;
}

/** Server-side listing: GET /api/ui/themes. */
export interface InstalledTheme extends ThemeManifest {
  /** URL prefix where its files are served: /themes/<id>/ */
  url: string;
  /** Where on disk; loopback only. */
  dir?: string;
  /** Linked from a folder for development (changes show on reload). */
  linked?: boolean;
  /** Why this entry cannot be loaded (bad manifest, api too new, …); such a theme is
   *  listed so the problem is visible, but gets no nav entry. */
  error?: string;
}

export const THEME_ROUTES = {
  /** GET → { themes: InstalledTheme[] } */
  list: "/api/ui/themes",
  /** GET/PUT /api/ui/themes/:id/state → JSON */
  state: "/api/ui/themes",
  /** Static: /themes/:id/<file> */
  files: "/themes",
  /** POST /api/ui/themes/reload (loopback): re-read manifests */
  reload: "/api/ui/themes/reload",
} as const;

export const THEME_ID_RE = /^[a-z][a-z0-9-]{1,40}$/;
