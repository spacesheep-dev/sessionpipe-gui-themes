// SPDX-License-Identifier: Apache-2.0
// One line per event for the expanded window, in the spirit of `sessionpipe tail`.
import type { StoredEvent } from "@sessionpipe-gui/theme-types/api";
import { oneLine } from "./util";

const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

export function durShort(msTotal: number | undefined): string {
  if (msTotal === undefined || Number.isNaN(msTotal)) return "";
  if (msTotal < 1000) return `${Math.round(msTotal)} ms`;
  if (msTotal < 60_000) return `${(msTotal / 1000).toFixed(msTotal < 10_000 ? 1 : 0)} s`;
  const m = Math.floor(msTotal / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export interface EventLine {
  /** "tool" | "text" | "turn" | "attention" | "session" | "other" */
  kind: string;
  /** A short label: the tool name, "assistant", "turn", … */
  label: string;
  text: string;
  err?: boolean;
  /** Prose events get a wrapped block instead of one line. */
  prose?: boolean;
}

export function eventLine(e: StoredEvent): EventLine | null {
  const d = e.data ?? {};
  switch (e.type) {
    case "tool.started":
      return { kind: "tool", label: str(d.tool), text: d.agent_id ? "subagent" : inputHint(d.input) };
    case "tool.ended": {
      const ok = d.ok !== false;
      const bits = [ok ? "ok" : "error"];
      if (num(d.ms) !== undefined) bits.push(durShort(num(d.ms)));
      if (d.error) bits.push(oneLine(str(d.error), 80));
      return { kind: "tool", label: str(d.tool), text: bits.join(" · "), err: !ok };
    }
    case "turn.started":
      return {
        kind: "turn",
        label: "turn",
        text: d.prompt_chars !== undefined ? `prompt · ${str(d.prompt_chars)} chars` : "prompt",
      };
    case "turn.ended": {
      const bits = [str(d.reason) || "stop"];
      if (num(d.ms) !== undefined) bits.push(durShort(num(d.ms)));
      if (d.error) bits.push(str(d.error));
      return { kind: "turn", label: "turn", text: bits.join(" · "), err: !!d.error };
    }
    case "turn.transcript": {
      const a = str(d.assistant);
      return a ? { kind: "text", label: "assistant", text: oneLine(a, 600), prose: true } : null;
    }
    case "turn.progress":
      // The live tail shows in the window's own text line; the rows keep the transcript.
      return null;
    case "files.changed": {
      const paths = Array.isArray(d.paths) ? (d.paths as unknown[]).map(str) : [];
      return {
        kind: "other",
        label: "files",
        text: paths.length <= 3 ? paths.join(", ") : `${paths.slice(0, 3).join(", ")} +${paths.length - 3}`,
      };
    }
    case "attention.needed":
      return {
        kind: "attention",
        label: str(d.kind) || "attention",
        text: [str(d.tool), oneLine(str(d.message), 140)].filter(Boolean).join(" · "),
      };
    case "attention.cleared":
      return { kind: "attention", label: "cleared", text: str(d.how) || "" };
    case "session.started":
      return { kind: "session", label: "session", text: `started · ${str(d.source) || "unknown"}` };
    case "session.ended":
      return { kind: "session", label: "session", text: `ended · ${str(d.reason) || "other"}` };
    case "subagent.started":
      return { kind: "other", label: "subagent", text: `${str(d.agent_type) || "subagent"} started` };
    case "subagent.ended":
      return { kind: "other", label: "subagent", text: `${str(d.agent_type) || "subagent"} ended` };
    case "context.compacted":
      return { kind: "other", label: "context", text: `compacted · ${str(d.trigger) || "auto"}` };
    case "session.heartbeat":
    case "native":
      return null;
    default:
      return { kind: "other", label: e.type, text: Object.keys(d).slice(0, 3).join(", ") };
  }
}

/** The one thing worth showing from a tool's input: a command, a path, a pattern. */
function inputHint(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  for (const k of ["command", "cmd", "file_path", "path", "pattern", "query", "url", "description", "prompt"]) {
    const v = i[k];
    if (typeof v === "string" && v.trim()) return oneLine(v, 90);
  }
  return "";
}

export function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
