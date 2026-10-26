// SPDX-License-Identifier: Apache-2.0
// Subagents on the canvas: compact pills hanging off their orchestrator's window, read
// from SessionSummary.agents (open ones first, then the newest done). A pill's position
// is always derived from its parent, so it can never be stranded. Nothing is guessed: no
// tool facts unless the agent's tools are attributed, no result unless one was sent.
import type { AgentRun, SessionSummary } from "@sessionpipe-gui/theme-types/api";
import { durShort, toolName } from "./events";
import { PILL_GAP, PILL_H, PILL_MORE_H, PILLS_SHOWN } from "./types";
import { el, ms, oneLine, setClass, setInline, setText } from "./util";

/** Pill ids: `<parent key>#<agent id>`; the fold row: `<parent key>#more`. */
export const pillId = (parent: string, agent: string) => `${parent}#${agent}`;

export interface PillStack {
  shown: AgentRun[];
  /** The row under the pills: "+3 more" (some open ones are folded) or "2 done". */
  more?: { text: string; open: boolean };
}

/** Which agents show for a parent: up to four, open first; all of them while the
 *  person unfolded the parent's finished ones. */
export function pillStack(s: SessionSummary, unfolded: boolean): PillStack {
  const agents = s.agents ?? [];
  if (!agents.length) return { shown: [] };
  const open = agents.filter((a) => a.state !== "done");
  const done = agents
    .filter((a) => a.state === "done")
    .sort((a, b) => (b.endedAt ?? b.lastAt).localeCompare(a.endedAt ?? a.lastAt));
  const all = [...open, ...done];
  if (unfolded) return { shown: all, more: done.length ? { text: "Fold done", open: true } : undefined };
  const shown = all.slice(0, PILLS_SHOWN);
  const rest = all.slice(PILLS_SHOWN);
  if (!rest.length) return { shown };
  const anyOpen = rest.some((a) => a.state !== "done");
  return {
    shown,
    more: { text: anyOpen ? `+${rest.length} more` : `${rest.length} done`, open: false },
  };
}

/** The stack's height: pills 8 px apart, then the fold row. */
export const stackHeight = (p: PillStack) =>
  p.shown.length
    ? p.shown.length * PILL_H + (p.shown.length - 1) * PILL_GAP + (p.more ? PILL_GAP + PILL_MORE_H : 0)
    : 0;

/** "Explore · Find ad-hoc money formatting"; the type alone, or "Subagent". */
export function agentName(a: AgentRun): { type: string; description: string } {
  return { type: a.type?.trim() || (a.description ? "" : "Subagent"), description: a.description?.trim() ?? "" };
}

/** What the agent is doing now, or how it ended (spec §4.1). */
export function agentNow(a: AgentRun, now: number): string {
  if (a.state === "done") {
    const first = a.result
      ?.split("\n")
      .map((l) => l.trim())
      .find(Boolean);
    if (first) return oneLine(first, 120);
    const ran = ms(a.endedAt ?? a.lastAt) - ms(a.startedAt);
    return ran > 0 ? durShort(ran) : "Done";
  }
  if (a.state === "stale") return `Quiet for ${durShort(Math.max(0, now - ms(a.lastAt)))}`;
  if (!a.attributed) return "Running";
  if (a.currentTool) {
    const d = Math.max(0, now - ms(a.currentTool.since));
    const name = toolName(a.currentTool.tool);
    return d < 1500 ? name : `${name} · ${durShort(Math.floor(d / 1000) * 1000)}`;
  }
  return "Thinking";
}

const GLYPH: Record<AgentRun["state"], string> = { running: "working", stale: "stale", done: "done" };

export class PillView {
  readonly el: HTMLElement;
  private glyph: HTMLElement;
  private type: HTMLElement;
  private desc: HTMLElement;
  private now: HTMLElement;
  private sig = "";
  agent: AgentRun;

  constructor(
    readonly id: string,
    readonly parent: string,
    agent: AgentRun,
  ) {
    this.agent = agent;
    this.el = el("div", "cv-pill");
    this.el.dataset.pill = id;
    this.el.dataset.parent = parent;
    this.el.dataset.agent = agent.id;
    this.el.tabIndex = 0;
    this.el.setAttribute("role", "button");
    const l1 = el("div", "cv-pill-l1");
    this.glyph = el("span", "dot cv-pill-glyph");
    this.glyph.setAttribute("aria-hidden", "true");
    this.type = el("span", "cv-pill-type");
    this.desc = el("span", "cv-pill-desc");
    l1.append(this.glyph, this.type, this.desc);
    this.now = el("div", "cv-pill-now num");
    this.el.append(l1, this.now);
    this.update(agent, Date.now());
  }

  update(a: AgentRun, now: number) {
    this.agent = a;
    const { type, description } = agentName(a);
    const nowText = agentNow(a, now);
    const sig = [a.state, type, description, nowText].join("\u0001");
    if (sig === this.sig) return;
    this.sig = sig;
    this.el.dataset.state = a.state;
    this.glyph.className = `dot dot--${GLYPH[a.state]} cv-pill-glyph`;
    setText(this.type, type);
    setText(this.desc, type && description ? `\u00a0·\u00a0${description}` : description);
    setInline(this.now, nowText);
    setClass(this.el, "is-done", a.state === "done");
    const label = [type, description].filter(Boolean).join(" · ");
    this.el.setAttribute("aria-label", `Subagent ${label}, ${a.state === "running" ? "running" : a.state}: ${nowText}`);
    this.el.title = a.attributed ? "" : "Codex doesn't report a subagent's tools separately";
  }

  destroy() {
    this.el.remove();
  }
}
