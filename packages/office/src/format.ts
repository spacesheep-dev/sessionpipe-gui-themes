// SPDX-License-Identifier: Apache-2.0
// Labels and readings the ThemeApi does not carry: the state words and hints, the
// attention kinds, the harness mark (api.format.monogram gives the glyph, but the office
// also wants its hue and label), the short model name, and the dense duration.
import type { ThemeApi } from "@sessionpipe-gui/theme-types";
import type { SessionState } from "@sessionpipe-gui/theme-types/api";

export const STATE_LABEL: Record<SessionState, string> = {
  needs_you: "needs you",
  working: "working",
  stale: "stale",
  idle: "idle",
  done: "done",
};

export const STATE_HINT: Record<SessionState, string> = {
  needs_you: "A permission, a question or an error is waiting for an answer.",
  working: "A turn is running and events are still arriving.",
  stale: "A turn started but nothing has arrived for over ten minutes.",
  idle: "The last turn ended; the session is open and waiting for a prompt.",
  done: "Ended, or silent for six hours, or only known from backfill.",
};

export const ATTENTION_LABEL: Record<string, string> = {
  permission: "permission",
  question: "question",
  elicitation: "input wanted",
  idle: "idle prompt",
  error: "error",
};

export interface HarnessMark {
  /** One or two letters for the monogram. */
  glyph: string;
  label: string;
  /** An oklch hue so each harness keeps its own colour everywhere. */
  hue: number;
}

const HARNESSES: Record<string, HarnessMark> = {
  "claude-code": { glyph: "Cl", label: "Claude Code", hue: 40 },
  codex: { glyph: "Cx", label: "Codex", hue: 150 },
  "gemini-cli": { glyph: "Ge", label: "Gemini CLI", hue: 265 },
  antigravity: { glyph: "Ag", label: "Antigravity", hue: 300 },
  cursor: { glyph: "Cu", label: "Cursor", hue: 200 },
  "copilot-cli": { glyph: "Cp", label: "Copilot CLI", hue: 230 },
  droid: { glyph: "Dr", label: "Droid", hue: 120 },
  kiro: { glyph: "Ki", label: "Kiro", hue: 330 },
  opencode: { glyph: "Oc", label: "OpenCode", hue: 180 },
  conformance: { glyph: "Cf", label: "conformance", hue: 0 },
};

/** The GUI's harnessMark: known harnesses by name, others hashed to a hue and initialled. */
export function harnessMark(name: string): HarnessMark {
  const known = HARNESSES[name];
  if (known) return known;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const letters = name
    .split(/[-_.]/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2);
  return { glyph: letters ? letters[0]!.toUpperCase() + (letters[1] ?? "") : "?", label: name, hue: h };
}

/** "claude-fable-5-1" → "fable 5.1", "gpt-5-codex" → "gpt-5 codex", "gemini-2.5-pro" → "gemini 2.5 pro". */
export function modelShort(model: string | undefined): string {
  if (!model) return "";
  let m = model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  m = m.replace(/(\d)-(\d)/g, "$1.$2");
  return m.replace(/-/g, " ");
}

/** api.format.duration without its spaces, for dense numerals: "4m12s", "2h05m". */
export const durShort = (api: ThemeApi, ms: number) => api.format.duration(ms).replace(/ /g, "");

/** Elapsed since an ISO time, as api.format.duration. */
export function since(api: ThemeApi, iso: string | undefined, at: number): string {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? "" : api.format.duration(at - t);
}
