// SPDX-License-Identifier: Apache-2.0
// Canvas: every live session as a window on an infinite, pannable, zoomable surface, in
// views. The presets (State, Machine, Harness, Repo, Label) are computed: a clean grid in
// labelled groups, the same on every device, never stored. My layout is the person's own
// arrangement with areas and notes, kept in api.storage as operations so devices merge.
// Map is the infrastructure. Subagents hang off their orchestrator as pills. Rendering is
// transforms only, applied in one requestAnimationFrame that runs only when asked.
import type { Theme, ThemeApi, ThemeSnapshot, ViewMenuItem, ViewShortcut } from "@sessionpipe-gui/theme-types";
import {
  type AgentRun,
  type ControlActivity,
  LABEL_COLORS,
  type LabelColor,
  type SessionKey,
  type SessionState,
  type SessionSummary,
} from "@sessionpipe-gui/theme-types/api";
import { type PillStack, PillView, pillId, pillStack, stackHeight } from "./agents";
import { AreaView, NoteView } from "./areas";
import "./canvas.css";
import { Chrome, type ChromeHost } from "./chrome";
import {
  areaOf,
  exec,
  isEmpty,
  isPositional,
  migrate,
  newId,
  normalize,
  type Op,
  pruneOp,
  v1HasPositions,
} from "./doc";
import { attachInput, type Hit, type InputHost, type MenuSource } from "./input";
import { bounds, type Cell, colsFor, findFree, type Group, gridCells, gridLayout, overlaps } from "./layout";
import { harnessName, type MapHost, MapLayer, repoParts } from "./map";
import {
  AREA_HEAD,
  AREA_MIN_H,
  AREA_MIN_W,
  AREA_PAD,
  BAR_H,
  BAR_H_PHONE,
  COL_GAP,
  type Doc,
  EXP_H,
  EXP_MAX_H,
  EXP_MAX_W,
  EXP_W,
  emptyDoc,
  GRID,
  GROUP_GAP,
  HEAD_H,
  isPreset,
  MINIMAP_W,
  NARROW_W,
  NOTE_H,
  NOTE_MAX,
  NOTE_MIN_H,
  NOTE_MIN_W,
  NOTE_W,
  PHONE_W,
  PILL_GAP,
  PILL_H,
  PILL_INDENT,
  PILL_MORE_H,
  PILL_OFF,
  PILL_W,
  type Rect,
  STATUS_H,
  TRUNK_OFF,
  VIEWS,
  type ViewId,
  type Viewport,
  WIN_H,
  WIN_H_ASK,
  WIN_W,
  type WinEntry,
  ZOOM_MAX,
  ZOOM_MIN,
} from "./types";
import { clamp, debounce, el, isTouchLike, reducedMotion, setClass, setText, svg } from "./util";
import { WinView } from "./window";

const LOCAL_VIEW = "view";
const LOCAL_MINIMAP = "minimap";
const LOCAL_DONE = "showDoneSessions";
const vpKey = (v: ViewId) => `viewport.${v}`;
const UNDO_MAX = 50;
const DONE_MAX = 48;
const TWEEN_MS = 320;
const STATE_ORDER: SessionState[] = ["needs_you", "working", "stale", "idle", "done"];
const STATE_TITLE: Record<string, string> = {
  needs_you: "Needs you",
  working: "Working",
  stale: "Stale",
  idle: "Idle",
  done: "Done",
};

interface Head {
  id: string;
  title: string;
  count: number;
  box: Rect;
  label?: LabelColor;
  icon?: string;
  keys: SessionKey[];
}

/** What a drag is carrying: start positions (world), live offsets applied at render. */
interface Moving {
  items: { item: string; x: number; y: number }[];
  dx: number;
  dy: number;
}

class Canvas implements InputHost, ChromeHost {
  readonly root: HTMLElement;
  private world: HTMLElement;
  private areasEl: HTMLElement;
  private headsEl: HTMLElement;
  private tethers: SVGSVGElement;
  private treeG: SVGGElement;
  private winsEl: HTMLElement;
  private notesEl: HTMLElement;
  private marqueeEl: HTMLElement;
  private tip: HTMLElement;
  private minimap: HTMLCanvasElement;
  private map: MapLayer;
  private chrome: Chrome;

  private doc: Doc = emptyDoc();
  private viewId: ViewId = "state";
  private view: Viewport = { x: 0, y: 0, k: 1 };
  private size = { w: 0, h: 0 };
  private snapshot: ThemeSnapshot;
  private wins = new Map<SessionKey, WinView>();
  private pills = new Map<string, PillView>();
  private mores = new Map<SessionKey, HTMLButtonElement>();
  private areaViews = new Map<string, AreaView>();
  private noteViews = new Map<string, NoteView>();
  private headEls = new Map<string, HTMLElement>();
  /** Window positions for the current view (world). */
  private rects = new Map<SessionKey, Rect>();
  /** Pill stacks of the windows that have agents. */
  private stacks = new Map<SessionKey, PillStack>();
  /** Child sessions shown as a pill, by key → their parent's key. */
  private asPill = new Map<SessionKey, SessionKey>();
  private heads: Head[] = [];
  /** Phone positions of areas and notes (computed, never stored). */
  private phoneBoxes = new Map<string, Rect>();
  private selection = new Set<string>();
  private hoverPill: string | null = null;
  private query = "";
  private frame = 0;
  private tween: { from: Viewport; to: Viewport; t0: number; ms: number } | undefined;
  private unsubs: (() => void)[] = [];
  private ticker: ReturnType<typeof setInterval> | undefined;
  private ro: ResizeObserver | undefined;
  private ready = false;
  private motion = !reducedMotion();
  private layoutSig = "";
  private tidying: ReturnType<typeof setTimeout> | undefined;
  /** A gesture is under way: another device's document waits for its end. */
  private gesture = false;
  private pendingRemote: { v: unknown } | undefined;
  private writes = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private undoStack: Op[] = [];
  private redoStack: Op[] = [];
  private moving: Moving | undefined;
  private resizing: { item: string; w: number; h: number; dw: number; dh: number } | undefined;
  private dropArea: string | undefined;
  /** Expanded windows outside My layout (this page only). */
  private expandedHere = new Set<SessionKey>();
  /** Keys this page saw while live: one that disappears was forgotten. */
  private seen = new Set<SessionKey>();
  private pointer = { x: 0, y: 0 };
  private saidPreset = false;
  private tipTimer: ReturnType<typeof setTimeout> | undefined;
  private editing = 0;
  /** Sessions a start named, waiting to appear by their machine's node. */
  private pendingStart = new Map<SessionKey, string>();
  private minimapMap: { s: number; ox: number; oy: number } | undefined;

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
    this.areasEl = el("div", "cv-areas");
    this.headsEl = el("div", "cv-heads");
    this.tethers = svg("svg", { class: "cv-tethers", "aria-hidden": "true" });
    this.treeG = svg("g", { class: "cv-tree" });
    this.tethers.append(this.treeG);
    this.winsEl = el("div", "cv-wins");
    this.notesEl = el("div", "cv-notes");
    this.marqueeEl = el("div", "cv-marquee");
    this.marqueeEl.hidden = true;
    this.map = new MapLayer(this.mapHost());
    this.world.append(
      this.areasEl,
      this.headsEl,
      this.map.lanesEl,
      this.tethers,
      this.map.nodesEl,
      this.winsEl,
      this.notesEl,
      this.map.customEl,
      this.marqueeEl,
    );
    this.chrome = new Chrome(this);
    this.minimap = el("canvas", "cv-minimap");
    this.minimap.setAttribute("aria-hidden", "true");
    this.minimap.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.jumpFromMinimap(e);
      const move = (ev: PointerEvent) => this.jumpFromMinimap(ev, false);
      const up = () => {
        this.minimap.removeEventListener("pointermove", move);
        this.minimap.removeEventListener("pointerup", up);
      };
      this.minimap.setPointerCapture(e.pointerId);
      this.minimap.addEventListener("pointermove", move);
      this.minimap.addEventListener("pointerup", up);
    });
    this.tip = el("div", "cv-tip");
    this.tip.hidden = true;
    this.tip.setAttribute("role", "tooltip");
    this.root.append(this.world, this.chrome.bar, this.chrome.statusBar, this.minimap, this.tip);
    this.root.addEventListener("pointerover", (e) => this.tipOver(e));
    this.root.addEventListener("pointerdown", () => this.hideTip());
    container.append(this.root);
    if (this.root.clientHeight < 160) {
      const top = this.root.getBoundingClientRect().top;
      this.root.style.height = `calc(100vh - ${Math.max(0, top)}px)`;
    }
    this.measure();
    this.ro = new ResizeObserver(() => {
      const before = this.size;
      this.measure();
      if (!this.ready) return;
      const phoneChanged = before.w < PHONE_W !== this.size.w < PHONE_W;
      if (phoneChanged || (isPreset(this.viewId) && Math.abs(before.w - this.size.w) > 40)) this.relayoutSoon();
      this.request();
    });
    this.ro.observe(this.root);

    this.unsubs.push(attachInput(this));
    this.unsubs.push(api.state.subscribe((s) => this.onSnapshot(s)));
    if (api.storage.subscribe) this.unsubs.push(api.storage.subscribe((v) => this.onRemote(v)));
    this.ticker = setInterval(() => this.tick(), 1000);
    void this.load();
  }

  // ---------- lifecycle ----------

  private async load() {
    let raw: unknown = null;
    try {
      raw = await this.api.storage.get();
    } catch {}
    this.doc = normalize(raw);
    const stored = this.api.local.get<ViewId>(LOCAL_VIEW);
    this.viewId = stored && VIEWS.some((v) => v.id === stored) ? stored : v1HasPositions(raw) ? "layout" : "state";
    // A layout from an earlier build: migrated once, by the first desktop that opens.
    if ((raw as { v?: number } | null)?.v === 1 && !this.phone) {
      void this.writeRaw((cur) => ((cur as { v?: number } | null)?.v === 1 ? migrate(cur as never) : normalize(cur)));
    }
    this.ready = true;
    this.chrome.setView(this.viewId);
    this.applyView(false);
    this.sync(this.snapshot);
    const vp = this.api.local.get<Viewport>(vpKey(this.viewId));
    if (vp && Number.isFinite(vp.x) && Number.isFinite(vp.y) && Number.isFinite(vp.k) && !this.phone) {
      this.view = { x: vp.x, y: vp.y, k: clamp(vp.k, ZOOM_MIN, ZOOM_MAX) };
    } else this.fit(false);
    this.request();
  }

  destroy() {
    for (const u of this.unsubs) u();
    if (this.ticker) clearInterval(this.ticker);
    this.ro?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.saveVp.flush();
    this.placeLater.flush();
    for (const v of this.wins.values()) v.destroy();
    this.map.destroy();
    this.chrome.destroy();
    this.root.remove();
  }

  private measure() {
    this.size = { w: this.root.clientWidth, h: this.root.clientHeight };
    setClass(this.root, "is-phone", this.phone);
    setClass(this.root, "is-narrow", this.size.w < NARROW_W);
    setClass(this.root, "is-small", this.size.w < MINIMAP_W);
  }

  /** A phone: one column, nothing stored. */
  private get phone() {
    return this.size.w < PHONE_W;
  }

  canArrange() {
    return this.viewId === "layout" && !this.phone;
  }

  private get barH() {
    return this.phone ? BAR_H_PHONE : BAR_H;
  }

  private saveVp = debounce(300, () => {
    if (this.ready) this.api.local.set(vpKey(this.viewId), this.view);
  });

  // ---------- the document ----------

  /** One change: applied here at once, then written as the same Op onto whatever the
   *  server holds (api.storage.update retries on another device's write). */
  private commit(op: Op, o: { undo?: boolean; say?: string } = {}) {
    if (isEmpty(op)) return;
    if (this.phone && isPositional(op)) return;
    const inverse = exec(this.doc, op);
    if (o.undo !== false) {
      this.undoStack.push(inverse);
      if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
      this.redoStack = [];
    }
    this.write(op);
    this.relayout(false);
    if (o.say) this.chrome.say(o.say, { label: "Undo", run: () => this.undo() });
  }

  private write(op: Op) {
    void this.writeRaw((cur) => {
      const d = normalize(cur);
      exec(d, op);
      return d;
    });
  }

  private writeRaw(change: (cur: unknown) => unknown) {
    this.writes++;
    const run = async () => {
      try {
        let result: unknown;
        if (this.api.storage.update) result = await this.api.storage.update(change);
        else {
          result = change(await this.api.storage.get());
          await this.api.storage.set(result);
        }
        // The server's answer carries other devices' changes; take it once nothing of
        // ours is still on its way and no gesture is under way.
        if (this.writes === 1) this.adopt(result);
      } catch (e) {
        this.chrome.say(e instanceof Error ? e.message : "Could not save the layout");
      } finally {
        this.writes--;
      }
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  private onRemote(v: unknown) {
    if (this.writes > 0) return; // our write's answer will carry it
    this.adopt(v);
  }

  private adopt(v: unknown) {
    if (this.gesture || this.editing > 0) {
      this.pendingRemote = { v };
      return;
    }
    this.pendingRemote = undefined;
    this.doc = normalize(v);
    this.relayout(false);
  }

  undo() {
    const op = this.undoStack.pop();
    if (!op) return;
    if (this.phone && isPositional(op)) {
      this.undoStack.push(op);
      return;
    }
    this.redoStack.push(exec(this.doc, op));
    this.write(op);
    this.relayout(false);
  }

  redo() {
    const op = this.redoStack.pop();
    if (!op) return;
    this.undoStack.push(exec(this.doc, op));
    this.write(op);
    this.relayout(false);
  }

  // ---------- state ----------

  private onSnapshot(s: ThemeSnapshot) {
    const schemeChanged = s.scheme !== this.snapshot.scheme;
    this.snapshot = s;
    if (schemeChanged) this.root.dataset.scheme = s.scheme;
    if (this.ready) this.sync(s);
  }

  private get showDoneSessions(): boolean {
    return this.api.local.get<boolean>(LOCAL_DONE) ?? false;
  }

  private label(key: SessionKey): { color: LabelColor; name: string } | undefined {
    const l = this.snapshot.labels;
    const c = l?.sessions.get(key);
    return c ? { color: c, name: l?.names[c] ?? c } : undefined;
  }

  /** Which sessions are windows here, which hang as pills, which are hidden or done. */
  private visible() {
    const s = this.snapshot;
    const done: SessionSummary[] = [];
    const hidden: SessionSummary[] = [];
    const wins: SessionSummary[] = [];
    const showDone = this.showDoneSessions;
    const unhide: Record<SessionKey, null> = {};
    for (const sess of s.sessions.values()) {
      const h = this.doc.hidden[sess.key];
      if (h && h !== sess.state) unhide[sess.key] = null;
      if (sess.state === "done" && !showDone && this.viewId !== "map") {
        if (!sess.parentId || !s.sessions.has(`${sess.harness}:${sess.parentId}`)) done.push(sess);
        continue;
      }
      if (sess.state === "done" && this.viewId === "map") continue;
      if (h && h === sess.state) {
        hidden.push(sess);
        continue;
      }
      wins.push(sess);
    }
    if (Object.keys(unhide).length) queueMicrotask(() => this.commit({ t: "hidden", set: unhide }, { undo: false }));
    // A child session that its orchestrator lists as an agent is that agent's pill.
    const shown = new Set(wins.map((w) => w.key));
    this.asPill.clear();
    if (this.viewId !== "map") {
      for (const p of wins) {
        for (const a of p.agents ?? []) if (a.session && shown.has(a.session)) this.asPill.set(a.session, p.key);
      }
    }
    return {
      wins: wins.filter((w) => !this.asPill.has(w.key)),
      hidden,
      done: done.sort((a, b) => (b.endedAt ?? b.lastAt).localeCompare(a.endedAt ?? a.lastAt)),
    };
  }

  private sync(s: ThemeSnapshot) {
    const now = Date.now();
    this.chrome.setConnection(s.connection);
    // Forgotten: seen here while live, gone now. Only that prunes the document.
    if (s.connection === "live") {
      const gone: SessionKey[] = [];
      for (const k of this.seen) if (!s.sessions.has(k)) gone.push(k);
      for (const k of gone) this.seen.delete(k);
      for (const k of s.sessions.keys()) this.seen.add(k);
      const op = gone.length ? pruneOp(this.doc, gone) : null;
      if (op) queueMicrotask(() => this.commit(op, { undo: false }));
    }
    const vis = this.visible();
    const acts = new Map<SessionKey, ControlActivity[]>();
    for (const a of s.control) {
      if (!a.session) continue;
      const list = acts.get(a.session) ?? [];
      list.push(a);
      acts.set(a.session, list);
    }
    const { hint, own } = this.pairing(vis.wins);
    const want = new Set<SessionKey>();
    for (const sess of vis.wins) {
      want.add(sess.key);
      const parentKey = sess.parentId ? `${sess.harness}:${sess.parentId}` : undefined;
      const parent = parentKey ? s.sessions.get(parentKey) : undefined;
      const ctx = {
        now,
        view: this.viewId,
        label: this.label(sess.key),
        activities: acts.get(sess.key) ?? [],
        ownReason: own.get(sess.key),
        parentTitle: parent ? this.api.format.title(parent) : undefined,
      };
      let v = this.wins.get(sess.key);
      if (!v) {
        const key = sess.key;
        v = new WinView(
          this.api,
          sess,
          { onOpen: () => this.openBeside(key), onMore: (at) => this.windowMenu(key, at, "mouse") },
          ctx,
        );
        v.z = this.wins.size + 1;
        if (this.ready && this.motion && this.layoutSig) {
          v.el.classList.add("is-new");
          v.el.addEventListener("animationend", () => v?.el.classList.remove("is-new"), { once: true });
        }
        this.winsEl.append(v.el);
        this.wins.set(sess.key, v);
      } else v.update(sess, ctx);
      setClass(v.el, "is-row", this.viewId === "map");
      const exp = this.isExpanded(sess.key);
      if (v.expanded !== exp) v.setExpanded(exp);
    }
    for (const [k, v] of this.wins) {
      if (!want.has(k)) {
        v.destroy();
        this.wins.delete(k);
        this.selection.delete(`w:${k}`);
      }
    }
    // Pills.
    this.stacks.clear();
    if (this.viewId !== "map") {
      for (const sess of vis.wins) {
        if (!sess.agents?.length) continue;
        this.stacks.set(sess.key, pillStack(sess, this.doc.showDone.includes(sess.key)));
      }
    }
    this.syncPills(now);
    this.chrome.setHint(hint.text, hint.pair);
    this.chrome.setCounts(vis.hidden.length, vis.done.length);
    this.hiddenList = vis.hidden;
    this.doneList = vis.done.slice(0, DONE_MAX);
    if (this.viewId === "map") this.map.build();
    const sig = this.signature(vis.wins);
    if (sig !== this.layoutSig) {
      const first = !this.layoutSig;
      this.layoutSig = sig;
      this.relayout(!first && isPreset(this.viewId));
    } else this.request();
    this.applySearch();
  }
  private hiddenList: SessionSummary[] = [];
  private doneList: SessionSummary[] = [];

  /** What moves windows: who is shown, in which group, at which size, with how many pills. */
  private signature(wins: SessionSummary[]): string {
    const v = this.viewId;
    return [
      v,
      this.phone,
      wins
        .map((s) => {
          const st = this.stacks.get(s.key);
          return [
            s.key,
            this.groupOf(s),
            this.sizeOf(s.key).h,
            st ? `${st.shown.length}${st.more ? "+" : ""}` : "",
            v === "state" ? s.state : "",
          ].join(":");
        })
        .join("|"),
    ].join("#");
  }

  private syncPills(now: number) {
    const want = new Set<string>();
    for (const [parent, st] of this.stacks) {
      for (const a of st.shown) {
        const id = pillId(parent, a.id);
        want.add(id);
        let p = this.pills.get(id);
        if (!p) {
          p = new PillView(id, parent, a);
          this.pills.set(id, p);
          this.winsEl.append(p.el);
        } else p.update(a, now);
      }
      let more = this.mores.get(parent);
      if (st.more) {
        if (!more) {
          more = el("button", "cv-pill-more");
          more.type = "button";
          more.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggleDone(parent);
          });
          this.mores.set(parent, more);
          this.winsEl.append(more);
        }
        setText(more, st.more.text);
        more.setAttribute("aria-expanded", String(st.more.open));
      } else if (more) {
        more.remove();
        this.mores.delete(parent);
      }
    }
    for (const [id, p] of this.pills) {
      if (!want.has(id)) {
        p.destroy();
        this.pills.delete(id);
        this.selection.delete(`p:${id}`);
      }
    }
    for (const [parent, m] of this.mores) {
      if (!this.stacks.get(parent)?.more) {
        m.remove();
        this.mores.delete(parent);
      }
    }
  }

  private toggleDone(parent: SessionKey) {
    const on = !this.doc.showDone.includes(parent);
    this.commit({ t: "showDone", key: parent, on }, { undo: false });
    this.sync(this.snapshot);
  }

  /** The pairing hint, said once: the machines on screen that can't take a message. */
  private pairing(wins: SessionSummary[]): { hint: { text: string; pair: boolean }; own: Map<SessionKey, string> } {
    const own = new Map<SessionKey, string>();
    const c = this.api.control;
    if (!c) return { hint: { text: "", pair: false }, own };
    const byReason = new Map<string, Set<string>>();
    const keyReason = new Map<SessionKey, string>();
    for (const s of wins) {
      if (s.state === "done") continue;
      const av = c.availability({ session: s.key });
      if (av.ok || !av.reason) continue;
      const set = byReason.get(av.reason) ?? new Set<string>();
      set.add(s.machine ?? "");
      byReason.set(av.reason, set);
      keyReason.set(s.key, av.reason);
    }
    if (!byReason.size) return { hint: { text: "", pair: false }, own };
    const pairing = [...byReason.keys()].filter((r) => /^pair /i.test(r));
    const machines = [...new Set(pairing.flatMap((r) => [...byReason.get(r)!]))].filter(Boolean).sort();
    let text = "";
    let pair = false;
    if (machines.length) {
      text = `Pair ${listWords(machines)} to send from here`;
      pair = true;
    } else if (byReason.size === 1) text = capital([...byReason.keys()][0]!);
    // A reason the status bar doesn't say is said in its own window.
    for (const [k, r] of keyReason) {
      const covered = (pair && /^pair /i.test(r)) || (!pair && byReason.size === 1);
      if (!covered) own.set(k, capital(r));
    }
    return { hint: { text, pair }, own };
  }

  private tick() {
    const now = Date.now();
    for (const v of this.wins.values()) v.tick(now);
    for (const p of this.pills.values()) p.update(p.agent, now);
  }

  // ---------- views and layout ----------

  setView(v: ViewId) {
    if (v === this.viewId) return;
    this.saveVp.flush();
    this.viewId = v;
    this.api.local.set(LOCAL_VIEW, v);
    this.chrome.setView(v);
    this.selection.clear();
    this.applyView(true);
    this.layoutSig = "";
    this.sync(this.snapshot);
    const vp = v === "layout" ? this.api.local.get<Viewport>(vpKey(v)) : null;
    if (vp && !this.phone) this.animateTo({ ...vp });
    else this.fit(true);
    this.animateLayout();
  }

  private applyView(fresh: boolean) {
    const v = this.viewId;
    this.root.dataset.view = v;
    this.map.setOn(v === "map");
    if (v === "map" && fresh) this.map.build();
  }

  private relayoutSoon = debounce(120, () => this.relayout(false));

  /** Positions for the current view; with `animate`, windows move there over 320 ms. */
  private relayout(animate: boolean) {
    if (!this.ready) return;
    const vis = [...this.wins.values()].map((w) => w.session);
    this.rects.clear();
    this.heads = [];
    this.phoneBoxes.clear();
    if (this.viewId === "map") {
      this.map.build();
      this.map.layout();
      for (const [k, r] of this.map.rows) if (this.wins.has(k)) this.rects.set(k, r);
    } else if (isPreset(this.viewId) || this.phone) {
      const groups = this.viewId === "layout" ? this.phoneLayoutGroups(vis) : this.groups(vis);
      const cellGroups: Group[] = groups.map((g) => ({
        id: g.id,
        cells: g.keys.map(
          (k): Cell => (k.startsWith("note:") ? { key: k, span: 1, h: this.phoneNoteH(k.slice(5)) } : this.cell(k)),
        ),
      }));
      const r = gridLayout(cellGroups, {
        viewW: this.size.w - 96,
        viewH: this.size.h - this.barH - STATUS_H,
        stack: this.phone,
      });
      for (const [k, p] of r.cells) {
        if (k.startsWith("note:")) {
          const id = k.slice(5);
          this.phoneBoxes.set(id, { x: p.x, y: p.y, w: this.phoneW, h: this.phoneNoteH(id) });
          continue;
        }
        const s = this.sizeOf(k);
        this.rects.set(k, { x: p.x, y: p.y, ...s });
      }
      const boxes = new Map(r.boxes.map((b) => [b.id, b]));
      for (const g of groups) {
        const box = boxes.get(g.id);
        if (box && g.title) this.heads.push({ ...g, box, count: g.keys.length });
      }
    } else {
      this.layoutMine(vis);
    }
    if (animate && this.motion) this.animateLayout();
    this.syncHeads();
    this.syncAreas();
    this.request();
  }

  private animateLayout() {
    if (!this.motion) return;
    this.world.classList.add("is-tidying");
    clearTimeout(this.tidying);
    this.tidying = setTimeout(() => {
      this.world.classList.remove("is-tidying");
      this.request();
    }, TWEEN_MS + 40);
  }

  private phoneNoteH(id: string) {
    return Math.max(NOTE_MIN_H, Math.min(this.doc.notes[id]?.h ?? NOTE_H, 160));
  }

  /** A phone's width for a window: the screen less its gutters. */
  private get phoneW() {
    return Math.max(WIN_W, this.size.w - 24);
  }

  private isExpanded(key: SessionKey): boolean {
    if (this.viewId === "map") return false;
    if (this.canArrange()) return !!this.doc.windows[key]?.expanded;
    return this.expandedHere.has(key);
  }

  private answerable(s: SessionSummary): boolean {
    const att = s.openAttentions[0];
    if (s.state !== "needs_you" || att?.kind !== "permission" || !this.api.control) return false;
    return this.api.control.availability({ session: s.key }).ok;
  }

  /** A window's size by kind (§5.2): fixed, so the grid is clean. */
  private sizeOf(key: SessionKey): { w: number; h: number } {
    if (this.viewId === "map") return this.map.rows.get(key) ?? { w: 240, h: 32 };
    const s = this.snapshot.sessions.get(key);
    const base = this.phone ? this.phoneW : WIN_W;
    if (this.isExpanded(key)) {
      const e = this.doc.windows[key];
      if (this.phone) return { w: base, h: EXP_H };
      return { w: e?.w ?? EXP_W, h: e?.h ?? EXP_H };
    }
    return { w: base, h: s && this.answerable(s) ? WIN_H_ASK : WIN_H };
  }

  /** A window and its pills as one grid cell: two columns wide beside it, or (a phone)
   *  the pills stacked under it. */
  private cell(key: SessionKey): Cell {
    const size = this.sizeOf(key);
    const st = this.stacks.get(key);
    const sh = st ? stackHeight(st) : 0;
    if (!sh) return { key, span: size.w > WIN_W && !this.phone ? 2 : 1, h: size.h };
    if (this.phone) return { key, span: 1, h: size.h + PILL_GAP + sh };
    return { key, span: 2, h: Math.max(size.h, sh) };
  }

  /** The footprint of a window with its pills, for finding free space. */
  private footprint(key: SessionKey, x: number, y: number): Rect {
    const c = this.cell(key);
    return { x, y, w: c.span === 2 ? WIN_W * 2 + COL_GAP : this.sizeOf(key).w, h: c.h };
  }

  private groupOf(s: SessionSummary): string {
    switch (this.viewId) {
      case "state":
        return s.state;
      case "machine":
        return s.machine ? `m:${s.machine}` : "m:";
      case "harness":
        return `h:${s.harness}`;
      case "repo":
        return s.repo ? `r:${repoParts(s.repo).short}` : "r:";
      case "label":
        return `l:${this.snapshot.labels?.sessions.get(s.key) ?? ""}`;
      case "layout":
        return this.phone ? `a:${areaOf(this.doc, s.key) ?? ""}` : "";
      default:
        return "";
    }
  }

  /** The preset's groups in their order, each with its windows sorted: by state (needs
   *  you, working, stale, idle), then the newest. */
  private groups(
    vis: SessionSummary[],
  ): { id: string; title: string; keys: SessionKey[]; label?: LabelColor; icon?: string }[] {
    const by = new Map<string, SessionSummary[]>();
    for (const s of vis) {
      const g = this.groupOf(s);
      const list = by.get(g) ?? [];
      list.push(s);
      by.set(g, list);
    }
    const sortWins = (list: SessionSummary[]) =>
      list.sort(
        (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || b.lastAt.localeCompare(a.lastAt),
      );
    const needs = (list: SessionSummary[]) => list.filter((s) => s.state === "needs_you").length;
    let ids = [...by.keys()];
    const v = this.viewId;
    if (v === "state") ids = STATE_ORDER.filter((st) => by.has(st));
    else if (v === "label") ids = [...LABEL_COLORS.map((c) => `l:${c}`), "l:"].filter((id) => by.has(id));
    else {
      ids.sort((a, b) => {
        const empty = (id: string) => (id.endsWith(":") ? 1 : 0);
        return (
          empty(a) - empty(b) ||
          needs(by.get(b)!) - needs(by.get(a)!) ||
          this.groupTitle(a).localeCompare(this.groupTitle(b))
        );
      });
    }
    return ids.map((id) => {
      const list = sortWins(by.get(id)!);
      const g: { id: string; title: string; keys: SessionKey[]; label?: LabelColor; icon?: string } = {
        id,
        title: this.groupTitle(id),
        keys: list.map((s) => s.key),
      };
      if (v === "label" && id.length > 2) g.label = id.slice(2) as LabelColor;
      if (v === "harness") g.icon = this.api.format.harnessIcon?.(id.slice(2))?.svg;
      return g;
    });
  }

  private groupTitle(id: string): string {
    const v = this.viewId;
    if (v === "state") return STATE_TITLE[id] ?? id;
    const rest = id.slice(2);
    if (v === "machine") return rest || "No machine";
    if (v === "harness") return harnessName(this.api, rest);
    if (v === "repo") return rest || "No repo";
    if (v === "label") return rest ? (this.snapshot.labels?.names[rest as LabelColor] ?? rest) : "No label";
    if (v === "layout") return rest ? this.doc.areas[rest]?.title || "Untitled area" : "Not in an area";
    return rest;
  }

  /** My layout on a phone: the person's areas as groups (top to bottom), then the rest,
   *  then the notes. Computed; nothing is stored. */
  private phoneLayoutGroups(vis: SessionSummary[]) {
    const areas = Object.entries(this.doc.areas).sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x);
    const out: { id: string; title: string; keys: SessionKey[]; label?: LabelColor }[] = [];
    const sorted = [...vis].sort(
      (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || b.lastAt.localeCompare(a.lastAt),
    );
    for (const [id, a] of areas) {
      out.push({
        id: `a:${id}`,
        title: a.title || "Untitled area",
        keys: sorted.filter((s) => a.members[s.key]).map((s) => s.key),
        label: a.label,
      });
    }
    const free = sorted.filter((s) => !areaOf(this.doc, s.key)).map((s) => s.key);
    if (free.length) out.push({ id: "a:", title: areas.length ? "Not in an area" : "", keys: free });
    const notes = Object.keys(this.doc.notes);
    if (notes.length) out.push({ id: "notes", title: "Notes", keys: notes.map((n) => `note:${n}`) });
    return out;
  }

  /** My layout on a desktop: members inside their area, the rest where the person put
   *  them; a window that has no place yet gets the nearest free spot (written once). */
  private layoutMine(vis: SessionSummary[]) {
    const placed: Record<SessionKey, { x: number; y: number }> = {};
    const fresh = vis.filter((s) => !this.doc.windows[s.key] && !areaOf(this.doc, s.key));
    for (const s of vis) {
      const p = this.minePos(s.key);
      if (p) this.rects.set(s.key, { ...p, ...this.sizeOf(s.key) });
    }
    if (!fresh.length) return;
    const nothingYet = Object.keys(this.doc.windows).length === 0 && Object.keys(this.doc.areas).length === 0;
    if (nothingYet) {
      // A first open: the free windows on a grid, the way Tidy would.
      const cells = fresh.map((s) => this.cell(s.key));
      const out = new Map<string, { x: number; y: number }>();
      gridCells(cells, colsFor(cells.reduce((n, c) => n + c.span, 0)), out);
      for (const [k, p] of out) placed[k] = p;
    } else {
      const taken = [...this.rects.entries()].map(([k, r]) => this.footprint(k, r.x, r.y));
      for (const a of Object.values(this.doc.areas)) taken.push(a);
      for (const n of Object.values(this.doc.notes)) taken.push(n);
      for (const s of fresh) {
        let centre = this.toWorld(this.size.w / 2, this.size.h / 2);
        const nodeId = this.pendingStart.get(s.key);
        if (nodeId) {
          this.pendingStart.delete(s.key);
          const nr = this.map.nodeRect(nodeId);
          if (nr) centre = { x: nr.x + nr.w / 2, y: nr.y - 120 };
        }
        const fp = this.footprint(s.key, 0, 0);
        const r = findFree(centre, fp.w, fp.h, taken);
        placed[s.key] = { x: r.x, y: r.y };
        taken.push({ ...r });
      }
    }
    for (const [k, p] of Object.entries(placed)) this.rects.set(k, { ...p, ...this.sizeOf(k) });
    for (const [k, p] of Object.entries(placed)) this.toPlace[k] = { x: Math.round(p.x), y: Math.round(p.y) };
    this.placeLater();
  }
  private toPlace: Record<SessionKey, { x: number; y: number }> = {};
  /** New windows' first places, written as one Op. */
  private placeLater = debounce(400, () => {
    const set = this.toPlace;
    this.toPlace = {};
    for (const k of Object.keys(set)) if (this.doc.windows[k] || areaOf(this.doc, k)) delete set[k];
    if (Object.keys(set).length && !this.phone) this.commit({ t: "win", set }, { undo: false });
  });

  /** A window's place in My layout from the document (a member: its area plus offset). */
  private minePos(key: SessionKey): { x: number; y: number } | undefined {
    const aid = areaOf(this.doc, key);
    if (aid) {
      const a = this.doc.areas[aid]!;
      const m = a.members[key]!;
      return { x: a.x + m.dx, y: a.y + m.dy };
    }
    const w = this.doc.windows[key];
    return w ? { x: w.x, y: w.y } : (this.toPlace[key] ?? undefined);
  }

  private syncHeads() {
    const want = new Set<string>();
    for (const h of this.heads) {
      want.add(h.id);
      let e = this.headEls.get(h.id);
      if (!e) {
        e = el("div", "cv-head");
        e.dataset.group = h.id;
        e.setAttribute("role", "heading");
        e.setAttribute("aria-level", "2");
        this.headsEl.append(e);
        this.headEls.set(h.id, e);
      }
      const sig = `${h.title}|${h.count}|${h.label ?? ""}|${h.icon ? 1 : 0}`;
      if (e.dataset.sig !== sig) {
        e.dataset.sig = sig;
        e.replaceChildren();
        if (h.label) e.append(el("span", `label-dot label-dot--${h.label}`));
        if (h.icon) {
          const i = el("span", "cv-head-icon");
          i.innerHTML = h.icon;
          e.append(i);
        }
        e.append(el("span", "cv-head-t", h.title), el("span", "cv-head-n num", String(h.count)));
      }
      e.style.transform = `translate3d(${h.box.x}px, ${h.box.y}px, 0)`;
      e.style.width = `${Math.max(h.box.w, WIN_W)}px`;
    }
    for (const [id, e] of this.headEls) {
      if (!want.has(id)) {
        e.remove();
        this.headEls.delete(id);
      }
    }
  }

  private syncAreas() {
    const names = this.snapshot.labels?.names as Record<LabelColor, string> | undefined;
    const mine = this.viewId === "layout";
    const showAreas = mine && !this.phone;
    const want = new Set(showAreas ? Object.keys(this.doc.areas) : []);
    for (const id of want) {
      const a = this.doc.areas[id]!;
      let v = this.areaViews.get(id);
      if (!v) {
        v = new AreaView(id);
        this.areaViews.set(id, v);
        this.areasEl.append(v.el);
      }
      const members = Object.keys(a.members).filter((k) => this.wins.has(k)).length;
      v.update(a, members, names);
    }
    for (const [id, v] of this.areaViews) {
      if (!want.has(id)) {
        v.destroy();
        this.areaViews.delete(id);
      }
    }
    const notes = new Set(mine ? Object.keys(this.doc.notes) : []);
    for (const id of notes) {
      const n = this.doc.notes[id]!;
      let v = this.noteViews.get(id);
      if (!v) {
        v = new NoteView(id);
        this.noteViews.set(id, v);
        this.notesEl.append(v.el);
      }
      v.update(n, names);
      const pb = this.phoneBoxes.get(id);
      if (pb) v.place(pb);
    }
    for (const [id, v] of this.noteViews) {
      if (!notes.has(id)) {
        v.destroy();
        this.noteViews.delete(id);
      }
    }
  }

  // ---------- geometry at render (drags applied) ----------

  /** A window's rect now: its place, plus whatever a drag is carrying. */
  private winRect(key: SessionKey): Rect | null {
    const r = this.rects.get(key);
    if (!r) return null;
    const m = this.moving;
    if (!m) return this.sized(key, r);
    if (this.carried(`w:${key}`)) return this.sized(key, { ...r, x: r.x + m.dx, y: r.y + m.dy });
    const aid = areaOf(this.doc, key);
    if (aid && this.carried(`a:${aid}`)) return this.sized(key, { ...r, x: r.x + m.dx, y: r.y + m.dy });
    return this.sized(key, r);
  }

  private sized(key: SessionKey, r: Rect): Rect {
    const z = this.resizing;
    if (z && z.item === `w:${key}`) {
      return { ...r, w: clamp(z.w + z.dw, EXP_W, EXP_MAX_W), h: clamp(z.h + z.dh, 240, EXP_MAX_H) };
    }
    return r;
  }

  private carried(item: string) {
    return !!this.moving?.items.some((i) => i.item === item);
  }

  private areaRect(id: string): Rect | null {
    const a = this.doc.areas[id];
    if (!a) return null;
    let r: Rect = { x: a.x, y: a.y, w: a.w, h: a.h };
    if (this.moving && this.carried(`a:${id}`)) r = { ...r, x: r.x + this.moving.dx, y: r.y + this.moving.dy };
    const z = this.resizing;
    if (z && z.item === `a:${id}`)
      r = { ...r, w: Math.max(AREA_MIN_W, z.w + z.dw), h: Math.max(AREA_MIN_H, z.h + z.dh) };
    return r;
  }

  private noteRect(id: string): Rect | null {
    const pb = this.phoneBoxes.get(id);
    if (pb) return pb;
    const n = this.doc.notes[id];
    if (!n) return null;
    let r: Rect = { x: n.x, y: n.y, w: n.w, h: n.h };
    if (this.moving && this.carried(`n:${id}`)) r = { ...r, x: r.x + this.moving.dx, y: r.y + this.moving.dy };
    const z = this.resizing;
    if (z && z.item === `n:${id}`)
      r = { ...r, w: Math.max(NOTE_MIN_W, z.w + z.dw), h: Math.max(NOTE_MIN_H, z.h + z.dh) };
    return r;
  }

  /** Where a parent's pills go: beside it (a column 36 px right of it, tops aligned), or
   *  on a phone under it, indented. */
  private pillRects(parent: SessionKey): { pills: [string, Rect][]; more?: Rect } {
    const st = this.stacks.get(parent);
    const r = this.winRect(parent);
    if (!st || !r) return { pills: [] };
    const out: [string, Rect][] = [];
    const stacked = this.phone;
    const x = stacked ? r.x + PILL_INDENT : r.x + r.w + PILL_OFF;
    const w = stacked ? r.w - PILL_INDENT : PILL_W;
    let y = stacked ? r.y + r.h + PILL_GAP : r.y;
    for (const a of st.shown) {
      out.push([pillId(parent, a.id), { x, y, w, h: PILL_H }]);
      y += PILL_H + PILL_GAP;
    }
    return { pills: out, more: st.more ? { x, y, w, h: PILL_MORE_H } : undefined };
  }

  toWorld(sx: number, sy: number) {
    return { x: (sx - this.view.x) / this.view.k, y: (sy - this.view.y) / this.view.k };
  }

  private toScreen(wx: number, wy: number) {
    return { x: wx * this.view.k + this.view.x, y: wy * this.view.k + this.view.y };
  }

  /** Everything on the canvas, for Fit and the minimap. */
  private contentRects(): Rect[] {
    const out: Rect[] = [];
    for (const k of this.wins.keys()) {
      const r = this.winRect(k);
      if (!r) continue;
      out.push(r);
      const p = this.pillRects(k);
      for (const [, pr] of p.pills) out.push(pr);
      if (p.more) out.push(p.more);
    }
    for (const h of this.heads) out.push({ x: h.box.x, y: h.box.y, w: h.box.w, h: HEAD_H });
    if (this.viewId === "layout") {
      for (const id of this.areaViews.keys()) {
        const r = this.areaRect(id);
        if (r) out.push(r);
      }
      for (const id of this.noteViews.keys()) {
        const r = this.noteRect(id);
        if (r) out.push(r);
      }
    }
    if (this.viewId === "map") {
      const l = this.map.laneBounds();
      if (l) out.push(l);
      for (const n of this.map.nodes.values()) out.push({ x: n.x, y: n.y, w: n.w, h: n.h });
    }
    return out;
  }

  // ---------- rendering ----------

  request() {
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
      if (p >= 1) this.tween = undefined;
      else this.request();
    }
    const { x, y, k } = this.view;
    this.world.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${k})`;
    let g = 32 * k;
    while (g < 18) g *= 2;
    while (g > 72) g /= 2;
    this.root.style.setProperty("--cv-grid", `${g}px`);
    this.root.style.setProperty("--cv-grid-x", `${x}px`);
    this.root.style.setProperty("--cv-grid-y", `${y}px`);
    this.chrome.setZoom(k);
    this.saveVp();

    for (const [key, v] of this.wins) {
      const r = this.winRect(key);
      if (!r) {
        v.el.style.visibility = "hidden";
        continue;
      }
      v.el.style.visibility = "";
      place(v.el, r);
      const z = String(v.z);
      if (v.el.style.zIndex !== z) v.el.style.zIndex = z;
      setClass(v.el, "is-selected", this.selection.has(`w:${key}`));
    }
    for (const parent of this.stacks.keys()) {
      const { pills, more } = this.pillRects(parent);
      // Pills stack with their parent, so a window raised over it doesn't cut them.
      const z = String(this.wins.get(parent)?.z ?? 0);
      for (const [id, r] of pills) {
        const p = this.pills.get(id);
        if (!p) continue;
        place(p.el, r);
        if (p.el.style.zIndex !== z) p.el.style.zIndex = z;
        setClass(p.el, "is-selected", this.selection.has(`p:${id}`));
      }
      const m = this.mores.get(parent);
      if (m && more) {
        place(m, more);
        m.style.zIndex = z;
      }
    }
    if (this.viewId === "layout") {
      for (const [id, v] of this.areaViews) {
        const r = this.areaRect(id);
        if (r) v.place(r);
        setClass(v.el, "is-selected", this.selection.has(`a:${id}`));
        setClass(v.el, "is-target", this.dropArea === id);
      }
      for (const [id, v] of this.noteViews) {
        const r = this.noteRect(id);
        if (r) v.place(r);
        setClass(v.el, "is-selected", this.selection.has(`n:${id}`));
      }
    }
    this.drawTethers();
    if (this.viewId === "map") this.map.draw();
    this.drawMinimap();
  }

  /** Parent → pills: out of the window's right edge at the title bar's centre, along a
   *  trunk 18 px out, into each pill's left edge at its centre. Open agents in --fg-4,
   *  done in --line; the hovered or selected pill's path in --fg-2. */
  private drawTethers() {
    const paths: [string, string][] = [];
    for (const parent of this.stacks.keys()) {
      const r = this.winRect(parent);
      if (!r) continue;
      const { pills } = this.pillRects(parent);
      if (!pills.length) continue;
      const st = this.stacks.get(parent)!;
      const lit = new Set<string>();
      for (const [id] of pills) if (this.hoverPill === id || this.selection.has(`p:${id}`)) lit.add(id);
      if (this.phone) {
        const tx = r.x + 12;
        const last = pills[pills.length - 1]![1];
        paths.push([`M${tx},${r.y + r.h} V${last.y + last.h / 2}`, "cv-tether"]);
        pills.forEach(([id, pr], i) => {
          const done = st.shown[i]?.state === "done";
          const cls = lit.has(id) ? "cv-tether is-lit" : done ? "cv-tether is-done" : "cv-tether";
          paths.push([`M${tx},${pr.y + pr.h / 2} H${pr.x}`, cls]);
        });
        continue;
      }
      const x1 = r.x + r.w;
      const y1 = r.y + 16;
      const trunk = x1 + TRUNK_OFF;
      const lastY = pills[pills.length - 1]![1].y + PILL_H / 2;
      paths.push([`M${x1},${y1} H${trunk} V${Math.max(y1, lastY)}`, "cv-tether"]);
      pills.forEach(([id, pr], i) => {
        const cy = pr.y + pr.h / 2;
        const done = st.shown[i]?.state === "done";
        paths.push([`M${trunk},${cy} H${pr.x}`, done ? "cv-tether is-done" : "cv-tether"]);
        if (lit.has(id)) paths.push([`M${x1},${y1} H${trunk} V${cy} H${pr.x}`, "cv-tether is-lit"]);
      });
    }
    const sig = paths.map((p) => p.join("@")).join(";");
    if (this.treeG.dataset.sig === sig) return;
    this.treeG.dataset.sig = sig;
    this.treeG.replaceChildren(...paths.map(([d, cls]) => svg("path", { d, class: cls })));
  }

  // ---------- the minimap ----------

  private get minimapOn() {
    return this.api.local.get<boolean>(LOCAL_MINIMAP) ?? true;
  }

  private drawMinimap() {
    const c = this.minimap;
    const rects = this.contentRects();
    const vpw = {
      x: -this.view.x / this.view.k,
      y: (this.barH - this.view.y) / this.view.k,
      w: this.size.w / this.view.k,
      h: (this.size.h - this.barH - STATUS_H) / this.view.k,
    };
    const all = bounds(rects);
    const fits =
      !all || (all.x >= vpw.x && all.y >= vpw.y && all.x + all.w <= vpw.x + vpw.w && all.y + all.h <= vpw.y + vpw.h);
    const on = this.minimapOn && this.size.w >= MINIMAP_W && !fits;
    c.hidden = !on;
    if (!on) return;
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
    const b = bounds([...rects, vpw])!;
    const pad = 10;
    const s = Math.min((W - pad * 2) / Math.max(1, b.w), (H - pad * 2) / Math.max(1, b.h));
    const ox = (W - b.w * s) / 2 - b.x * s;
    const oy = (H - b.h * s) / 2 - b.y * s;
    // Outlines only: windows in the mark tier, the viewport a step darker.
    const css = getComputedStyle(this.root);
    ctx.lineWidth = 1;
    ctx.strokeStyle = css.getPropertyValue("--fg-4").trim() || "#888";
    for (const r of rects) {
      ctx.strokeRect(
        Math.round(ox + r.x * s) + 0.5,
        Math.round(oy + r.y * s) + 0.5,
        Math.max(2, Math.round(r.w * s)),
        Math.max(2, Math.round(r.h * s)),
      );
    }
    ctx.strokeStyle = css.getPropertyValue("--fg-3").trim() || "#666";
    ctx.strokeRect(
      Math.round(ox + vpw.x * s) + 0.5,
      Math.round(oy + vpw.y * s) + 0.5,
      Math.round(vpw.w * s),
      Math.round(vpw.h * s),
    );
    this.minimapMap = { s, ox, oy };
  }

  private jumpFromMinimap(e: PointerEvent, animate = true) {
    const m = this.minimapMap;
    if (!m) return;
    const r = this.minimap.getBoundingClientRect();
    const wx = (e.clientX - r.left - m.ox) / m.s;
    const wy = (e.clientY - r.top - m.oy) / m.s;
    const to = { x: this.size.w / 2 - wx * this.view.k, y: this.size.h / 2 - wy * this.view.k, k: this.view.k };
    if (animate) this.animateTo(to);
    else {
      this.tween = undefined;
      this.view = to;
      this.request();
    }
  }

  // ---------- viewport ----------

  private animateTo(to: Viewport) {
    to.k = clamp(to.k, ZOOM_MIN, ZOOM_MAX);
    if (!this.motion) {
      this.view = to;
      this.request();
      return;
    }
    this.tween = { from: { ...this.view }, to, t0: performance.now(), ms: 240 };
    this.request();
  }

  fit(animate = true) {
    const b = bounds(this.contentRects());
    const top = this.barH + (this.phone ? 12 : 24);
    const bottom = STATUS_H + (this.phone ? 12 : 24);
    if (!b) {
      this.animateTo({ x: this.size.w / 2, y: top + 40, k: 1 });
      return;
    }
    const side = this.phone ? 12 : 48;
    const kw = (this.size.w - side * 2) / b.w;
    const kh = (this.size.h - top - bottom) / b.h;
    const k = clamp(Math.min(kw, this.phone ? 1 : kh, 1), ZOOM_MIN, ZOOM_MAX);
    const to = {
      x: this.phone ? side - b.x * k : (this.size.w - b.w * k) / 2 - b.x * k,
      y: this.phone || kh < kw ? top - b.y * k : top + (this.size.h - top - bottom - b.h * k) / 2 - b.y * k,
      k,
    };
    if (this.phone && b.w * k < this.size.w - side * 2) to.x = (this.size.w - b.w * k) / 2 - b.x * k;
    if (animate) this.animateTo(to);
    else {
      this.view = to;
      this.request();
    }
  }

  private zoomTo(k: number) {
    this.animateTo(this.zoomedAround(this.size.w / 2, this.size.h / 2, k / (this.tween?.to ?? this.view).k));
  }

  zoomStep(dir: 1 | -1) {
    this.animateTo(this.zoomedAround(this.size.w / 2, this.size.h / 2, dir > 0 ? 1.25 : 0.8));
  }

  private zoomedAround(sx: number, sy: number, factor: number): Viewport {
    const v = this.tween?.to ?? this.view;
    const k = clamp(v.k * factor, ZOOM_MIN, ZOOM_MAX);
    const f = k / v.k;
    return { x: sx - (sx - v.x) * f, y: sy - (sy - v.y) * f, k };
  }

  vp() {
    return this.view;
  }

  panBy(dx: number, dy: number) {
    this.tween = undefined;
    this.view = { ...this.view, x: this.view.x + dx, y: this.view.y + dy };
    this.request();
  }

  zoomAt(sx: number, sy: number, factor: number) {
    this.tween = undefined;
    const k = clamp(this.view.k * factor, ZOOM_MIN, ZOOM_MAX);
    const f = k / this.view.k;
    this.view = { x: sx - (sx - this.view.x) * f, y: sy - (sy - this.view.y) * f, k };
    this.request();
  }

  commitViewport() {
    this.saveVp();
  }

  // ---------- actions ----------

  /** Tidy: My layout's areas re-gridded inside, free windows on a grid to the right of
   *  the areas, notes left where they are. On a phone it only re-fits (nothing stored). */
  tidy() {
    if (this.viewId !== "layout") {
      this.fit();
      return;
    }
    if (this.phone) {
      this.relayout(true);
      this.fit();
      return;
    }
    const ops: Op[] = [];
    const vis = [...this.wins.keys()];
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    for (const [id, a] of Object.entries(this.doc.areas)) {
      ops.push(this.tidyAreaOp(id, vis));
      right = Math.max(right, a.x + a.w);
      top = Math.min(top, a.y);
    }
    const free = vis.filter((k) => !areaOf(this.doc, k));
    const sorted = free
      .map((k) => this.snapshot.sessions.get(k)!)
      .filter(Boolean)
      .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || b.lastAt.localeCompare(a.lastAt));
    const cells = sorted.map((s) => this.cell(s.key));
    const out = new Map<string, { x: number; y: number }>();
    const ox = Number.isFinite(right) ? right + GROUP_GAP : 0;
    const oy = Number.isFinite(top) ? top : 0;
    gridCells(
      cells,
      Math.max(colsFor(cells.reduce((n, c) => n + c.span, 0)), cells.some((c) => c.span === 2) ? 2 : 1),
      out,
      ox,
      oy,
    );
    const set: Record<SessionKey, { x: number; y: number; expanded?: boolean }> = {};
    for (const [k, p] of out) set[k] = { ...this.doc.windows[k], x: p.x, y: p.y };
    ops.push({ t: "win", set });
    this.commit({ t: "batch", ops });
    this.animateLayout();
    this.fit();
    this.chrome.say("Tidied");
  }

  /** An area's members on the grid inside it: its width fixed, its height grown to fit. */
  private tidyAreaOp(id: string, onCanvas: SessionKey[]): Op {
    const a = this.doc.areas[id]!;
    const members = onCanvas
      .filter((k) => a.members[k])
      .map((k) => this.snapshot.sessions.get(k)!)
      .filter(Boolean)
      .sort((p, q) => STATE_ORDER.indexOf(p.state) - STATE_ORDER.indexOf(q.state) || q.lastAt.localeCompare(p.lastAt));
    const cols = Math.max(1, Math.floor((a.w - AREA_PAD * 2 + COL_GAP) / (WIN_W + COL_GAP)));
    const cells = members.map((s) => this.cell(s.key));
    const out = new Map<string, { x: number; y: number }>();
    const { h } = gridCells(cells, cols, out, AREA_PAD, AREA_HEAD + 12);
    const m: Record<SessionKey, { dx: number; dy: number }> = {};
    for (const [k, p] of out) m[k] = { dx: p.x, dy: p.y };
    const need = AREA_HEAD + 12 + h + AREA_PAD;
    return { t: "areaPatch", id, patch: { h: Math.max(a.h, need, AREA_MIN_H) }, members: m };
  }

  private newArea(at?: { x: number; y: number }, rect?: Rect, members: SessionKey[] = []) {
    if (!this.canArrange()) {
      if (this.viewId !== "layout") this.setView("layout");
      if (!this.canArrange()) return;
    }
    const id = newId("a");
    const c = at ?? this.toWorld(this.size.w / 2, this.size.h / 2);
    let r: Rect = rect ?? { x: Math.round(c.x - 240), y: Math.round(c.y - 140), w: 480, h: 280 };
    if (!rect) {
      const taken = [...this.contentRects()];
      r = findFree({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, r.w, r.h, taken, 24);
    }
    const area = {
      title: "",
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.max(AREA_MIN_W, Math.round(r.w)),
      h: Math.max(AREA_MIN_H, Math.round(r.h)),
      members: {} as Record<SessionKey, { dx: number; dy: number }>,
      z: this.topZ(),
    };
    const ops: Op[] = [];
    for (const k of members) {
      const p = this.winRect(k);
      if (!p) continue;
      area.members[k] = { dx: Math.round(p.x - area.x), dy: Math.round(p.y - area.y) };
      const prev = areaOf(this.doc, k);
      if (prev) ops.push({ t: "areaPatch", id: prev, patch: {}, members: { [k]: null } });
    }
    this.commit({ t: "batch", ops: [...ops, { t: "area", id, set: area }] });
    this.selection = new Set([`a:${id}`]);
    void this.renameArea(id);
  }

  private topZ() {
    let z = 0;
    for (const a of Object.values(this.doc.areas)) z = Math.max(z, a.z);
    for (const n of Object.values(this.doc.notes)) z = Math.max(z, n.z);
    return z + 1;
  }

  private newNote(at?: { x: number; y: number }, text = "") {
    if (this.viewId !== "layout") this.setView("layout");
    const id = newId("n");
    if (this.phone) {
      // A phone may write a note's text, not its place: it lands beside the last one.
      const last = Object.values(this.doc.notes).sort((a, b) => b.y - a.y)[0];
      const note = {
        text: text || " ",
        x: last?.x ?? 0,
        y: (last?.y ?? 0) + (last?.h ?? 0) + 16,
        w: NOTE_W,
        h: NOTE_H,
        z: this.topZ(),
      };
      void this.writeRaw((cur) => {
        const d = normalize(cur);
        d.notes[id] = note;
        return d;
      });
      exec(this.doc, { t: "note", id, set: note });
      this.relayout(false);
      if (!text) void this.editNote(id);
      return;
    }
    const c = at ?? this.toWorld(this.size.w / 2, this.size.h / 2);
    const r = findFree(c, NOTE_W, NOTE_H, this.contentRects(), 16);
    this.commit({
      t: "note",
      id,
      set: { text, x: Math.round(r.x), y: Math.round(r.y), w: NOTE_W, h: NOTE_H, z: this.topZ() },
    });
    this.selection = new Set([`n:${id}`]);
    if (!text) void this.editNote(id);
  }

  addArea() {
    this.newArea();
  }

  addNote() {
    this.newNote();
  }

  private async renameArea(id: string) {
    let v = this.areaViews.get(id);
    if (!v) {
      await new Promise((r) => requestAnimationFrame(r));
      v = this.areaViews.get(id);
    }
    if (!v) return;
    this.editing++;
    const title = await v.rename();
    this.editing--;
    if (title !== null && this.doc.areas[id] && title !== this.doc.areas[id]!.title) {
      this.commit({ t: "areaPatch", id, patch: { title } });
    }
    this.afterEdit();
  }

  private async editNote(id: string) {
    let v = this.noteViews.get(id);
    if (!v) {
      await new Promise((r) => requestAnimationFrame(r));
      v = this.noteViews.get(id);
    }
    if (!v) return;
    this.editing++;
    const text = await v.edit();
    this.editing--;
    const n = this.doc.notes[id];
    if (n && text !== null) {
      if (!text.trim()) {
        // An empty note is no note.
        this.commit({ t: "note", id, set: null }, { undo: false });
        this.undoStack = this.undoStack.filter((o) => !(o.t === "note" && o.id === id));
      } else if (text !== n.text) {
        if (text.length > NOTE_MAX) this.chrome.say("A note holds up to 2,000 characters");
        else this.commitText(id, text);
      }
    } else if (n && !n.text.trim()) {
      this.commit({ t: "note", id, set: null }, { undo: false });
    }
    this.afterEdit();
  }

  /** A note's text: on a phone too (text is not a position). */
  private commitText(id: string, text: string) {
    if (!this.phone) {
      this.commit({ t: "notePatch", id, patch: { text } });
      return;
    }
    exec(this.doc, { t: "notePatch", id, patch: { text } });
    this.write({ t: "notePatch", id, patch: { text } });
  }

  private afterEdit() {
    this.root.focus({ preventScroll: true });
    if (this.pendingRemote && !this.gesture && this.editing === 0) this.adopt(this.pendingRemote.v);
  }

  private deleteSelection() {
    if (this.viewId === "map") {
      this.map.deleteSelected();
      return;
    }
    const areas = [...this.selection].filter((i) => i.startsWith("a:")).map((i) => i.slice(2));
    const notes = [...this.selection].filter((i) => i.startsWith("n:")).map((i) => i.slice(2));
    if (areas.length || notes.length) {
      const ops: Op[] = [
        ...areas.map((id): Op => ({ t: "area", id, set: null })),
        ...notes.map((id): Op => ({ t: "note", id, set: null })),
      ];
      // An area's windows stay where they are.
      for (const id of areas) {
        const a = this.doc.areas[id];
        if (!a) continue;
        const set: Record<SessionKey, { x: number; y: number }> = {};
        for (const [k, m] of Object.entries(a.members))
          set[k] = { ...this.doc.windows[k], x: a.x + m.dx, y: a.y + m.dy };
        ops.unshift({ t: "win", set });
      }
      const what =
        areas.length && notes.length
          ? "Deleted"
          : areas.length
            ? areas.length === 1
              ? "Area deleted"
              : `${areas.length} areas deleted`
            : notes.length === 1
              ? "Note deleted"
              : `${notes.length} notes deleted`;
      this.selection.clear();
      this.commit({ t: "batch", ops }, { say: what });
      return;
    }
    const keys = this.selectedKeys();
    if (keys.length) this.hide(keys);
  }

  private hide(keys: SessionKey[]) {
    const set: Record<SessionKey, SessionState> = {};
    for (const k of keys) {
      const s = this.snapshot.sessions.get(k);
      if (s) set[k] = s.state;
    }
    for (const k of keys) this.selection.delete(`w:${k}`);
    this.commit(
      { t: "hidden", set },
      { say: keys.length === 1 ? "Hidden until it changes" : `${keys.length} hidden until they change` },
    );
    this.sync(this.snapshot);
  }

  private unhide(key: SessionKey) {
    this.commit({ t: "hidden", set: { [key]: null } }, { undo: false });
    this.sync(this.snapshot);
    this.selection = new Set([`w:${key}`]);
    this.reveal(key);
  }

  /** Bring a window into view when it's off screen. */
  private reveal(key: SessionKey) {
    const r = this.winRect(key);
    if (!r) return;
    const k = this.view.k;
    const s = this.toScreen(r.x, r.y);
    if (s.x >= 0 && s.y >= this.barH && s.x + r.w * k <= this.size.w && s.y + r.h * k <= this.size.h - STATUS_H) return;
    this.animateTo({ x: this.size.w / 2 - (r.x + r.w / 2) * k, y: this.size.h / 2 - (r.y + r.h / 2) * k, k });
  }

  private toggleExpand(key: SessionKey) {
    const v = this.wins.get(key);
    if (!v || this.viewId === "map") return;
    const on = !this.isExpanded(key);
    if (this.canArrange()) {
      const cur = this.doc.windows[key] ?? this.minePos(key) ?? { x: 0, y: 0 };
      const next: WinEntry = { ...cur, x: cur.x, y: cur.y, expanded: on || undefined };
      if (!on) {
        delete next.w;
        delete next.h;
      }
      if (!next.expanded) delete next.expanded;
      this.commit({ t: "win", set: { [key]: next } }, { undo: false });
    } else if (on) this.expandedHere.add(key);
    else this.expandedHere.delete(key);
    v.setExpanded(on);
    this.layoutSig = "";
    this.sync(this.snapshot);
    v.el.focus({ preventScroll: true });
  }

  private openBeside(key: SessionKey, background = false) {
    const v = this.wins.get(key);
    const r = v?.el.getBoundingClientRect();
    this.api.openSession(
      key,
      r
        ? { split: true, background, from: { x: r.x, y: r.y, width: r.width, height: r.height } }
        : { split: true, background },
    );
  }

  /** A pill: its child session when it has one, else the agent inside its parent. */
  private openAgent(id: string, asPage = false) {
    const p = this.pills.get(id);
    if (!p) return;
    const a = p.agent;
    if (a.session) {
      this.api.openSession(a.session, asPage || this.phone ? {} : { split: true });
      return;
    }
    this.api.openSession(p.parent, asPage || this.phone ? { agent: a.id } : { split: true, agent: a.id });
  }

  private selectedKeys(): SessionKey[] {
    return [...this.selection].filter((i) => i.startsWith("w:")).map((i) => i.slice(2));
  }

  /** ⌥⌘1–7, ⌥⌘0: sessions through the host's labels, areas and notes in the document. */
  private setLabel(c: LabelColor | null) {
    const keys = this.selectedKeys();
    const focused = this.focusedKey();
    if (!keys.length && focused && !this.selection.size) keys.push(focused);
    if (keys.length) void this.api.labels?.set(keys, c);
    const ops: Op[] = [];
    for (const i of this.selection) {
      if (i.startsWith("a:")) ops.push({ t: "areaPatch", id: i.slice(2), patch: { label: c } });
      if (i.startsWith("n:")) ops.push({ t: "notePatch", id: i.slice(2), patch: { label: c } });
    }
    if (ops.length) this.commit({ t: "batch", ops });
  }

  private focusedKey(): SessionKey | undefined {
    const a = document.activeElement as HTMLElement | null;
    return (a?.closest(".cv-win") as HTMLElement | null)?.dataset.key;
  }

  private enter() {
    const items = [...this.selection];
    const one = items.length === 1 ? items[0]! : undefined;
    const focused = this.focusedKey();
    if (one?.startsWith("a:")) void this.renameArea(one.slice(2));
    else if (one?.startsWith("n:")) void this.editNote(one.slice(2));
    else if (one?.startsWith("p:")) this.openAgent(one.slice(2));
    else if (one?.startsWith("w:")) this.toggleExpand(one.slice(2));
    else if (focused) this.toggleExpand(focused);
  }

  private nudge(dx: number, dy: number) {
    if (!this.canArrange() || !this.selection.size) return;
    const first = [...this.selection].find((i) => !i.startsWith("p:"));
    if (!first) return;
    if (!this.moving) {
      if (!this.beginMove(first)) return;
      this.nudged = { dx: 0, dy: 0 };
    }
    this.nudged!.dx += dx;
    this.nudged!.dy += dy;
    this.moveBy(this.nudged!.dx, this.nudged!.dy, false);
    this.endNudge();
  }
  private nudged: { dx: number; dy: number } | undefined;
  private endNudge = debounce(500, () => {
    this.nudged = undefined;
    this.endMove(true);
  });

  // ---------- search ----------

  setQuery(q: string) {
    this.query = q.trim().toLowerCase();
    this.applySearch();
    if (this.query) this.revealHit();
  }

  private applySearch() {
    const q = parseQuery(this.query);
    setClass(this.root, "is-searching", !!this.query);
    let hits = 0;
    for (const v of this.wins.values()) {
      const hit = !!this.query && this.matches(v.session, q);
      if (hit) hits++;
      setClass(v.el, "is-hit", hit);
      setClass(v.el, "is-dim", !!this.query && !hit);
    }
    if (this.query) this.chrome.say(hits === 1 ? "1 match" : `${hits} matches`, undefined, true);
    else if (this.wasSearching) this.chrome.say("");
    this.wasSearching = !!this.query;
  }
  private wasSearching = false;

  private matches(s: SessionSummary, q: ReturnType<typeof parseQuery>): boolean {
    const l = this.snapshot.labels;
    const color = l?.sessions.get(s.key);
    const labelIs = (x: string) =>
      x === "none" ? !color : !!color && (color === x || (l?.names[color] ?? "").toLowerCase() === x);
    for (const t of q.tokens) {
      let ok = true;
      if (t.k === "label") ok = labelIs(t.v);
      else if (t.k === "machine") ok = (s.machine ?? "").toLowerCase().includes(t.v);
      else if (t.k === "harness")
        ok = s.harness.toLowerCase().includes(t.v) || harnessName(this.api, s.harness).toLowerCase().includes(t.v);
      else if (t.k === "repo") ok = (s.repo ?? "").toLowerCase().includes(t.v);
      if (ok === t.neg) return false;
    }
    if (!q.text) return true;
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
      ...(s.agents ?? []).flatMap((a) => [a.type, a.description]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q.text);
  }

  /** If no match is on screen, bring the first one into view. */
  private revealHit() {
    const k = this.view.k;
    const vw = { x: -this.view.x / k, y: -this.view.y / k, w: this.size.w / k, h: this.size.h / k };
    let first: Rect | null = null;
    for (const v of this.wins.values()) {
      if (!v.el.classList.contains("is-hit")) continue;
      const r = this.winRect(v.key);
      if (!r) continue;
      if (overlaps(r, vw, 0)) return;
      first ??= r;
    }
    if (!first) return;
    this.animateTo({
      x: this.size.w / 2 - (first.x + first.w / 2) * k,
      y: this.size.h / 2 - (first.y + first.h / 2) * k,
      k,
    });
  }

  // ---------- menus ----------

  private at(sx: number, sy: number) {
    const r = this.root.getBoundingClientRect();
    return { x: r.left + sx, y: r.top + sy };
  }

  private open(
    items: ViewMenuItem[],
    at: { x: number; y: number },
    source: MenuSource,
    title?: string,
    subtitle?: string,
  ) {
    this.hideTip();
    this.api.menu?.open(items, at, { source, title, subtitle });
  }

  /** The Label ▸ rows: the seven with their names and keys, None; checked when every
   *  target shares it. */
  private labelItems(
    current: LabelColor | null | undefined,
    run: (c: LabelColor | null) => void,
    edit = true,
  ): ViewMenuItem[] {
    const names = this.snapshot.labels?.names;
    const rows: ViewMenuItem[] = LABEL_COLORS.map((c) => ({
      label: names?.[c] ?? c[0]!.toUpperCase() + c.slice(1),
      swatch: c,
      radio: true,
      checked: current === c,
      action: `label.${c}`,
      run: () => run(c),
    }));
    rows.push(
      { sep: true },
      { label: "None", radio: true, checked: current === null, action: "label.none", run: () => run(null) },
    );
    if (edit && this.api.labels)
      rows.push({ sep: true }, { label: "Edit labels…", run: () => this.api.labels?.edit(current ?? undefined) });
    return rows;
  }

  menuAt(hit: Hit, sx: number, sy: number, source: MenuSource) {
    if (!this.api.menu) return;
    const at = this.at(sx, sy);
    switch (hit.kind) {
      case "win": {
        const item = `w:${hit.key}`;
        if (this.selection.size > 1 && this.selection.has(item)) this.selectionMenu(at, source);
        else {
          if (!this.selection.has(item)) this.selection = new Set([item]);
          this.request();
          this.windowMenu(hit.key, at, source);
        }
        return;
      }
      case "pill":
        this.selection = new Set([`p:${hit.id}`]);
        this.request();
        this.pillMenu(hit.id, at, source);
        return;
      case "area":
        if (this.selection.size > 1 && this.selection.has(`a:${hit.id}`)) return this.selectionMenu(at, source);
        this.selection = new Set([`a:${hit.id}`]);
        this.request();
        this.areaMenu(hit.id, at, source);
        return;
      case "note":
        this.selection = new Set([`n:${hit.id}`]);
        this.request();
        this.noteMenu(hit.id, at, source);
        return;
      case "head":
        this.headMenu(hit.group, at, source);
        return;
      case "node":
        if (hit.custom) {
          this.map.select(hit.id);
          this.open(
            [
              { label: "Rename", keys: "↵", run: () => this.map.edit(hit.id) },
              { sep: true },
              { label: "Delete", keys: "⌫", danger: true, run: () => void this.map.deleteSelected() },
            ],
            at,
            source,
          );
          return;
        }
        this.groundMenu(at, source, sx, sy);
        return;
      case "link":
        this.map.select(hit.id);
        this.open(
          [{ label: "Delete line", keys: "⌫", danger: true, run: () => void this.map.deleteSelected() }],
          at,
          source,
        );
        return;
      default:
        this.groundMenu(at, source, sx, sy);
    }
  }

  menuForSelection(): void {
    const items = [...this.selection];
    const first = items[0];
    const r = !first
      ? null
      : first.startsWith("w:")
        ? this.winRect(first.slice(2))
        : first.startsWith("a:")
          ? this.areaRect(first.slice(2))
          : first.startsWith("n:")
            ? this.noteRect(first.slice(2))
            : null;
    const focused = this.focusedKey();
    if (!first && focused) {
      this.selection = new Set([`w:${focused}`]);
      this.menuForSelection();
      return;
    }
    if (!first) {
      this.groundMenu(this.at(16, this.barH + 8), "keyboard", this.size.w / 2, this.size.h / 2);
      return;
    }
    const pr = first.startsWith("p:")
      ? this.pillRects(this.pills.get(first.slice(2))?.parent ?? "").pills.find(([id]) => id === first.slice(2))?.[1]
      : null;
    const box = r ?? pr;
    const s = box ? this.toScreen(box.x, box.y) : { x: 16, y: this.barH + 8 };
    const at = this.at(s.x, s.y);
    if (items.length > 1) {
      this.selectionMenu(at, "keyboard");
      return;
    }
    if (first.startsWith("w:")) this.windowMenu(first.slice(2), at, "keyboard");
    else if (first.startsWith("p:")) this.pillMenu(first.slice(2), at, "keyboard");
    else if (first.startsWith("a:")) this.areaMenu(first.slice(2), at, "keyboard");
    else if (first.startsWith("n:")) this.noteMenu(first.slice(2), at, "keyboard");
  }

  /** The board's menu for the session, with the canvas's own rows. */
  private windowMenu(key: SessionKey, at: { x: number; y: number }, source: MenuSource) {
    const s = this.snapshot.sessions.get(key);
    const v = this.wins.get(key);
    if (!s || !v || !this.api.menu) return;
    const answer: ViewMenuItem[] | undefined = v.answerable
      ? [
          { label: "Allow", run: () => void v.answer("allow") },
          { label: "Deny", run: () => void v.answer("deny") },
        ]
      : undefined;
    const extra: ViewMenuItem[] = [];
    if (this.viewId !== "map")
      extra.push({
        label: this.isExpanded(key) ? "Collapse" : "Expand",
        action: "enter",
        run: () => this.toggleExpand(key),
      });
    const parentKey = s.parentId ? `${s.harness}:${s.parentId}` : undefined;
    if (parentKey && this.wins.has(parentKey))
      extra.push({ label: "Select parent", run: () => this.selectOnly(`w:${parentKey}`) });
    extra.push({ label: "Hide until it changes", run: () => this.hide([key]) });
    const aid = areaOf(this.doc, key);
    if (this.canArrange() && aid) extra.push({ label: "Remove from area", run: () => this.removeFromArea([key]) });
    this.hideTip();
    this.api.menu.session(key, at, { answer, extra, source });
  }

  private selectionMenu(at: { x: number; y: number }, source: MenuSource) {
    const keys = this.selectedKeys();
    const items: ViewMenuItem[] = [];
    if (keys.length) {
      const labels = keys.map((k) => this.snapshot.labels?.sessions.get(k) ?? null);
      const same = labels.every((l) => l === labels[0]) ? labels[0] : undefined;
      items.push({ label: "Label", items: this.labelItems(same, (c) => void this.api.labels?.set(keys, c)) });
    }
    const docItems = [...this.selection].filter((i) => i.startsWith("a:") || i.startsWith("n:"));
    if (docItems.length && !keys.length)
      items.push({ label: "Label", items: this.labelItems(undefined, (c) => this.setLabel(c), false) });
    if (this.canArrange() && keys.length)
      items.push({ label: "New area from selection", run: () => this.areaFromSelection() });
    if (keys.length) {
      items.push({ label: "Hide until they change", run: () => this.hide(keys) });
      items.push({ sep: true });
      items.push({
        label: "Open beside",
        run: () =>
          keys.forEach((k, i) => {
            this.openBeside(k, i < keys.length - 1);
          }),
      });
    }
    if (docItems.length)
      items.push({ sep: true }, { label: "Delete", keys: "⌫", danger: true, run: () => this.deleteSelection() });
    this.open(items, at, source, `${this.selection.size} selected`);
  }

  private areaFromSelection() {
    const keys = this.selectedKeys();
    const rects = keys.map((k) => {
      const r = this.winRect(k)!;
      return this.footprint(k, r.x, r.y);
    });
    const b = bounds(rects);
    if (!b) return;
    this.newArea(
      undefined,
      { x: b.x - AREA_PAD, y: b.y - AREA_PAD - AREA_HEAD, w: b.w + AREA_PAD * 2, h: b.h + AREA_PAD * 2 + AREA_HEAD },
      keys,
    );
  }

  private removeFromArea(keys: SessionKey[]) {
    const ops: Op[] = [];
    for (const k of keys) {
      const aid = areaOf(this.doc, k);
      const p = this.winRect(k);
      if (!aid || !p) continue;
      ops.push({ t: "areaPatch", id: aid, patch: {}, members: { [k]: null } });
      // Out of the area, just right of it.
      const a = this.doc.areas[aid]!;
      ops.push({
        t: "win",
        set: { [k]: { ...this.doc.windows[k], x: Math.round(a.x + a.w + GROUP_GAP), y: Math.round(p.y) } },
      });
    }
    this.commit({ t: "batch", ops });
  }

  private pillMenu(id: string, at: { x: number; y: number }, source: MenuSource) {
    const p = this.pills.get(id);
    if (!p) return;
    const a: AgentRun = p.agent;
    const copy = (text: string) => () => void navigator.clipboard?.writeText(text).catch(() => {});
    const copies: ViewMenuItem[] = [{ label: "Agent ID", run: copy(a.id) }];
    if (a.description) copies.push({ label: "Description", run: copy(a.description) });
    if (a.result) copies.push({ label: "Result", run: copy(a.result) });
    const title = [a.type, a.description].filter(Boolean).join(" · ") || "Subagent";
    const parent = this.snapshot.sessions.get(p.parent);
    this.open(
      [
        { label: "Open beside", action: "enter", run: () => this.openAgent(id) },
        { label: "Open as page", run: () => this.openAgent(id, true) },
        { sep: true },
        { label: "Select parent", run: () => this.selectOnly(`w:${p.parent}`) },
        { sep: true },
        { label: "Copy", items: copies },
      ],
      at,
      source,
      title,
      parent ? this.api.format.title(parent) : undefined,
    );
  }

  private areaMenu(id: string, at: { x: number; y: number }, source: MenuSource) {
    const a = this.doc.areas[id];
    if (!a) return;
    const arrange = this.canArrange();
    this.open(
      [
        { label: "Rename", action: "enter", run: () => void this.renameArea(id) },
        {
          label: "Label",
          items: this.labelItems(
            a.label ?? null,
            (c) => this.commit({ t: "areaPatch", id, patch: { label: c } }),
            false,
          ),
        },
        {
          label: "Tidy this area",
          disabled: !arrange,
          run: () => this.commit(this.tidyAreaOp(id, [...this.wins.keys()])),
        },
        {
          label: "Select members",
          run: () => {
            this.selection = new Set(
              Object.keys(a.members)
                .filter((k) => this.wins.has(k))
                .map((k) => `w:${k}`),
            );
            this.request();
          },
        },
        { sep: true },
        { label: "Delete area", action: "delete", danger: true, run: () => this.selectThenDelete(`a:${id}`) },
      ],
      at,
      source,
      a.title || "Untitled area",
    );
  }

  private noteMenu(id: string, at: { x: number; y: number }, source: MenuSource) {
    const n = this.doc.notes[id];
    if (!n) return;
    this.open(
      [
        { label: "Edit", action: "enter", run: () => void this.editNote(id) },
        {
          label: "Label",
          items: this.labelItems(
            n.label ?? null,
            (c) => this.commit({ t: "notePatch", id, patch: { label: c } }),
            false,
          ),
        },
        { label: "Copy text", run: () => void navigator.clipboard?.writeText(n.text).catch(() => {}) },
        { sep: true },
        { label: "Delete note", action: "delete", danger: true, run: () => this.selectThenDelete(`n:${id}`) },
      ],
      at,
      source,
      "Note",
    );
  }

  private selectThenDelete(item: string) {
    this.selection = new Set([item]);
    this.deleteSelection();
  }

  private headMenu(group: string, at: { x: number; y: number }, source: MenuSource) {
    const h = this.heads.find((x) => x.id === group);
    if (!h) return;
    const keys = h.keys.filter((k) => this.wins.has(k));
    const items: ViewMenuItem[] = [
      {
        label: "Select group",
        run: () => {
          this.selection = new Set(keys.map((k) => `w:${k}`));
          this.request();
        },
      },
    ];
    if (keys.length <= 6)
      items.push({
        label: "Open all beside",
        run: () =>
          keys.forEach((k, i) => {
            this.openBeside(k, i < keys.length - 1);
          }),
      });
    if (this.viewId === "label" && this.api.labels)
      items.push({ sep: true }, { label: "Edit labels…", run: () => this.api.labels?.edit(h.label) });
    this.open(items, at, source, h.title);
  }

  private viewItems(): ViewMenuItem[] {
    return VIEWS.map((v) => ({
      label: v.label,
      radio: true,
      checked: v.id === this.viewId,
      action: `view.${v.id}`,
      run: () => this.setView(v.id),
    }));
  }

  private groundMenu(at: { x: number; y: number }, source: MenuSource, sx: number, sy: number) {
    const w = this.toWorld(sx, sy);
    let items: ViewMenuItem[];
    if (this.viewId === "layout") {
      items = [
        {
          label: "New area",
          action: "area",
          disabled: this.phone ? "Arrange on a larger screen" : false,
          run: () => this.newArea(w),
        },
        { label: "New note", action: "note", run: () => this.newNote(w) },
        { label: "Tidy", action: "tidy", run: () => this.tidy() },
        { label: "Fit", action: "fit", run: () => this.fit() },
        {
          label: "Paste note",
          run: async () => {
            const t = await navigator.clipboard?.readText().catch(() => "");
            if (t?.trim()) this.newNote(w, t.slice(0, NOTE_MAX));
            else this.chrome.say("Nothing to paste");
          },
        },
        { sep: true },
        { label: "Reset My layout…", danger: true, disabled: this.phone, run: () => void this.reset() },
      ];
    } else if (this.viewId === "map") {
      items = [
        {
          label: "New node",
          run: () => {
            this.map.addCustom(Math.round(w.x / GRID) * GRID, Math.round(w.y / GRID) * GRID);
          },
        },
        { label: "Fit", action: "fit", run: () => this.fit() },
      ];
    } else {
      items = [
        { label: "View", items: this.viewItems() },
        { label: "Fit", action: "fit", run: () => this.fit() },
        { label: "Show done sessions", checked: this.showDoneSessions, run: () => this.toggleShowDone() },
      ];
    }
    this.open(items, at, source);
  }

  viewMenu(at: { x: number; y: number }) {
    this.open(this.viewItems(), at, "mouse");
  }

  zoomMenu(at: { x: number; y: number }) {
    this.open(
      [
        { label: "Zoom in", action: "zoom-in", run: () => this.zoomStep(1) },
        { label: "Zoom out", action: "zoom-out", run: () => this.zoomStep(-1) },
        { label: "Actual size", action: "zoom-actual", run: () => this.zoomTo(1) },
        { label: "Fit", action: "fit", run: () => this.fit() },
      ],
      at,
      "mouse",
    );
  }

  moreMenu(at: { x: number; y: number }) {
    const items: ViewMenuItem[] = [];
    if (this.phone && this.viewId === "layout") {
      items.push({ label: "New note", run: () => this.newNote() }, { sep: true });
    }
    items.push(
      { label: "Show done sessions", checked: this.showDoneSessions, run: () => this.toggleShowDone() },
      {
        label: "Show minimap",
        checked: this.minimapOn,
        disabled: this.size.w < MINIMAP_W ? "Only on a wider window" : false,
        run: () => {
          this.api.local.set(LOCAL_MINIMAP, !this.minimapOn);
          this.request();
        },
      },
    );
    if (this.api.labels) items.push({ sep: true }, { label: "Edit labels…", run: () => this.api.labels?.edit() });
    if (this.viewId === "layout" && !this.phone)
      items.push({ sep: true }, { label: "Reset My layout…", danger: true, run: () => void this.reset() });
    this.open(items, at, "mouse");
  }

  hiddenMenu(at: { x: number; y: number }) {
    this.open(
      this.hiddenList.map((s) => ({
        label: this.api.format.title(s),
        items: [
          { label: "Show", run: () => this.unhide(s.key) },
          { label: "Open beside", run: () => this.openBeside(s.key) },
        ],
      })),
      at,
      "mouse",
      "Hidden",
    );
  }

  doneMenu(at: { x: number; y: number }) {
    this.open(
      this.doneList.map((s) => ({
        label: this.api.format.title(s),
        items: [
          { label: "Open beside", run: () => this.openBeside(s.key) },
          { label: "Open as page", run: () => this.api.openSession(s.key) },
        ],
      })),
      at,
      "mouse",
      "Done",
    );
  }

  pair() {
    this.api.navigate("/machines");
  }

  private toggleShowDone() {
    this.api.local.set(LOCAL_DONE, !this.showDoneSessions);
    this.layoutSig = "";
    this.sync(this.snapshot);
  }

  private async reset() {
    const ok = this.api.menu
      ? await this.api.menu.confirm({
          title: "Reset My layout?",
          body: "Window positions, areas and notes go. Sessions stay.",
          action: "Reset",
          danger: true,
        })
      : false;
    if (!ok) return;
    this.commit({ t: "restore", windows: {}, areas: {}, notes: {} }, { say: "My layout reset" });
    this.layoutSig = "";
    this.sync(this.snapshot);
    this.fit();
  }

  // ---------- the tooltip ----------

  private tipOver(e: PointerEvent) {
    const bar = (e.target as Element | null)?.closest?.(".cv-win-bar");
    clearTimeout(this.tipTimer);
    if (!bar || e.pointerType !== "mouse" || this.root.classList.contains("is-touch")) {
      this.tip.hidden = true;
      return;
    }
    const key = (bar.closest(".cv-win") as HTMLElement).dataset.key!;
    this.tipTimer = setTimeout(() => {
      const v = this.wins.get(key);
      if (!v || this.gesture) return;
      this.tip.replaceChildren(...v.tipLines().map((l, i) => el("div", i ? "cv-tip-l" : "cv-tip-t", l)));
      const r = bar.getBoundingClientRect();
      const root = this.root.getBoundingClientRect();
      this.tip.hidden = false;
      const x = Math.min(r.left - root.left, this.size.w - this.tip.offsetWidth - 8);
      const below = r.bottom - root.top + 6;
      const y =
        below + this.tip.offsetHeight > this.size.h - STATUS_H ? r.top - root.top - this.tip.offsetHeight - 6 : below;
      this.tip.style.transform = `translate3d(${Math.max(8, x)}px, ${y}px, 0)`;
    }, 500);
  }

  private hideTip() {
    clearTimeout(this.tipTimer);
    this.tip.hidden = true;
  }

  // ---------- InputHost ----------

  get shortcuts(): ThemeApi["shortcuts"] {
    return this.api.shortcuts;
  }

  hit(target: EventTarget | null): Hit {
    const t = target as Element | null;
    if (!t || !(t instanceof Element)) return { kind: "canvas" };
    if (t.closest(".cv-bar, .cv-statusbar, .cv-minimap, .cv-pop, .cv-ghost, .cv-tip, .cv-pill-more"))
      return { kind: "ui" };
    const win = t.closest(".cv-win") as HTMLElement | null;
    if (win) {
      const key = win.dataset.key!;
      if (t.closest("button, a, input, select, textarea")) return { kind: "win", key, part: "control" };
      if (t.closest(".cv-win-resize")) return { kind: "win", key, part: "resize" };
      if (t.closest(".cv-detail-list")) return { kind: "win", key, part: "scroll" };
      if (t.closest(".cv-win-bar")) return { kind: "win", key, part: "bar" };
      return { kind: "win", key, part: "body" };
    }
    const pill = t.closest(".cv-pill") as HTMLElement | null;
    if (pill) return { kind: "pill", id: pill.dataset.pill!, parent: pill.dataset.parent!, agent: pill.dataset.agent! };
    const note = t.closest(".cv-note") as HTMLElement | null;
    if (note) {
      const id = note.dataset.note!;
      if (t.closest(".cv-note-resize")) return { kind: "note", id, part: "resize" };
      if (t.closest(".cv-note-text.is-editing")) return { kind: "note", id, part: "edit" };
      return { kind: "note", id, part: "body" };
    }
    const node = t.closest(".cv-node") as HTMLElement | null;
    if (node) {
      const id = node.dataset.id!;
      const custom = node.dataset.kind === "custom";
      if (t.closest(".cv-node-h")) return { kind: "node", id, part: "handle", custom };
      const chip = t.closest(".cv-chip-a") as HTMLElement | null;
      if (chip) return { kind: "node", id, part: "chip", chip: chip.dataset.chip, custom };
      if (t.closest(".cv-node-edit[contenteditable='true']")) return { kind: "node", id, part: "edit", custom };
      if (node.dataset.chip) return { kind: "node", id, part: "chip", chip: node.dataset.chip, custom };
      return { kind: "node", id, part: "body", custom };
    }
    const link = t.closest("[data-link]") as (SVGElement & { dataset: DOMStringMap }) | null;
    if (link?.dataset.link) return { kind: "link", id: link.dataset.link };
    const head = t.closest(".cv-head") as HTMLElement | null;
    if (head) return { kind: "head", group: head.dataset.group! };
    const area = t.closest(".cv-area") as HTMLElement | null;
    if (area) {
      const id = area.dataset.area!;
      if (t.closest(".cv-area-resize")) return { kind: "area", id, part: "resize" };
      if (t.closest(".cv-area-title.is-editing")) return { kind: "area", id, part: "edit" };
      if (t.closest(".cv-area-head")) return { kind: "area", id, part: "head" };
      return { kind: "area", id, part: "body" };
    }
    return { kind: "canvas" };
  }

  hitAt(sx: number, sy: number): Hit {
    const r = this.root.getBoundingClientRect();
    return this.hit(document.elementFromPoint(sx + r.left, sy + r.top));
  }

  itemOf(hit: Hit): string | null {
    switch (hit.kind) {
      case "win":
        return `w:${hit.key}`;
      case "pill":
        return `p:${hit.id}`;
      case "area":
        return hit.part === "body" ? null : `a:${hit.id}`;
      case "note":
        return `n:${hit.id}`;
      default:
        return null;
    }
  }

  isSelected(item: string) {
    return this.selection.has(item);
  }

  select(item: string | null, add: boolean) {
    if (!item) {
      if (this.selection.size) {
        this.selection.clear();
        this.request();
      }
      return;
    }
    if (add) {
      if (this.selection.has(item)) this.selection.delete(item);
      else this.selection.add(item);
    } else this.selection = new Set([item]);
    if (item.startsWith("w:")) {
      const v = this.wins.get(item.slice(2));
      if (v) {
        v.z = Math.max(...[...this.wins.values()].map((w) => w.z)) + 1;
        if (!v.el.contains(document.activeElement)) v.el.focus({ preventScroll: true });
      }
    } else if (item.startsWith("p:")) this.pills.get(item.slice(2))?.el.focus({ preventScroll: true });
    else if (item.startsWith("n:")) this.noteViews.get(item.slice(2))?.el.focus({ preventScroll: true });
    else this.root.focus({ preventScroll: true });
    this.request();
  }

  private selectOnly(item: string) {
    this.select(item, false);
    if (item.startsWith("w:")) this.reveal(item.slice(2));
  }

  beginMove(item: string): boolean {
    if (!this.canArrange()) return false;
    if (!this.selection.has(item)) this.select(item, false);
    const items: Moving["items"] = [];
    const areas = new Set([...this.selection].filter((i) => i.startsWith("a:")).map((i) => i.slice(2)));
    for (const i of this.selection) {
      if (i.startsWith("w:")) {
        const k = i.slice(2);
        const aid = areaOf(this.doc, k);
        if (aid && areas.has(aid)) continue; // moves with its area
        const r = this.rects.get(k);
        if (r) items.push({ item: i, x: r.x, y: r.y });
      } else if (i.startsWith("a:")) {
        const a = this.doc.areas[i.slice(2)];
        if (a) items.push({ item: i, x: a.x, y: a.y });
      } else if (i.startsWith("n:")) {
        const n = this.doc.notes[i.slice(2)];
        if (n) items.push({ item: i, x: n.x, y: n.y });
      }
    }
    if (!items.length) return false;
    this.moving = { items, dx: 0, dy: 0 };
    this.hideTip();
    return true;
  }

  moveBy(dx: number, dy: number, snap: boolean) {
    const m = this.moving;
    if (!m) return;
    if (snap) {
      // Snap the first item's position to the grid; the rest keep their offsets.
      const f = m.items[0]!;
      dx = Math.round((f.x + dx) / GRID) * GRID - f.x;
      dy = Math.round((f.y + dy) / GRID) * GRID - f.y;
    }
    m.dx = dx;
    m.dy = dy;
    // While a window is over an area, the area says so.
    const wins = m.items.filter((i) => i.item.startsWith("w:"));
    this.dropArea = undefined;
    if (wins.length && !m.items.some((i) => i.item.startsWith("a:"))) {
      const r = this.winRect(wins[0]!.item.slice(2));
      if (r) this.dropArea = this.areaAt(r.x + r.w / 2, r.y + r.h / 2);
    }
    this.request();
  }

  /** The topmost area under a point. */
  private areaAt(x: number, y: number): string | undefined {
    let best: string | undefined;
    let z = Number.NEGATIVE_INFINITY;
    for (const [id, a] of Object.entries(this.doc.areas)) {
      const r = this.areaRect(id)!;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h && a.z > z) {
        best = id;
        z = a.z;
      }
    }
    return best;
  }

  /** The drag ended: one Op for everything it moved, membership decided by where each
   *  window's centre landed. */
  endMove(moved: boolean) {
    const m = this.moving;
    this.moving = undefined;
    this.dropArea = undefined;
    if (!m || !moved || (m.dx === 0 && m.dy === 0)) {
      this.request();
      this.afterGesture();
      return;
    }
    const ops: Op[] = [];
    const dx = Math.round(m.dx);
    const dy = Math.round(m.dy);
    for (const it of m.items) {
      const x = Math.round(it.x + dx);
      const y = Math.round(it.y + dy);
      if (it.item.startsWith("a:")) ops.push({ t: "areaPatch", id: it.item.slice(2), patch: { x, y } });
      else if (it.item.startsWith("n:")) ops.push({ t: "notePatch", id: it.item.slice(2), patch: { x, y } });
      else {
        const k = it.item.slice(2);
        const size = this.sizeOf(k);
        const target = this.areaAt(x + size.w / 2, y + size.h / 2);
        const prev = areaOf(this.doc, k);
        if (prev && prev !== target) ops.push({ t: "areaPatch", id: prev, patch: {}, members: { [k]: null } });
        if (target) {
          const a = this.doc.areas[target]!;
          ops.push({ t: "areaPatch", id: target, patch: {}, members: { [k]: { dx: x - a.x, dy: y - a.y } } });
        }
        ops.push({ t: "win", set: { [k]: { ...this.doc.windows[k], x, y } } });
      }
    }
    this.commit({ t: "batch", ops });
    this.afterGesture();
  }

  beginResize(item: string): boolean {
    if (!this.canArrange()) return false;
    let r: Rect | null = null;
    if (item.startsWith("w:")) {
      const k = item.slice(2);
      if (!this.isExpanded(k)) return false;
      r = this.winRect(k);
    } else if (item.startsWith("a:")) r = this.areaRect(item.slice(2));
    else if (item.startsWith("n:")) r = this.noteRect(item.slice(2));
    if (!r) return false;
    this.select(item, false);
    this.resizing = { item, w: r.w, h: r.h, dw: 0, dh: 0 };
    return true;
  }

  resizeBy(dw: number, dh: number, snap: boolean) {
    const z = this.resizing;
    if (!z) return;
    z.dw = snap ? Math.round((z.w + dw) / GRID) * GRID - z.w : dw;
    z.dh = snap ? Math.round((z.h + dh) / GRID) * GRID - z.h : dh;
    this.request();
  }

  endResize() {
    const z = this.resizing;
    if (!z) return;
    const id = z.item.slice(2);
    let r: Rect | null = null;
    if (z.item.startsWith("w:")) r = this.winRect(id);
    else if (z.item.startsWith("a:")) r = this.areaRect(id);
    else r = this.noteRect(id);
    this.resizing = undefined;
    if (!r || (z.dw === 0 && z.dh === 0)) {
      this.afterGesture();
      return;
    }
    const w = Math.round(r.w);
    const h = Math.round(r.h);
    if (z.item.startsWith("w:")) {
      const cur = this.doc.windows[id] ?? { ...this.minePos(id)!, expanded: true };
      this.commit({ t: "win", set: { [id]: { ...cur, w, h } } });
    } else if (z.item.startsWith("a:")) this.commit({ t: "areaPatch", id, patch: { w, h } });
    else this.commit({ t: "notePatch", id, patch: { w, h } });
    this.layoutSig = "";
    this.afterGesture();
  }

  marquee(r: Rect | null, draw: boolean, done: boolean) {
    const e = this.marqueeEl;
    if (!r || (done && !draw)) e.hidden = true;
    if (r) {
      e.hidden = done;
      setClass(e, "is-draw", draw);
      e.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`;
      e.style.width = `${r.w}px`;
      e.style.height = `${r.h}px`;
    }
    if (!r) return;
    if (draw) {
      if (!done) return;
      e.hidden = true;
      if (r.w < 40 || r.h < 40) return;
      // Windows whose centre is inside become members.
      const keys = [...this.wins.keys()].filter((k) => {
        const w = this.winRect(k)!;
        const cx = w.x + w.w / 2;
        const cy = w.y + w.h / 2;
        return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
      });
      this.newArea(undefined, r, keys);
      return;
    }
    const sel = new Set<string>();
    for (const k of this.wins.keys()) {
      const w = this.winRect(k);
      if (w && overlaps(w, r, 0)) sel.add(`w:${k}`);
    }
    for (const id of this.areaViews.keys()) {
      const a = this.areaRect(id);
      if (a && a.x >= r.x && a.y >= r.y && a.x + a.w <= r.x + r.w && a.y + a.h <= r.y + r.h) sel.add(`a:${id}`);
    }
    for (const id of this.noteViews.keys()) {
      const n = this.noteRect(id);
      if (n && overlaps(n, r, 0)) sel.add(`n:${id}`);
    }
    this.selection = sel;
    this.request();
  }

  presetDrag() {
    if (this.saidPreset) return;
    this.saidPreset = true;
    this.chrome.say("Arrange by hand in My layout");
  }

  activate(hit: Hit) {
    switch (hit.kind) {
      case "win":
        this.toggleExpand(hit.key);
        break;
      case "pill":
        this.openAgent(hit.id);
        break;
      case "area":
        if (this.canArrange()) void this.renameArea(hit.id);
        break;
      case "note":
        void this.editNote(hit.id);
        break;
    }
  }

  escape() {
    this.hideTip();
    if (this.selection.size) {
      this.selection.clear();
      this.request();
      return;
    }
    if (this.chrome.search.value || this.query) {
      this.chrome.search.value = "";
      this.setQuery("");
    }
  }

  pointerAt(sx: number, sy: number) {
    this.pointer = { x: sx, y: sy };
  }

  setGesture(on: boolean) {
    this.gesture = on;
    if (!on) this.afterGesture();
  }

  private afterGesture() {
    if (!this.gesture && this.editing === 0 && this.pendingRemote) this.adopt(this.pendingRemote.v);
  }

  busyTyping() {
    return this.editing > 0 || this.map.isEditing || this.map.hasPopover;
  }

  actions(): ViewShortcut[] {
    const viewKeys: ViewShortcut[] = VIEWS.map((v, i) => ({
      id: `view.${v.id}`,
      label: `View: ${v.label}`,
      keys: [String(i + 1)],
      run: () => this.setView(v.id),
    }));
    const labelKeys: ViewShortcut[] = LABEL_COLORS.map((c, i) => ({
      id: `label.${c}`,
      label: `Label the selection ${c}`,
      keys: [`mod+alt+${i + 1}`],
      run: () => this.setLabel(c),
    }));
    const at = () => this.toWorld(this.pointer.x, this.pointer.y);
    const nudge = (dx: number, dy: number) => () => this.nudge(dx, dy);
    return [
      ...viewKeys,
      { id: "fit", label: "Fit everything", keys: ["0"], run: () => this.fit() },
      { id: "zoom-in", label: "Zoom in", keys: ["mod+plus", "mod+=", "plus", "="], run: () => this.zoomStep(1) },
      { id: "zoom-out", label: "Zoom out", keys: ["mod+-", "-"], run: () => this.zoomStep(-1) },
      { id: "zoom-actual", label: "Actual size", keys: ["shift+0"], run: () => this.zoomTo(1) },
      { id: "tidy", label: "Tidy My layout", keys: ["shift+t"], run: () => this.tidy() },
      {
        id: "area",
        label: "New area at the pointer",
        keys: ["a"],
        run: () => this.newArea(at()),
        hint: "hold and drag to draw one",
      },
      { id: "note", label: "New note at the pointer", keys: ["n"], run: () => this.newNote(at()) },
      { id: "enter", label: "Expand, or edit the title or note", keys: ["enter"], run: () => this.enter() },
      {
        id: "delete",
        label: "Delete the area or note; hide windows",
        keys: ["backspace", "delete"],
        run: () => this.deleteSelection(),
      },
      { id: "undo", label: "Undo", keys: ["mod+z"], run: () => this.undo() },
      { id: "redo", label: "Redo", keys: ["shift+mod+z"], run: () => this.redo() },
      ...labelKeys,
      { id: "label.none", label: "Remove the selection's label", keys: ["mod+alt+0"], run: () => this.setLabel(null) },
      {
        id: "search",
        label: "Search the canvas",
        keys: ["/"],
        run: () => {
          this.chrome.bar.classList.add("is-search-open");
          this.chrome.search.focus();
          this.chrome.search.select();
        },
      },
      { id: "left", label: "Nudge left", keys: ["left"], run: nudge(-1, 0), hint: "My layout" },
      { id: "right", label: "Nudge right", keys: ["right"], run: nudge(1, 0) },
      { id: "up", label: "Nudge up", keys: ["up"], run: nudge(0, -1) },
      { id: "down", label: "Nudge down", keys: ["down"], run: nudge(0, 1) },
      { id: "left-grid", label: "Nudge left one grid step", keys: ["shift+left"], run: nudge(-GRID, 0) },
      { id: "right-grid", label: "Nudge right one grid step", keys: ["shift+right"], run: nudge(GRID, 0) },
      { id: "up-grid", label: "Nudge up one grid step", keys: ["shift+up"], run: nudge(0, -GRID) },
      { id: "down-grid", label: "Nudge down one grid step", keys: ["shift+down"], run: nudge(0, GRID) },
    ];
  }

  // ---------- the map ----------

  private mapHost(): MapHost {
    return {
      api: this.api,
      root: this.root,
      tethers: this.tethers,
      doc: () => this.doc.map,
      snapshot: () => this.snapshot,
      sessions: () =>
        [...this.wins.values()]
          .map((w) => w.session)
          .sort(
            (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || b.lastAt.localeCompare(a.lastAt),
          ),
      toScreen: (wx, wy) => this.toScreen(wx, wy),
      request: () => this.request(),
      commit: () => this.commitMap(),
      onStarted: (session, nodeId) => {
        this.pendingStart.set(session, nodeId);
        const machine = this.map.nodes.get(nodeId)?.label ?? "the machine";
        this.chrome.say(`Starting on ${machine}`);
      },
      narrow: () => this.phone,
    };
  }

  commitMap() {
    const set = JSON.parse(JSON.stringify(this.doc.map));
    exec(this.doc, { t: "map", set });
    this.write({ t: "map", set });
    this.relayout(false);
  }

  nodeRect(id: string) {
    return this.map.nodeRect(id);
  }

  moveNode(id: string, x: number, y: number) {
    this.map.moveNode(id, x, y);
    if (this.viewId === "map") {
      for (const [k, r] of this.map.rows) if (this.wins.has(k)) this.rects.set(k, r);
    }
  }

  beginLink(id: string) {
    this.map.beginLink(id);
  }

  moveLink(wx: number, wy: number) {
    this.map.moveLink(wx, wy);
  }

  endLink(target: string | null) {
    this.map.endLink(target);
  }

  beginGhost(chip: string, sx: number, sy: number) {
    this.map.beginGhost(chip, sx, sy);
  }

  moveGhost(sx: number, sy: number) {
    this.map.moveGhost(sx, sy);
  }

  endGhost(target: string | null) {
    this.map.endGhost(target);
  }

  selectNode(id: string | null) {
    this.map.select(id);
  }

  hover(id: string | null) {
    const pill = id?.startsWith("pill:") ? id.slice(5) : null;
    if (pill !== this.hoverPill) {
      this.hoverPill = pill;
      for (const [k, v] of this.wins) setClass(v.el, "is-tethered", !!pill && this.pills.get(pill)?.parent === k);
      this.request();
    }
    if (this.viewId === "map") this.map.setFocus(id?.startsWith("pill:") ? null : id);
  }
}

/** "label:red machine:build-box -label:none ship it" → tokens and the free text. */
function parseQuery(q: string): { tokens: { k: string; v: string; neg: boolean }[]; text: string } {
  const tokens: { k: string; v: string; neg: boolean }[] = [];
  const rest: string[] = [];
  for (const part of q.split(/\s+/).filter(Boolean)) {
    const m = /^(-?)(label|machine|harness|repo):(.+)$/.exec(part);
    if (m) tokens.push({ neg: m[1] === "-", k: m[2]!, v: m[3]! });
    else rest.push(part);
  }
  return { tokens, text: rest.join(" ") };
}

function place(e: HTMLElement, r: Rect) {
  const t = `translate3d(${r.x}px, ${r.y}px, 0)`;
  if (e.style.transform !== t) e.style.transform = t;
  const w = `${r.w}px`;
  const h = `${r.h}px`;
  if (e.style.width !== w) e.style.width = w;
  if (e.style.height !== h) e.style.height = h;
}

function listWords(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const theme: Theme = {
  mount(container, api) {
    const c = new Canvas(container, api);
    return () => c.destroy();
  },
};

export default theme;
