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
import { type CustomNode, LANE_GAP, type Layout, type Link, NODE_GAP, NODE_H } from "./types";
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
  strength?: "needs" | "working" | "stale" | "idle";
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
  /** The session's state, for coloured highlights. */
  state?: string;
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
/** How far outside a lane its bus runs. */
const BUS_GAP = 14;
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
      this.trunkEls.clear();
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
      // The dot takes the strongest state of the machine's sessions.
      let strength: "needs" | "working" | "stale" | "idle" = "idle";
      for (const sess of s.sessions.values()) {
        if (sess.machine !== m.name || sess.parentId) continue;
        if (sess.state === "needs_you") strength = "needs";
        else if (sess.state === "working" && strength !== "needs") strength = "working";
        else if (sess.state === "stale" && strength === "idle") strength = "stale";
      }
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
        strength,
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

    // Hand-drawn. A node left without a label (an edit the page never finished) goes.
    for (const c of Object.values(lay.custom ?? {})) {
      if (!c.label?.trim() && c.id !== this.editing) {
        delete lay.custom![c.id];
        lay.links = (lay.links ?? []).filter((k) => k.from !== c.id && k.to !== c.id);
        continue;
      }
      want.push({ id: c.id, kind: "custom", lane: -1, label: c.label });
    }
    // Positions of nodes that are gone (a viewer that reconnected has a new id).
    if (lay.nodes) {
      const ids = new Set(want.map((n) => n.id));
      for (const id of Object.keys(lay.nodes)) if (!ids.has(id)) delete lay.nodes[id];
    }

    // Chips in the order of the windows they connect to, so lines don't cross.
    const wins = this.host.liveWindows();
    const cx = (sess: SessionSummary) => {
      const w = wins.find((x) => x.session.key === sess.key);
      return w ? w.rect.x + w.rect.w / 2 : undefined;
    };
    for (const n of want) {
      if (!n.chips?.length) continue;
      const bary = new Map<string, number>();
      for (const c of n.chips) {
        const xs: number[] = [];
        for (const sess of s.sessions.values()) {
          if (sess.parentId || sess.harness !== c.harness || sess.accountId !== c.accountId) continue;
          const x = cx(sess);
          if (x !== undefined) xs.push(x);
        }
        bary.set(c.id, xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.POSITIVE_INFINITY);
      }
      n.chips.sort((a, b) => bary.get(a.id)! - bary.get(b.id)!);
    }
    const sig = want
      .map((n) =>
        [n.id, n.label, n.sub, n.online, n.needs, n.current, n.strength, n.chips?.map((c) => c.label).join("|")].join(
          "\u0002",
        ),
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
      dot.dataset.s = n.strength ?? "idle";
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

  /** Lanes are as wide as the sessions (at least MIN_LANE_W) and their nodes pack into
   *  rows inside that width, so nothing can leave its lane: a node keeps the x it was
   *  dragged to while it fits on its row, and wraps when it does not. Positions are
   *  relative to the lane's left edge (`lanes.x`); a stored x outside the lane is dropped. */
  layoutNodes(): void {
    const lay = this.host.layout();
    const wins = this.host.liveWindows();
    const b = bounds(wins.map((w) => w.rect)) ?? { x: -300, y: -120, w: 600, h: 240 };
    if (!lay.lanes || lay.lanes.x === undefined) lay.lanes = this.defaultLanes(b);
    lay.nodes ??= {};
    const narrow = this.host.narrow();
    const W = narrow ? Math.max(b.w, 360) : Math.max(MIN_LANE_W, b.w + LANE_PAD * 2);
    const PAD = 12;
    const ROW = NODE_H + 8;
    const laneX = lay.lanes.x;

    // Pack each lane: stored positions first, in x order, each kept where it fits.
    const placed = new Map<string, { x: number; row: number }>();
    const rowsOf: number[] = [];
    for (let lane = 0; lane < LANES.length; lane++) {
      const members = [...this.nodes.values()].filter((n) => n.lane === lane);
      const stored = (n: MapNode) => {
        const st = lay.nodes?.[n.id];
        if (!st || !Number.isFinite(st.x) || st.x < 0 || st.x + n.w > W - PAD) return undefined;
        return st.x;
      };
      const bary = new Map(members.map((n) => [n.id, this.barycenter(n.id)]));
      members.sort((p, q) => {
        const a = stored(p);
        const c = stored(q);
        if (a === undefined && c === undefined)
          return bary.get(p.id)! - bary.get(q.id)! || p.label.localeCompare(q.label);
        if (a === undefined) return 1;
        if (c === undefined) return -1;
        return a - c;
      });
      let cursor = PAD;
      let row = 0;
      for (const n of members) {
        const want = stored(n);
        // Kept where it was dragged when that is further along the row and fits; else
        // the next slot; a full row wraps and the node starts the next one.
        let x = want !== undefined && want >= cursor && want + n.w <= W - PAD ? want : cursor;
        if (x + n.w > W - PAD && cursor > PAD) {
          row++;
          cursor = PAD;
          x = PAD;
        }
        placed.set(n.id, { x, row });
        if (want === undefined || want !== x) lay.nodes[n.id] = { x };
        cursor = x + n.w + NODE_GAP;
      }
      rowsOf[lane] = row + 1;
    }
    const laneH = (lane: number) => (lane === 1 ? HUB_H + 12 : rowsOf[lane]! * ROW + 20);
    const { top, bottom } = lay.lanes;
    const gap = narrow ? LANE_GAP - 16 : LANE_GAP;
    const agentsY = top - laneH(2);
    const hubY = agentsY - gap - laneH(1);
    const devicesY = hubY - gap - laneH(0);
    this.rows = [
      { y: devicesY, h: laneH(0) },
      { y: hubY, h: laneH(1) },
      { y: agentsY, h: laneH(2) },
      { y: bottom, h: laneH(3) },
      { y: bottom + laneH(3) + gap, h: laneH(4) },
    ];
    for (const n of this.nodes.values()) {
      if (n.kind === "custom") {
        const c = lay.custom?.[n.id];
        if (c) {
          n.x = c.x;
          n.y = c.y;
        }
        continue;
      }
      const p = placed.get(n.id);
      if (!p) continue;
      const row = this.rows[n.lane]!;
      n.x = laneX + p.x;
      n.y = row.y + (n.lane === 1 ? (row.h - n.h) / 2 : 10 + p.row * ROW);
    }
    const last = this.rows[4]!;
    this.laneRect = { x: laneX, y: devicesY, w: W, h: last.y + last.h - devicesY };
  }

  /** Where the lanes are, for Fit. */
  laneBounds(): Rect | null {
    return this.lanesEl.hidden ? null : this.laneRect;
  }

  private defaultLanes(b: Rect): { x: number; top: number; bottom: number } {
    const narrow = this.host.narrow();
    const w = narrow ? Math.max(b.w, 360) : Math.max(MIN_LANE_W, b.w + LANE_PAD * 2);
    return { x: b.x - (narrow ? 0 : (w - b.w) / 2), top: b.y - LANE_GAP - 8, bottom: b.y + b.h + LANE_GAP + 8 };
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
      const laneX = lay.lanes?.x ?? 0;
      const W = this.laneRect.w;
      const rel = Math.max(12, Math.min(W - 12 - n.w, x - laneX));
      lay.nodes[id] = { x: rel };
      n.x = laneX + rel;
    }
  }

  // ---------- edges ----------

  private computeEdges(): Edge[] {
    const lay = this.host.layout();
    const edges: Edge[] = [];
    for (const n of this.nodes.values()) if (n.kind === "device") edges.push({ a: n.id, b: "hub", kind: "device" });
    for (const { session } of this.host.liveWindows()) {
      const from = `win:${session.key}`;
      // Up to the account it runs as (or its harness when the account is unknown).
      const chip = session.accountId ? `acct:${session.harness}:${session.accountId}` : undefined;
      if (chip && this.chipRect(chip)) edges.push({ a: from, b: chip, kind: "agent", state: session.state });
      else if (this.nodes.has(`agent:${session.harness}`))
        edges.push({ a: from, b: `agent:${session.harness}`, kind: "agent", state: session.state });
      if (session.machine && this.nodes.has(`machine:${session.machine}`)) {
        edges.push({ a: from, b: `machine:${session.machine}`, kind: "session", state: session.state });
      }
      if (session.repo) {
        const id = `repo:${repoParts(session.repo).short}`;
        if (this.nodes.has(id)) edges.push({ a: from, b: id, kind: "session", state: session.state });
      }
    }
    for (const l of lay.links ?? []) edges.push({ a: l.from, b: l.to, kind: "custom", id: l.id });
    return edges;
  }

  /** Mean x of the windows an endpoint connects to; nodes pack in that order. */
  private barycenter(id: string): number {
    const xs: number[] = [];
    for (const e of this.edges) {
      if (e.kind === "custom") continue;
      const other = e.b === id ? e.a : e.a === id ? e.b : undefined;
      if (!other) continue;
      const r = this.endRect(other);
      if (r) xs.push(r.x + r.w / 2);
    }
    if (id.startsWith("agent:")) {
      // A group follows its chips.
      const n = this.nodes.get(id);
      for (const c of n?.chips ?? []) {
        const b = this.barycenter(c.id);
        if (Number.isFinite(b)) xs.push(b);
      }
    }
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.POSITIVE_INFINITY;
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

    // Orthogonal routing: an edge leaves its source straight (down to a machine or repo,
    // up to an account), reaches a bus a few px outside the target's lane, runs along it
    // and joins the target's trunk; every edge to one target shares the bus and the
    // trunk, so N sessions → one machine draw as one bundle. Paths are kept across
    // frames and only get new geometry when an end moved.
    const seen = new Set<string>();
    const trunks = new Map<string, { x: number; busY: number; ty: number; up: boolean; lit?: boolean }>();
    for (const e of this.edges) {
      const a = this.endRect(e.a);
      const b = this.endRect(e.b);
      if (!a || !b) continue;
      const key = `${e.a}|${e.b}`;
      seen.add(key);
      let d: string;
      if (e.kind === "custom") {
        d = `M${a.x + a.w / 2},${a.y + a.h / 2} L${b.x + b.w / 2},${b.y + b.h / 2}`;
      } else {
        const up = b.y + b.h <= a.y;
        const lane = this.laneOf(e.b);
        const row = lane >= 0 ? this.rows[lane]! : null;
        const busY = row ? (up ? row.y + row.h + BUS_GAP : row.y - BUS_GAP) : up ? b.y + b.h + BUS_GAP : b.y - BUS_GAP;
        // Machine and repo drops sit a little apart so they don't overlap under a window.
        const dx = e.kind === "session" && e.b.startsWith("repo:") ? 5 : e.kind === "session" ? -5 : 0;
        const sx = a.x + a.w / 2 + dx;
        const sy = up ? a.y : a.y + a.h;
        const tx = b.x + b.w / 2;
        const ty = up ? b.y + b.h : b.y;
        d = orthoPath([
          [sx, sy],
          [sx, busY],
          [tx, busY],
        ]);
        const t = trunks.get(e.b);
        if (!t) trunks.set(e.b, { x: tx, busY, ty, up });
      }
      let rec = this.lineEls.get(key);
      if (!rec) {
        const line = svg("path", { class: `cv-edge cv-edge-${e.kind}`, "data-a": e.a, "data-b": e.b });
        if (e.state) line.dataset.state = e.state;
        let hit: SVGPathElement | undefined;
        if (e.kind === "custom" && e.id) {
          line.dataset.link = e.id;
          hit = svg("path", { class: "cv-edge-hit", "data-a": e.a, "data-b": e.b });
          hit.dataset.link = e.id;
        }
        rec = { line, hit, coords: "" };
        this.lineEls.set(key, rec);
        this.edgesG.append(line);
        if (hit) this.edgesG.append(hit);
      } else if (e.state && rec.line.dataset.state !== e.state) rec.line.dataset.state = e.state;
      if (rec.coords !== d) {
        rec.coords = d;
        rec.line.setAttribute("d", d);
        rec.hit?.setAttribute("d", d);
      }
      if (e.kind === "custom") setClass(rec.line, "is-selected", this.selected === e.id);
    }
    for (const [key, rec] of this.lineEls) {
      if (seen.has(key)) continue;
      rec.line.remove();
      rec.hit?.remove();
      this.lineEls.delete(key);
    }
    // One trunk per target: from the bus into the node.
    for (const [target, t] of trunks) {
      let el = this.trunkEls.get(target);
      if (!el) {
        el = svg("path", { class: "cv-trunk", "data-b": target });
        this.trunkEls.set(target, el);
        this.edgesG.append(el);
      }
      const d = `M${t.x},${t.busY} L${t.x},${t.ty}`;
      if (el.getAttribute("d") !== d) el.setAttribute("d", d);
    }
    for (const [target, el] of this.trunkEls) {
      if (trunks.has(target)) continue;
      el.remove();
      this.trunkEls.delete(target);
    }
    if (this.focus) this.applyFocus();
  }
  private lineEls = new Map<string, { line: SVGPathElement; hit?: SVGPathElement; coords: string }>();
  private trunkEls = new Map<string, SVGPathElement>();

  private laneOf(id: string): number {
    if (id.startsWith("acct:")) return 2;
    return this.nodes.get(id)?.lane ?? -1;
  }

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
    const litTargets = new Set<string>();
    if (id) {
      lit.add(id);
      const group = id.startsWith("agent:") ? `acct:${id.slice(6)}:` : undefined;
      for (const e of this.edges) {
        const touches =
          e.a === id || e.b === id || (group !== undefined && (e.a.startsWith(group) || e.b.startsWith(group)));
        if (!touches) continue;
        lit.add(e.a);
        lit.add(e.b);
        if (e.kind !== "custom") litTargets.add(e.b);
        if (e.a.startsWith("acct:")) lit.add(`agent:${e.a.split(":")[1]}`);
        if (e.b.startsWith("acct:")) lit.add(`agent:${e.b.split(":")[1]}`);
      }
    }
    const group = id?.startsWith("agent:") ? `acct:${id.slice(6)}:` : undefined;
    for (const rec of this.lineEls.values()) {
      const a = rec.line.dataset.a!;
      const b = rec.line.dataset.b!;
      const on =
        !!id && (a === id || b === id || (group !== undefined && (a.startsWith(group) || b.startsWith(group))));
      setClass(rec.line, "is-lit", on);
    }
    for (const [target, el] of this.trunkEls) setClass(el, "is-lit", litTargets.has(target));
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
    this.editing = id;
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

/** A polyline with rounded corners (6 px) as an SVG path. */
export function orthoPath(pts: [number, number][], r = 6): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]!;
    const [x, y] = pts[i]!;
    const [nx, ny] = pts[i + 1]!;
    const inLen = Math.hypot(x - px, y - py);
    const outLen = Math.hypot(nx - x, ny - y);
    const rr = Math.min(r, inLen / 2, outLen / 2);
    if (rr < 0.5 || inLen === 0 || outLen === 0) {
      d += ` L${x},${y}`;
      continue;
    }
    const ux = (x - px) / inLen;
    const uy = (y - py) / inLen;
    const vx = (nx - x) / outLen;
    const vy = (ny - y) / outLen;
    d += ` L${x - ux * rr},${y - uy * rr} Q${x},${y} ${x + vx * rr},${y + vy * rr}`;
  }
  const [lx, ly] = pts[pts.length - 1]!;
  d += ` L${lx},${ly}`;
  return d;
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
