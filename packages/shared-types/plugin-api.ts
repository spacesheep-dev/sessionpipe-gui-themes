// SPDX-License-Identifier: Apache-2.0
// The server plugin contract. A plugin is an ES module installed under
// <stateDir>/plugins/<id>/ beside a plugin.json manifest and imported by the GUI's own
// Node process at boot (and on reload). It sees the store's stream and the settings the
// host keeps for it, and talks back only through the PluginApi it is handed.
//
// What a plugin can and cannot do about control: it can notify, and it can *suggest* an
// answer to an open permission. It can never answer one. Only a passkey on a trusted
// device signs a `permission.answer` (CONTROL.md); the receiver holds no key, so neither
// does anything running inside it. A suggestion is shown in the GUI beside the prompt,
// and a person confirms it with one tap, which sends the ordinary signed answer.
//
// A plugin is code running in the receiver process with everything that process has:
// the state dir, the network, the machine. Install only plugins you trust.
//
// Three kinds of extension share one installer (`sessionpipe-gui <kind> add|link|remove|list`):
// views (theme.json, shared/theme-api.ts), skins (skin.json, shared/skin-api.ts) and
// plugins (this file). A plugin that ships with the GUI (dist/bundled/plugins/<id>) is
// listed `bundled` and stays off until the person enables it: it runs code and may reach
// out of the machine, so nothing it could do happens unasked.
//
// Versioning: `PLUGIN_API_VERSION` is bumped on a breaking change; a manifest's `api`
// says which version the plugin was written for; the host refuses a newer one.

import type { SessionKey, SessionSummary, Snapshot, StreamMessage } from "./api.js";

export const PLUGIN_API_VERSION = 1 as const;

export type SettingType = "string" | "secret" | "number" | "boolean" | "select" | "multiselect";

/** One setting the host keeps for the plugin and shows as a form field on the Views page. */
export interface SettingField {
  key: string;
  label: string;
  type: SettingType;
  /** For `select` and `multiselect`. */
  options?: string[];
  default?: unknown;
  /** One line under the field. */
  help?: string;
}

/** plugin.json, next to the entry module. */
export interface PluginManifest {
  /** `[a-z][a-z0-9-]{1,40}`; the folder name and the settings file name. */
  id: string;
  name: string;
  version: string;
  /** What this package is: a plugin runs in the receiver process. */
  kind: "plugin";
  /** Relative path of the ES module; defaults to "index.js". */
  entry: string;
  /** The PluginApi version this plugin targets. */
  api: number;
  description?: string;
  settings?: SettingField[];
  /** Where it came from (filled by the host on install, not by the author). */
  source?: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface PluginApi {
  version: typeof PLUGIN_API_VERSION;
  /** Host name, version and where it can be opened. */
  host: { name: string; version: string; urls: { local: string; lan: string[]; https?: string } };
  /** This plugin's manifest, as installed. */
  manifest: PluginManifest;
  /** To the host's log, prefixed with the plugin id. Values equal to a secret setting are
   *  masked, but do not rely on that: never log a token. */
  log(level: LogLevel, msg: string, data?: unknown): void;
  /** The plugin's settings, defaults filled in, secrets included (this is the server side).
   *  `onChange` fires after a save from the Views page, with the new values. */
  settings: {
    get<T = Record<string, unknown>>(): T;
    onChange(listener: (settings: Record<string, unknown>) => void): () => void;
  };
  /** The store's stream, as the page sees it: events with the session after applying them,
   *  session readings (`flags`, `openAttentions`, state), machines, control activity. */
  events: {
    subscribe(listener: (message: StreamMessage) => void): () => void;
    snapshot(): Snapshot;
  };
  sessions: {
    get(key: SessionKey): SessionSummary | undefined;
    /** A link to the session page a phone can open: the https origin when TLS mode is on,
     *  else the first LAN URL; with the UI key, so a cold browser gets in. */
    url(key: SessionKey): string;
  };
  /** Suggest an answer to an open, answerable permission. The host keeps it, streams it to
   *  every page, and drops it when the attention closes. Nothing is sent to the machine
   *  until a person confirms it with their passkey. */
  suggest(suggestion: {
    session: SessionKey;
    attentionId: string;
    decision: "allow" | "deny";
    /** Who, in words: "Misha on Telegram". */
    by: string;
    note?: string;
  }): void;
  /** One JSON document per plugin, kept by the host under the state dir (≤ 256 KB). */
  storage: {
    get<T = unknown>(): Promise<T | null>;
    set(value: unknown): Promise<void>;
  };
  fetch: typeof globalThis.fetch;
}

/** What `activate` returns: the host calls `deactivate` on reload and at shutdown. */
export interface PluginHandle {
  deactivate(): Promise<void> | void;
}

/** The module's default export. */
export interface Plugin {
  activate(api: PluginApi): Promise<PluginHandle> | PluginHandle;
}

export type PluginStatus = "active" | "error" | "inactive";

/** Server-side listing: GET /api/ui/plugins. */
export interface InstalledPlugin extends PluginManifest {
  /** `inactive` with `disabled: true` is a plugin turned off (every bundled one, until enabled). */
  status: PluginStatus;
  /** Why it is not running (bad manifest, api too new, activate threw, …). */
  error?: string;
  /** Where on disk; loopback only. */
  dir?: string;
  /** Linked from a folder for development. */
  linked?: boolean;
  /** Shipped with the GUI (dist/bundled/plugins/<id>), not installed by the person: listed
   *  after their own installs (an install of the same id overrides it), `source: "bundled"`,
   *  cannot be removed, off until enabled. */
  bundled?: boolean;
  /** Not activated: turned off in config.json (`disabled`), or bundled and not yet turned
   *  on (`enabled`). Enable on the Views page or with `sessionpipe-gui plugin enable <id>`. */
  disabled?: boolean;
  /** Current setting values with defaults filled in; `secret` fields masked ("••••" + last 4). */
  values?: Record<string, unknown>;
}

export const PLUGIN_ROUTES = {
  /** GET → { plugins: InstalledPlugin[] } */
  list: "/api/ui/plugins",
  /** POST /api/ui/plugins/reload (loopback): deactivate, re-read, import afresh, activate */
  reload: "/api/ui/plugins/reload",
  /** PUT /api/ui/plugins/:id/settings (loopback) { key: value, … } → { settings } (masked) */
  settings: "/api/ui/plugins",
  /** POST /api/ui/plugins/:id/enable | /disable (loopback) → { plugins }: remembered in config.json */
  toggle: "/api/ui/plugins",
} as const;

export const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{1,40}$/;

export const SECRET_MASK = "••••";

/** How a secret is shown: the mask plus its last four characters, or "" when unset. A value
 *  sent back in this shape leaves the stored secret as it is. */
export function maskSecret(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  return `${SECRET_MASK}${value.length > 4 ? value.slice(-4) : ""}`;
}

export const isMasked = (value: unknown): boolean => typeof value === "string" && value.startsWith(SECRET_MASK);

/** Defaults from the manifest under the stored values. */
export function withDefaults(manifest: PluginManifest, stored: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of manifest.settings ?? []) if (f.default !== undefined) out[f.key] = f.default;
  return { ...out, ...stored };
}

export function maskSettings(manifest: PluginManifest, values: Record<string, unknown>): Record<string, unknown> {
  const out = { ...values };
  for (const f of manifest.settings ?? []) if (f.type === "secret") out[f.key] = maskSecret(values[f.key]);
  return out;
}
