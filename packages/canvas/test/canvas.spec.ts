// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "@playwright/test";
import { open, parentWindows, scale, stored, worldPos, zoom } from "./helpers";

test("drag moves a window and the position lands in storage", async ({ page }) => {
  await open(page);
  const win = parentWindows(page).first();
  const key = (await win.getAttribute("data-key"))!;
  const before = await worldPos(page, key);
  const k = await scale(page);
  const bar = await win.locator(".cv-win-bar").boundingBox();
  await page.mouse.move(bar!.x + 40, bar!.y + 12);
  await page.mouse.down();
  await page.mouse.move(bar!.x + 140, bar!.y + 92, { steps: 6 });
  await page.mouse.move(bar!.x + 240, bar!.y + 172, { steps: 6 });
  await page.mouse.up();
  const after = await worldPos(page, key);
  expect(after.x - before.x).toBeCloseTo(200 / k, 0);
  expect(after.y - before.y).toBeCloseTo(160 / k, 0);
  await expect.poll(async () => (await stored(page))?.windows[key]?.x).toBeCloseTo(after.x, 0);
  await expect.poll(async () => (await stored(page))?.windows[key]?.y).toBeCloseTo(after.y, 0);
});

test("shift snaps a drag to the 8 px grid", async ({ page }) => {
  await open(page);
  const win = parentWindows(page).nth(1);
  const key = (await win.getAttribute("data-key"))!;
  const bar = await win.locator(".cv-win-bar").boundingBox();
  await page.keyboard.down("Shift");
  await page.mouse.move(bar!.x + 40, bar!.y + 12);
  await page.mouse.down();
  await page.mouse.move(bar!.x + 77, bar!.y + 51, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const p = await worldPos(page, key);
  expect(p.x % 8).toBe(0);
  expect(p.y % 8).toBe(0);
});

test("resizing from the corner grows the window", async ({ page }) => {
  await open(page);
  const win = parentWindows(page).nth(2);
  const key = (await win.getAttribute("data-key"))!;
  const before = await worldPos(page, key);
  const h = await win.locator(".cv-win-resize").boundingBox();
  await page.mouse.move(h!.x + 8, h!.y + 8);
  await page.mouse.down();
  await page.mouse.move(h!.x + 108, h!.y + 68, { steps: 6 });
  await page.mouse.up();
  const after = await worldPos(page, key);
  expect(after.w).toBeGreaterThan(before.w + 50);
  expect(after.h).toBeGreaterThan(before.h + 30);
});

test("zoom: ctrl+wheel, keys, and 0 to fit", async ({ page }) => {
  await open(page);
  const k0 = await zoom(page);
  await page.mouse.move(700, 450);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 200);
  await page.keyboard.up("Control");
  await expect.poll(() => zoom(page)).toBeLessThan(k0);
  const k1 = await zoom(page);
  await page.keyboard.press("+");
  await expect.poll(() => zoom(page)).toBeGreaterThan(k1);
  await page.keyboard.press("0");
  await expect.poll(() => zoom(page)).toBeCloseTo(k0, 1);
  // Bounds: 0.25–2.
  for (let i = 0; i < 12; i++) await page.keyboard.press("-");
  await expect.poll(() => zoom(page)).toBe(0.25);
  for (let i = 0; i < 20; i++) await page.keyboard.press("+");
  await expect.poll(() => zoom(page)).toBe(2);
});

test("tidy puts needs-you windows in the first column", async ({ page }) => {
  await open(page);
  await page.click(".cv-btn:has-text('Tidy')");
  await page.waitForTimeout(500);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".cv-win:not(.is-sub)")].map((el) => ({
      state: el.dataset.state,
      x: Number(/translate3d\(([-\d.]+)px/.exec(el.style.transform)![1]),
    })),
  );
  const needs = rows.filter((r) => r.state === "needs_you");
  const others = rows.filter((r) => r.state !== "needs_you");
  expect(needs.length).toBeGreaterThan(0);
  const x0 = needs[0]!.x;
  for (const r of needs) expect(r.x).toBe(x0);
  for (const r of others) expect(r.x).toBeGreaterThan(x0);
});

test("double-click expands a window and streams its rows; again collapses", async ({ page }) => {
  await open(page);
  const key = (await page.locator('.cv-win[data-state="working"]:not(.is-sub)').first().getAttribute("data-key"))!;
  const win = page.locator(`.cv-win[data-key="${key}"]`);
  const before = await worldPos(page, key);
  await win.locator(".cv-win-bar").dblclick();
  await expect(win).toHaveClass(/is-expanded/);
  await expect(win.locator(".cv-row").first()).toBeVisible();
  const rows = await win.locator(".cv-row").count();
  const after = await worldPos(page, key);
  expect(after.w).toBeGreaterThan(before.w);
  // A live event for this session appends a row.
  await page.evaluate((k) => window.__harness.world.raise(k, 1), key);
  await expect.poll(() => win.locator(".cv-row").count()).toBeGreaterThan(rows);
  await win.locator(".cv-win-bar").dblclick();
  await expect(win).not.toHaveClass(/is-expanded/);
  expect((await worldPos(page, key)).w).toBe(before.w);
});

test("search highlights matches and dims the rest; Escape clears", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__harness.world.spawnSession({ title: "Zebra crossing audit" }));
  await page.keyboard.press("/");
  await expect(page.locator(".cv-search")).toBeFocused();
  await page.keyboard.type("zebra");
  await expect(page.locator(".cv-win.is-hit")).toHaveCount(1);
  const total = await page.locator(".cv-win").count();
  await expect(page.locator(".cv-win.is-dim")).toHaveCount(total - 1);
  await expect(page.locator(".cv-status")).toHaveText("1 match");
  await page.keyboard.press("Escape");
  await expect(page.locator(".cv-win.is-dim")).toHaveCount(0);
  await expect(page.locator(".cv-search")).toHaveValue("");
});

test("a new session lands in free space, overlapping nothing", async ({ page }) => {
  await open(page);
  const key = await page.evaluate(() => window.__harness.world.spawnSession({ title: "Brand new" }));
  const win = page.locator(`.cv-win[data-key="${key}"]`);
  await expect(win).toBeVisible();
  await page.waitForTimeout(300);
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".cv-win")].map((el) => ({
      key: el.dataset.key,
      r: el.getBoundingClientRect().toJSON(),
    })),
  );
  const mine = boxes.find((b) => b.key === key)!.r;
  for (const b of boxes) {
    if (b.key === key) continue;
    const r = b.r;
    const apart =
      mine.x >= r.x + r.width || mine.x + mine.width <= r.x || mine.y >= r.y + r.height || mine.y + mine.height <= r.y;
    expect(apart, `overlaps ${b.key}`).toBe(true);
  }
  await expect.poll(async () => (await stored(page))?.windows[key]).toBeTruthy();
});

test("close hides a window into the tray until its state changes", async ({ page }) => {
  await open(page);
  const win = page.locator('.cv-win[data-state="idle"]:not(.is-sub)').first();
  const key = (await win.getAttribute("data-key"))!;
  await win.locator(".cv-win-close").click();
  await expect(page.locator(`.cv-win[data-key="${key}"]`)).toHaveCount(0);
  await expect(page.locator(".cv-tray .cv-chip")).toHaveCount(1);
  await page.evaluate((k) => window.__harness.world.raise(k, 0), key);
  await expect(page.locator(`.cv-win[data-key="${key}"]`)).toHaveClass(/is-needs/);
  await expect(page.locator(".cv-tray")).toBeHidden();
});

test("a session that ends leaves the canvas for the done shelf", async ({ page }) => {
  await open(page);
  const n0 = await page.locator(".cv-win:not(.is-sub)").count();
  await expect(page.locator(".cv-shelf-btn")).toHaveText("Done · 3");
  const key = await page.evaluate(() => {
    const k = window.__harness.world
      .keys("working")
      .find((x) => !window.__harness.sessions().find((s) => s.key === x)?.parentId)!;
    window.__harness.world.end(k);
    return k;
  });
  await expect(page.locator(`.cv-win[data-key="${key}"]`)).toHaveCount(0);
  expect(await page.locator(".cv-win:not(.is-sub)").count()).toBe(n0 - 1);
  await expect(page.locator(".cv-shelf-btn")).toHaveText("Done · 4");
  await page.click(".cv-shelf-btn");
  await expect(page.locator(".cv-tile")).toHaveCount(4);
});

test("subagents follow their parent", async ({ page }) => {
  await open(page);
  const sub = page.locator(".cv-win.is-sub").first();
  const subKey = (await sub.getAttribute("data-key"))!;
  const parentId = await page.evaluate((k) => window.__harness.sessions().find((s) => s.key === k)!.parentId, subKey);
  const parent = page.locator(`.cv-win[data-key$=":${parentId}"]`);
  const pKey = (await parent.getAttribute("data-key"))!;
  const s0 = await worldPos(page, subKey);
  const p0 = await worldPos(page, pKey);
  const bar = await parent.locator(".cv-win-bar").boundingBox();
  await page.mouse.move(bar!.x + 40, bar!.y + 12);
  await page.mouse.down();
  await page.mouse.move(bar!.x + 140, bar!.y + 62, { steps: 6 });
  await page.mouse.up();
  const s1 = await worldPos(page, subKey);
  const p1 = await worldPos(page, pKey);
  expect(s1.x - s0.x).toBeCloseTo(p1.x - p0.x, 0);
  expect(s1.y - s0.y).toBeCloseTo(p1.y - p0.y, 0);
  await expect(page.locator(".cv-tether")).toHaveCount(2);
});

test("arrow keys nudge the focused window; the title arrow opens the session", async ({ page }) => {
  await open(page);
  const win = parentWindows(page).first();
  const key = (await win.getAttribute("data-key"))!;
  await win.click({ position: { x: 100, y: 80 } });
  const before = await worldPos(page, key);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  const after = await worldPos(page, key);
  expect(after.x - before.x).toBe(8);
  expect(after.y - before.y).toBe(8);
  await win.locator(".cv-win-open").click();
  await expect(page.locator("#log")).toHaveText(`openSession(${key} · split)`);
  const opened = await page.evaluate(() => window.__harness.lastOpen());
  const box = await win.boundingBox();
  expect(opened?.key).toBe(key);
  const opts = opened?.opts as { split: boolean; from: { x: number; y: number; width: number; height: number } };
  expect(opts.split).toBe(true);
  expect(opts.from.x).toBeCloseTo(box!.x, 0);
  expect(opts.from.width).toBeCloseTo(box!.width, 0);
});

test("Enter on a focused window without a prompt line opens the session split", async ({ page }) => {
  await open(page, "&control=0");
  const win = parentWindows(page).first();
  const key = (await win.getAttribute("data-key"))!;
  await win.click({ position: { x: 100, y: 80 } });
  await page.keyboard.press("Enter");
  await expect(page.locator("#log")).toHaveText(`openSession(${key} · split)`);
  await expect(win).not.toHaveClass(/is-expanded/);
});
