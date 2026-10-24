// SPDX-License-Identifier: Apache-2.0
// One row per event for the expanded window, in words: a tool call is one row (its end
// fills in the duration), a prompt heads its turn with the time.
import type { StoredEvent } from "@sessionpipe-gui/theme-types/api";
import { oneLine } from "./util";

const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** The GUI's one duration grammar (web/src/lib/time.ts): "0.4 s" under a second (a tool
 *  call; "<0.1 s" when quicker, never "0.0 s"), "12 s", "4 m", "1 h 05 m", "3 d". */
export function durShort(msTotal: number | undefined): string {
  if (msTotal === undefined || Number.isNaN(msTotal)) return "";
  const d = Math.max(0, msTotal);
  if (d < 50) return "<0.1 s";
  if (d < 1000) return `${(d / 1000).toFixed(1)} s`;
  if (d < 60_000) return `${Math.floor(d / 1000)} s`;
  const m = Math.floor(d / 60_000);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, "0")} m`;
  return `${Math.floor(h / 24)} d`;
}

export interface EventLine {
  /** "tool" | "text" | "turn" | "attention" | "session" | "other" */
  kind: string;
  /** What happened, in words: the tool's name, "Prompt", "Changed", "Session started". */
  label: string;
  text: string;
  /** The right column: a tool's duration once it ended, a turn's clock time. */
  end?: string;
  err?: boolean;
  /** Prose events get a wrapped block instead of one line. */
  prose?: boolean;
  /** A tool call's id: its end fills the row its start drew, one row per call. */
  call?: string;
}

const CLEARED: Record<string, string> = { answered: "Answered", cancelled: "Cancelled", timeout: "Timed out" };

/** One row in words, the way the Session page reads (raw types stay in the store). */
export function eventLine(e: StoredEvent): EventLine | null {
  const d = e.data ?? {};
  const tool = toolName(str(d.tool));
  const call = str(d.call_id) || undefined;
  switch (e.type) {
    case "tool.started":
      return { kind: "tool", label: tool, text: d.agent_id ? "Subagent" : inputHint(d.input), call };
    case "tool.ended": {
      const ok = d.ok !== false;
      return {
        kind: "tool",
        label: tool,
        text: d.error ? oneLine(str(d.error), 120) : "",
        end: ok ? durShort(num(d.ms)) : "✕",
        err: !ok,
        call,
      };
    }
    case "turn.started": {
      const prompt = oneLine(str(d.prompt), 200);
      const n = num(d.prompt_chars);
      return {
        kind: "turn",
        label: "Prompt",
        text: prompt || (n !== undefined ? `${n} characters, not shared` : ""),
        end: clock(e.time),
      };
    }
    case "turn.ended":
      // The turn's end is the next prompt's start; only a failure says so.
      return d.error ? { kind: "turn", label: "Turn failed", text: oneLine(str(d.error), 120), err: true } : null;
    case "turn.transcript": {
      const a = str(d.assistant);
      return a ? { kind: "text", label: "", text: oneLine(a, 600), prose: true } : null;
    }
    case "turn.progress":
      // The live tail shows in the window's own text line; the rows keep the transcript.
      return null;
    case "files.changed": {
      const paths = Array.isArray(d.paths) ? (d.paths as unknown[]).map(str) : [];
      return {
        kind: "other",
        label: "Changed",
        text: paths.length <= 3 ? paths.join(", ") : `${paths.slice(0, 3).join(", ")} +${paths.length - 3}`,
      };
    }
    case "attention.needed": {
      const msg = oneLine(str(d.message), 140);
      // The tool once: "Bash rm -rf dist" under "Bash" reads "rm -rf dist".
      const rest = tool && msg.toLowerCase().startsWith(tool.toLowerCase()) ? msg.slice(tool.length).trim() : msg;
      return { kind: "attention", label: "Needs you", text: [tool, rest].filter(Boolean).join(": ") };
    }
    case "attention.cleared":
      return { kind: "attention", label: CLEARED[str(d.how)] ?? "Cleared", text: "" };
    case "session.started":
      return { kind: "session", label: d.source === "resume" ? "Session resumed" : "Session started", text: "" };
    case "session.ended":
      return { kind: "session", label: "Session ended", text: "" };
    case "subagent.started":
      return { kind: "other", label: "Subagent", text: `${str(d.agent_type) || "Agent"} started` };
    case "subagent.ended":
      return { kind: "other", label: "Subagent", text: `${str(d.agent_type) || "Agent"} finished` };
    case "context.compacted":
      return { kind: "other", label: "Context compacted", text: "" };
    case "session.heartbeat":
    case "native":
      return null;
    default:
      return { kind: "other", label: e.type, text: Object.keys(d).slice(0, 3).join(", ") };
  }
}

/** An MCP tool reads as its server and its tool: "mcp__github__search_issues" is
 *  "github · search_issues". */
export function toolName(t: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(t);
  return m ? `${m[1]} · ${m[2]}` : t;
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

/** 24-hour "14:05", the time a turn began. */
export function clock(iso: string, seconds = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    hour12: false,
  });
}
