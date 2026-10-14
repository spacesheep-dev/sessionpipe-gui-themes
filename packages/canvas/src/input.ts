// SPDX-License-Identifier: Apache-2.0
// Pointer, wheel and keyboard, turned into calls on the canvas. One pointer drags a
// window, a zone or the canvas; two pointers pinch. Nothing here touches the DOM beyond
// pointer capture and cursors.
import { GRID, type Viewport } from "./types";
import { clamp } from "./util";

export type Hit =
  | { kind: "win"; key: string; part: "body" | "resize" | "scroll" | "control" | "bar" }
  | { kind: "zone"; name: string; part: "label" | "resize" }
  | { kind: "ui" }
  | { kind: "canvas" };

export interface InputHost {
  root: HTMLElement;
  vp(): Viewport;
  panBy(dx: number, dy: number): void;
  zoomAt(sx: number, sy: number, factor: number): void;
  zoomStep(dir: 1 | -1): void;
  fit(): void;
  hit(target: EventTarget | null): Hit;
  /** The window's absolute world rect and current size. */
  winRect(key: string): { x: number; y: number; w: number; h: number } | null;
  moveWin(key: string, x: number, y: number): void;
  resizeWin(key: string, w: number, h: number): void;
  zoneRect(name: string): { x: number; y: number; w: number; h: number } | null;
  moveZone(name: string, x: number, y: number): void;
  resizeZone(name: string, w: number, h: number): void;
  focusWin(key: string): void;
  toggleExpand(key: string): void;
  nudgeFocused(dx: number, dy: number): void;
  expandFocused(): void;
  focusSearch(): void;
  clearSearch(): void;
  /** The gesture ended: persist. */
  commit(): void;
}

interface Pointer {
  id: number;
  x: number;
  y: number;
  type: string;
}

type Mode =
  | { kind: "none" }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "drag"; key: string; part: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { kind: "resize"; key: string; sx: number; sy: number; ow: number; oh: number }
  | { kind: "zone"; name: string; sx: number; sy: number; ox: number; oy: number }
  | { kind: "zone-resize"; name: string; sx: number; sy: number; ow: number; oh: number }
  | { kind: "pinch"; d0: number; k0: number; mx: number; my: number };

const TAP_MS = 350;
const DRAG_PX = 3;

export function attachInput(host: InputHost): () => void {
  const root = host.root;
  const pointers = new Map<number, Pointer>();
  let mode: Mode = { kind: "none" };
  let space = false;
  let lastTap: { key: string; at: number } | undefined;

  const pt = (e: PointerEvent) => {
    const r = root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const snap = (v: number, on: boolean) => (on ? Math.round(v / GRID) * GRID : v);

  const startPinch = () => {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return;
    const d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    mode = { kind: "pinch", d0, k0: host.vp().k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    root.classList.add("is-panning");
  };

  const onDown = (e: PointerEvent) => {
    const hit = host.hit(e.target);
    if (hit.kind === "ui") return;
    if (hit.kind === "win" && hit.part === "control") return;
    if (hit.kind === "win" && hit.part === "scroll" && !space) {
      // Mouse drags select / scroll inside the rows; touch scrolls them via touch-action.
      host.focusWin(hit.key);
      return;
    }
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    const p = pt(e);
    pointers.set(e.pointerId, { id: e.pointerId, x: p.x, y: p.y, type: e.pointerType });
    root.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch" && pointers.size === 2) {
      startPinch();
      return;
    }
    if (pointers.size > 1) return;
    const v = host.vp();
    if (space || hit.kind === "canvas") {
      mode = { kind: "pan", sx: p.x, sy: p.y, vx: v.x, vy: v.y };
      root.classList.add("is-panning");
    } else if (hit.kind === "win") {
      host.focusWin(hit.key);
      const r = host.winRect(hit.key);
      if (!r) return;
      if (hit.part === "resize") mode = { kind: "resize", key: hit.key, sx: p.x, sy: p.y, ow: r.w, oh: r.h };
      else mode = { kind: "drag", key: hit.key, part: hit.part, sx: p.x, sy: p.y, ox: r.x, oy: r.y, moved: false };
    } else if (hit.kind === "zone") {
      const r = host.zoneRect(hit.name);
      if (!r) return;
      if (hit.part === "resize") mode = { kind: "zone-resize", name: hit.name, sx: p.x, sy: p.y, ow: r.w, oh: r.h };
      else mode = { kind: "zone", name: hit.name, sx: p.x, sy: p.y, ox: r.x, oy: r.y };
    }
    if (mode.kind !== "none" && e.pointerType === "mouse") e.preventDefault();
  };

  const onMove = (e: PointerEvent) => {
    const rec = pointers.get(e.pointerId);
    if (!rec) return;
    const p = pt(e);
    rec.x = p.x;
    rec.y = p.y;
    const k = host.vp().k;
    switch (mode.kind) {
      case "pan":
        host.panBy(p.x - mode.sx, p.y - mode.sy);
        mode.sx = p.x;
        mode.sy = p.y;
        break;
      case "drag": {
        const dx = (p.x - mode.sx) / k;
        const dy = (p.y - mode.sy) / k;
        if (!mode.moved && Math.hypot(p.x - mode.sx, p.y - mode.sy) < DRAG_PX) return;
        if (!mode.moved) {
          mode.moved = true;
          root.classList.add("is-dragging");
        }
        host.moveWin(mode.key, snap(mode.ox + dx, e.shiftKey), snap(mode.oy + dy, e.shiftKey));
        break;
      }
      case "resize":
        host.resizeWin(
          mode.key,
          snap(mode.ow + (p.x - mode.sx) / k, e.shiftKey),
          snap(mode.oh + (p.y - mode.sy) / k, e.shiftKey),
        );
        break;
      case "zone":
        host.moveZone(
          mode.name,
          snap(mode.ox + (p.x - mode.sx) / k, e.shiftKey),
          snap(mode.oy + (p.y - mode.sy) / k, e.shiftKey),
        );
        break;
      case "zone-resize":
        host.resizeZone(mode.name, mode.ow + (p.x - mode.sx) / k, mode.oh + (p.y - mode.sy) / k);
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

  const onUp = (e: PointerEvent) => {
    const had = pointers.delete(e.pointerId);
    if (!had) return;
    try {
      root.releasePointerCapture(e.pointerId);
    } catch {}
    if (mode.kind === "pinch") {
      if (pointers.size === 0) end();
      return;
    }
    if (mode.kind === "drag" && !mode.moved) {
      // A click or tap on a window; two on the bar expand it. (The browser's dblclick is
      // no use here: pointer capture retargets it to the root.)
      const now = performance.now();
      const onBar = mode.part === "bar";
      if (onBar && lastTap && lastTap.key === mode.key && now - lastTap.at < TAP_MS) {
        host.toggleExpand(mode.key);
        lastTap = undefined;
      } else lastTap = { key: mode.key, at: now };
    }
    end();
  };

  const end = () => {
    const was = mode.kind;
    mode = { kind: "none" };
    root.classList.remove("is-panning", "is-dragging");
    if (was !== "none" && was !== "pan" && was !== "pinch") host.commit();
    else if (was === "pan" || was === "pinch") host.commit();
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
    const p = pt(e as unknown as PointerEvent);
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
    wheelCommit();
  };
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  const wheelCommit = () => {
    if (wheelTimer) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => host.commit(), 250);
  };

  const ours = () => {
    const a = document.activeElement;
    return !a || a === document.body || a === document.documentElement || root.contains(a);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!ours()) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (typing) {
      if (e.key === "Escape") {
        host.clearSearch();
        (t as HTMLInputElement).blur();
        root.focus();
        e.preventDefault();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const step = e.shiftKey ? GRID * 4 : GRID;
    switch (e.key) {
      case " ":
        space = true;
        root.classList.add("is-space");
        e.preventDefault();
        return;
      case "/":
        host.focusSearch();
        e.preventDefault();
        return;
      case "Escape":
        host.clearSearch();
        if (t && t !== root) root.focus();
        return;
      case "0":
        host.fit();
        break;
      case "+":
      case "=":
        host.zoomStep(1);
        break;
      case "-":
      case "_":
        host.zoomStep(-1);
        break;
      case "ArrowLeft":
        host.nudgeFocused(-step, 0);
        break;
      case "ArrowRight":
        host.nudgeFocused(step, 0);
        break;
      case "ArrowUp":
        host.nudgeFocused(0, -step);
        break;
      case "ArrowDown":
        host.nudgeFocused(0, step);
        break;
      case "Enter":
        host.expandFocused();
        break;
      default:
        return;
    }
    e.preventDefault();
    host.commit();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " ") {
      space = false;
      root.classList.remove("is-space");
    }
  };
  const onDbl = (e: MouseEvent) => {
    // Our own two-click detection handles expanding; stop the browser selecting text.
    if (host.hit(e.target).kind !== "ui") e.preventDefault();
  };
  const onBlur = () => {
    space = false;
    root.classList.remove("is-space");
  };

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  root.addEventListener("wheel", onWheel, { passive: false });
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);
  root.addEventListener("dblclick", onDbl);
  window.addEventListener("blur", onBlur);
  return () => {
    root.removeEventListener("pointerdown", onDown);
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerup", onUp);
    root.removeEventListener("pointercancel", onUp);
    root.removeEventListener("wheel", onWheel);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("keyup", onKeyUp);
    root.removeEventListener("dblclick", onDbl);
    window.removeEventListener("blur", onBlur);
    if (wheelTimer) clearTimeout(wheelTimer);
  };
}
