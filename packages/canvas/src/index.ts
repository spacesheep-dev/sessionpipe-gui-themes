// SPDX-License-Identifier: Apache-2.0
// Canvas: every live session as a window on an infinite, pannable, zoomable surface.
// Positions live in api.storage (shared across devices); the viewport in api.local.
// Rendering is transforms only, applied in one requestAnimationFrame that runs only
// when something changed.
import type { Theme, ThemeApi, ThemeSnapshot } from "@sessionpipe-gui/theme-types";
import type { SessionKey, SessionSummary } from "@sessionpipe-gui/theme-types/api";
import "./canvas.css";
import { attachInput, type Hit, type InputHost } from "./input";
import { bounds, findFree, overlaps, type Rect, tidy } from "./layout";
import {
  EXP_H,
  EXP_W,
  emptyLayout,
  type Layout,
  MAX_H,
  MAX_W,
  MIN_H,
  MIN_W,
  SUB_H,
  SUB_W,
  type Viewport,
  WIN_H,
  WIN_W,
  type WinPos,
  ZOOM_MAX,
  ZOOM_MIN,
  type Zone,
} from "./types";
import { clamp, debounce, el, isTouchLike, reducedMotion, setClass, setText, svg } from "./util";
import { WinView } from "./window";

const VIEWPORT_KEY = "viewport";
const SHELF_MAX = 48;
const Z_NEEDS = 100_000;

class Canvas implements InputHost {
  readonly root: HTMLElement;
  private world: HTMLElement;
  private zonesEl: HTMLElement;
  private tethers: SVGSVGElement;
  private winsEl: HTMLElement;
  private search: HTMLInputElement;
  private zoomLabel: HTMLButtonElement;
  private conn: HTMLElement;
  private zonesBtn: HTMLButtonElement;
  private tray: HTMLElement;
  private shelf: HTMLElement;
  private shelfBtn: HTMLButtonElement;
  private shelfTiles: HTMLElement;
  private minimap: HTMLCanvasElement;
  private status: HTMLElement;

  private layout: Layout = emptyLayout();
  private view: Viewport = { x: 0, y: 0, k: 1 };
  private size = { w: 0, h: 0 };
  private views = new Map<SessionKey, WinView>();
  private zoneEls = new Map<string, HTMLElement>();
  private snapshot: ThemeSnapshot;
  private zTop = 1;
  private query = "";
  private dirtyVp = true;
  private dirtyWins = new Set<SessionKey>();
  private dirtyAll = true;
  private frame = 0;
  private tween: { from: Viewport; to: Viewport; t0: number; ms: number } | undefined;
  private leaving = new Set<SessionKey>();
  private unsubs: (() => void)[] = [];
  private ticker: ReturnType<typeof setInterval> | undefined;
  private ro: ResizeObserver | undefined;
  private ready = false;
  private motion = !reducedMotion();

  constructor(
    container: HTMLElement,
    private api: ThemeApi,
  ) {
    this.snapshot = api.state.get();
    this.root = el("div", "spcv");
    this.root.tabIndex = 0;
    this.root.dataset.scheme = this.snapshot.scheme;
    if (isTouchLike()) this.root.classList.add("is-touch");

    this.world = el("div", "cv-world");
    this.zonesEl = el("div", "cv-zones");
    this.tethers = svg("svg", { class: "cv-tethers", "aria-hidden": "true" });
    this.winsEl = el("div", "cv-wins");
    this.world.append(this.zonesEl, this.tethers, this.winsEl);

    // HUD: search, actions, zoom.
    const hud = el("div", "cv-hud");
    const left = el("div", "cv-hud-l");
    this.search = el("input", "cv-search");
    this.search.type = "search";
    this.search.placeholder = "Find  /";
    this.search.setAttribute("aria-label", "Find sessions");
    this.search.autocomplete = "off";
    this.search.addEventListener("input", () => this.setQuery(this.search.value));
    left.append(this.search);
    const btn = (label: string, title: string, fn: () => void) => {
      const b = el("button", "cv-btn", label);
      b.type = "button";
      b.title = title;
      b.addEventListener("click", fn);
      left.append(b);
      return b;
    };
    btn("Tidy", "Arrange by state", () => this.tidy());
    btn("Fit", "Zoom to show everything (0)", () => this.fit());
    this.zonesBtn = btn("Zones", "Show machines as regions", () => this.toggleZones());
    btn("Reset", "Forget the layout", () => this.reset());
    const right = el("div", "cv-hud-r");
    this.conn = el("span", "cv-conn");
    this.zoomLabel = el("button", "cv-zoom", "100%");
    this.zoomLabel.type = "button";
    this.zoomLabel.title = "Zoom to 100%";
    this.zoomLabel.addEventListener("click", () => this.zoomTo(1));
    right.append(this.conn, this.zoomLabel);
    hud.append(left, right);

    this.status = el("div", "cv-status");
    this.status.setAttribute("aria-live", "polite");

    this.tray = el("div", "cv-tray");
    this.shelf = el("div", "cv-shelf");
    this.shelfBtn = el("button", "cv-shelf-btn");
    this.shelfBtn.type = "button";
    this.shelfBtn.addEventListener("click", () => {
      this.layout.shelfOpen = !this.layout.shelfOpen;
      this.renderShelf();
      this.save();
    });
    this.shelfTiles = el("div", "cv-shelf-tiles");
    this.shelf.append(this.shelfBtn, this.shelfTiles);

    this.minimap = el("canvas", "cv-minimap");
    this.minimap.title = "Click to jump";
    this.minimap.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.jumpFromMinimap(e);
    });

    this.root.append(this.world, hud, this.status, this.tray, this.shelf, this.minimap);
    container.append(this.root);
    if (this.root.clientHeight < 160) {
      const top = this.root.getBoundingClientRect().top;
      this.root.style.height = `calc(100vh - ${Math.max(0, top)}px)`;
    }
    this.measure();
    this.ro = new ResizeObserver(() => {
      this.measure();
      this.dirtyVp = true;
      this.request();
    });
    this.ro.observe(this.root);

    this.unsubs.push(attachInput(this));
    this.unsubs.push(api.state.subscribe((s) => this.onSnapshot(s)));
    this.ticker = setInterval(() => this.tick(), 1000);
    void this.load();
  }

  // ---------- lifecycle ----------

  private async load() {
    let stored: Layout | null = null;
    try {
      stored = await this.api.storage.get<Layout>();
      if (stored && stored.v === 1 && stored.windows) this.layout = { ...emptyLayout(), ...stored };
    } catch {}
    const vp = this.api.local.get<Viewport>(VIEWPORT_KEY);
    if (vp && Number.isFinite(vp.x) && Number.isFinite(vp.y) && Number.isFinite(vp.k)) {
      this.view = { x: vp.x, y: vp.y, k: clamp(vp.k, ZOOM_MIN, ZOOM_MAX) };
    }
    this.ready = true;
    setClass(this.zonesBtn, "is-on", this.layout.zonesOn);
    const fresh = !stored || Object.keys(this.layout.windows).length === 0;
    this.sync(this.api.state.get(), true);
    if (fresh && this.narrow) this.tidy(false);
    if (!vp) this.fit(false);
    this.dirtyVp = true;
    this.request();
  }

  destroy() {
    for (const u of this.unsubs) u();
    if (this.ticker) clearInterval(this.ticker);
    this.ro?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.save.flush();
    this.saveVp.flush();
    for (const v of this.views.values()) v.destroy();
    this.root.remove();
  }

  private measure() {
    this.size = { w: this.root.clientWidth, h: this.root.clientHeight };
  }

  /** A phone: windows stack in one column and Fit fits the width. */
  private get narrow() {
    return this.size.w < 600;
  }

  private save = debounce(400, () => {
    void this.api.storage.set(this.layout).catch(() => {});
  });
  private saveVp = debounce(250, () => {
    this.api.local.set(VIEWPORT_KEY, this.view);
  });

  // ---------- state ----------

  private onSnapshot(s: ThemeSnapshot) {
    const schemeChanged = s.scheme !== this.snapshot.scheme;
    this.snapshot = s;
    if (schemeChanged) {
      this.root.dataset.scheme = s.scheme;
      this.dirtyVp = true;
      this.request();
    }
    if (this.ready) this.sync(s, false);
  }

  private sync(s: ThemeSnapshot, initial: boolean) {
    const now = Date.now();
    setText(this.conn, s.connection === "live" ? "" : s.connection);
    setClass(this.conn, "is-off", s.connection !== "live");
    let placed = false;
    let zChanged = false;
    const live: SessionSummary[] = [];
    for (const sess of s.sessions.values()) {
      const key = sess.key;
      const pos = this.layout.windows[key];
      if (sess.state === "done") {
        const v = this.views.get(key);
        if (v) this.leave(v);
        continue;
      }
      live.push(sess);
      if (pos?.hidden && pos.hidden !== sess.state) {
        delete pos.hidden;
        placed = true;
      }
      if (pos?.hidden) {
        const v = this.views.get(key);
        if (v) this.dropView(v);
        continue;
      }
      let view = this.views.get(key);
      if (!view) {
        if (!pos) {
          this.layout.windows[key] = this.place(sess);
          placed = true;
        }
        view = this.addView(sess, !initial && this.motion);
        zChanged = true;
      } else {
        const before = view.session.state;
        view.update(sess, now);
        if (before !== sess.state) zChanged = true;
      }
      const p = this.layout.windows[key];
      if (p?.expanded && !view.expanded) view.setExpanded(true);
      this.dirtyWins.add(key);
    }
    // Sessions the host forgot.
    for (const [key, v] of this.views) {
      if (!s.sessions.has(key)) {
        this.dropView(v);
        delete this.layout.windows[key];
        placed = true;
      }
    }
    for (const key of Object.keys(this.layout.windows)) {
      if (!s.sessions.has(key)) {
        delete this.layout.windows[key];
        placed = true;
      }
    }
    if (zChanged) this.restack();
    if (placed) this.save();
    this.renderTray(live);
    this.renderShelf();
    this.renderZones();
    this.applySearch();
    this.dirtyAll = true;
    this.request();
  }

  private addView(sess: SessionSummary, animate: boolean): WinView {
    const v = new WinView(
      this.api,
      sess,
      () => this.api.openSession(sess.key),
      () => this.hide(sess.key),
    );
    v.z = ++this.zTop;
    this.views.set(sess.key, v);
    if (animate) {
      v.el.classList.add("is-new");
      v.el.addEventListener("animationend", () => v.el.classList.remove("is-new"), { once: true });
    }
    this.winsEl.append(v.el);
    this.applySize(v);
    return v;
  }

  private dropView(v: WinView) {
    this.views.delete(v.key);
    this.leaving.delete(v.key);
    v.destroy();
  }

  /** Done: shrink and slide toward the shelf, then leave the world. */
  private leave(v: WinView) {
    if (this.leaving.has(v.key)) return;
    this.leaving.add(v.key);
    const r = this.absRect(v.key);
    if (!this.motion || !r) {
      this.dropView(v);
      return;
    }
    const target = this.toWorld(this.size.w / 2, this.size.h - 12);
    v.el.classList.add("is-leaving");
    v.el.style.transform = `translate3d(${target.x - r.w / 2}px, ${target.y - r.h / 2}px, 0) scale(0.15)`;
    const done = () => this.dropView(v);
    v.el.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 500);
  }

  private hide(key: SessionKey) {
    const pos = this.layout.windows[key];
    const v = this.views.get(key);
    if (!pos || !v) return;
    pos.hidden = v.session.state;
    if (pos.expanded) {
      pos.expanded = false;
    }
    this.dropView(v);
    this.save();
    this.sync(this.snapshot, false);
  }

  private unhide(key: SessionKey) {
    const pos = this.layout.windows[key];
    if (pos) delete pos.hidden;
    this.save();
    this.sync(this.snapshot, false);
    const v = this.views.get(key);
    if (v) this.focusWin(key);
  }

  private tick() {
    const now = Date.now();
    for (const v of this.views.values()) v.tick(now);
  }

  // ---------- geometry ----------

  private pos(key: SessionKey): WinPos {
    const p = this.layout.windows[key];
    if (p) return p;
    const s = this.snapshot.sessions.get(key);
    const sub = !!s?.parentId;
    const np = { x: 0, y: 0, w: sub ? SUB_W : WIN_W, h: sub ? SUB_H : WIN_H, rel: sub };
    this.layout.windows[key] = np;
    return np;
  }

  private parentKey(key: SessionKey): SessionKey | undefined {
    const s = this.snapshot.sessions.get(key);
    if (!s?.parentId) return undefined;
    const pk = `${s.harness}:${s.parentId}`;
    return this.layout.windows[pk] ? pk : undefined;
  }

  private shown(key: SessionKey): { w: number; h: number } {
    const p = this.pos(key);
    if (p.expanded) {
      // On a phone an expanded window fits the screen's width instead.
      const maxW = this.narrow ? Math.max(p.w, (this.size.w - 24) / this.view.k) : Number.POSITIVE_INFINITY;
      return { w: Math.min(maxW, Math.max(p.ew ?? 0, p.w, EXP_W)), h: Math.max(p.eh ?? 0, p.h, EXP_H) };
    }
    return { w: p.w, h: p.h };
  }

  /** Absolute world rect, resolving a subagent's offset from its parent. */
  private absRect(key: SessionKey): Rect | null {
    const p = this.layout.windows[key];
    if (!p) return null;
    const { w, h } = this.shown(key);
    const pk = p.rel ? this.parentKey(key) : undefined;
    if (pk) {
      const pr = this.absRect(pk);
      if (pr) return { x: pr.x + p.x, y: pr.y + p.y, w, h };
    }
    return { x: p.x, y: p.y, w, h };
  }

  private toWorld(sx: number, sy: number) {
    return { x: (sx - this.view.x) / this.view.k, y: (sy - this.view.y) / this.view.k };
  }

  private visibleRects(): Rect[] {
    const out: Rect[] = [];
    for (const key of this.views.keys()) {
      const r = this.absRect(key);
      if (r) out.push(r);
    }
    return out;
  }

  /** A new window goes to the nearest free spot around the viewport centre; a subagent
   *  hangs under its parent, to the right of its siblings. */
  private place(sess: SessionSummary): WinPos {
    const sub = !!sess.parentId;
    const w = sub ? SUB_W : WIN_W;
    const h = sub ? SUB_H : WIN_H;
    if (sub) {
      const pk = `${sess.harness}:${sess.parentId}`;
      const parent = this.layout.windows[pk];
      if (parent) {
        // The next free slot in rows under the parent, no wider than it.
        const siblings = [...this.snapshot.sessions.values()].filter(
          (s) =>
            s.parentId === sess.parentId &&
            s.key !== sess.key &&
            this.layout.windows[s.key]?.rel &&
            this.views.has(s.key),
        );
        const taken = siblings.map((s) => this.layout.windows[s.key]!);
        for (let y = parent.h + 10; y < parent.h + 2000; y += h + 10) {
          for (let x = 0; x + w <= Math.max(parent.w, w); x += w + 10) {
            const r = { x, y, w, h };
            if (!taken.some((t) => overlaps(r, t, 4))) return { ...r, rel: true };
          }
        }
        return { x: 0, y: parent.h + 10, w, h, rel: true };
      }
    }
    const centre = this.toWorld(this.size.w / 2, this.size.h / 2);
    const taken = this.visibleRects();
    const r = findFree(centre, w, h, taken);
    return { x: r.x, y: r.y, w, h };
  }

  // ---------- rendering ----------

  private request() {
    if (this.frame) return;
    this.frame = requestAnimationFrame((t) => {
      this.frame = 0;
      this.render(t);
    });
  }

  private render(t: number) {
    if (this.tween) {
      const p = clamp((t - this.tween.t0) / this.tween.ms, 0, 1);
      const e = 1 - (1 - p) ** 3;
      const { from, to } = this.tween;
      this.view = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
      this.dirtyVp = true;
      if (p >= 1) this.tween = undefined;
      else this.request();
    }
    if (this.dirtyVp) {
      const { x, y, k } = this.view;
      this.world.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${k})`;
      let s = 32 * k;
      while (s < 18) s *= 2;
      while (s > 72) s /= 2;
      this.root.style.setProperty("--cv-grid", `${s}px`);
      this.root.style.setProperty("--cv-grid-x", `${x}px`);
      this.root.style.setProperty("--cv-grid-y", `${y}px`);
      setText(this.zoomLabel, `${Math.round(k * 100)}%`);
      this.dirtyVp = false;
      this.saveVp();
    }
    const keys = this.dirtyAll ? this.views.keys() : this.dirtyWins;
    for (const key of keys) {
      const v = this.views.get(key);
      if (v && !this.leaving.has(key)) this.applyWin(v);
    }
    this.dirtyWins.clear();
    this.dirtyAll = false;
    this.drawTethers();
    this.drawZones();
    this.drawMinimap();
  }

  private applyWin(v: WinView) {
    const r = this.absRect(v.key);
    if (!r) return;
    v.el.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`;
    this.applySize(v);
    const z = v.session.state === "needs_you" ? Z_NEEDS + v.z : v.z;
    const zs = String(z);
    if (v.el.style.zIndex !== zs) v.el.style.zIndex = zs;
  }

  private applySize(v: WinView) {
    const { w, h } = this.shown(v.key);
    const ws = `${w}px`;
    const hs = `${h}px`;
    if (v.el.style.width !== ws) v.el.style.width = ws;
    if (v.el.style.height !== hs) v.el.style.height = hs;
  }

  private restack() {
    for (const v of this.views.values()) this.dirtyWins.add(v.key);
  }

  private drawTethers() {
    const lines: string[] = [];
    for (const v of this.views.values()) {
      const p = this.layout.windows[v.key];
      if (!p?.rel) continue;
      const pk = this.parentKey(v.key);
      if (!pk || !this.views.has(pk)) continue;
      const a = this.absRect(v.key);
      const b = this.absRect(pk);
      if (!a || !b) continue;
      lines.push(`${a.x + a.w / 2},${a.y + a.h / 2},${b.x + b.w / 2},${b.y + b.h / 2}`);
    }
    const sig = lines.join(";");
    if (this.tethers.dataset.sig === sig) return;
    this.tethers.dataset.sig = sig;
    this.tethers.replaceChildren(
      ...lines.map((l) => {
        const [x1, y1, x2, y2] = l.split(",");
        return svg("line", { x1: x1!, y1: y1!, x2: x2!, y2: y2!, class: "cv-tether" });
      }),
    );
  }

  // ---------- zones ----------

  private renderZones() {
    const on = this.layout.zonesOn;
    setClass(this.root, "has-zones", on);
    if (!on) {
      this.zonesEl.replaceChildren();
      this.zoneEls.clear();
      return;
    }
    const names = new Set<string>();
    for (const m of this.snapshot.machines.keys()) names.add(m);
    for (const s of this.snapshot.sessions.values()) if (s.machine) names.add(s.machine);
    for (const name of names) {
      if (!this.layout.zones[name]) this.layout.zones[name] = this.defaultZone(name);
      if (!this.zoneEls.has(name)) {
        const z = el("div", "cv-zone");
        z.dataset.zone = name;
        const label = el("div", "cv-zone-label");
        label.append(el("span", "cv-zone-name", name), el("span", "cv-zone-n"));
        const handle = el("div", "cv-zone-resize");
        z.append(label, handle);
        this.zonesEl.append(z);
        this.zoneEls.set(name, z);
      }
    }
    for (const [name, z] of this.zoneEls) {
      if (!names.has(name)) {
        z.remove();
        this.zoneEls.delete(name);
      }
    }
  }

  private defaultZone(name: string): Zone {
    const rects: Rect[] = [];
    for (const [key, v] of this.views) {
      if (v.session.machine !== name) continue;
      const r = this.absRect(key);
      if (r) rects.push(r);
    }
    const b = bounds(rects);
    const PAD = 40;
    if (b) return { x: b.x - PAD, y: b.y - PAD - 8, w: b.w + PAD * 2, h: b.h + PAD * 2 + 8 };
    const taken = [...this.visibleRects(), ...Object.values(this.layout.zones)];
    const r = findFree(this.toWorld(this.size.w / 2, this.size.h / 2), 640, 420, taken, 80);
    return { x: r.x, y: r.y, w: r.w, h: r.h };
  }

  private drawZones() {
    if (!this.layout.zonesOn) return;
    for (const [name, z] of this.zoneEls) {
      const r = this.layout.zones[name];
      if (!r) continue;
      z.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`;
      z.style.width = `${r.w}px`;
      z.style.height = `${r.h}px`;
      let n = 0;
      for (const key of this.views.keys()) {
        const wr = this.absRect(key);
        if (
          wr &&
          wr.x + wr.w / 2 >= r.x &&
          wr.x + wr.w / 2 <= r.x + r.w &&
          wr.y + wr.h / 2 >= r.y &&
          wr.y + wr.h / 2 <= r.y + r.h
        )
          n++;
      }
      const nEl = z.querySelector(".cv-zone-n") as HTMLElement;
      setText(nEl, n ? String(n) : "");
    }
  }

  private toggleZones() {
    this.layout.zonesOn = !this.layout.zonesOn;
    setClass(this.zonesBtn, "is-on", this.layout.zonesOn);
    if (this.layout.zonesOn && Object.keys(this.layout.zones).length === 0) {
      this.tidy();
    } else {
      this.renderZones();
      this.dirtyAll = true;
      this.request();
      this.save();
    }
  }

  // ---------- tray and shelf ----------

  private renderTray(live: SessionSummary[]) {
    const hidden = live.filter((s) => this.layout.windows[s.key]?.hidden);
    this.tray.hidden = hidden.length === 0;
    const sig = hidden.map((s) => `${s.key}:${s.state}`).join(",");
    if (this.tray.dataset.sig === sig) return;
    this.tray.dataset.sig = sig;
    this.tray.replaceChildren(
      el("span", "cv-tray-label", "hidden"),
      ...hidden.map((s) => {
        const b = el("button", "cv-chip", this.api.format.title(s));
        b.type = "button";
        b.dataset.state = s.state;
        b.title = "Show again";
        b.addEventListener("click", () => this.unhide(s.key));
        return b;
      }),
    );
  }

  private renderShelf() {
    const done = [...this.snapshot.sessions.values()]
      .filter((s) => s.state === "done" && !s.parentId)
      .sort((a, b) => (b.endedAt ?? b.lastAt).localeCompare(a.endedAt ?? a.lastAt))
      .slice(0, SHELF_MAX);
    this.shelf.hidden = done.length === 0;
    const open = this.layout.shelfOpen;
    setClass(this.root, "has-shelf", done.length > 0);
    setClass(this.root, "shelf-open", done.length > 0 && open);
    setClass(this.shelf, "is-open", open);
    setText(this.shelfBtn, `Done · ${done.length}`);
    this.shelfBtn.setAttribute("aria-expanded", String(open));
    const now = Date.now();
    const sig = `${open}|${done.map((s) => s.key).join(",")}`;
    if (!open) {
      this.shelfTiles.replaceChildren();
      this.shelfTiles.dataset.sig = "";
      return;
    }
    if (this.shelfTiles.dataset.sig === sig) return;
    this.shelfTiles.dataset.sig = sig;
    this.shelfTiles.replaceChildren(
      ...done.map((s) => {
        const t = el("button", "cv-tile");
        t.type = "button";
        t.title = "Open the session";
        t.addEventListener("click", () => this.api.openSession(s.key));
        const meta = [this.api.format.ago(s.endedAt ?? s.lastAt, now), this.api.format.repoBranch(s)].filter(Boolean);
        t.append(el("span", "cv-tile-title", this.api.format.title(s)), el("span", "cv-tile-meta", meta.join(" · ")));
        return t;
      }),
    );
  }

  // ---------- minimap ----------

  private drawMinimap() {
    const c = this.minimap;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== W * dpr || c.height !== H * dpr) {
      c.width = W * dpr;
      c.height = H * dpr;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const rects = this.visibleRects();
    const vpw = {
      x: -this.view.x / this.view.k,
      y: -this.view.y / this.view.k,
      w: this.size.w / this.view.k,
      h: this.size.h / this.view.k,
    };
    const b = bounds([...rects, vpw]);
    if (!b) return;
    const pad = 20;
    const s = Math.min((W - pad * 2) / Math.max(1, b.w), (H - pad * 2) / Math.max(1, b.h));
    const ox = (W - b.w * s) / 2 - b.x * s;
    const oy = (H - b.h * s) / 2 - b.y * s;
    // Hairline outlines only: windows in muted grey, a needs-you window in amber, the
    // viewport a shade darker. Nothing is filled.
    const css = getComputedStyle(this.root);
    const fg4 = css.getPropertyValue("--fg-4").trim() || "#888";
    const needs = css.getPropertyValue("--needs").trim() || "#d9a441";
    const line = css.getPropertyValue("--fg-3").trim() || "#666";
    ctx.lineWidth = 1;
    const px = (v: number) => Math.round(v) + 0.5;
    for (const [key, v] of this.views) {
      const r = this.absRect(key);
      if (!r) continue;
      const needsYou = v.session.state === "needs_you";
      ctx.strokeStyle = needsYou ? needs : fg4;
      ctx.globalAlpha = needsYou || v.session.state === "working" ? 1 : 0.6;
      ctx.strokeRect(px(ox + r.x * s), px(oy + r.y * s), Math.max(2, Math.round(r.w * s)), Math.max(2, Math.round(r.h * s)));
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = line;
    ctx.strokeRect(
      Math.round(ox + vpw.x * s) + 0.5,
      Math.round(oy + vpw.y * s) + 0.5,
      Math.round(vpw.w * s),
      Math.round(vpw.h * s),
    );
    this.minimapMap = { s, ox, oy };
  }
  private minimapMap: { s: number; ox: number; oy: number } | undefined;

  private jumpFromMinimap(e: PointerEvent) {
    const m = this.minimapMap;
    if (!m) return;
    const r = this.minimap.getBoundingClientRect();
    const wx = (e.clientX - r.left - m.ox) / m.s;
    const wy = (e.clientY - r.top - m.oy) / m.s;
    this.animateTo({ x: this.size.w / 2 - wx * this.view.k, y: this.size.h / 2 - wy * this.view.k, k: this.view.k });
  }

  // ---------- viewport ----------

  private animateTo(to: Viewport) {
    to.k = clamp(to.k, ZOOM_MIN, ZOOM_MAX);
    if (!this.motion) {
      this.view = to;
      this.dirtyVp = true;
      this.request();
      this.commit();
      return;
    }
    this.tween = { from: { ...this.view }, to, t0: performance.now(), ms: 220 };
    this.request();
  }

  fit(animate = true) {
    const rects = this.visibleRects();
    if (this.layout.zonesOn) rects.push(...Object.values(this.layout.zones));
    const b = bounds(rects);
    if (!b) {
      this.animateTo({ x: this.size.w / 2, y: this.size.h / 2, k: 1 });
      return;
    }
    const pad = this.narrow ? 12 : 48;
    const topPad = this.narrow ? 52 : 56; // under the HUD
    const shelfH = this.shelf.hidden ? 0 : this.layout.shelfOpen ? 98 : 28;
    const kw = (this.size.w - pad * 2) / b.w;
    const kh = (this.size.h - topPad - pad - shelfH) / b.h;
    const k = clamp(Math.min(kw, this.narrow ? 1 : kh, 1), ZOOM_MIN, ZOOM_MAX);
    const to = {
      x: (this.size.w - b.w * k) / 2 - b.x * k,
      y: this.narrow && kh < kw ? topPad - b.y * k : topPad + (this.size.h - topPad - shelfH - b.h * k) / 2 - b.y * k,
      k,
    };
    if (animate) this.animateTo(to);
    else {
      this.view = to;
      this.dirtyVp = true;
      this.request();
    }
  }

  private zoomTo(k: number) {
    const cx = this.size.w / 2;
    const cy = this.size.h / 2;
    this.zoomAt(cx, cy, k / this.view.k);
    this.commit();
  }

  // ---------- actions ----------

  tidy(animate = true) {
    const sessions = [...this.snapshot.sessions.values()].filter((s) => this.views.has(s.key));
    const r = tidy(sessions, (k) => this.pos(k), this.layout.zonesOn && !this.narrow, this.narrow);
    if (this.motion && animate) {
      this.winsEl.classList.add("is-tidying");
      setTimeout(() => this.winsEl.classList.remove("is-tidying"), 400);
    }
    for (const [key, p] of r.windows) {
      const pos = this.pos(key);
      pos.x = p.x;
      pos.y = p.y;
    }
    if (this.layout.zonesOn) {
      this.layout.zones = {};
      for (const [name, z] of r.zones) this.layout.zones[name] = z;
      this.renderZones();
    }
    this.dirtyAll = true;
    this.request();
    this.fit(animate);
    this.save();
    if (animate) this.say("tidied");
  }

  reset() {
    this.layout = emptyLayout();
    for (const v of [...this.views.values()]) this.dropView(v);
    setClass(this.zonesBtn, "is-on", false);
    this.view = { x: this.size.w / 2, y: this.size.h / 2, k: 1 };
    this.sync(this.snapshot, true);
    this.fit();
    this.save();
    this.say("layout reset");
  }

  private toggleExpandKey(key: SessionKey) {
    const v = this.views.get(key);
    const p = this.layout.windows[key];
    if (!v || !p) return;
    p.expanded = !p.expanded;
    v.setExpanded(!!p.expanded);
    this.focusWin(key);
    this.dirtyWins.add(key);
    this.request();
    this.save();
  }

  private setQuery(q: string) {
    this.query = q.trim().toLowerCase();
    this.applySearch();
    if (this.query) this.revealHit();
  }

  /** If no match is on screen, bring the first one into view. */
  private revealHit() {
    const vw = {
      x: -this.view.x / this.view.k,
      y: -this.view.y / this.view.k,
      w: this.size.w / this.view.k,
      h: this.size.h / this.view.k,
    };
    let first: Rect | null = null;
    for (const v of this.views.values()) {
      if (!v.el.classList.contains("is-hit")) continue;
      const r = this.absRect(v.key);
      if (!r) continue;
      if (overlaps(r, vw, 0)) return;
      first ??= r;
    }
    if (!first) return;
    const k = this.view.k;
    this.animateTo({
      x: this.size.w / 2 - (first.x + first.w / 2) * k,
      y: this.size.h / 2 - (first.y + first.h / 2) * k,
      k,
    });
  }

  private applySearch() {
    const q = this.query;
    setClass(this.root, "is-searching", !!q);
    let hits = 0;
    for (const v of this.views.values()) {
      const s = v.session;
      const hay = [
        this.api.format.title(s),
        s.repo,
        s.branch,
        s.machine,
        s.harness,
        s.model,
        s.currentTool?.tool,
        s.progress?.assistant,
        s.lastAssistant,
        s.lastUser,
        s.openAttentions[0]?.message,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const hit = !!q && hay.includes(q);
      if (hit) hits++;
      setClass(v.el, "is-hit", hit);
      setClass(v.el, "is-dim", !!q && !hit);
    }
    if (q) this.say(hits === 1 ? "1 match" : `${hits} matches`);
    else this.say("");
  }

  private say(text: string) {
    setText(this.status, text);
    this.status.hidden = !text;
    if (text) {
      clearTimeout(this.sayTimer);
      this.sayTimer = setTimeout(() => {
        if (!this.query) this.status.hidden = true;
      }, 1800);
    }
  }
  private sayTimer: ReturnType<typeof setTimeout> | undefined;

  // ---------- InputHost ----------

  vp() {
    return this.view;
  }

  panBy(dx: number, dy: number) {
    this.tween = undefined;
    this.view = { ...this.view, x: this.view.x + dx, y: this.view.y + dy };
    this.dirtyVp = true;
    this.request();
  }

  zoomAt(sx: number, sy: number, factor: number) {
    this.tween = undefined;
    const k = clamp(this.view.k * factor, ZOOM_MIN, ZOOM_MAX);
    const f = k / this.view.k;
    this.view = { x: sx - (sx - this.view.x) * f, y: sy - (sy - this.view.y) * f, k };
    this.dirtyVp = true;
    this.request();
  }

  zoomStep(dir: 1 | -1) {
    this.animateTo(this.zoomedAround(this.size.w / 2, this.size.h / 2, dir > 0 ? 1.25 : 0.8));
  }

  /** Where the view is heading: the tween's end while one runs, so repeated steps add up. */
  private zoomedAround(sx: number, sy: number, factor: number): Viewport {
    const v = this.tween?.to ?? this.view;
    const k = clamp(v.k * factor, ZOOM_MIN, ZOOM_MAX);
    const f = k / v.k;
    return { x: sx - (sx - v.x) * f, y: sy - (sy - v.y) * f, k };
  }

  hit(target: EventTarget | null): Hit {
    const t = target as Element | null;
    if (!t || !(t instanceof Element)) return { kind: "canvas" };
    if (t.closest(".cv-hud, .cv-tray, .cv-shelf, .cv-minimap, .cv-status")) return { kind: "ui" };
    const win = t.closest(".cv-win") as HTMLElement | null;
    if (win) {
      const key = win.dataset.key!;
      if (t.closest("button, a, input")) return { kind: "win", key, part: "control" };
      if (t.closest(".cv-win-resize")) return { kind: "win", key, part: "resize" };
      if (t.closest(".cv-detail-list")) return { kind: "win", key, part: "scroll" };
      if (t.closest(".cv-win-bar")) return { kind: "win", key, part: "bar" };
      return { kind: "win", key, part: "body" };
    }
    const zone = t.closest(".cv-zone") as HTMLElement | null;
    if (zone) {
      const name = zone.dataset.zone!;
      if (t.closest(".cv-zone-resize")) return { kind: "zone", name, part: "resize" };
      if (t.closest(".cv-zone-label")) return { kind: "zone", name, part: "label" };
    }
    return { kind: "canvas" };
  }

  winRect(key: string) {
    return this.absRect(key);
  }

  moveWin(key: string, x: number, y: number) {
    const p = this.layout.windows[key];
    if (!p) return;
    if (p.rel) {
      const pk = this.parentKey(key);
      const pr = pk ? this.absRect(pk) : null;
      if (pr) {
        p.x = x - pr.x;
        p.y = y - pr.y;
      } else {
        p.x = x;
        p.y = y;
      }
    } else {
      p.x = x;
      p.y = y;
    }
    this.dirtyAll = true; // children follow
    this.request();
  }

  resizeWin(key: string, w: number, h: number) {
    const p = this.layout.windows[key];
    if (!p) return;
    const cw = clamp(w, MIN_W, MAX_W);
    const ch = clamp(h, MIN_H, MAX_H);
    if (p.expanded) {
      p.ew = cw;
      p.eh = ch;
    } else {
      p.w = cw;
      p.h = ch;
    }
    this.dirtyWins.add(key);
    this.dirtyAll = true;
    this.request();
  }

  zoneRect(name: string) {
    return this.layout.zones[name] ?? null;
  }

  moveZone(name: string, x: number, y: number) {
    const z = this.layout.zones[name];
    if (!z) return;
    z.x = x;
    z.y = y;
    this.request();
  }

  resizeZone(name: string, w: number, h: number) {
    const z = this.layout.zones[name];
    if (!z) return;
    z.w = Math.max(160, w);
    z.h = Math.max(120, h);
    this.request();
  }

  focusWin(key: string) {
    const v = this.views.get(key);
    if (!v) return;
    if (v.z !== this.zTop) v.z = ++this.zTop;
    if (document.activeElement !== v.el && !v.el.contains(document.activeElement)) v.el.focus({ preventScroll: true });
    this.dirtyWins.add(key);
    this.request();
  }

  toggleExpand(key: string) {
    this.toggleExpandKey(key);
  }

  private focusedKey(): SessionKey | undefined {
    const a = document.activeElement as HTMLElement | null;
    const w = a?.closest(".cv-win") as HTMLElement | null;
    return w?.dataset.key;
  }

  nudgeFocused(dx: number, dy: number) {
    const key = this.focusedKey();
    if (!key) return;
    const r = this.absRect(key);
    if (!r) return;
    this.moveWin(key, r.x + dx, r.y + dy);
  }

  expandFocused() {
    const key = this.focusedKey();
    if (key) this.toggleExpandKey(key);
  }

  focusSearch() {
    this.search.focus();
    this.search.select();
  }

  clearSearch() {
    if (this.search.value) this.search.value = "";
    this.setQuery("");
  }

  commit() {
    this.save();
    this.saveVp();
    this.save.flush();
  }
}

const theme: Theme = {
  mount(container, api) {
    const c = new Canvas(container, api);
    return () => c.destroy();
  },
};

export default theme;
