// SPDX-License-Identifier: Apache-2.0
import type { Page } from "@playwright/test";

export const HARNESS = "/harness.html?tick=0&scheme=dark";

export interface StoredDoc {
  v: number;
  windows: Record<string, { x: number; y: number; w?: number; h?: number; expanded?: boolean }>;
  areas: Record<
    string,
    {
      title: string;
      x: number;
      y: number;
      w: number;
      h: number;
      label?: string;
      members: Record<string, { dx: number; dy: number }>;
    }
  >;
  notes: Record<string, { text: string; x: number; y: number; w: number; h: number; label?: string }>;
  hidden: Record<string, string>;
  showDone: string[];
  map: { custom: Record<string, { label: string }>; links: unknown[]; nodes: Record<string, { x: number }> };
}

export async function open(page: Page, extra = "") {
  await page.goto(HARNESS + extra);
  await page.waitForSelector(".cv-win");
  // The layout is placed and fitted after storage resolves; let the first Fit land.
  await page.waitForTimeout(350);
  await settle(page);
}

/** Two frames: whatever the canvas scheduled has been applied. */
export const settle = (page: Page) =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** The world's scale from its transform. */
export async function scale(page: Page): Promise<number> {
  await settle(page);
  return page.evaluate(() => {
    const m = /scale\(([-\d.]+)\)/.exec((document.querySelector(".cv-world") as HTMLElement).style.transform);
    return Number(m![1]);
  });
}

/** An element's world position from its transform, and its size. */
export async function worldPos(page: Page, key: string, sel = ".cv-win[data-key=") {
  await settle(page);
  return page.evaluate(
    ({ k, sel }) => {
      const el = document.querySelector(`${sel}"${CSS.escape(k)}"]`) as HTMLElement;
      const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform);
      return { x: Number(m![1]), y: Number(m![2]), w: el.offsetWidth, h: el.offsetHeight };
    },
    { k: key, sel },
  );
}

export async function zoom(page: Page): Promise<number> {
  const t = await page.locator(".cv-zoom-v").textContent();
  return Number(t!.replace("%", "")) / 100;
}

export async function stored(page: Page): Promise<StoredDoc | null> {
  return page.evaluate(() => window.__harness.stored() as Promise<StoredDoc | null>);
}

/** Switch views from the segmented control and let the 320 ms move land. */
export async function view(page: Page, id: string) {
  await page.click(`.cv-view[data-view="${id}"]`);
  await page.waitForTimeout(420);
  await settle(page);
}

/** The menus the canvas asked the host for, newest last. */
export const menus = (page: Page) =>
  page.evaluate(() => window.__harness.menus.map((m) => ({ ...m, items: [...m.items] }))) as Promise<
    {
      kind: string;
      key?: string;
      source?: string;
      title?: string;
      items: string[];
      answer?: string[];
      extra?: string[];
    }[]
  >;

/** A row of the drawn stand-in menu. */
export const menuItem = (page: Page, name: string | RegExp) =>
  page.locator(".hm").getByRole("menuitem", { name }).or(page.locator(".hm").getByRole("menuitemradio", { name }));

export const windows = (page: Page) => page.locator(".cv-win");
