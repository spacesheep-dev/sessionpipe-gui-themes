// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "@playwright/test";
import { open, worldPos } from "./helpers";

test("phone: windows stack in one column and a tap on the arrow opens the session", async ({ page }) => {
  await open(page);
  const xs = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".cv-win:not(.is-sub)")].map((el) =>
      Number(/translate3d\(([-\d.]+)px/.exec(el.style.transform)![1]),
    ),
  );
  expect(new Set(xs).size).toBe(1);
  const win = page.locator(".cv-win:not(.is-sub)").first();
  const key = (await win.getAttribute("data-key"))!;
  await win.locator(".cv-win-open").tap();
  await expect(page.locator("#log")).toHaveText(`openSession(${key} · split)`);
});

test("phone: one finger drags a window; two taps on the title expand it", async ({ page }) => {
  await open(page);
  // The stack puts needs-you first, so this one is at the top of the screen.
  const win = page.locator('.cv-win[data-state="needs_you"]').first();
  const key = (await win.getAttribute("data-key"))!;
  const before = await worldPos(page, key);
  const bar = await win.locator(".cv-win-bar").boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const x = bar!.x + 60;
  const y = bar!.y + 12;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + i * 10, y: y + i * 20 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const after = await worldPos(page, key);
  expect(after.y).toBeGreaterThan(before.y + 50);
  const bar2 = win.locator(".cv-win-bar");
  await bar2.tap();
  await bar2.tap();
  await expect(win).toHaveClass(/is-expanded/);
});
