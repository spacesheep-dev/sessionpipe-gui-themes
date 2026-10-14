// SPDX-License-Identifier: Apache-2.0
import type { Page } from "@playwright/test";

export const HARNESS = "/harness.html?tick=0&scheme=dark";

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

/** The world's scale from its transform (the zoom label rounds). */
export async function scale(page: Page): Promise<number> {
  await settle(page);
  return page.evaluate(() => {
    const m = /scale\(([-\d.]+)\)/.exec((document.querySelector(".cv-world") as HTMLElement).style.transform);
    return Number(m![1]);
  });
}

/** The window's world position from its transform. */
export async function worldPos(page: Page, key: string) {
  await settle(page);
  return page.evaluate((k) => {
    const el = document.querySelector(`.cv-win[data-key="${CSS.escape(k)}"]`) as HTMLElement;
    const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform);
    return { x: Number(m![1]), y: Number(m![2]), w: el.offsetWidth, h: el.offsetHeight };
  }, key);
}

export async function zoom(page: Page): Promise<number> {
  const t = await page.locator(".cv-zoom").textContent();
  return Number(t!.replace("%", "")) / 100;
}

export async function stored(page: Page) {
  return page.evaluate(() => window.__harness.stored() as { windows: Record<string, { x: number; y: number }> } | null);
}

export const parentWindows = (page: Page) => page.locator(".cv-win:not(.is-sub)");

/** Turn the map on and wait for the Fit that follows it to land. */
export async function mapOn(page: Page) {
  await page.click(".cv-btn:has-text('Map')");
  await page.waitForTimeout(320);
  await settle(page);
}
