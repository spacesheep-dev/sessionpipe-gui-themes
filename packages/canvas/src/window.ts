// SPDX-License-Identifier: Apache-2.0
// One session as a native panel: a 32 px title bar (state glyph, label dot, title, the
// harness mark, ↗ and ⋯ on hover), one muted line of what the grouping doesn't already
// say with the time on the right, and up to three lines of body by state: the request
// with Allow / Deny when it needs you, the live tail while it works, the last reply when
// it rests. Expanded, it shows the session's rows and the prompt. The DOM is built once;
// `update` touches only what changed (a signature), `tick` the time once a second.
import type { ThemeApi } from "@sessionpipe-gui/theme-types";
import type { ControlActivity, LabelColor, SessionSummary } from "@sessionpipe-gui/theme-types/api";
import { Detail } from "./detail";
import { durShort } from "./events";
import { repoParts } from "./map";
import type { ViewId } from "./types";
import { el, ms, oneLine, setClass, setText } from "./util";

const KIND_LABEL: Record<string, string> = {
  prompt: "Prompt",
  "permission.answer": "Answer",
  cancel: "Cancel",
  start: "Start",
  "key.add": "Trust a device",
};

const ICON_OPEN =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h6.5V10M12.5 3.5 4 12"/></svg>';
const ICON_MORE =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="12.5" cy="8" r="1.25"/></svg>';

export interface WinHooks {
  onOpen(): void;
  onMore(at: { x: number; y: number }): void;
}

/** What the canvas knows that the session doesn't: the view (line 2 depends on it), the
 *  label, whether this page can carry a command, the parent it was split from. */
export interface WinContext {
  now: number;
  view: ViewId;
  label?: { color: LabelColor; name: string };
  activities: readonly ControlActivity[];
  /** A reason to say in this window only when it differs from the one the status bar says. */
  ownReason?: string;
  /** A child session whose orchestrator isn't on the canvas. */
  parentTitle?: string;
}

export class WinView {
  readonly el: HTMLElement;
  readonly key: string;
  z = 0;
  session: SessionSummary;
  detail: Detail | undefined;
  private sig = "";
  private glyph: HTMLElement;
  private dot: HTMLElement;
  private title: HTMLElement;
  private mark: HTMLElement;
  private markFor = "";
  private metaText: HTMLElement;
  private metaErr: HTMLElement;
  private time: HTMLElement;
  private body: HTMLElement;
  private text: HTMLElement;
  private ask: HTMLElement;
  private askText: HTMLElement;
  private askActs: HTMLElement;
  private wait: HTMLElement;
  private ctl: HTMLElement;
  private input: HTMLInputElement;
  private reason: HTMLElement;
  private acts: HTMLElement;
  /** What the time on the right counts from. */
  private since: number | undefined;
  private canControl = false;
  private busy = false;
  private error = "";
  private ctx: WinContext;

  constructor(
    private api: ThemeApi,
    session: SessionSummary,
    private hooks: WinHooks,
    ctx: WinContext,
  ) {
    this.key = session.key;
    this.session = session;
    this.ctx = ctx;
    this.el = el("div", "cv-win");
    this.el.dataset.key = session.key;
    this.el.tabIndex = 0;
    this.el.setAttribute("role", "group");

    const bar = el("div", "cv-win-bar");
    this.glyph = el("span", "dot cv-win-glyph");
    this.glyph.setAttribute("aria-hidden", "true");
    this.dot = el("span", "label-dot cv-win-label");
    this.dot.hidden = true;
    this.title = el("span", "cv-win-title");
    this.mark = el("span", "cv-win-mark");
    this.mark.setAttribute("aria-hidden", "true");
    const open = iconBtn("cv-win-open", ICON_OPEN, "Open beside");
    open.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.onOpen();
    });
    const more = iconBtn("cv-win-more", ICON_MORE, "More");
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = more.getBoundingClientRect();
      this.hooks.onMore({ x: r.left, y: r.bottom + 4 });
    });
    const tools = el("span", "cv-win-tools");
    tools.append(open, more);
    bar.append(this.glyph, this.dot, this.title, this.mark, tools);

    const meta = el("div", "cv-win-meta");
    const left = el("span", "cv-win-meta-l");
    this.metaText = el("span", "cv-win-meta-t");
    this.metaErr = el("span", "cv-win-err");
    left.append(this.metaText, this.metaErr);
    this.time = el("span", "cv-win-time num");
    meta.append(left, this.time);

    this.body = el("div", "cv-win-body");
    this.text = el("div", "cv-win-text");
    this.ask = el("div", "cv-win-ask");
    this.askText = el("div", "cv-win-ask-x");
    this.askActs = el("div", "cv-win-acts");
    const allow = el("button", "btn btn--sm btn--primary cv-allow", "Allow");
    const deny = el("button", "btn btn--sm cv-deny", "Deny");
    for (const [b, d] of [
      [allow, "allow"],
      [deny, "deny"],
    ] as const) {
      b.type = "button";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.answer(d);
      });
    }
    this.askActs.append(deny, allow);
    this.wait = el("div", "cv-win-wait", "Waiting in the terminal");
    this.ask.append(this.askText, this.wait, this.askActs);

    // Expanded only: the prompt when the host can carry one, what was sent, the reason.
    this.ctl = el("div", "cv-win-ctl");
    this.input = el("input", "field cv-ctl-input");
    this.input.type = "text";
    this.input.placeholder = "Message · Enter sends";
    this.input.autocomplete = "off";
    this.input.setAttribute("aria-label", "Prompt for this session");
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && this.input.value.trim()) {
        e.preventDefault();
        const text = this.input.value.trim();
        void this.run(async () => {
          const a = await this.api.control!.send(this.key, text);
          this.input.value = "";
          return a;
        });
      }
      if (e.key === "Escape") {
        this.input.blur();
        this.el.focus({ preventScroll: true });
      }
    });
    this.reason = el("div", "cv-ctl-reason");
    this.acts = el("div", "cv-ctl-acts");
    this.ctl.append(this.acts, this.input, this.reason);
    this.ctl.hidden = true;
    this.body.append(this.text, this.ask);

    const resize = el("div", "cv-win-resize");
    resize.setAttribute("aria-hidden", "true");
    this.el.append(bar, meta, this.body, this.ctl, resize);
    this.update(session, ctx);
  }

  /** Whether it needs you and Allow / Deny can be answered from here: a taller window. */
  get answerable(): boolean {
    const att = this.session.openAttentions[0];
    return this.session.state === "needs_you" && att?.kind === "permission" && this.canControl;
  }

  update(s: SessionSummary, ctx: WinContext) {
    this.session = s;
    this.ctx = ctx;
    const att = s.openAttentions[0];
    const control = this.api.control;
    const av = control && s.state !== "done" ? control.availability({ session: s.key }) : null;
    this.canControl = !!av?.ok;
    const expanded = !!this.detail;
    const acts = expanded ? ctx.activities.slice(0, 3) : [];
    const prog = s.progress?.assistant ?? "";
    const sig = [
      s.state,
      s.title,
      s.machine,
      s.repo,
      s.branch,
      s.currentTool?.tool,
      s.currentTool?.since,
      s.currentTurn?.since,
      s.stateSince,
      s.lastAt,
      s.endedAt,
      att?.attentionId,
      att?.message,
      prog.length,
      s.lastAssistant,
      s.lastUser,
      s.counts.toolErrors,
      av ? `${av.ok}:${av.reason ?? ""}` : "-",
      acts.map((a) => `${a.id}:${a.outcome ?? ""}:${a.reply?.length ?? ""}`).join(","),
      ctx.view,
      ctx.label?.color,
      ctx.label?.name,
      ctx.ownReason,
      ctx.parentTitle,
      expanded,
      this.busy,
      this.error,
    ].join("\u0001");
    if (sig === this.sig) {
      this.tick(ctx.now);
      return;
    }
    this.sig = sig;
    const title = this.api.format.title(s);

    this.el.dataset.state = s.state;
    setClass(this.el, "is-needs", s.state === "needs_you");
    setClass(this.el, "is-ask", this.answerable);
    setClass(this.el, "is-done", s.state === "done");
    this.glyph.className = `dot dot--${s.state} cv-win-glyph`;
    setText(this.title, title);
    if (ctx.label) {
      this.dot.className = `label-dot label-dot--${ctx.label.color} cv-win-label`;
      this.dot.title = `Label: ${ctx.label.name}`;
      this.dot.hidden = false;
    } else this.dot.hidden = true;
    // The harness mark, except where the grouping already says the harness.
    const markFor = ctx.view === "harness" ? "" : s.harness;
    if (markFor !== this.markFor) {
      this.markFor = markFor;
      const icon = markFor ? this.api.format.harnessIcon?.(markFor) : null;
      if (icon) this.mark.innerHTML = icon.svg;
      else setText(this.mark, markFor ? this.api.format.monogram(markFor) : "");
      this.mark.hidden = !markFor;
    }
    const stateWord = STATE_WORDS[s.state] ?? s.state;
    this.el.setAttribute(
      "aria-label",
      `${title}, ${stateWord}${ctx.label ? `, label ${ctx.label.name}` : ""}${s.agents?.length ? `, ${agentWords(s)}` : ""}`,
    );

    // Line 2: only what the grouping doesn't already say; errors when there are any.
    const facts = ctx.parentTitle
      ? [`Subagent of ${ctx.parentTitle}`]
      : ctx.view === "machine"
        ? [this.api.format.repoBranch(s)].filter(Boolean)
        : metaFacts(s, ctx.view);
    const errs = s.counts.toolErrors;
    if (errs > 0 && facts.length >= 2) facts.length = 1;
    setText(this.metaText, facts.join(" · "));
    setText(this.metaErr, errs > 0 ? `${facts.length ? " · " : ""}${errs} error${errs === 1 ? "" : "s"}` : "");
    this.since = sinceOf(s);
    this.tick(ctx.now);

    // The body by state.
    let text = "";
    let textCls = "cv-win-text";
    if (s.state === "needs_you" && att) {
      this.ask.hidden = false;
      this.askText.replaceChildren();
      const message = att.message?.trim() ?? "";
      if (att.kind === "permission" && att.tool) {
        this.askText.append(document.createTextNode(`${att.tool}: `), el("code", "cv-code", oneLine(message, 220)));
      } else {
        this.askText.append(document.createTextNode(oneLine(message || ASK_WORDS[att.kind] || att.kind, 220)));
      }
      this.askActs.hidden = !this.answerable;
      this.wait.hidden = this.answerable;
      this.text.hidden = true;
    } else {
      this.ask.hidden = true;
      if (s.state === "working" && prog) {
        text = tail(prog, 260);
        textCls += " is-live";
      } else if (s.state === "working") {
        const tool = s.currentTool;
        text = tool ? `${tool.tool} · ${durShort(Math.max(0, ctx.now - ms(tool.since)))}` : "Thinking";
        textCls += " is-quiet";
      } else if (s.lastAssistant) {
        text = oneLine(s.lastAssistant, 280);
      } else if (s.progress?.user || s.lastUser) {
        text = oneLine(s.progress?.user ?? s.lastUser, 280);
        textCls += " is-user";
      }
      setText(this.text, text);
      this.text.className = textCls;
      this.text.hidden = !text;
    }

    // Control lives in the expanded window.
    if (expanded && control && s.state !== "done") {
      this.ctl.hidden = false;
      this.input.hidden = !this.canControl;
      this.input.disabled = this.busy;
      const reason = this.error || (av && !av.ok ? (ctx.ownReason ?? "") : "");
      setText(this.reason, reason);
      this.reason.hidden = !reason;
      setClass(this.reason, "is-err", !!this.error);
      this.renderActs(acts, s);
    } else {
      this.ctl.hidden = true;
    }
  }

  private renderActs(acts: readonly ControlActivity[], s: SessionSummary) {
    const machine = s.machine ?? "the machine";
    this.acts.replaceChildren(
      ...acts.map((a) => {
        const state = shownState(a);
        const row = el("div", `cv-act is-${state}`);
        row.dataset.message = a.id;
        row.dataset.outcome = state;
        const head = el("div", "cv-act-head");
        head.append(
          el("span", "cv-act-kind", KIND_LABEL[a.kind] ?? a.kind),
          el("span", "cv-act-text", a.text ? oneLine(a.text, 80) : ""),
        );
        row.append(head, el("div", "cv-act-state", outcomeWords(a, machine)));
        if (a.reply) row.append(el("div", "cv-act-reply", tail(a.reply, 200)));
        return row;
      }),
    );
    this.acts.hidden = acts.length === 0;
  }

  /** Once a second: the time on the right. */
  tick(now: number) {
    const t = this.since;
    setText(this.time, t === undefined || Number.isNaN(t) ? "" : short(Math.max(0, now - t)));
    // "Bash · 12 s" while a tool runs and nothing is being written.
    const s = this.session;
    if (s.state === "working" && !s.progress?.assistant && s.currentTool && this.text.classList.contains("is-quiet")) {
      setText(this.text, `${s.currentTool.tool} · ${durShort(Math.max(0, now - ms(s.currentTool.since)))}`);
    }
  }

  /** Model and counts, for the tooltip. */
  tipLines(): string[] {
    const s = this.session;
    const c = s.counts;
    const n = (v: number, w: string) => `${v} ${w}${v === 1 ? "" : "s"}`;
    const harness = this.api.format.harnessIcon?.(s.harness)?.name ?? s.harness;
    return [
      this.api.format.title(s),
      [harness, s.model].filter(Boolean).join(" · "),
      [s.machine, s.cwd].filter(Boolean).join(" · "),
      [n(c.tools, "tool"), n(c.toolErrors, "error"), n(c.filesChanged, "file")].join(" · "),
    ].filter(Boolean);
  }

  private async run(fn: () => Promise<unknown>) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.refresh();
    try {
      await fn();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      this.error = m.startsWith("not sent") ? m : `Not sent · ${m}`;
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  private refresh() {
    this.sig = "";
    this.update(this.session, { ...this.ctx, now: Date.now() });
  }

  /** Allow or deny the open permission: from here when the host carries it, else beside. */
  answer(decision: "allow" | "deny"): Promise<void> | void {
    const att = this.session.openAttentions[0];
    if (!att) return;
    if (att.kind === "permission" && this.canControl && this.api.control) {
      return this.run(() => this.api.control!.answer(this.key, att.attentionId, decision));
    }
    this.hooks.onOpen();
  }

  /** The prompt line of the expanded window, when there is one. */
  focusPrompt(): boolean {
    if (this.ctl.hidden || this.input.hidden || this.input.disabled) return false;
    this.input.focus();
    return true;
  }

  setExpanded(on: boolean) {
    setClass(this.el, "is-expanded", on);
    if (on && !this.detail) {
      this.detail = new Detail(this.api, this.key);
      this.body.append(this.detail.el);
    } else if (!on && this.detail) {
      this.detail.destroy();
      this.detail = undefined;
    }
    this.refresh();
  }

  get expanded() {
    return !!this.detail;
  }

  destroy() {
    this.detail?.destroy();
    this.el.remove();
  }
}

function iconBtn(cls: string, svg: string, label: string): HTMLButtonElement {
  const b = el("button", `icon-btn cv-icon ${cls}`);
  b.type = "button";
  b.innerHTML = svg;
  b.title = label;
  b.setAttribute("aria-label", label);
  return b;
}

const STATE_WORDS: Record<string, string> = {
  needs_you: "needs you",
  working: "working",
  stale: "stale",
  idle: "idle",
  done: "done",
};

const ASK_WORDS: Record<string, string> = {
  permission: "Permission",
  question: "A question",
  elicitation: "Input wanted",
  idle: "Waiting for a prompt",
  error: "An error",
};

function agentWords(s: SessionSummary): string {
  const running = s.counts.agentsRunning ?? 0;
  const n = s.agents.length;
  return running ? `${running} subagent${running === 1 ? "" : "s"} running` : `${n} subagent${n === 1 ? "" : "s"}`;
}

/** Line 2's facts for a view: what its grouping doesn't already say. */
function metaFacts(s: SessionSummary, view: ViewId): string[] {
  if (view === "repo") return [s.machine, s.branch].filter((x): x is string => !!x);
  return [s.machine, s.repo ? repoParts(s.repo).short : ""].filter((x): x is string => !!x);
}

/** Needs you: since the attention; working: since its state began; idle: since its last event. */
function sinceOf(s: SessionSummary): number | undefined {
  const att = s.openAttentions[0];
  if (s.state === "needs_you" && att) return ms(att.at);
  if (s.state === "working") return ms(s.stateSince);
  if (s.state === "done") return ms(s.endedAt ?? s.lastAt);
  return ms(s.lastAt);
}

/** "now", "12 s", "3 min", "2 h", "3 d". */
export function short(d: number): string {
  if (d < 5000) return "now";
  if (d < 60_000) return `${Math.floor(d / 1000)} s`;
  if (d < 3600_000) return `${Math.floor(d / 60_000)} min`;
  if (d < 86_400_000) return `${Math.floor(d / 3600_000)} h`;
  return `${Math.floor(d / 86_400_000)} d`;
}

function tail(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `…${t.slice(t.length - max + 1)}` : t;
}

/** The step a carried message is at, the way the Session page reads it. */
function shownState(a: ControlActivity): string {
  if (a.outcome === "taken" && a.reply !== undefined) return "progress";
  return a.outcome ?? "queued";
}

function outcomeWords(a: ControlActivity, machine: string): string {
  switch (shownState(a)) {
    case "queued":
      return `Queued · waiting for ${machine}`;
    case "taken":
      return `Taken · ${machine} is delivering it`;
    case "progress":
      return `Working · ${machine} is answering`;
    case "delivered":
      return "Delivered";
    case "expired":
      return `Expired · ${a.detail ?? "nobody took it in time"}`;
    case "unsupported":
      return `Unsupported on this harness`;
    case "failed":
      return `Failed · ${a.detail ?? "the path errored"}`;
    case "refused":
      return `Refused · ${a.code ? a.code.replace(/_/g, " ") : (a.detail ?? "")}`;
    default:
      return String(a.outcome);
  }
}
