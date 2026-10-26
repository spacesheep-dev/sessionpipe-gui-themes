// SPDX-License-Identifier: Apache-2.0
// A phone: one column in every view, pills under their parent, a long-press for the
// action sheet, and nothing it does writes a position.
import { expect, test } from "@playwright/test";
import { menus, open, worldPos } from "./helpers";

const xs = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".cv-win")].map((el) =>
      Number(/translate3d\(([-\d.]+)px/.exec(el.style.transform)![1]),
    ),
  );

test("phone: one column, the view as a pop-up, and a tap on ↗ opens the session", async ({ page }) => {
  await open(page);
  expect(new Set(await xs(page)).size).toBe(1);
  await expect(page.locator(".cv-views")).toBeHidden();
  await expect(page.locator(".cv-view-chip")).toHaveText("View: State");
  await page.locator(".cv-view-chip").tap();
  expect((await menus(page)).at(-1)!.items).toEqual([
    "State",
    "Machine",
    "Harness",
    "Repo",
    "Label",
    "My layout",
    "Map",
  ]);
  await page.locator(".hm").getByRole("menuitemradio", { name: "Machine" }).tap();
  await page.waitForTimeout(400);
  expect(new Set(await xs(page)).size).toBe(1);
  const win = page.locator(".cv-win").first();
  const key = (await win.getAttribute("data-key"))!;
  await win.locator(".cv-win-open").tap();
  await expect(page.locator("#log")).toHaveText(`openSession(${key} · split)`);
});

test("phone: pills stack under their parent, indented", async ({ page }) => {
  await open(page);
  const parent = await page.evaluate(
    () => window.__harness.sessions().find((s) => s.agents.some((a) => !a.session))!.key,
  );
  const p = await worldPos(page, parent);
  const pill = page.locator(`.cv-pill[data-parent="${parent}"]`).first();
  const q = await worldPos(page, (await pill.getAttribute("data-pill"))!, ".cv-pill[data-pill=");
  expect(q.x).toBe(p.x + 24);
  expect(q.y).toBe(p.y + p.h + 8);
});

test("phone: a long-press opens the window's menu as a sheet", async ({ page }) => {
  await open(page);
  // The top window, so the finger lands on screen (the stack is taller than the phone).
  const win = page.locator('.cv-win[data-state="needs_you"]').first();
  const box = (await win.locator(".cv-win-meta").boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + 40;
  const y = box.y + 8;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(600);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const m = (await menus(page)).at(-1)!;
  expect(m.kind).toBe("session");
  expect(m.source).toBe("touch");
  await expect(page.locator(".hm.is-sheet")).toBeVisible();
});

test("phone: one finger pans (nothing moves); two taps expand; Tidy and My layout leave the document alone", async ({
  page,
}) => {
  await open(page);
  const etag0 = await page.evaluate(() => window.__harness.etag());
  const win = page.locator('.cv-win[data-state="needs_you"]').first();
  const key = (await win.getAttribute("data-key"))!;
  const before = await worldPos(page, key);
  const bar = (await win.locator(".cv-win-bar").boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = bar.x + 60;
  const y = bar.y + 12;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + i * 4, y: y + i * 20 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect(await worldPos(page, key)).toEqual(before);
  const t = win.locator(".cv-win-title");
  await t.tap();
  await t.tap();
  await expect(win).toHaveClass(/is-expanded/);
  // My layout on a phone: computed, one column; Tidy re-fits and stores nothing.
  await page.locator(".cv-view-chip").tap();
  await page.locator(".hm").getByRole("menuitemradio", { name: "My layout" }).tap();
  await page.waitForTimeout(400);
  expect(new Set(await xs(page)).size).toBe(1);
  await page.keyboard.press("Shift+T");
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__harness.etag())).toBe(etag0);
  expect(await page.evaluate(() => window.__harness.storageLog.length)).toBe(0);
});
