// SPDX-License-Identifier: Apache-2.0
// One session as a window: title bar, what's happening, open attention, counts. The DOM
// is built once; `update` touches only what changed (a signature per session), and
// `tick` updates the elapsed numerals once a second.
import type { ThemeApi } from "@sessionpipe-gui/theme-types";
import type { SessionSummary } from "@sessionpipe-gui/theme-types/api";
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
  private text: HTMLElement;
  private att: HTMLElement;
  private attText: HTMLElement;
  private foot: HTMLElement;
  private footLeft: HTMLElement;
  private footRight: HTMLElement;
  /** What the elapsed numeral counts from, if anything. */
  private since: number | undefined;
  private sincePrefix = "";

  constructor(
    private api: ThemeApi,
    session: SessionSummary,
    private onOpen: () => void,
    private onClose: () => void,
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
      this.onOpen();
    });
    const close = el("button", "cv-win-close", "×");
    close.type = "button";
    close.title = "Hide until it changes state";
    close.setAttribute("aria-label", "Hide until it changes state");
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onClose();
    });
    this.bar.append(this.dot, this.title, this.meta, open, close);

    this.body = el("div", "cv-win-body");
    this.now = el("div", "cv-win-now");
    const nowLabel = el("span", "cv-win-now-l");
    this.nowElapsed = el("span", "cv-win-now-t");
    this.now.append(nowLabel, this.nowElapsed);
    this.text = el("div", "cv-win-text");
    this.att = el("div", "cv-win-att");
    this.attText = el("span", "cv-win-att-x");
    const allow = el("a", "cv-link", "Allow");
    allow.href = "#";
    const deny = el("a", "cv-link", "Deny");
    deny.href = "#";
    for (const a of [allow, deny]) {
      a.title = "Answer on the session page";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onOpen();
      });
    }
    const acts = el("span", "cv-win-att-a");
    acts.append(allow, deny);
    this.att.append(this.attText, acts);
    this.body.append(this.now, this.text, this.att);

    this.foot = el("div", "cv-win-foot");
    this.footLeft = el("span");
    this.footRight = el("span");
    this.foot.append(this.footLeft, this.footRight);

    const resize = el("div", "cv-win-resize");
    resize.setAttribute("aria-hidden", "true");
    this.el.append(this.bar, this.body, this.foot, resize);
    this.update(session, Date.now());
  }

  update(s: SessionSummary, now: number) {
    this.session = s;
    const att = s.openAttentions[0];
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
    ].join("\u0001");
    if (sig === this.sig) return;
    this.sig = sig;

    this.el.dataset.state = s.state;
    setClass(this.el, "is-needs", s.state === "needs_you");
    setClass(this.el, "is-muted", s.state === "stale" || s.state === "idle");
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
      nowText = "done";
      this.since = undefined;
    }
    setText(label, nowText);
    this.now.className = `cv-win-now ${nowCls}`;
    this.tick(now);

    // The live text: the tail of what is being written, else the last exchange.
    let text = "";
    let textCls = "cv-win-text";
    if (s.state === "working" && prog) {
      text = tail(prog, 220);
      textCls += " is-live";
    } else if (s.lastAssistant) {
      text = oneLine(s.lastAssistant, 220);
    } else if (s.progress?.user || s.lastUser) {
      text = oneLine(s.progress?.user ?? s.lastUser, 220);
      textCls += " is-user";
    }
    setText(this.text, text);
    this.text.className = textCls;
    this.text.hidden = !text;

    // Attention.
    if (att) {
      setText(this.attText, oneLine(att.message ?? ATTENTION_LABEL[att.kind] ?? att.kind, 160));
      this.att.hidden = false;
      setClass(this.att, "is-ask", att.kind === "permission");
    } else {
      this.att.hidden = true;
    }

    // Counts.
    const c = s.counts;
    const bits = [`${c.tools} tool${c.tools === 1 ? "" : "s"}`];
    if (c.toolErrors) bits.push(`${c.toolErrors} err`);
    if (c.filesChanged) bits.push(`${c.filesChanged} file${c.filesChanged === 1 ? "" : "s"}`);
    if (c.turns) bits.push(`${c.turns} turn${c.turns === 1 ? "" : "s"}`);
    if (c.subagents) bits.push(`${c.subagents} sub`);
    setText(this.footLeft, bits.join(" · "));
    setText(this.footRight, [this.api.format.monogram(s.harness), modelShort(s.model)].filter(Boolean).join(" · "));
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
