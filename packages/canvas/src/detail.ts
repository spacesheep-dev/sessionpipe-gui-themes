// SPDX-License-Identifier: Apache-2.0
// The expanded window's body: the session's rows, loaded once and then streamed.
import type { ThemeApi } from "@sessionpipe-gui/theme-types";
import type { SessionKey, StoredEvent } from "@sessionpipe-gui/theme-types/api";
import { clock, eventLine } from "./events";
import { el } from "./util";

const MAX_ROWS = 400;

export class Detail {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private off: (() => void) | undefined;
  private lastSeq = -1;
  private rows = 0;
  private dead = false;
  /** Tool calls still running, by call id: the row their end fills. */
  private calls = new Map<string, { row: HTMLElement; end: HTMLElement }>();
  /** What this turn's tools named (paths, mostly), so a file change they made is known. */
  private touched = new Set<string>();

  constructor(
    private api: ThemeApi,
    private key: SessionKey,
  ) {
    this.el = el("div", "cv-detail");
    this.list = el("div", "cv-detail-list");
    this.list.setAttribute("role", "log");
    this.el.append(this.list);
    void this.load();
  }

  private async load() {
    const status = el("div", "cv-detail-status", "Loading…");
    this.list.append(status);
    try {
      const d = await this.api.fetch.session(this.key, { limit: 200 });
      if (this.dead) return;
      status.remove();
      for (const e of d.events) this.push(e, false);
      if (!this.rows) this.list.append(el("div", "cv-detail-status", "Nothing yet"));
      this.list.scrollTop = this.list.scrollHeight;
    } catch (err) {
      status.textContent = `Couldn’t load the session · ${(err as Error).message ?? err}`;
    }
    this.off = this.api.onEvent((e) => {
      if (`${e.harness.name}:${e.session.id}` === this.key) this.push(e, true);
    });
  }

  private push(e: StoredEvent, live: boolean) {
    if (e.session.seq <= this.lastSeq) return;
    this.lastSeq = e.session.seq;
    const line = eventLine(e);
    if (!line) return;
    // "Changed server/receiver.ts" under "Edit server/receiver.ts" says it twice.
    if (e.type === "turn.started") this.touched.clear();
    if (e.type === "files.changed") {
      const paths = Array.isArray(e.data?.paths) ? (e.data.paths as unknown[]) : [];
      if (paths.length && paths.every((p) => this.touched.has(String(p)))) return;
    } else if (line.kind === "tool" && line.text) this.touched.add(line.text);
    const pinned = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 24;
    const open = line.call ? this.calls.get(line.call) : undefined;
    if (open && e.type === "tool.ended") {
      // The call's row already stands: its end fills the right column.
      this.calls.delete(line.call!);
      open.end.textContent = line.end ?? "";
      if (line.err) {
        open.row.classList.add("is-err");
        if (line.text) open.end.title = line.text;
      }
      return;
    }
    const row = el("div", `cv-row cv-row-${line.kind}${line.err ? " is-err" : ""}${line.prose ? " is-prose" : ""}`);
    row.title = clock(e.time, true);
    const end = el("span", "cv-row-e num", line.end ?? "");
    if (line.prose) row.append(el("span", "cv-row-x", line.text));
    else row.append(el("span", "cv-row-l", line.label), el("span", "cv-row-x", line.text), end);
    if (line.call && e.type === "tool.started") this.calls.set(line.call, { row, end });
    if (this.rows === 0) this.list.querySelector(".cv-detail-status")?.remove();
    this.list.append(row);
    this.rows++;
    while (this.rows > MAX_ROWS && this.list.firstElementChild) {
      this.list.firstElementChild.remove();
      this.rows--;
    }
    if (live && pinned) this.list.scrollTop = this.list.scrollHeight;
  }

  destroy() {
    this.dead = true;
    this.off?.();
    this.el.remove();
  }
}
