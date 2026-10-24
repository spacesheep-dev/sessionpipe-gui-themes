// SPDX-License-Identifier: Apache-2.0
import type { ThemeApi } from "@sessionpipe-gui/theme-types";

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

const inlineSrc = new WeakMap<HTMLElement, string>();

/** A one-line preview without its Markdown: `code` becomes mono without the ticks, and
 *  emphasis, links and heading marks are dropped. `md: false` sets plain text. Rebuilt
 *  only when the text changed. */
export function setInline(e: HTMLElement, text: string, md = true) {
  const src = md ? text : `\u0000${text}`;
  if (inlineSrc.get(e) === src) return;
  inlineSrc.set(e, src);
  if (!md || !/[`*_[#]/.test(text)) {
    e.textContent = text;
    return;
  }
  const plain = text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,:;!?]|$)/g, "$1$2")
    .replace(/(^|\s)#{1,6} /g, "$1");
  e.replaceChildren(
    ...plain
      .split(/`([^`]+)`/)
      .map((part, i) => (i % 2 ? el("code", "cv-code", part) : document.createTextNode(part.replace(/`/g, "")))),
  );
}

export const isTouchLike = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

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
