// SPDX-License-Identifier: Apache-2.0
// The canvas's chrome, in the app's native grammar: a 48 px opaque toolbar (the views
// as a segmented control, My layout's Tidy / + Area / + Note, then search, Fit, the zoom
// pop-up and ⋯) and a 28 px status bar at the bottom (the connection word when it isn't
// live, the pairing hint said once, a transient line with an Undo, Hidden and Done).
// The controls wear the host's classes (.seg, .icon-btn, .search, .sel.chipsel), so they
// look like every other toolbar in the app.
import { VIEWS, type ViewId } from "./types";
import { el, setClass, setText } from "./util";

export interface ChromeHost {
  setView(v: ViewId): void;
  tidy(): void;
  addArea(): void;
  addNote(): void;
  fit(): void;
  setQuery(q: string): void;
  viewMenu(at: { x: number; y: number }): void;
  zoomMenu(at: { x: number; y: number }): void;
  moreMenu(at: { x: number; y: number }): void;
  hiddenMenu(at: { x: number; y: number }): void;
  doneMenu(at: { x: number; y: number }): void;
  pair(): void;
}

const svg = (body: string, fill = false) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${body}</svg>`;
export const ICONS = {
  tidy: svg(
    '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
  ),
  area: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke-dasharray="2 2"/><path d="M8 5.5v5M5.5 8h5"/>'),
  note: svg('<path d="M3 2.5h10v7.5L10 13.5H3z"/><path d="M10 13.5V10h3.5"/><path d="M5.5 6h5M5.5 8.5h3"/>'),
  fit: svg('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>'),
  more: svg(
    '<circle cx="3.5" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="12.5" cy="8" r="1.25"/>',
    true,
  ),
  search: svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>'),
  chevron:
    '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2.5 4 2.5 2.5L7.5 4"/></svg>',
};

function iconBtn(cls: string, icon: string, label: string, fn: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = el("button", `icon-btn cv-icon ${cls}`);
  b.type = "button";
  b.innerHTML = icon;
  // The host's tooltip names it and shows its key in caps ("Tidy" ⇧T); no native title.
  b.setAttribute("aria-label", label.replace(/ · .*$/, ""));
  const key = / · (.+)$/.exec(label)?.[1];
  if (key) b.dataset.tipKeys = key;
  b.addEventListener("click", () => fn(b));
  return b;
}

const below = (b: HTMLElement) => {
  const r = b.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 4 };
};
const above = (b: HTMLElement) => {
  const r = b.getBoundingClientRect();
  return { x: r.left, y: r.top - 4 };
};

export class Chrome {
  readonly bar: HTMLElement;
  readonly statusBar: HTMLElement;
  readonly search: HTMLInputElement;
  private seg: HTMLElement;
  private segBtns = new Map<ViewId, HTMLButtonElement>();
  private viewChip: HTMLButtonElement;
  private layoutTools: HTMLElement;
  private zoom: HTMLButtonElement;
  private conn: HTMLElement;
  private hint: HTMLElement;
  private hintText: HTMLElement;
  private sayEl: HTMLElement;
  private sayText: HTMLElement;
  private sayBtn: HTMLButtonElement;
  private sayAction: (() => void) | undefined;
  private sayTimer: ReturnType<typeof setTimeout> | undefined;
  private hiddenBtn: HTMLButtonElement;
  private doneBtn: HTMLButtonElement;

  constructor(host: ChromeHost) {
    this.bar = el("div", "cv-bar");
    this.bar.setAttribute("role", "toolbar");
    this.bar.setAttribute("aria-label", "Canvas");
    const left = el("div", "cv-bar-l");
    this.seg = el("div", "seg cv-views");
    this.seg.setAttribute("role", "radiogroup");
    this.seg.setAttribute("aria-label", "View");
    VIEWS.forEach((v, i) => {
      const b = el("button", "seg-opt cv-view", v.label);
      b.type = "button";
      b.dataset.view = v.id;
      b.setAttribute("role", "radio");
      b.dataset.tip = v.label;
      b.dataset.tipKeys = String(i + 1);
      b.addEventListener("click", () => host.setView(v.id));
      this.seg.append(b);
      this.segBtns.set(v.id, b);
    });
    this.viewChip = el("button", "sel chipsel cv-view-chip");
    this.viewChip.type = "button";
    this.viewChip.setAttribute("aria-haspopup", "menu");
    this.viewChip.addEventListener("click", () => host.viewMenu(below(this.viewChip)));
    this.layoutTools = el("div", "cv-layout-tools");
    this.layoutTools.append(
      iconBtn("cv-tidy", ICONS.tidy, "Tidy · ⇧T", () => host.tidy()),
      iconBtn("cv-add-area", ICONS.area, "New area · A", () => host.addArea()),
      iconBtn("cv-add-note", ICONS.note, "New note · N", () => host.addNote()),
    );
    left.append(this.seg, this.viewChip, this.layoutTools);

    const right = el("div", "cv-bar-r");
    const search = el("label", "search cv-search");
    search.insertAdjacentHTML("afterbegin", `<span class="search-icon">${ICONS.search}</span>`);
    this.search = el("input");
    this.search.type = "search";
    this.search.placeholder = "Search";
    this.search.autocomplete = "off";
    this.search.spellcheck = false;
    this.search.setAttribute("aria-label", "Search the canvas");
    this.search.addEventListener("input", () => host.setQuery(this.search.value));
    search.append(this.search, el("kbd", undefined, "/"));
    const searchBtn = iconBtn("cv-search-btn", ICONS.search, "Search · /", () => this.openSearch(true));
    this.search.addEventListener("blur", () => {
      if (!this.search.value) this.openSearch(false);
    });
    this.zoom = el("button", "sel chipsel cv-zoom num");
    this.zoom.type = "button";
    this.zoom.setAttribute("aria-haspopup", "menu");
    this.zoom.setAttribute("aria-label", "Zoom");
    this.zoom.addEventListener("click", () => host.zoomMenu(below(this.zoom)));
    const more = iconBtn("cv-more", ICONS.more, "More", (b) => host.moreMenu(below(b)));
    more.setAttribute("aria-haspopup", "menu");
    right.append(
      search,
      searchBtn,
      iconBtn("cv-fit", ICONS.fit, "Fit · 0", () => host.fit()),
      this.zoom,
      more,
    );
    this.bar.append(left, right);

    this.statusBar = el("div", "cv-statusbar");
    const sl = el("div", "cv-sb-l");
    this.conn = el("span", "cv-conn");
    this.hint = el("span", "cv-hint");
    this.hintText = el("span");
    const pair = el("button", "cv-link cv-pair", "Pair…");
    pair.type = "button";
    pair.addEventListener("click", () => host.pair());
    this.hint.append(this.hintText, pair);
    this.hint.hidden = true;
    this.sayEl = el("span", "cv-say");
    this.sayEl.setAttribute("role", "status");
    this.sayEl.setAttribute("aria-live", "polite");
    this.sayText = el("span", "cv-say-t");
    this.sayBtn = el("button", "cv-link cv-say-btn");
    this.sayBtn.type = "button";
    this.sayBtn.hidden = true;
    this.sayBtn.addEventListener("click", () => {
      const fn = this.sayAction;
      this.say("");
      fn?.();
    });
    this.sayEl.append(this.sayText, this.sayBtn);
    sl.append(this.conn, this.hint, this.sayEl);
    const sr = el("div", "cv-sb-r");
    this.hiddenBtn = el("button", "cv-sb-btn cv-hidden-btn");
    this.hiddenBtn.type = "button";
    this.hiddenBtn.addEventListener("click", () => host.hiddenMenu(above(this.hiddenBtn)));
    this.doneBtn = el("button", "cv-sb-btn cv-done-btn");
    this.doneBtn.type = "button";
    this.doneBtn.addEventListener("click", () => host.doneMenu(above(this.doneBtn)));
    sr.append(this.hiddenBtn, this.doneBtn);
    this.statusBar.append(sl, sr);
  }

  private openSearch(on: boolean) {
    setClass(this.bar, "is-search-open", on);
    if (on) this.search.focus();
  }

  setView(v: ViewId) {
    for (const [id, b] of this.segBtns) {
      b.setAttribute("aria-checked", String(id === v));
      setClass(b, "seg-on", id === v);
      b.tabIndex = id === v ? 0 : -1;
    }
    const label = VIEWS.find((x) => x.id === v)?.label ?? v;
    this.viewChip.innerHTML = "";
    this.viewChip.append(el("span", undefined, `View: ${label}`));
    this.viewChip.insertAdjacentHTML("beforeend", ICONS.chevron);
    this.viewChip.setAttribute("aria-label", `View: ${label}`);
    this.layoutTools.hidden = v !== "layout";
  }

  setZoom(k: number) {
    const t = `${Math.round(k * 100)}%`;
    if (this.zoom.firstChild?.textContent === t) return;
    this.zoom.replaceChildren(el("span", "cv-zoom-v", t));
    this.zoom.insertAdjacentHTML("beforeend", ICONS.chevron);
  }

  setConnection(c: string) {
    setText(this.conn, c === "live" ? "" : c === "connecting" ? "Reconnecting…" : "Offline");
    this.conn.hidden = c === "live";
  }

  /** The one pairing hint; `pair` adds "Pair…". */
  setHint(text: string, pair: boolean) {
    setText(this.hintText, text);
    this.hint.hidden = !text;
    (this.hint.lastElementChild as HTMLElement).hidden = !pair;
  }

  /** A transient line; with an action ("Undo") it stays 8 s, else 1.8 s. Empty clears. */
  say(text: string, action?: { label: string; run: () => void }, sticky = false) {
    clearTimeout(this.sayTimer);
    setText(this.sayText, text);
    this.sayAction = action?.run;
    this.sayBtn.hidden = !action;
    if (action) setText(this.sayBtn, action.label);
    this.sayEl.hidden = !text;
    if (text && !sticky) this.sayTimer = setTimeout(() => this.say(""), action ? 8000 : 1800);
  }

  setCounts(hidden: number, done: number) {
    setText(this.hiddenBtn, `Hidden ${hidden} ▴`);
    this.hiddenBtn.hidden = hidden === 0;
    setText(this.doneBtn, `Done ${done} ▴`);
    this.doneBtn.hidden = done === 0;
  }

  destroy() {
    clearTimeout(this.sayTimer);
    this.bar.remove();
    this.statusBar.remove();
  }
}
