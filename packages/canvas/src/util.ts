// SPDX-License-Identifier: Apache-2.0
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** textContent only when it changed: no layout work for an unchanged frame. */
export function setText(e: HTMLElement, text: string) {
  if (e.textContent !== text) e.textContent = text;
}

export function setClass(e: Element, cls: string, on: boolean) {
  if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
}

export const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function debounce<A extends unknown[]>(
  ms: number,
  fn: (...a: A) => void,
): ((...a: A) => void) & { flush(): void } {
  let t: ReturnType<typeof setTimeout> | undefined;
  let last: A | undefined;
  const d = (...a: A) => {
    last = a;
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = undefined;
      if (last) fn(...last);
      last = undefined;
    }, ms);
  };
  d.flush = () => {
    if (t) clearTimeout(t);
    t = undefined;
    if (last) fn(...last);
    last = undefined;
  };
  return d;
}

export const ms = (iso: string | undefined): number => (iso ? Date.parse(iso) : Number.NaN);

export function oneLine(s: string | undefined, max: number): string {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export const isTouchLike = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
