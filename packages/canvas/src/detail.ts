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
    const status = el("div", "cv-detail-status", "loading…");
    this.list.append(status);
    try {
      const d = await this.api.fetch.session(this.key, { limit: 200 });
      if (this.dead) return;
      status.remove();
      for (const e of d.events) this.push(e, false);
      if (!this.rows) this.list.append(el("div", "cv-detail-status", "nothing yet"));
      this.list.scrollTop = this.list.scrollHeight;
    } catch (err) {
      status.textContent = `could not load: ${(err as Error).message ?? err}`;
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
    const pinned = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 24;
    const row = el("div", `cv-row cv-row-${line.kind}${line.err ? " is-err" : ""}${line.prose ? " is-prose" : ""}`);
    row.append(
      el("span", "cv-row-t", clock(e.time)),
      el("span", "cv-row-l", line.label),
      el("span", "cv-row-x", line.text),
    );
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
