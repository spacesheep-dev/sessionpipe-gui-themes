// SPDX-License-Identifier: Apache-2.0
// The infrastructure around the sessions, as nodes in horizontal lanes top → bottom:
// devices (browsers looking at this GUI, passkeys the machines trust), a small hub for
// the GUI itself, agents (harness × account), then the session windows, machines, and
// the repos they work in. Lines: device → hub, account → the machines it runs on, live
// session → its machine and its repo. Hand-drawn nodes and links sit beside them.
// Everything here is positioned with transforms; the DOM is rebuilt only when the set
// of nodes changes, lines are redrawn when something moved.
import type { ThemeApi, ThemeSnapshot } from "@sessionpipe-gui/theme-types";
import type { SessionKey, SessionSummary } from "@sessionpipe-gui/theme-types/api";
import { bounds, findFree, type Rect } from "./layout";
import { type CustomNode, LANE_GAP, LANE_H, type Layout, type Link, NODE_GAP, NODE_H } from "./types";
import { el, oneLine, setClass, setText, svg } from "./util";

export type NodeKind = "device" | "hub" | "agent" | "machine" | "repo" | "custom";

export interface Chip {
  id: string;
  harness: string;
  accountId: string;
  label: string;
  /** Offset within the node, measured once. */
  x: number;
  w: number;
}

export interface MapNode {
  id: string;
  kind: NodeKind;
  /** 0 devices, 1 hub, 2 agents, 3 machines, 4 storage; -1 custom (free). */
  lane: number;
  label: string;
  sub?: string;
  chips?: Chip[];
  machine?: string;
  machineId?: string;
  online?: boolean;
  needs?: boolean;
  current?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  el: HTMLElement;
}

interface Edge {
  a: string;
  b: string;
  kind: "device" | "agent" | "session" | "custom";
  id?: string;
}

export interface MapHost {
  api: ThemeApi;
  root: HTMLElement;
  world: HTMLElement;
  tethers: SVGSVGElement;
  layout(): Layout;
  snapshot(): ThemeSnapshot;
  /** Live, visible, top-level session windows with their absolute rects. */
  liveWindows(): { session: SessionSummary; rect: Rect }[];
  toScreen(wx: number, wy: number): { x: number; y: number };
  request(): void;
  save(): void;
  /** A start was accepted: the session the host named will appear by that machine. */
  onStarted(session: SessionKey, machineNodeId: string): void;
  /** A phone: lanes wrap their nodes into rows instead of one long band. */
  narrow(): boolean;
  /** Everything that already occupies world space, for placing a new node. */
  taken(): Rect[];
}

export const LANES = ["devices", "", "agents", "machines", "storage"] as const;
const HUB_H = 28;
const MIN_LANE_W = 960;
const LANE_PAD = 80;

export class MapLayer {
  readonly lanesEl: HTMLElement;
  readonly nodesEl: HTMLElement;
  /** Hand-drawn nodes sit above the windows: they are annotations. */
  readonly customEl: HTMLElement;
  private edgesG: SVGGElement;
  private tempLine: SVGLineElement;
  private laneEls: HTMLElement[] = [];
  nodes = new Map<string, MapNode>();
  private edges: Edge[] = [];
  private sig = "";
  private focus: string | null = null;
  selected: string | null = null;
  private ghost: HTMLElement | undefined;
  private ghostChip: Chip | undefined;
  private pop: HTMLElement | undefined;
  private linkFrom: string | undefined;
  private laneRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private rows: { y: number; h: number }[] = [];
  private editing: string | undefined;

  constructor(private host: MapHost) {
    this.lanesEl = el("div", "cv-lanes");
    this.nodesEl = el("div", "cv-nodes");
    this.customEl = el("div", "cv-nodes cv-nodes-custom");
    this.edgesG = svg("g", { class: "cv-edges" });
    this.tempLine = svg("line", { class: "cv-edge cv-edge-custom is-temp" });
    this.tempLine.style.display = "none";
    host.tethers.append(this.edgesG, this.tempLine);
    for (const name of LANES) {
      const lane = el("div", "cv-lane");
      lane.dataset.lane = name;
      lane.append(el("span", "cv-lane-l", name));
      this.lanesEl.append(lane);
      this.laneEls.push(lane);
    }
    this.lanesEl.hidden = true;
    this.nodesEl.hidden = true;
    this.customEl.hidden = true;
  }

  setOn(on: boolean) {
    this.lanesEl.hidden = !on;
    this.nodesEl.hidden = !on;
    this.customEl.hidden = !on;
    if (on) this.sig = "";
    if (!on) {
      this.edgesG.replaceChildren();
      this.lineEls.clear();
      this.closePopover();
      this.setFocus(null);
    }
  }

  // ---------- nodes from the snapshot ----------

  /** Rebuild the node set when it changed; always returns whether a redraw is due. */
  build(): boolean {
    const s = this.host.snapshot();
    const lay = this.host.layout();
    const want: Omit<MapNode, "x" | "y" | "w" | "h" | "el">[] = [];

    // Devices: every browser on the stream, then the passkeys machines trust.
    for (const v of s.viewers) {
      want.push({
        id: `dev:${v.id}`,
        kind: "device",
        lane: 0,
        label: v.label || v.device,
        sub: v.current ? "you" : v.loopback ? "this machine" : [v.device, v.ip].filter(Boolean).join(" · "),
        current: v.current,
      });
    }
    const keys = new Map<string, string[]>();
    for (const m of s.machines.values()) {
      for (const k of m.control?.keys ?? []) {
        const name = k.name?.trim();
        if (!name) continue;
        const list = keys.get(name) ?? [];
        list.push(m.name);
        keys.set(name, list);
      }
    }
    for (const [name, machines] of keys) {
      if ([...s.viewers].some((v) => v.label === name)) continue;
      want.push({
        id: `dev:key:${name}`,
        kind: "device",
        lane: 0,
        label: name,
        sub: `passkey · ${machines.join(", ")}`,
      });
    }
    want.push({ id: "hub", kind: "hub", lane: 1, label: this.host.api.host.name, sub: this.host.api.host.version });

    // Agents: one group per harness with a chip per account seen in its sessions.
    const emails = new Map<string, string>();
    for (const m of s.machines.values()) {
      for (const a of m.control?.accounts ?? []) if (a.email) emails.set(`${a.harness}:${a.id}`, a.email);
    }
    const groups = new Map<string, Map<string, Chip>>();
    for (const sess of s.sessions.values()) {
      if (sess.parentId) continue;
      const g = groups.get(sess.harness) ?? new Map<string, Chip>();
      groups.set(sess.harness, g);
      if (sess.accountId && !g.has(sess.accountId)) {
        const id = `acct:${sess.harness}:${sess.accountId}`;
        g.set(sess.accountId, {
          id,
          harness: sess.harness,
          accountId: sess.accountId,
          label: emails.get(`${sess.harness}:${sess.accountId}`) ?? sess.accountId.slice(0, 8),
          x: 0,
          w: 0,
        });
      }
    }
    for (const [harness, chips] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      want.push({
        id: `agent:${harness}`,
        kind: "agent",
        lane: 2,
        label: harnessShort(harness),
        chips: [...chips.values()],
      });
    }

    // Machines.
    for (const m of [...s.machines.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const c = m.control;
      const versions = Object.entries(m.harnesses)
        .filter(([, v]) => v)
        .map(([h, v]) => `${this.host.api.format.monogram(h)} ${v}`)
        .join(" · ");
      const sub = c ? (c.online ? versions || "online" : "offline") : "not paired";
      want.push({
        id: `machine:${m.name}`,
        kind: "machine",
        lane: 3,
        label: m.name,
        sub,
        machine: m.name,
        machineId: c?.machineId,
        online: !!c?.online,
        needs: m.needsYou > 0,
      });
    }

    // Storage: one node per repo.
    const repos = new Map<string, string>();
    for (const sess of s.sessions.values()) {
      if (!sess.repo) continue;
      const { short, host } = repoParts(sess.repo);
      repos.set(short, host);
    }
    for (const [short, host] of [...repos].sort((a, b) => a[0].localeCompare(b[0]))) {
      want.push({ id: `repo:${short}`, kind: "repo", lane: 4, label: short, sub: host });
    }

    // Hand-drawn.
    for (const c of Object.values(lay.custom ?? {})) {
      want.push({ id: c.id, kind: "custom", lane: -1, label: c.label });
    }

    const sig = want
      .map((n) =>
        [n.id, n.label, n.sub, n.online, n.needs, n.current, n.chips?.map((c) => c.label).join("|")].join("\u0002"),
      )
      .join("\u0001");
    // Widths come from the DOM, so a build while the layer is hidden must run again
    // once it shows (setOn clears the signature).
    const hidden = this.nodesEl.hidden;
    const changed = sig !== this.sig;
    if (changed) {
      this.sig = hidden ? "" : sig;
      const seen = new Set<string>();
      for (const n of want) {
        seen.add(n.id);
        let node = this.nodes.get(n.id);
        if (!node) {
          const e = this.nodeEl(n);
          (n.kind === "custom" ? this.customEl : this.nodesEl).append(e);
          node = { ...n, x: 0, y: 0, w: 0, h: NODE_H, el: e };
          this.nodes.set(n.id, node);
        } else {
          Object.assign(node, n);
          this.fillNode(node);
        }
        node.w = node.el.offsetWidth || node.w;
        node.h = node.el.offsetHeight || NODE_H;
        for (const c of node.chips ?? []) {
          const ce = node.el.querySelector(`[data-chip="${CSS.escape(c.id)}"]`) as HTMLElement | null;
          if (ce) {
            c.x = ce.offsetLeft;
            c.w = ce.offsetWidth;
          }
        }
      }
      for (const [id, node] of this.nodes) {
        if (!seen.has(id)) {
          node.el.remove();
          this.nodes.delete(id);
          if (this.selected === id) this.selected = null;
        }
      }
    }
    this.edges = this.computeEdges();
    return changed;
  }

  private nodeEl(n: Omit<MapNode, "x" | "y" | "w" | "h" | "el">): HTMLElement {
    const e = el("div", `cv-node cv-node-${n.kind}`);
    e.dataset.id = n.id;
    e.dataset.kind = n.kind;
    e.tabIndex = 0;
    const node = { ...n, x: 0, y: 0, w: 0, h: NODE_H, el: e };
    this.fillNode(node);
    return e;
  }

  private fillNode(n: MapNode) {
    const e = n.el;
    e.replaceChildren();
    if (n.kind === "machine") {
      const dot = el("span", "cv-node-dot");
      setClass(dot, "is-on", !!n.online);
      e.append(dot);
    }
    if (n.kind === "custom") {
      const l = el("span", "cv-node-l cv-node-edit", n.label);
      l.spellcheck = false;
      e.append(l);
    } else {
      e.append(el("span", "cv-node-l", n.label));
    }
    if (n.sub) e.append(el("span", "cv-node-s", n.sub));
    if (n.needs) {
      const nd = el("span", "cv-node-needs");
      nd.title = "A session here needs you";
      e.append(nd);
    }
    for (const c of n.chips ?? []) {
      const chip = el("span", "cv-chip-a", c.label);
      chip.dataset.chip = c.id;
      chip.dataset.harness = c.harness;
      chip.dataset.account = c.accountId;
      chip.title = `${c.label} · drag onto a machine to start a session`;
      e.append(chip);
    }
    const h = el("span", "cv-node-h");
    h.title = "Drag to another node to link";
    e.append(h);
    setClass(e, "is-current", !!n.current);
    setClass(e, "is-off", n.kind === "machine" && !n.online);
    setClass(e, "is-selected", this.selected === n.id);
  }

  // ---------- geometry ----------

  /** Lane rows from the anchors; nodes get their stored x or the next free slot. */
  layoutNodes(): void {
    const lay = this.host.layout();
    const wins = this.host.liveWindows();
    const b = bounds(wins.map((w) => w.rect)) ?? { x: -300, y: -120, w: 600, h: 240 };
    if (!lay.lanes) lay.lanes = this.defaultLanes(b);
    const { top, bottom } = lay.lanes;
    const agentsY = top - LANE_H;
    const hubY = agentsY - LANE_GAP - HUB_H;
    const devicesY = hubY - LANE_GAP - LANE_H;
    this.rows = [
      { y: devicesY, h: LANE_H },
      { y: hubY, h: HUB_H },
      { y: agentsY, h: LANE_H },
      { y: bottom, h: LANE_H },
      { y: bottom + LANE_H + LANE_GAP, h: LANE_H },
    ];
    lay.nodes ??= {};
    if (this.host.narrow()) {
      this.wrapNodes(b, lay);
      return;
    }
    const x0 = Math.min(b.x, ...Object.values(lay.nodes).map((n) => n.x));
    // Stored x first; new nodes take the next slot in their lane, and remember it.
    const nextX: number[] = this.rows.map(() => x0);
    for (const n of this.nodes.values()) {
      if (n.kind === "custom") continue;
      const st = lay.nodes[n.id];
      if (st) nextX[n.lane] = Math.max(nextX[n.lane]!, st.x + n.w + NODE_GAP);
    }
    for (const n of this.nodes.values()) {
      if (n.kind === "custom") {
        const c = lay.custom?.[n.id];
        if (c) {
          n.x = c.x;
          n.y = c.y;
        }
        continue;
      }
      let st = lay.nodes[n.id];
      if (!st) {
        st = { x: nextX[n.lane]! };
        lay.nodes[n.id] = st;
        nextX[n.lane] = st.x + n.w + NODE_GAP;
        this.host.save();
      }
      const row = this.rows[n.lane]!;
      n.x = st.x;
      n.y = row.y + (row.h - n.h) / 2;
    }
    // The bands span everything, with room on both sides.
    let x1 = b.x + b.w;
    let xMin = x0;
    for (const n of this.nodes.values()) {
      if (n.kind === "custom") continue;
      xMin = Math.min(xMin, n.x);
      x1 = Math.max(x1, n.x + n.w);
    }
    const w = Math.max(MIN_LANE_W, x1 - xMin + LANE_PAD * 2);
    this.laneRect = { x: xMin - LANE_PAD, y: devicesY, w, h: this.rows[4]!.y + LANE_H - devicesY };
  }

  /** Phones: each lane is as wide as the column and its nodes wrap into rows, so the
   *  lanes stack top → bottom and read at the column's zoom. Stored x is ignored. */
  private wrapNodes(b: Rect, lay: Layout) {
    const W = Math.max(b.w, 360);
    const PAD = 12;
    const ROW = NODE_H + 8;
    const laneH = (lane: number) => {
      let x = PAD;
      let rows = 1;
      for (const n of this.nodes.values()) {
        if (n.lane !== lane) continue;
        if (x > PAD && x + n.w > W - PAD) {
          x = PAD;
          rows++;
        }
        x += n.w + NODE_GAP;
      }
      return rows * ROW + 20;
    };
    const { top, bottom } = lay.lanes!;
    const hA = laneH(2);
    const hH = HUB_H + 12;
    const hD = laneH(0);
    const agentsY = top - hA;
    const hubY = agentsY - LANE_GAP + 16 - hH;
    const devicesY = hubY - LANE_GAP + 16 - hD;
    this.rows = [
      { y: devicesY, h: hD },
      { y: hubY, h: hH },
      { y: agentsY, h: hA },
      { y: bottom, h: laneH(3) },
      { y: bottom + laneH(3) + LANE_GAP - 16, h: laneH(4) },
    ];
    const cursor = this.rows.map((r) => ({ x: PAD, y: r.y + 20 }));
    for (const n of this.nodes.values()) {
      if (n.kind === "custom") {
        const c = lay.custom?.[n.id];
        if (c) {
          n.x = c.x;
          n.y = c.y;
        }
        continue;
      }
      const cur = cursor[n.lane]!;
      if (cur.x > PAD && cur.x + n.w > W - PAD) {
        cur.x = PAD;
        cur.y += ROW;
      }
      n.x = b.x + cur.x;
      n.y = cur.y;
      cur.x += n.w + NODE_GAP;
    }
    const last = this.rows[4]!;
    this.laneRect = { x: b.x, y: this.rows[0]!.y, w: W, h: last.y + last.h - this.rows[0]!.y };
  }

  private defaultLanes(b: Rect): { top: number; bottom: number } {
    return { top: b.y - LANE_GAP - 8, bottom: b.y + b.h + LANE_GAP + 8 };
  }

  /** Tidy: lanes hug the windows again and the nodes pack from the left. */
  relayout() {
    const lay = this.host.layout();
    const b = bounds(this.host.liveWindows().map((w) => w.rect));
    lay.lanes = this.defaultLanes(b ?? { x: -300, y: -120, w: 600, h: 240 });
    lay.nodes = {};
    this.layoutNodes();
  }

  nodeRect(id: string): Rect | null {
    const n = this.nodes.get(id);
    return n ? { x: n.x, y: n.y, w: n.w, h: n.h } : null;
  }

  private chipRect(chipId: string): Rect | null {
    for (const n of this.nodes.values()) {
      const c = n.chips?.find((c) => c.id === chipId);
      if (c) return { x: n.x + c.x, y: n.y, w: c.w, h: n.h };
    }
    return null;
  }

  /** Any endpoint: a node, an account chip, or a session window. */
  private endRect(id: string): Rect | null {
    if (id.startsWith("win:")) {
      const key = id.slice(4);
      return this.host.liveWindows().find((w) => w.session.key === key)?.rect ?? null;
    }
    if (id.startsWith("acct:")) return this.chipRect(id);
    return this.nodeRect(id);
  }

  moveNode(id: string, x: number, y: number) {
    const n = this.nodes.get(id);
    if (!n) return;
    const lay = this.host.layout();
    if (n.kind === "custom") {
      const c = lay.custom?.[id];
      if (c) {
        c.x = x;
        c.y = y;
      }
      n.x = x;
      n.y = y;
    } else {
      lay.nodes ??= {};
      lay.nodes[id] = { x };
      n.x = x;
    }
  }

  // ---------- edges ----------

  private computeEdges(): Edge[] {
    const s = this.host.snapshot();
    const lay = this.host.layout();
    const edges: Edge[] = [];
    for (const n of this.nodes.values()) if (n.kind === "device") edges.push({ a: n.id, b: "hub", kind: "device" });
    const acctMachine = new Set<string>();
    for (const sess of s.sessions.values()) {
      if (sess.parentId || !sess.machine) continue;
      const from = sess.accountId ? `acct:${sess.harness}:${sess.accountId}` : `agent:${sess.harness}`;
      const key = `${from}→machine:${sess.machine}`;
      if (!acctMachine.has(key) && this.nodes.has(`machine:${sess.machine}`)) {
        acctMachine.add(key);
        edges.push({ a: from, b: `machine:${sess.machine}`, kind: "agent" });
      }
    }
    for (const { session } of this.host.liveWindows()) {
      if (session.machine && this.nodes.has(`machine:${session.machine}`)) {
        edges.push({ a: `win:${session.key}`, b: `machine:${session.machine}`, kind: "session" });
      }
      if (session.repo) {
        const id = `repo:${repoParts(session.repo).short}`;
        if (this.nodes.has(id)) edges.push({ a: `win:${session.key}`, b: id, kind: "session" });
      }
    }
    for (const l of lay.links ?? []) edges.push({ a: l.from, b: l.to, kind: "custom", id: l.id });
    return edges;
  }

  /** Lines and lanes from the current rects. Called from the frame when anything moved. */
  draw() {
    if (this.lanesEl.hidden) return;
    for (let i = 0; i < LANES.length; i++) {
      const lane = this.laneEls[i]!;
      const row = this.rows[i]!;
      lane.style.transform = `translate3d(${this.laneRect.x}px, ${row.y}px, 0)`;
      lane.style.width = `${this.laneRect.w}px`;
      lane.style.height = `${row.h}px`;
    }
    for (const n of this.nodes.values()) n.el.style.transform = `translate3d(${n.x}px, ${n.y}px, 0)`;

    // One <line> per edge, kept across frames: attributes change only when an end moved.
    const seen = new Set<string>();
    let changed = false;
    for (const e of this.edges) {
      const a = this.endRect(e.a);
      const b = this.endRect(e.b);
      if (!a || !b) continue;
      // Lane edges leave a node's bottom and enter the next one's top; hand-drawn
      // links go centre to centre, which the nodes cover at both ends.
      const down = a.y + a.h <= b.y;
      const up = b.y + b.h <= a.y;
      const x1 = a.x + a.w / 2;
      const y1 = e.kind === "custom" ? a.y + a.h / 2 : down ? a.y + a.h : up ? a.y : a.y + a.h / 2;
      const x2 = b.x + b.w / 2;
      const y2 = e.kind === "custom" ? b.y + b.h / 2 : down ? b.y : up ? b.y + b.h : b.y + b.h / 2;
      const key = `${e.a}|${e.b}`;
      seen.add(key);
      let rec = this.lineEls.get(key);
      if (!rec) {
        const line = svg("line", { class: `cv-edge cv-edge-${e.kind}`, "data-a": e.a, "data-b": e.b });
        let hit: SVGLineElement | undefined;
        if (e.kind === "custom" && e.id) {
          line.dataset.link = e.id;
          hit = svg("line", { class: "cv-edge-hit", "data-a": e.a, "data-b": e.b });
          hit.dataset.link = e.id;
        }
        rec = { line, hit, coords: "" };
        this.lineEls.set(key, rec);
        this.edgesG.append(line);
        if (hit) this.edgesG.append(hit);
        changed = true;
      }
      const coords = `${x1},${y1},${x2},${y2}`;
      if (rec.coords !== coords) {
        rec.coords = coords;
        for (const el of [rec.line, rec.hit]) {
          if (!el) continue;
          el.setAttribute("x1", `${x1}`);
          el.setAttribute("y1", `${y1}`);
          el.setAttribute("x2", `${x2}`);
          el.setAttribute("y2", `${y2}`);
        }
      }
      if (e.kind === "custom") setClass(rec.line, "is-selected", this.selected === e.id);
    }
    for (const [key, rec] of this.lineEls) {
      if (seen.has(key)) continue;
      rec.line.remove();
      rec.hit?.remove();
      this.lineEls.delete(key);
      changed = true;
    }
    if (changed && this.focus) this.applyFocus();
  }
  private lineEls = new Map<string, { line: SVGLineElement; hit?: SVGLineElement; coords: string }>();

  // ---------- hover focus ----------

  setFocus(id: string | null) {
    if (id === this.focus) return;
    this.focus = id;
    setClass(this.host.root, "is-focus", !!id);
    this.applyFocus();
  }

  private applyFocus() {
    const id = this.focus;
    const lit = new Set<string>();
    if (id) {
      lit.add(id);
      for (const e of this.edges) {
        const hitA =
          e.a === id || e.a.startsWith(`${id}`) || (id.startsWith("agent:") && e.a.startsWith(`acct:${id.slice(6)}:`));
        const hitB = e.b === id;
        if (hitA || hitB) {
          lit.add(e.a);
          lit.add(e.b);
          if (e.a.startsWith("acct:")) lit.add(`agent:${e.a.split(":")[1]}`);
        }
      }
    }
    for (const line of this.edgesG.children) {
      const a = (line as SVGElement).dataset.a!;
      const b = (line as SVGElement).dataset.b!;
      const on = !!id && lit.has(a) && lit.has(b) && (a === id || b === id || a.startsWith("acct:") || lit.has(id));
      setClass(
        line,
        "is-lit",
        on && (a === id || b === id || (id.startsWith("agent:") && a.startsWith(`acct:${id.slice(6)}:`))),
      );
    }
    for (const n of this.nodes.values()) setClass(n.el, "is-lit", lit.has(n.id));
    for (const w of this.host.root.querySelectorAll<HTMLElement>(".cv-win")) {
      setClass(w, "is-lit", lit.has(`win:${w.dataset.key}`));
    }
  }

  // ---------- hand-drawn nodes and links ----------

  addCustom(x: number, y: number): string {
    const lay = this.host.layout();
    lay.custom ??= {};
    const id = `c_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    const spot = findFree({ x, y }, 140, NODE_H, this.host.taken(), 24);
    lay.custom[id] = { id, label: "", x: spot.x, y: spot.y };
    this.build();
    this.layoutNodes();
    this.draw();
    this.select(id);
    this.edit(id);
    return id;
  }

  /** Inline edit of a custom node's label; an empty label on commit deletes it. */
  edit(id: string) {
    const n = this.nodes.get(id);
    if (n?.kind !== "custom") return;
    const l = n.el.querySelector(".cv-node-edit") as HTMLElement;
    this.editing = id;
    l.contentEditable = "true";
    n.el.classList.add("is-editing");
    l.focus();
    const range = document.createRange();
    range.selectNodeContents(l);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    const commit = () => {
      l.removeEventListener("blur", commit);
      l.removeEventListener("keydown", onKey);
      l.contentEditable = "false";
      n.el.classList.remove("is-editing");
      this.editing = undefined;
      const label = oneLine(l.textContent ?? "", 60);
      const lay = this.host.layout();
      if (!label) {
        delete lay.custom?.[id];
        lay.links = (lay.links ?? []).filter((k) => k.from !== id && k.to !== id);
        if (this.selected === id) this.selected = null;
      } else if (lay.custom?.[id]) {
        lay.custom[id].label = label;
      }
      this.build();
      this.layoutNodes();
      this.draw();
      this.host.save();
      this.host.request();
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        l.blur();
      }
    };
    l.addEventListener("blur", commit);
    l.addEventListener("keydown", onKey);
  }

  get isEditing() {
    return !!this.editing;
  }

  select(id: string | null) {
    if (this.selected === id) return;
    this.selected = id;
    for (const n of this.nodes.values()) setClass(n.el, "is-selected", n.id === id);
    this.draw();
  }

  /** Backspace: a hand-drawn node (with its links) or a hand-drawn link. */
  deleteSelected(): boolean {
    const id = this.selected;
    if (!id) return false;
    const lay = this.host.layout();
    if (lay.custom?.[id]) {
      delete lay.custom[id];
      lay.links = (lay.links ?? []).filter((k) => k.from !== id && k.to !== id);
    } else if (lay.links?.some((k) => k.id === id)) {
      lay.links = lay.links.filter((k) => k.id !== id);
    } else {
      return false;
    }
    this.selected = null;
    this.build();
    this.layoutNodes();
    this.draw();
    this.host.save();
    this.host.request();
    return true;
  }

  beginLink(from: string) {
    this.linkFrom = from;
    const r = this.endRect(from);
    if (!r) return;
    this.tempLine.setAttribute("x1", `${r.x + r.w / 2}`);
    this.tempLine.setAttribute("y1", `${r.y + r.h / 2}`);
    this.tempLine.setAttribute("x2", `${r.x + r.w / 2}`);
    this.tempLine.setAttribute("y2", `${r.y + r.h / 2}`);
    this.tempLine.style.display = "";
    this.host.root.classList.add("is-linking");
  }

  moveLink(wx: number, wy: number) {
    this.tempLine.setAttribute("x2", `${wx}`);
    this.tempLine.setAttribute("y2", `${wy}`);
  }

  endLink(to: string | null) {
    const from = this.linkFrom;
    this.linkFrom = undefined;
    this.tempLine.style.display = "none";
    this.host.root.classList.remove("is-linking");
    if (!from || !to || to === from) return;
    const lay = this.host.layout();
    lay.links ??= [];
    if (lay.links.some((k) => (k.from === from && k.to === to) || (k.from === to && k.to === from))) return;
    const link: Link = { id: `l_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, from, to };
    lay.links.push(link);
    this.edges = this.computeEdges();
    this.select(link.id);
    this.host.save();
    this.host.request();
  }

  // ---------- an agent dragged onto a machine ----------

  beginGhost(chipId: string, sx: number, sy: number) {
    let chip: Chip | undefined;
    for (const n of this.nodes.values()) chip = chip ?? n.chips?.find((c) => c.id === chipId);
    if (!chip) return;
    this.ghostChip = chip;
    this.ghost = el("div", "cv-ghost", chip.label);
    this.host.root.append(this.ghost);
    this.moveGhost(sx, sy);
    this.host.root.classList.add("is-ghosting");
  }

  moveGhost(sx: number, sy: number) {
    if (this.ghost) this.ghost.style.transform = `translate3d(${sx + 12}px, ${sy - 14}px, 0)`;
  }

  endGhost(targetId: string | null) {
    const chip = this.ghostChip;
    this.ghost?.remove();
    this.ghost = undefined;
    this.ghostChip = undefined;
    this.host.root.classList.remove("is-ghosting");
    const target = targetId ? this.nodes.get(targetId) : undefined;
    if (!chip || !target || target.kind !== "machine") return;
    this.openPopover(target, chip);
  }

  /** The small start form under a machine node. */
  openPopover(machine: MapNode, chip: Chip) {
    this.closePopover();
    const api = this.host.api;
    const pop = el("div", "cv-pop");
    pop.dataset.machine = machine.id;
    const m = this.host.snapshot().machines.get(machine.machine ?? "");
    const av =
      api.control && machine.machineId
        ? api.control.availability({ machineId: machine.machineId })
        : { ok: false, reason: "control is not available" };
    pop.append(el("div", "cv-pop-t", `Start ${harnessShort(chip.harness)} on ${machine.label}`));
    pop.append(el("div", "cv-pop-s", chip.label));
    const folders = m?.control?.folders ?? [];
    const sel = el("select", "cv-pop-folder");
    sel.setAttribute("aria-label", "Folder");
    for (const f of folders) {
      const o = el("option", undefined, f);
      o.value = f;
      sel.append(o);
    }
    if (!folders.length) {
      const o = el("option", undefined, "no folders allowed");
      o.value = "";
      sel.append(o);
    }
    const input = el("input", "cv-pop-text");
    input.type = "text";
    input.placeholder = "First message";
    input.setAttribute("aria-label", "First message");
    const row = el("div", "cv-pop-row");
    const start = el("button", "cv-pop-start", "Start");
    start.type = "button";
    const cancel = el("button", "cv-pop-cancel", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => this.closePopover());
    const reason = el("div", "cv-pop-reason", av.ok ? "" : (av.reason ?? ""));
    reason.hidden = av.ok;
    const ready = () => av.ok && !!sel.value && !!input.value.trim();
    const sync = () => {
      start.disabled = !ready();
    };
    input.addEventListener("input", sync);
    sel.addEventListener("change", sync);
    const go = async () => {
      if (!ready() || !api.control || !machine.machineId) return;
      start.disabled = true;
      setText(reason, "sending…");
      reason.hidden = false;
      try {
        const a = await api.control.start(machine.machineId, {
          harness: chip.harness,
          cwd: sel.value,
          text: input.value.trim(),
        });
        this.host.onStarted(a.session, machine.id);
        this.closePopover();
      } catch (e) {
        setText(reason, e instanceof Error ? e.message : String(e));
        reason.classList.add("is-err");
        start.disabled = false;
      }
    };
    start.addEventListener("click", () => void go());
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") void go();
      if (e.key === "Escape") this.closePopover();
    });
    sel.addEventListener("keydown", (e) => e.stopPropagation());
    row.append(start, cancel);
    pop.append(sel, input, row, reason);
    this.host.root.append(pop);
    const p = this.host.toScreen(machine.x, machine.y + machine.h);
    const rw = pop.offsetWidth;
    const rh = pop.offsetHeight;
    const rootW = this.host.root.clientWidth;
    const rootH = this.host.root.clientHeight;
    const x = Math.max(8, Math.min(rootW - rw - 8, p.x));
    const y = p.y + 8 + rh > rootH - 8 ? Math.max(8, p.y - rh - machine.h * 1 - 8) : p.y + 8;
    pop.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    this.pop = pop;
    sync();
    if (av.ok) input.focus();
  }

  closePopover() {
    this.pop?.remove();
    this.pop = undefined;
  }

  get hasPopover() {
    return !!this.pop;
  }

  destroy() {
    this.closePopover();
    this.ghost?.remove();
    this.lanesEl.remove();
    this.nodesEl.remove();
    this.customEl.remove();
    this.edgesG.remove();
    this.tempLine.remove();
  }
}

export function harnessShort(h: string): string {
  return h.replace(/-code$|-cli$/, "");
}

export function repoParts(repo: string): { short: string; host: string } {
  const noScheme = repo.replace(/^[a-z]+:\/\//i, "").replace(/\.git$/, "");
  const parts = noScheme.split("/").filter(Boolean);
  if (parts.length >= 3) return { short: parts.slice(-2).join("/"), host: parts[0]! };
  return { short: noScheme, host: "" };
}

export type { CustomNode };
