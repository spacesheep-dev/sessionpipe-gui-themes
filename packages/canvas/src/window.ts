// SPDX-License-Identifier: Apache-2.0
// One session as a window: title bar, what's happening, open attention, a prompt line
// when the host can carry a command to it, the messages sent, counts. The DOM is built
// once; `update` touches only what changed (a signature per session), and `tick`
// updates the elapsed numerals once a second.
import type { ThemeApi } from "@sessionpipe-gui/theme-types";
import type { ControlActivity, SessionSummary } from "@sessionpipe-gui/theme-types/api";
import { Detail } from "./detail";
import { durShort } from "./events";
import { el, ms, oneLine, setClass, setText } from "./util";

const ATTENTION_LABEL: Record<string, string> = {
  permission: "permission",
  question: "question",
  elicitation: "input wanted",
  idle: "idle prompt",
  error: "error",
};

const KIND_LABEL: Record<string, string> = {
  prompt: "prompt",
  "permission.answer": "answer",
  cancel: "cancel",
  start: "start",
  "key.add": "trust a device",
};

/** Messages shown under the prompt line: the latest, or three when expanded. */
const ACTS_SHOWN = 1;
const ACTS_EXPANDED = 3;

export interface WinHooks {
  onOpen(): void;
  onClose(): void;
  /** The "n done" chip: show or fold the finished subagents. */
  onToggleDone(): void;
}

export class WinView {
  readonly el: HTMLElement;
  readonly key: string;
  z = 0;
  session: SessionSummary;
  detail: Detail | undefined;
  private sig = "";
  private bar: HTMLElement;
  private dot: HTMLElement;
  private title: HTMLElement;
  private meta: HTMLElement;
  private body: HTMLElement;
  private now: HTMLElement;
  private nowElapsed: HTMLElement;
  private cancel: HTMLAnchorElement;
  private text: HTMLElement;
  private att: HTMLElement;
  private attText: HTMLElement;
  private allow: HTMLAnchorElement;
  private deny: HTMLAnchorElement;
  private ctl: HTMLElement;
  private ctlRow: HTMLElement;
  private input: HTMLInputElement;
  private reason: HTMLElement;
  private acts: HTMLElement;
  private foot: HTMLElement;
  private footLeft: HTMLElement;
  private footRight: HTMLElement;
  private kids: HTMLButtonElement;
  /** What the elapsed numeral counts from, if anything. */
  private since: number | undefined;
  private sincePrefix = "";
  private canControl = false;
  private busy = false;
  private error = "";

  constructor(
    private api: ThemeApi,
    session: SessionSummary,
    private hooks: WinHooks,
  ) {
    this.key = session.key;
    this.session = session;
    const sub = !!session.parentId;
    this.el = el("div", `cv-win${sub ? " is-sub" : ""}`);
    this.el.dataset.key = session.key;
    this.el.tabIndex = 0;
    this.el.setAttribute("role", "group");

    this.bar = el("div", "cv-win-bar");
    this.dot = el("span", "cv-dot");
    this.title = el("span", "cv-win-title");
    this.meta = el("span", "cv-win-meta");
    const open = el("button", "cv-win-open", "→");
    open.type = "button";
    open.title = "Open the session";
    open.setAttribute("aria-label", "Open the session");
    open.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.onOpen();
    });
    const close = el("button", "cv-win-close", "×");
    close.type = "button";
    close.title = "Hide until it changes state";
    close.setAttribute("aria-label", "Hide until it changes state");
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.onClose();
    });
    this.bar.append(this.dot, this.title, this.meta, open, close);

    this.body = el("div", "cv-win-body");
    this.now = el("div", "cv-win-now");
    const nowLabel = el("span", "cv-win-now-l");
    this.nowElapsed = el("span", "cv-win-now-t");
    this.cancel = el("a", "cv-link cv-win-cancel", "Cancel");
    this.cancel.href = "#";
    this.cancel.title = "Stop the running turn";
    this.cancel.hidden = true;
    this.cancel.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.run(() => this.api.control!.cancel(this.key));
    });
    this.now.append(nowLabel, this.nowElapsed, this.cancel);
    this.text = el("div", "cv-win-text");
    this.att = el("div", "cv-win-att");
    this.attText = el("span", "cv-win-att-x");
    this.allow = el("a", "cv-link", "Allow");
    this.allow.href = "#";
    this.deny = el("a", "cv-link", "Deny");
    this.deny.href = "#";
    for (const [a, decision] of [
      [this.allow, "allow"],
      [this.deny, "deny"],
    ] as const) {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void this.answer(decision);
      });
    }
    const acts = el("span", "cv-win-att-a");
    acts.append(this.allow, this.deny);
    this.att.append(this.attText, acts);

    // Control: a prompt line when the host can sign and carry a command to this
    // session; the host's reason in a muted line when it cannot.
    this.ctl = el("div", "cv-win-ctl");
    this.ctlRow = el("div", "cv-ctl-row");
    this.input = el("input", "cv-ctl-input");
    this.input.type = "text";
    this.input.placeholder = "Prompt… Enter sends";
    this.input.autocomplete = "off";
    this.input.setAttribute("aria-label", "Prompt for this session");
    this.input.addEventListener("keydown", (e) => {
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
      e.stopPropagation();
    });
    this.ctlRow.append(this.input);
    this.reason = el("div", "cv-ctl-reason");
    this.acts = el("div", "cv-ctl-acts");
    this.ctl.append(this.ctlRow, this.reason, this.acts);
    this.ctl.hidden = true;
    this.body.append(this.now, this.text, this.att, this.ctl);

    this.foot = el("div", "cv-win-foot");
    this.footLeft = el("span");
    this.footRight = el("span");
    this.kids = el("button", "cv-win-kids");
    this.kids.type = "button";
    this.kids.hidden = true;
    this.kids.title = "Finished subagents";
    this.kids.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.onToggleDone();
    });
    this.foot.append(this.footLeft, this.kids, this.footRight);

    const resize = el("div", "cv-win-resize");
    resize.setAttribute("aria-hidden", "true");
    this.el.append(this.bar, this.body, this.foot, resize);
    this.update(session, Date.now(), [], 0, false);
  }

  update(
    s: SessionSummary,
    now: number,
    activities: readonly ControlActivity[],
    doneKids: number,
    showingDone: boolean,
  ) {
    this.session = s;
    this.lastActs = activities;
    this.lastDone = doneKids;
    this.lastShowing = showingDone;
    const att = s.openAttentions[0];
    const prog = s.progress?.assistant ?? "";
    const control = this.api.control;
    const av = control && s.state !== "done" ? control.availability({ session: s.key }) : null;
    this.canControl = !!av?.ok;
    const acts = activities.slice(0, this.expanded ? ACTS_EXPANDED : ACTS_SHOWN);
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
      s.endedAt,
      att?.attentionId,
      att?.message,
      prog.length,
      s.progress?.at,
      s.lastAssistant,
      s.lastUser,
      s.counts.tools,
      s.counts.toolErrors,
      s.counts.filesChanged,
      s.counts.turns,
      s.counts.subagents,
      s.model,
      av ? `${av.ok}:${av.reason ?? ""}` : "-",
      acts.map((a) => `${a.id}:${a.outcome ?? ""}:${a.reply?.length ?? ""}`).join(","),
      doneKids,
      showingDone,
      this.busy,
      this.error,
    ].join("\u0001");
    if (sig === this.sig) return;
    this.sig = sig;

    this.el.dataset.state = s.state;
    setClass(this.el, "is-needs", s.state === "needs_you");
    setClass(this.el, "is-muted", s.state === "stale" || s.state === "idle" || s.state === "done");
    setClass(this.el, "is-done", s.state === "done");
    setText(this.title, this.api.format.title(s));
    this.title.title = this.api.format.title(s);
    const rb = this.api.format.repoBranch(s);
    setText(this.meta, [s.machine, rb].filter(Boolean).join(" · "));

    // What's happening now.
    const label = this.now.firstElementChild as HTMLElement;
    this.since = undefined;
    this.sincePrefix = "";
    let nowText = "";
    let nowCls = "";
    if (s.state === "needs_you" && att) {
      nowText = `${ATTENTION_LABEL[att.kind] ?? att.kind}${att.tool ? ` · ${att.tool}` : ""}`;
      nowCls = "is-needs";
      this.since = ms(att.at);
      this.sincePrefix = "waiting ";
    } else if (s.state === "working") {
      if (s.currentTool) {
        nowText = s.currentTool.tool;
        nowCls = "is-tool";
        this.since = ms(s.currentTool.since);
      } else if (s.progress && now - ms(s.progress.at) < 4000) {
        nowText = "writing";
        nowCls = "is-writing";
      } else {
        nowText = "thinking";
        nowCls = "is-writing";
        this.since = s.currentTurn ? ms(s.currentTurn.since) : undefined;
      }
    } else if (s.state === "stale") {
      nowText = "silent";
      this.since = ms(s.lastAt);
      this.sincePrefix = "for ";
    } else if (s.state === "idle") {
      nowText = "idle";
      this.since = ms(s.stateSince);
      this.sincePrefix = "for ";
    } else {
      const ran = ms(s.endedAt ?? s.lastAt) - ms(s.startedAt);
      nowText = `done · ${s.counts.tools} tool${s.counts.tools === 1 ? "" : "s"}${ran > 0 ? ` · ${durShort(ran)}` : ""}`;
      this.since = undefined;
    }
    setText(label, nowText);
    this.now.className = `cv-win-now ${nowCls}`;
    this.cancel.hidden = !(this.canControl && s.state === "working" && !s.parentId);
    this.tick(now);

    // The live text: the tail of what is being written, else the last exchange.
    let text = "";
    let textCls = "cv-win-text";
    if (s.state === "working" && prog) {
      text = tail(prog, 260);
      textCls += " is-live";
    } else if (s.lastAssistant) {
      text = oneLine(s.lastAssistant, 260);
    } else if (s.progress?.user || s.lastUser) {
      text = oneLine(s.progress?.user ?? s.lastUser, 260);
      textCls += " is-user";
    }
    setText(this.text, text);
    this.text.className = textCls;
    this.text.hidden = !text;

    // Attention. Allow/Deny act here when the host can carry the answer; otherwise they
    // lead to the session page, where control lives.
    if (att) {
      setText(this.attText, oneLine(att.message ?? ATTENTION_LABEL[att.kind] ?? att.kind, 160));
      this.att.hidden = false;
      const ask = att.kind === "permission";
      setClass(this.att, "is-ask", ask);
      setClass(this.att, "is-local", ask && this.canControl);
      const title = ask && this.canControl ? "Answer from here" : "Answer on the session page";
      this.allow.title = title;
      this.deny.title = title;
    } else {
      this.att.hidden = true;
    }

    // Control.
    if (control && !s.parentId && s.state !== "done") {
      this.ctl.hidden = false;
      this.ctlRow.hidden = !this.canControl;
      this.input.disabled = this.busy;
      const reason = this.error || (av && !av.ok ? av.reason || "control is not available" : "");
      setText(this.reason, reason);
      this.reason.hidden = !reason;
      setClass(this.reason, "is-err", !!this.error);
      this.renderActs(acts, s, now);
    } else {
      this.ctl.hidden = true;
    }

    // Counts.
    const c = s.counts;
    const bits = [`${c.tools} tool${c.tools === 1 ? "" : "s"}`];
    if (c.toolErrors) bits.push(`${c.toolErrors} err`);
    if (c.filesChanged) bits.push(`${c.filesChanged} file${c.filesChanged === 1 ? "" : "s"}`);
    if (c.turns) bits.push(`${c.turns} turn${c.turns === 1 ? "" : "s"}`);
    const liveKids = c.subagents - doneKids;
    if (liveKids > 0) bits.push(`${liveKids} sub`);
    setText(this.footLeft, bits.join(" · "));
    this.kids.hidden = doneKids === 0;
    setText(this.kids, `${doneKids} done`);
    setClass(this.kids, "is-on", showingDone);
    this.kids.setAttribute("aria-expanded", String(showingDone));
    setText(this.footRight, [this.api.format.monogram(s.harness), modelShort(s.model)].filter(Boolean).join(" · "));
  }

  private renderActs(acts: readonly ControlActivity[], s: SessionSummary, now: number) {
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
          el("span", "cv-act-ago", this.api.format.ago(a.ackedAt ?? a.takenAt ?? a.at, now)),
        );
        row.append(head, el("div", `cv-act-state${isFinal(a) ? "" : " is-live"}`, outcomeWords(a, machine)));
        if (a.reply) row.append(el("div", "cv-act-reply", tail(a.reply, 200)));
        return row;
      }),
    );
    this.acts.hidden = acts.length === 0;
  }

  /** Once a second: the elapsed numeral beside the current tool or wait. */
  tick(now: number) {
    if (this.since === undefined || Number.isNaN(this.since)) {
      setText(this.nowElapsed, "");
      return;
    }
    const d = Math.max(0, now - this.since);
    setText(this.nowElapsed, d < 1500 ? "" : `${this.sincePrefix}${durShort(d)}`);
  }

  private async run(fn: () => Promise<unknown>) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.sig = "";
    this.refresh();
    try {
      await fn();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      this.error = m.startsWith("not sent") ? m : `not sent · ${m}`;
    } finally {
      this.busy = false;
      this.sig = "";
      this.refresh();
    }
  }

  /** Re-render from the last session with the control state changed (the canvas
   *  re-updates with fresh activities on the next snapshot anyway). */
  private refresh() {
    this.update(this.session, Date.now(), this.lastActs, this.lastDone, this.lastShowing);
  }
  private lastActs: readonly ControlActivity[] = [];
  private lastDone = 0;
  private lastShowing = false;

  /** Allow or deny the open permission: from here when the host carries it, else on the page. */
  answer(decision: "allow" | "deny"): Promise<void> | void {
    const att = this.session.openAttentions[0];
    if (!att) return;
    if (att.kind === "permission" && this.canControl && this.api.control) {
      return this.run(() => this.api.control!.answer(this.key, att.attentionId, decision));
    }
    this.hooks.onOpen();
  }

  /** Enter on a focused window: the prompt line, when there is one. */
  focusPrompt(): boolean {
    if (this.ctl.hidden || this.ctlRow.hidden || this.input.disabled) return false;
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
  }

  get expanded() {
    return !!this.detail;
  }

  destroy() {
    this.detail?.destroy();
    this.el.remove();
  }
}

function tail(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `…${t.slice(t.length - max + 1)}` : t;
}

/** "claude-fable-5-1" → "fable 5.1", "gpt-5-codex" → "gpt-5 codex". */
function modelShort(model: string | undefined): string {
  if (!model) return "";
  let m = model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  m = m.replace(/(\d)-(\d)/g, "$1.$2");
  return m.replace(/-/g, " ");
}

/** The step a carried message is at, the way the Session page reads it. */
function shownState(a: ControlActivity): string {
  if (a.outcome === "taken" && a.reply !== undefined) return "progress";
  return a.outcome ?? "queued";
}

const isFinal = (a: ControlActivity) =>
  a.outcome === "delivered" ||
  a.outcome === "expired" ||
  a.outcome === "unsupported" ||
  a.outcome === "failed" ||
  a.outcome === "refused";

function outcomeWords(a: ControlActivity, machine: string): string {
  const mode = a.mode ? ` · ${a.mode}` : "";
  switch (shownState(a)) {
    case "queued":
      return `queued · waiting for ${machine} to take it`;
    case "taken":
      return `taken · ${machine} is delivering it${mode}`;
    case "progress":
      return `working · ${machine} is answering${mode}`;
    case "delivered":
      return `delivered${mode}`;
    case "expired":
      return `expired · ${a.detail ?? "nobody took it in time"}`;
    case "unsupported":
      return `unsupported · ${machine} has no way to ${KIND_LABEL[a.kind] ?? a.kind} on this harness`;
    case "failed":
      return `failed · ${a.detail ?? "the path errored"}`;
    case "refused":
      return `refused · ${a.code ? a.code.replace(/_/g, " ") : (a.detail ?? "")}`;
    default:
      return String(a.outcome);
  }
}
