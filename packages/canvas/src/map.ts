// SPDX-License-Identifier: Apache-2.0
// The Map view: the infrastructure around the sessions, in lanes from the top: devices
// (browsers on this GUI, grouped by name, and the passkeys machines trust), agents (one
// node per harness; an account only when it has an email), machines with their sessions
// as small rows under them, and the repos those work in. Lines show only for what is
// hovered. Hand-drawn nodes and links are the person's, kept in the canvas document.
// Everything is positioned with transforms; the DOM is rebuilt only when the set of
// nodes changes, lines are redrawn when something moved.
import type { ThemeApi, ThemeSnapshot } from "@sessionpipe-gui/theme-types";
import type { SessionKey, SessionState, SessionSummary } from "@sessionpipe-gui/theme-types/api";
import { findFree, type Rect } from "./layout";
import { type CustomNode, LANE_GAP, type Link, type MapDoc, NODE_GAP, NODE_H, ROW_H, ROW_W } from "./types";
import { el, oneLine, setClass, setText, svg } from "./util";

export type NodeKind = "device" | "agent" | "machine" | "repo" | "custom";

export interface Chip {
  id: string;
  harness: string;
  accountId: string;
  label: string;
}

export interface MapNode {
  id: string;
  kind: NodeKind;
  /** 0 devices, 1 agents, 2 machines, 3 repos; -1 custom (free). */
  lane: number;
  label: string;
  sub?: string;
  chips?: Chip[];
  /** The harness's own start chip (the node itself drags onto a machine). */
  start?: Chip;
  machine?: string;
  machineId?: string;
  online?: boolean;
  current?: boolean;
  strength?: SessionState;
  x: number;
  y: number;
  w: number;
  h: number;
  el: HTMLElement;
}

interface Edge {
  a: string;
  b: string;
  kind: "agent" | "session" | "custom";
  id?: string;
}

export interface MapHost {
  api: ThemeApi;
  root: HTMLElement;
  tethers: SVGSVGElement;
  doc(): MapDoc;
  snapshot(): ThemeSnapshot;
  /** The sessions shown as rows, in order. */
  sessions(): SessionSummary[];
  toScreen(wx: number, wy: number): { x: number; y: number };
  request(): void;
  /** The person changed the map: write it. */
  commit(): void;
  /** A start was accepted: the session the host named will appear by that machine. */
  onStarted(session: SessionKey, machineNodeId: string): void;
  narrow(): boolean;
}

export const LANES = ["Devices", "Agents", "Machines", "Repos"] as const;
const MIN_LANE_W = 960;
const PAD = 16;
const ROW_STEP = ROW_H + 6;

export class MapLayer {
  readonly lanesEl: HTMLElement;
  readonly nodesEl: HTMLElement;
  /** Hand-drawn nodes sit above everything: they are annotations. */
  readonly customEl: HTMLElement;
  private edgesG: SVGGElement;
  private tempLine: SVGLineElement;
  private laneEls: HTMLElement[] = [];
  nodes = new Map<string, MapNode>();
  /** Where each session row goes (world), from the last layout. */
  rows = new Map<SessionKey, Rect>();
  private edges: Edge[] = [];
  private sig = "";
  private focus: string | null = null;
  selected: string | null = null;
  private ghost: HTMLElement | undefined;
  private ghostChip: Chip | undefined;
  private pop: HTMLElement | undefined;
  private linkFrom: string | undefined;
  private laneRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private laneRows: { y: number; h: number }[] = [];
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
      lane.dataset.lane = name.toLowerCase();
      lane.append(el("span", "cv-lane-l", name));
      this.lanesEl.append(lane);
      this.laneEls.push(lane);
    }
    this.setOn(false);
  }

  get on() {
    return !this.lanesEl.hidden;
  }

  setOn(on: boolean) {
    this.lanesEl.hidden = !on;
    this.nodesEl.hidden = !on;
    this.customEl.hidden = !on;
    this.edgesG.style.display = on ? "" : "none";
    if (on) this.sig = "";
    else {
      this.closePopover();
      this.setFocus(null);
    }
  }

  // ---------- nodes from the snapshot ----------

  /** Rebuild the node set when it changed. */
  build(): void {
    const s = this.host.snapshot();
    const doc = this.host.doc();
    const api = this.host.api;
    const want: Omit<MapNode, "x" | "y" | "w" | "h" | "el">[] = [];

    // Devices: the browsers on the stream, one node per name ("you" once), then the
    // passkeys machines trust that are no browser here.
    const byLabel = new Map<string, { current: boolean; n: number }>();
    for (const v of s.viewers) {
      const label = v.label || v.device;
      const g = byLabel.get(label) ?? { current: false, n: 0 };
      g.current ||= !!v.current;
      g.n++;
      byLabel.set(label, g);
    }
    for (const [label, g] of byLabel) {
      want.push({
        id: `dev:${label}`,
        kind: "device",
        lane: 0,
        label,
        sub: g.current ? "you" : undefined,
        current: g.current,
      });
    }
    const keys = new Set<string>();
    for (const m of s.machines.values())
      for (const k of m.control?.keys ?? []) if (k.name?.trim()) keys.add(k.name.trim());
    for (const name of keys) {
      if (byLabel.has(name)) continue;
      want.push({ id: `dev:key:${name}`, kind: "device", lane: 0, label: name, sub: "passkey" });
    }

    // Agents: one node per harness; an account is named only by its email.
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
        g.set(sess.accountId, {
          id: `acct:${sess.harness}:${sess.accountId}`,
          harness: sess.harness,
          accountId: sess.accountId,
          label: emails.get(`${sess.harness}:${sess.accountId}`) ?? "",
        });
      }
    }
    for (const [harness, accounts] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      const name = harnessName(api, harness);
      const all = [...accounts.values()];
      const first = all[0];
      want.push({
        id: `agent:${harness}`,
        kind: "agent",
        lane: 1,
        label: name,
        sub: all.length > 1 ? `${all.length} accounts` : undefined,
        chips: all.filter((c) => c.label),
        start: { id: `start:${harness}`, harness, accountId: first?.accountId ?? "", label: name },
      });
    }

    // Machines, with the strongest state of their sessions as the one glyph.
    const order: SessionState[] = ["needs_you", "working", "stale", "idle"];
    for (const m of [...s.machines.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const c = m.control;
      let strength: SessionState = "idle";
      for (const sess of s.sessions.values()) {
        if (sess.machine !== m.name || sess.parentId || sess.state === "done") continue;
        if (order.indexOf(sess.state) < order.indexOf(strength)) strength = sess.state;
      }
      want.push({
        id: `machine:${m.name}`,
        kind: "machine",
        lane: 2,
        label: m.name,
        sub: c && !c.online ? "offline" : undefined,
        machine: m.name,
        machineId: c?.machineId,
        online: !!c?.online,
        strength,
      });
    }

    // Repos: the short name; the host only when two repos share it.
    const repos = new Map<string, Set<string>>();
    for (const sess of s.sessions.values()) {
      if (!sess.repo) continue;
      const { short, host } = repoParts(sess.repo);
      const set = repos.get(short) ?? new Set<string>();
      set.add(host);
      repos.set(short, set);
    }
    for (const [short, hosts] of [...repos].sort((a, b) => a[0].localeCompare(b[0]))) {
      want.push({
        id: `repo:${short}`,
        kind: "repo",
        lane: 3,
        label: short,
        sub: hosts.size > 1 ? "several hosts" : undefined,
      });
    }

    // Hand-drawn. A node left without a label (an edit the page never finished) goes.
    for (const c of Object.values(doc.custom)) {
      if (!c.label?.trim() && c.id !== this.editing) continue;
      want.push({ id: c.id, kind: "custom", lane: -1, label: c.label });
    }

    const sig = want
      .map((n) =>
        [n.id, n.label, n.sub, n.online, n.current, n.strength, n.chips?.map((c) => c.label).join("|")].join("\u0002"),
      )
      .join("\u0001");
    // Widths come from the DOM, so a build while the layer is hidden must run again
    // once it shows (setOn clears the signature).
    if (sig !== this.sig) {
      this.sig = this.nodesEl.hidden ? "" : sig;
      const seen = new Set<string>();
      for (const n of want) {
        seen.add(n.id);
        let node = this.nodes.get(n.id);
        if (!node) {
          const e = el("div", `cv-node cv-node-${n.kind}`);
          e.dataset.id = n.id;
          e.dataset.kind = n.kind;
          e.tabIndex = 0;
          (n.kind === "custom" ? this.customEl : this.nodesEl).append(e);
          node = { ...n, x: 0, y: 0, w: 0, h: NODE_H, el: e };
          this.nodes.set(n.id, node);
        } else Object.assign(node, n);
        this.fillNode(node);
        node.w = node.el.offsetWidth || node.w;
        node.h = node.el.offsetHeight || NODE_H;
      }
      for (const [id, node] of this.nodes) {
        if (!seen.has(id)) {
          node.el.remove();
          this.nodes.delete(id);
          if (this.selected === id) this.selected = null;
        }
      }
    }
  }

  private fillNode(n: MapNode) {
    const e = n.el;
    e.replaceChildren();
    if (n.kind === "machine") e.append(el("span", `dot dot--${n.strength ?? "idle"} cv-node-glyph`));
    if (n.kind === "custom") {
      const l = el("span", "cv-node-l cv-node-edit", n.label);
      l.spellcheck = false;
      e.append(l);
    } else e.append(el("span", "cv-node-l", n.label));
    if (n.sub) e.append(el("span", "cv-node-s", n.sub));
    for (const c of n.chips ?? []) {
      const chip = el("span", "cv-chip-a", c.label);
      chip.dataset.chip = c.id;
      chip.title = `${c.label} · drag onto a machine to start a session`;
      e.append(chip);
    }
    if (n.start) {
      e.dataset.chip = n.start.id;
      e.title = `Drag onto a machine to start a ${n.label} session`;
    }
    const h = el("span", "cv-node-h");
    h.title = "Drag to another node to link";
    e.append(h);
    setClass(e, "is-current", !!n.current);
    setClass(e, "is-off", n.kind === "machine" && !n.online);
    setClass(e, "is-selected", this.selected === n.id);
  }

  // ---------- geometry ----------

  /** Lanes from the origin down: devices and agents above the machines, each machine's
   *  sessions as rows under it, the repos below the tallest column. A node keeps the x it
   *  was dragged to along its lane while it fits; the rest pack from the left. */
  layout(): void {
    const doc = this.host.doc();
    const narrow = this.host.narrow();
    const ROW = NODE_H + 8;
    const sessions = this.host.sessions();
    const byMachine = new Map<string, SessionSummary[]>();
    for (const s of sessions) {
      const id = s.machine && this.nodes.has(`machine:${s.machine}`) ? `machine:${s.machine}` : "machine:";
      const list = byMachine.get(id) ?? [];
      list.push(s);
      byMachine.set(id, list);
    }
    // The machine lane sets the width: each machine a slot as wide as its rows.
    const machines = [...this.nodes.values()].filter((n) => n.lane === 2);
    const slot = (n: MapNode) => Math.max(n.w, ROW_W);
    const machinesW = machines.reduce((w, n) => w + slot(n) + NODE_GAP, PAD) + (byMachine.has("machine:") ? ROW_W : 0);
    const W = narrow ? Math.max(360, ROW_W + PAD * 2) : Math.max(MIN_LANE_W, machinesW + PAD);

    const placed = new Map<string, { x: number; row: number }>();
    const rowsOf: number[] = [];
    for (let lane = 0; lane < LANES.length; lane++) {
      const members = [...this.nodes.values()].filter((n) => n.lane === lane);
      const width = (n: MapNode) => (lane === 2 ? slot(n) : n.w);
      const stored = (n: MapNode) => {
        const st = doc.nodes[n.id];
        if (!st || !Number.isFinite(st.x) || st.x < 0 || st.x + width(n) > W - PAD) return undefined;
        return st.x;
      };
      members.sort((p, q) => {
        const a = stored(p);
        const c = stored(q);
        if (a === undefined && c === undefined) return p.label.localeCompare(q.label);
        if (a === undefined) return 1;
        if (c === undefined) return -1;
        return a - c;
      });
      let cursor = PAD;
      let row = 0;
      for (const n of members) {
        const want = stored(n);
        let x = want !== undefined && want >= cursor && want + width(n) <= W - PAD ? want : cursor;
        // A full row wraps (a phone's machines stack too).
        if (x + width(n) > W - PAD && cursor > PAD) {
          row++;
          cursor = PAD;
          x = PAD;
        }
        placed.set(n.id, { x, row });
        cursor = x + width(n) + NODE_GAP;
      }
      rowsOf[lane] = row + 1;
    }
    const laneH = (lane: number) => rowsOf[lane]! * ROW + 28;
    const gap = narrow ? LANE_GAP - 16 : LANE_GAP;
    // Machines at y = 0; their session rows under each one.
    const machinesY = 0;
    const agentsY = machinesY - gap - laneH(1);
    const devicesY = agentsY - gap - laneH(0);
    const rowsTop = machinesY + laneH(2) + 12;
    this.rows.clear();
    let bottom = rowsTop;
    const columns: [string, number][] = machines.map((n) => [n.id, (placed.get(n.id)?.x ?? PAD) + 0]);
    if (byMachine.has("machine:")) columns.push(["machine:", machinesW - ROW_W]);
    if (narrow) {
      // A phone: one column of rows, machine by machine.
      let y = rowsTop;
      for (const [id] of columns) {
        for (const s of byMachine.get(id) ?? []) {
          this.rows.set(s.key, { x: PAD, y, w: W - PAD * 2, h: ROW_H });
          y += ROW_STEP;
        }
      }
      bottom = y;
    } else {
      for (const [id, x] of columns) {
        let y = rowsTop;
        for (const s of byMachine.get(id) ?? []) {
          this.rows.set(s.key, { x, y, w: ROW_W, h: ROW_H });
          y += ROW_STEP;
        }
        bottom = Math.max(bottom, y);
      }
    }
    const reposY = bottom + gap;
    this.laneRows = [
      { y: devicesY, h: laneH(0) },
      { y: agentsY, h: laneH(1) },
      { y: machinesY, h: laneH(2) },
      { y: reposY, h: laneH(3) },
    ];
    for (const n of this.nodes.values()) {
      if (n.kind === "custom") {
        const c = doc.custom[n.id];
        if (c) {
          n.x = c.x;
          n.y = c.y;
        }
        continue;
      }
      const p = placed.get(n.id);
      if (!p) continue;
      const row = this.laneRows[n.lane]!;
      n.x = p.x;
      n.y = row.y + 22 + p.row * ROW;
    }
    const last = this.laneRows[3]!;
    this.laneRect = { x: 0, y: devicesY, w: W, h: last.y + last.h - devicesY };
    this.edges = this.computeEdges();
  }

  /** Where the lanes are, for Fit. */
  laneBounds(): Rect | null {
    return this.on ? this.laneRect : null;
  }

  nodeRect(id: string): Rect | null {
    const n = this.nodes.get(id);
    return n ? { x: n.x, y: n.y, w: n.w, h: n.h } : null;
  }

  private chipRect(chipId: string): Rect | null {
    for (const n of this.nodes.values()) {
      if (n.start?.id === chipId) return this.nodeRect(n.id);
      const c = n.chips?.find((c) => c.id === chipId);
      if (c) {
        const ce = n.el.querySelector(`[data-chip="${CSS.escape(c.id)}"]`) as HTMLElement | null;
        return { x: n.x + (ce?.offsetLeft ?? 0), y: n.y, w: ce?.offsetWidth ?? n.w, h: n.h };
      }
    }
    return null;
  }

  /** Any endpoint: a node, an account chip, or a session row. */
  private endRect(id: string): Rect | null {
    if (id.startsWith("win:")) return this.rows.get(id.slice(4)) ?? null;
    if (id.startsWith("acct:") || id.startsWith("start:")) return this.chipRect(id);
    return this.nodeRect(id);
  }

  moveNode(id: string, x: number, y: number) {
    const n = this.nodes.get(id);
    if (!n) return;
    const doc = this.host.doc();
    if (n.kind === "custom") {
      const c = doc.custom[id];
      if (c) {
        c.x = Math.round(x);
        c.y = Math.round(y);
      }
      n.x = x;
      n.y = y;
    } else {
      const rel = Math.max(PAD, Math.min(this.laneRect.w - PAD - n.w, x));
      doc.nodes[id] = { x: Math.round(rel) };
      this.layout();
    }
    this.host.request();
  }

  // ---------- edges ----------

  private computeEdges(): Edge[] {
    const doc = this.host.doc();
    const edges: Edge[] = [];
    for (const s of this.host.sessions()) {
      if (!this.rows.has(s.key)) continue;
      const from = `win:${s.key}`;
      const chip = s.accountId ? `acct:${s.harness}:${s.accountId}` : undefined;
      if (chip && this.chipRect(chip)) edges.push({ a: from, b: chip, kind: "agent" });
      else if (this.nodes.has(`agent:${s.harness}`)) edges.push({ a: from, b: `agent:${s.harness}`, kind: "agent" });
      if (s.repo) {
        const id = `repo:${repoParts(s.repo).short}`;
        if (this.nodes.has(id)) edges.push({ a: from, b: id, kind: "session" });
      }
    }
    for (const l of doc.links) edges.push({ a: l.from, b: l.to, kind: "custom", id: l.id });
    return edges;
  }

  /** Lines and lanes from the current rects. Called from the frame when anything moved. */
  draw() {
    if (!this.on) return;
    for (let i = 0; i < LANES.length; i++) {
      const lane = this.laneEls[i]!;
      const row = this.laneRows[i];
      if (!row) continue;
      lane.style.transform = `translate3d(${this.laneRect.x}px, ${row.y}px, 0)`;
      lane.style.width = `${this.laneRect.w}px`;
      lane.style.height = `${row.h}px`;
    }
    for (const n of this.nodes.values()) n.el.style.transform = `translate3d(${n.x}px, ${n.y}px, 0)`;

    // Orthogonal: a line leaves its row straight up (to its agent) or down (to its repo),
    // turns once onto the target's centre. Paths are kept across frames and only get new
    // geometry when an end moved.
    const seen = new Set<string>();
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
        const sx = a.x + 12;
        const sy = up ? a.y : a.y + a.h;
        const tx = b.x + b.w / 2;
        const ty = up ? b.y + b.h : b.y;
        const mid = up ? ty + 12 : ty - 12;
        d = orthoPath([
          [sx, sy],
          [sx, mid],
          [tx, mid],
          [tx, ty],
        ]);
      }
      let rec = this.lineEls.get(key);
      if (!rec) {
        const line = svg("path", { class: `cv-edge cv-edge-${e.kind}`, "data-a": e.a, "data-b": e.b });
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
      }
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
    if (this.focus) this.applyFocus();
  }
  private lineEls = new Map<string, { line: SVGPathElement; hit?: SVGPathElement; coords: string }>();

  // ---------- hover focus: the lines of what is hovered ----------

  setFocus(id: string | null) {
    if (id === this.focus) return;
    this.focus = id;
    setClass(this.host.root, "is-focus", !!id && this.on);
    this.applyFocus();
  }

  private applyFocus() {
    const id = this.focus;
    const lit = new Set<string>();
    const group = id?.startsWith("agent:") ? `acct:${id.slice(6)}:` : undefined;
    const touches = (a: string, b: string) =>
      !!id &&
      (a === id ||
        b === id ||
        (group !== undefined && (a.startsWith(group) || b.startsWith(group))) ||
        // A machine lights the lines of its sessions.
        (id.startsWith("machine:") && this.machineOf(a) === id));
    if (id) {
      lit.add(id);
      for (const e of this.edges) {
        if (!touches(e.a, e.b)) continue;
        lit.add(e.a);
        lit.add(e.b);
        if (e.b.startsWith("acct:")) lit.add(`agent:${e.b.split(":")[1]}`);
      }
    }
    for (const rec of this.lineEls.values()) {
      setClass(rec.line, "is-lit", touches(rec.line.dataset.a!, rec.line.dataset.b!));
    }
    for (const n of this.nodes.values()) setClass(n.el, "is-lit", lit.has(n.id));
    for (const w of this.host.root.querySelectorAll<HTMLElement>(".cv-win")) {
      setClass(w, "is-lit", lit.has(`win:${w.dataset.key}`));
    }
  }

  private machineOf(end: string): string | undefined {
    if (!end.startsWith("win:")) return undefined;
    const s = this.host.snapshot().sessions.get(end.slice(4));
    return s?.machine ? `machine:${s.machine}` : undefined;
  }

  // ---------- hand-drawn nodes and links ----------

  addCustom(x: number, y: number): string {
    const doc = this.host.doc();
    const id = `c_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    const taken = [...this.nodes.values()].map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
    const spot = findFree({ x, y }, 140, NODE_H, [...taken, ...this.rows.values()], 24);
    doc.custom[id] = { id, label: "", x: spot.x, y: spot.y };
    this.editing = id;
    this.build();
    this.layout();
    this.draw();
    this.select(id);
    this.edit(id);
    return id;
  }

  /** Inline edit of a hand-drawn node's label; an empty label on commit deletes it. */
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
      const doc = this.host.doc();
      if (!label) {
        delete doc.custom[id];
        doc.links = doc.links.filter((k) => k.from !== id && k.to !== id);
        if (this.selected === id) this.selected = null;
      } else if (doc.custom[id]) doc.custom[id].label = label;
      this.build();
      this.layout();
      this.draw();
      this.host.commit();
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
    const doc = this.host.doc();
    if (doc.custom[id]) {
      delete doc.custom[id];
      doc.links = doc.links.filter((k) => k.from !== id && k.to !== id);
    } else if (doc.links.some((k) => k.id === id)) {
      doc.links = doc.links.filter((k) => k.id !== id);
    } else return false;
    this.selected = null;
    this.build();
    this.layout();
    this.draw();
    this.host.commit();
    this.host.request();
    return true;
  }

  beginLink(from: string) {
    this.linkFrom = from;
    const r = this.endRect(from);
    if (!r) return;
    for (const [k, v] of [
      ["x1", r.x + r.w / 2],
      ["y1", r.y + r.h / 2],
      ["x2", r.x + r.w / 2],
      ["y2", r.y + r.h / 2],
    ] as const) {
      this.tempLine.setAttribute(k, `${v}`);
    }
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
    const doc = this.host.doc();
    if (doc.links.some((k) => (k.from === from && k.to === to) || (k.from === to && k.to === from))) return;
    const link: Link = { id: `l_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, from, to };
    doc.links.push(link);
    this.edges = this.computeEdges();
    this.select(link.id);
    this.host.commit();
    this.host.request();
  }

  // ---------- an agent dragged onto a machine ----------

  private chipById(id: string): Chip | undefined {
    for (const n of this.nodes.values()) {
      if (n.start?.id === id) return n.start;
      const c = n.chips?.find((c) => c.id === id);
      if (c) return c;
    }
    return undefined;
  }

  beginGhost(chipId: string, sx: number, sy: number) {
    const chip = this.chipById(chipId);
    if (!chip) return;
    this.ghostChip = chip;
    this.ghost = el("div", "cv-ghost", chip.label || harnessName(this.host.api, chip.harness));
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
        : { ok: false, reason: "Control is not available" };
    pop.append(el("div", "cv-pop-t", `Start ${harnessName(api, chip.harness)} on ${machine.label}`));
    if (chip.label && chip.label !== harnessName(api, chip.harness)) pop.append(el("div", "cv-pop-s", chip.label));
    const folders = m?.control?.folders ?? [];
    const sel = el("select", "field cv-pop-folder");
    sel.setAttribute("aria-label", "Folder");
    for (const f of folders) {
      const o = el("option", undefined, f);
      o.value = f;
      sel.append(o);
    }
    if (!folders.length) {
      const o = el("option", undefined, "No folders allowed");
      o.value = "";
      sel.append(o);
    }
    const input = el("input", "field cv-pop-text");
    input.type = "text";
    input.placeholder = "First message";
    input.setAttribute("aria-label", "First message");
    const row = el("div", "cv-pop-row");
    const start = el("button", "btn btn--sm btn--primary cv-pop-start", "Start");
    start.type = "button";
    const cancel = el("button", "btn btn--sm btn--ghost cv-pop-cancel", "Cancel");
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
      setText(reason, "Sending…");
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
    row.append(cancel, start);
    pop.append(sel, input, row, reason);
    this.host.root.append(pop);
    const p = this.host.toScreen(machine.x, machine.y + machine.h);
    const rw = pop.offsetWidth;
    const rh = pop.offsetHeight;
    const rootW = this.host.root.clientWidth;
    const rootH = this.host.root.clientHeight;
    const x = Math.max(8, Math.min(rootW - rw - 8, p.x));
    const y = p.y + 8 + rh > rootH - 36 ? Math.max(56, p.y - rh - machine.h - 8) : p.y + 8;
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

/** "Claude Code" (the host's name for it), else "claude". */
export function harnessName(api: ThemeApi, h: string): string {
  return api.format.harnessIcon?.(h)?.name ?? h.replace(/-code$|-cli$/, "");
}

export function repoParts(repo: string): { short: string; host: string } {
  const noScheme = repo.replace(/^[a-z]+:\/\//i, "").replace(/\.git$/, "");
  const parts = noScheme.split("/").filter(Boolean);
  if (parts.length >= 3) return { short: parts.slice(-2).join("/"), host: parts[0]! };
  return { short: noScheme, host: "" };
}

export type { CustomNode };
