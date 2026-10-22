// SPDX-License-Identifier: Apache-2.0
// Pointer, wheel, keyboard and right-click, turned into calls on the canvas. One pointer
// moves what it grabbed (windows, areas, notes in My layout), draws a selection
// rectangle on the ground in My layout, or pans; two pointers pinch. A right-click, a
// long-press (450 ms, cancelled by 8 px of movement) or Shift+F10 opens the menu of what
// is under it. Nothing here touches the DOM beyond pointer capture and cursors.
import type { ThemeApi, ViewShortcut } from "@sessionpipe-gui/theme-types";
import type { Viewport } from "./types";
import { clamp } from "./util";

export type Hit =
  | { kind: "win"; key: string; part: "body" | "bar" | "resize" | "scroll" | "control" }
  | { kind: "pill"; id: string; parent: string; agent: string }
  | { kind: "area"; id: string; part: "head" | "body" | "resize" | "edit" }
  | { kind: "note"; id: string; part: "body" | "resize" | "edit" }
  | { kind: "head"; group: string }
  | { kind: "node"; id: string; part: "body" | "handle" | "chip" | "edit"; chip?: string; custom: boolean }
  | { kind: "link"; id: string }
  | { kind: "ui" }
  | { kind: "canvas" };

export type MenuSource = "mouse" | "keyboard" | "touch";

export interface InputHost {
  root: HTMLElement;
  shortcuts?: ThemeApi["shortcuts"];
  vp(): Viewport;
  panBy(dx: number, dy: number): void;
  zoomAt(sx: number, sy: number, factor: number): void;
  toWorld(sx: number, sy: number): { x: number; y: number };
  hit(target: EventTarget | null): Hit;
  hitAt(sx: number, sy: number): Hit;
  /** My layout on a desktop: things move by hand. */
  canArrange(): boolean;
  /** The selection: `w:<key>`, `p:<pill id>`, `a:<area>`, `n:<note>`. */
  itemOf(hit: Hit): string | null;
  isSelected(item: string): boolean;
  select(item: string | null, add: boolean): void;
  /** Moving: what a drag on `item` carries (the selection when it is part of it). */
  beginMove(item: string): boolean;
  moveBy(dx: number, dy: number, snap: boolean): void;
  endMove(moved: boolean): void;
  beginResize(item: string): boolean;
  resizeBy(dw: number, dh: number, snap: boolean): void;
  endResize(): void;
  /** A rectangle on the ground, world units: selects (or, with A held, draws an area). */
  marquee(r: { x: number; y: number; w: number; h: number } | null, draw: boolean, done: boolean): void;
  /** A window was dragged in a preset view: it pans instead, once said why. */
  presetDrag(): void;
  /** Double-click or two taps: expand a window, open a pill, rename an area, edit a note. */
  activate(hit: Hit): void;
  menuAt(hit: Hit, sx: number, sy: number, source: MenuSource): void;
  /** Shift+F10, the ContextMenu key: the selection's menu. */
  menuForSelection(): void;
  escape(): void;
  pointerAt(sx: number, sy: number): void;
  setGesture(on: boolean): void;
  /** The gesture ended: keep the viewport. */
  commitViewport(): void;
  /** The view's keys (registered with the host's keymap, or matched here without one). */
  actions(): ViewShortcut[];
  /** Something with its own keyboard (a title being edited, the start form) is open. */
  busyTyping(): boolean;

  // The map: nodes, hand-drawn links, an agent dragged onto a machine.
  nodeRect(id: string): { x: number; y: number; w: number; h: number } | null;
  moveNode(id: string, x: number, y: number): void;
  commitMap(): void;
  beginLink(id: string): void;
  moveLink(wx: number, wy: number): void;
  endLink(target: string | null): void;
  beginGhost(chip: string, sx: number, sy: number): void;
  moveGhost(sx: number, sy: number): void;
  endGhost(target: string | null): void;
  selectNode(id: string | null): void;
  hover(id: string | null): void;
}

interface Pointer {
  id: number;
  x: number;
  y: number;
  type: string;
}

type Mode =
  | { kind: "none" }
  | { kind: "pan"; sx: number; sy: number; hint: boolean }
  | { kind: "move"; item: string; hit: Hit; sx: number; sy: number; moved: boolean; started: boolean }
  | { kind: "resize"; sx: number; sy: number }
  | { kind: "marquee"; sx: number; sy: number; draw: boolean; moved: boolean }
  | { kind: "tap"; hit: Hit; sx: number; sy: number }
  | { kind: "node"; id: string; sx: number; sy: number; ox: number; oy: number; custom: boolean; moved: boolean }
  | { kind: "link"; id: string }
  | { kind: "ghost"; chip: string }
  | { kind: "pinch"; d0: number; k0: number; mx: number; my: number };

const TAP_MS = 350;
const DRAG_PX = 3;
const LONG_MS = 450;
const LONG_PX = 8;

/** "mod+alt+1" against a keydown, for hosts without a keymap. */
function matches(chord: string, e: KeyboardEvent): boolean {
  const parts = chord.toLowerCase().split("+");
  const key = parts.pop()!;
  const mac = /mac|iphone|ipad/i.test(navigator.platform);
  const want = {
    mod: parts.includes("mod"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
  };
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (mod !== want.mod || e.altKey !== want.alt) return false;
  const k = e.key.toLowerCase();
  const code = e.code.toLowerCase();
  const named: Record<string, string[]> = {
    enter: ["enter"],
    backspace: ["backspace"],
    delete: ["delete"],
    left: ["arrowleft"],
    right: ["arrowright"],
    up: ["arrowup"],
    down: ["arrowdown"],
    plus: ["+", "="],
  };
  const keyOk = named[key] ? named[key].includes(k) : k === key || code === `digit${key}` || code === `key${key}`;
  // Shift is part of a printable key ("?", "+"); only check it for letters, digits and named keys.
  if (/^[a-z0-9]$/.test(key) || (named[key] && key !== "plus")) return keyOk && e.shiftKey === want.shift;
  return keyOk;
}

export function attachInput(host: InputHost): () => void {
  const root = host.root;
  const pointers = new Map<number, Pointer>();
  let mode: Mode = { kind: "none" };
  let space = false;
  let aHeld = false;
  let lastTap: { item: string; at: number } | undefined;
  let longTimer: ReturnType<typeof setTimeout> | undefined;
  let longAt: { x: number; y: number } | undefined;
  /** A menu opened from a long-press or a key: the contextmenu event that may follow is the same one. */
  let menuOpenedAt = Number.NEGATIVE_INFINITY;
  /** The finger that long-pressed is still down: its release must not click the sheet. */
  let longFired = false;
  const onTouchEnd = (e: TouchEvent) => {
    if (!longFired) return;
    longFired = false;
    e.preventDefault();
  };

  const pt = (e: { clientX: number; clientY: number }) => {
    const r = root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const cancelLong = () => {
    if (longTimer) clearTimeout(longTimer);
    longTimer = undefined;
    longAt = undefined;
  };

  const startPinch = () => {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return;
    const d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    if (mode.kind === "move") host.endMove(false);
    mode = { kind: "pinch", d0, k0: host.vp().k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    root.classList.add("is-panning");
  };

  const onDown = (e: PointerEvent) => {
    const hit = host.hit(e.target);
    if (hit.kind === "ui") return;
    if (hit.kind === "win" && hit.part === "control") return;
    if ((hit.kind === "area" || hit.kind === "note") && hit.part === "edit") return;
    if (hit.kind === "node" && hit.part === "edit") return;
    if (hit.kind === "win" && hit.part === "scroll" && !space && e.pointerType === "mouse") {
      host.select(`w:${hit.key}`, e.shiftKey);
      return;
    }
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    const p = pt(e);
    pointers.set(e.pointerId, { id: e.pointerId, x: p.x, y: p.y, type: e.pointerType });
    root.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch" && pointers.size === 2) {
      cancelLong();
      startPinch();
      return;
    }
    if (pointers.size > 1) return;
    host.setGesture(true);
    // A long-press on touch opens the menu of what is under the finger.
    if (e.pointerType !== "mouse") {
      longAt = { x: e.clientX, y: e.clientY };
      longTimer = setTimeout(() => {
        longTimer = undefined;
        if (mode.kind === "move") host.endMove(false);
        if (mode.kind === "resize") host.endResize();
        mode = { kind: "none" };
        pointers.clear();
        root.classList.remove("is-panning", "is-dragging");
        menuOpenedAt = performance.now();
        longFired = true;
        host.menuAt(hit, p.x, p.y, "touch");
      }, LONG_MS);
    }
    const arrange = host.canArrange();
    const item = host.itemOf(hit);
    if (space || hit.kind === "link" || ((hit.kind === "canvas" || hit.kind === "head") && !arrange)) {
      if (hit.kind === "link") host.selectNode(hit.id);
      mode = { kind: "pan", sx: p.x, sy: p.y, hint: false };
      root.classList.add("is-panning");
    } else if (hit.kind === "canvas" || hit.kind === "head" || (hit.kind === "area" && hit.part === "body")) {
      // My layout's ground: a selection rectangle (an area with A held). Touch pans.
      if (e.pointerType === "touch") {
        mode = { kind: "pan", sx: p.x, sy: p.y, hint: false };
        root.classList.add("is-panning");
      } else {
        mode = { kind: "marquee", sx: p.x, sy: p.y, draw: aHeld, moved: false };
        if (aHeld) areaArmed = undefined;
      }
      host.selectNode(null);
    } else if (hit.kind === "node") {
      if (hit.part === "handle") {
        mode = { kind: "link", id: hit.id };
        host.beginLink(hit.id);
      } else if (hit.part === "chip" && hit.chip) {
        mode = { kind: "ghost", chip: hit.chip };
        host.beginGhost(hit.chip, p.x, p.y);
      } else {
        const r = host.nodeRect(hit.id);
        if (!r) return;
        mode = { kind: "node", id: hit.id, sx: p.x, sy: p.y, ox: r.x, oy: r.y, custom: hit.custom, moved: false };
      }
    } else if (item && (hit.kind === "win" || hit.kind === "area" || hit.kind === "note") && hit.part === "resize") {
      if (arrange && host.beginResize(item)) mode = { kind: "resize", sx: p.x, sy: p.y };
      else mode = { kind: "pan", sx: p.x, sy: p.y, hint: true };
    } else if (item && arrange && hit.kind !== "pill") {
      mode = { kind: "move", item, hit, sx: p.x, sy: p.y, moved: false, started: false };
    } else if (item) {
      // A preset (or a pill): a press selects, a drag pans.
      mode = { kind: "tap", hit, sx: p.x, sy: p.y };
    }
    if (mode.kind !== "none" && e.pointerType === "mouse") e.preventDefault();
    if (mode.kind !== "none" && e.pointerType === "touch") root.classList.add("is-touch-drag");
  };

  const onMove = (e: PointerEvent) => {
    const p0 = pt(e);
    if (mode.kind === "none") host.pointerAt(p0.x, p0.y);
    const rec = pointers.get(e.pointerId);
    if (!rec) return;
    rec.x = p0.x;
    rec.y = p0.y;
    if (longAt && Math.hypot(e.clientX - longAt.x, e.clientY - longAt.y) > LONG_PX) cancelLong();
    const k = host.vp().k;
    switch (mode.kind) {
      case "tap":
        if (Math.hypot(p0.x - mode.sx, p0.y - mode.sy) < DRAG_PX) return;
        mode = { kind: "pan", sx: mode.sx, sy: mode.sy, hint: mode.hit.kind === "win" };
        root.classList.add("is-panning");
        if (mode.hint) host.presetDrag();
        onMove(e);
        break;
      case "pan":
        host.panBy(p0.x - mode.sx, p0.y - mode.sy);
        mode.sx = p0.x;
        mode.sy = p0.y;
        break;
      case "move": {
        if (!mode.moved && Math.hypot(p0.x - mode.sx, p0.y - mode.sy) < DRAG_PX) return;
        if (!mode.started) {
          mode.started = true;
          if (!host.beginMove(mode.item)) {
            mode = { kind: "pan", sx: mode.sx, sy: mode.sy, hint: false };
            return;
          }
          root.classList.add("is-dragging");
        }
        mode.moved = true;
        host.moveBy((p0.x - mode.sx) / k, (p0.y - mode.sy) / k, e.shiftKey);
        break;
      }
      case "resize":
        host.resizeBy((p0.x - mode.sx) / k, (p0.y - mode.sy) / k, e.shiftKey);
        break;
      case "marquee": {
        if (!mode.moved && Math.hypot(p0.x - mode.sx, p0.y - mode.sy) < DRAG_PX) return;
        mode.moved = true;
        const a = host.toWorld(mode.sx, mode.sy);
        const b = host.toWorld(p0.x, p0.y);
        host.marquee(
          { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) },
          mode.draw,
          false,
        );
        break;
      }
      case "node": {
        if (!mode.moved && Math.hypot(p0.x - mode.sx, p0.y - mode.sy) < DRAG_PX) return;
        if (!mode.moved) {
          mode.moved = true;
          root.classList.add("is-dragging");
        }
        const nx = mode.ox + (p0.x - mode.sx) / k;
        const ny = mode.custom ? mode.oy + (p0.y - mode.sy) / k : mode.oy;
        host.moveNode(mode.id, nx, ny);
        break;
      }
      case "link": {
        const w = host.toWorld(p0.x, p0.y);
        host.moveLink(w.x, w.y);
        break;
      }
      case "ghost":
        host.moveGhost(p0.x, p0.y);
        break;
      case "pinch": {
        const [a, b] = [...pointers.values()];
        if (!a || !b) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const target = clamp(mode.k0 * (d / mode.d0), 0.25, 2);
        const cur = host.vp().k;
        if (Math.abs(target - cur) > 1e-4) host.zoomAt(mx, my, target / cur);
        host.panBy(mx - mode.mx, my - mode.my);
        mode.mx = mx;
        mode.my = my;
        break;
      }
    }
  };

  /** Two clicks or taps on the same thing within TAP_MS. (The browser's dblclick is no
   *  use: pointer capture retargets it to the root.) */
  const tapped = (hit: Hit, shift: boolean) => {
    const item = host.itemOf(hit) ?? (hit.kind === "area" ? `a:${hit.id}` : null);
    if (!item) return;
    const now = performance.now();
    if (lastTap && lastTap.item === item && now - lastTap.at < TAP_MS) {
      lastTap = undefined;
      host.activate(hit);
      return;
    }
    lastTap = { item, at: now };
    host.select(item, shift);
  };

  const onUp = (e: PointerEvent) => {
    const had = pointers.delete(e.pointerId);
    cancelLong();
    if (!had) return;
    try {
      root.releasePointerCapture(e.pointerId);
    } catch {}
    if (mode.kind === "pinch") {
      if (pointers.size === 0) end();
      return;
    }
    const p = pt(e);
    switch (mode.kind) {
      case "tap":
        tapped(mode.hit, e.shiftKey);
        break;
      case "move":
        if (mode.started) host.endMove(mode.moved);
        if (!mode.moved) tapped(mode.hit, e.shiftKey);
        break;
      case "resize":
        host.endResize();
        break;
      case "marquee":
        if (mode.moved) {
          const a = host.toWorld(mode.sx, mode.sy);
          const b = host.toWorld(p.x, p.y);
          host.marquee(
            { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) },
            mode.draw,
            true,
          );
        } else {
          const hit = host.hitAt(p.x, p.y);
          if (hit.kind === "area") tapped(hit, e.shiftKey);
          else host.select(null, false);
        }
        break;
      case "pan":
        if (Math.hypot(p.x - mode.sx, p.y - mode.sy) < DRAG_PX && host.hitAt(p.x, p.y).kind === "canvas") {
          host.select(null, false);
        }
        break;
      case "link": {
        const t = host.hitAt(p.x, p.y);
        host.endLink(t.kind === "node" ? (t.chip ?? t.id) : t.kind === "win" ? `win:${t.key}` : null);
        break;
      }
      case "ghost": {
        const t = host.hitAt(p.x, p.y);
        host.endGhost(t.kind === "node" ? t.id : null);
        break;
      }
      case "node":
        if (mode.moved) host.commitMap();
        else host.selectNode(mode.id);
        break;
    }
    end();
  };

  const end = () => {
    mode = { kind: "none" };
    root.classList.remove("is-panning", "is-dragging", "is-touch-drag");
    host.setGesture(false);
    host.commitViewport();
  };

  const onWheel = (e: WheelEvent) => {
    const hit = host.hit(e.target);
    if (hit.kind === "ui") return;
    if (hit.kind === "win" && hit.part === "scroll" && !e.ctrlKey && !e.metaKey) {
      const list = (e.target as Element).closest(".cv-detail-list") as HTMLElement | null;
      if (list && list.scrollHeight > list.clientHeight) {
        const atTop = list.scrollTop <= 0 && e.deltaY < 0;
        const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1 && e.deltaY > 0;
        if (!atTop && !atBottom) return; // let it scroll
      }
    }
    e.preventDefault();
    const p = pt(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? root.clientHeight : 1;
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel with small deltas; a mouse wheel in big steps.
      const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey && Math.abs(e.deltaY) < 50 ? 0.01 : 0.0025));
      host.zoomAt(p.x, p.y, factor);
    } else {
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
      host.panBy(-dx * unit, -dy * unit);
    }
    if (wheelTimer) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => host.commitViewport(), 250);
  };
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;

  const ours = () => {
    const a = document.activeElement;
    return !a || a === document.body || a === document.documentElement || root.contains(a);
  };
  const editable = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    return (
      !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
    );
  };

  // Right-click everywhere inside the canvas opens our menu (through the host's), except
  // in a text field or while editing, which keep the native one.
  const onContextMenu = (e: MouseEvent) => {
    if (editable(e.target)) return;
    e.preventDefault();
    if (performance.now() - menuOpenedAt < 600) return;
    const hit = host.hit(e.target);
    if (hit.kind === "ui") return;
    const p = pt(e);
    host.menuAt(hit, p.x, p.y, "mouse");
  };

  // The keys, through the host's keymap when it has one (listed in `?`, rebindable), else
  // matched here. Space (hold to pan), A (held to draw an area), Esc and the menu keys
  // stay on the listener either way.
  // "New area" runs when its key comes up without a drag: held, the same key draws one.
  let areaArmed: (() => void) | undefined;
  const wrap = (a: ViewShortcut): ViewShortcut => ({
    ...a,
    run: () => {
      if (!ours() || host.busyTyping()) return;
      if (a.id === "area") areaArmed = a.run;
      else a.run();
    },
  });
  const list = host.actions().map(wrap);
  const unregister = host.shortcuts?.register(list);
  const viaHost = !!unregister;

  const onKey = (e: KeyboardEvent) => {
    if (!ours()) return;
    const typing = editable(e.target);
    if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
      if (typing) return;
      e.preventDefault();
      menuOpenedAt = performance.now();
      host.menuForSelection();
      return;
    }
    if (typing) {
      if (e.key === "Escape" && (e.target as HTMLElement).tagName === "INPUT") {
        host.escape();
        (e.target as HTMLInputElement).blur();
        root.focus();
        e.preventDefault();
      }
      return;
    }
    if (host.busyTyping()) return;
    if (e.key === " " && !e.metaKey && !e.ctrlKey) {
      space = true;
      root.classList.add("is-space");
      e.preventDefault();
      return;
    }
    if (e.key === "a" && !e.metaKey && !e.ctrlKey && !e.altKey) aHeld = true;
    if (e.key === "Escape") {
      host.escape();
      return;
    }
    if (viaHost) return;
    for (const a of list) {
      if (a.keys.some((k) => matches(k, e))) {
        e.preventDefault();
        a.run();
        return;
      }
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (areaArmed && !["Shift", "Meta", "Control", "Alt"].includes(e.key)) {
      const run = areaArmed;
      areaArmed = undefined;
      run();
    }
    if (e.key === " ") {
      space = false;
      root.classList.remove("is-space");
    }
    if (e.key === "a" || e.key === "A") aHeld = false;
  };
  const onDbl = (e: MouseEvent) => {
    // Our own two-click detection handles it; stop the browser selecting text.
    if (host.hit(e.target).kind !== "ui" && !editable(e.target)) e.preventDefault();
  };
  const onBlur = () => {
    space = false;
    aHeld = false;
    root.classList.remove("is-space");
  };
  const onOver = (e: PointerEvent) => {
    if (mode.kind !== "none") return;
    const hit = host.hit(e.target);
    host.hover(
      hit.kind === "node"
        ? (hit.chip ?? hit.id)
        : hit.kind === "win"
          ? `win:${hit.key}`
          : hit.kind === "pill"
            ? `pill:${hit.id}`
            : null,
    );
  };
  const onLeave = () => host.hover(null);

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  root.addEventListener("wheel", onWheel, { passive: false });
  root.addEventListener("contextmenu", onContextMenu);
  root.addEventListener("touchend", onTouchEnd, { passive: false });
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);
  root.addEventListener("dblclick", onDbl);
  root.addEventListener("pointerover", onOver);
  root.addEventListener("pointerleave", onLeave);
  window.addEventListener("blur", onBlur);
  return () => {
    root.removeEventListener("pointerdown", onDown);
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerup", onUp);
    root.removeEventListener("pointercancel", onUp);
    root.removeEventListener("wheel", onWheel);
    root.removeEventListener("contextmenu", onContextMenu);
    root.removeEventListener("touchend", onTouchEnd);
    document.removeEventListener("keydown", onKey);
    unregister?.();
    document.removeEventListener("keyup", onKeyUp);
    root.removeEventListener("dblclick", onDbl);
    root.removeEventListener("pointerover", onOver);
    root.removeEventListener("pointerleave", onLeave);
    window.removeEventListener("blur", onBlur);
    if (wheelTimer) clearTimeout(wheelTimer);
    cancelLong();
  };
}
