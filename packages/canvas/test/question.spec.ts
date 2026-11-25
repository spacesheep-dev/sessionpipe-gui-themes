// SPDX-License-Identifier: Apache-2.0
// Claude Code's question (AskUserQuestion) arrives as a permission, but Allow and Deny
// cannot carry the option chosen: the window and its menu offer neither, and say where
// it is answered.
import { expect, test } from "@playwright/test";
import { menus, open, settle } from "./helpers";

const SMALL = "&world=small";
const WIN_H = 100; // WIN_H in src/types.ts; an answerable window is WIN_H_ASK, 132
const QUESTION = -1; // QUESTION_ASK in dev/mock.ts: the AskUserQuestion permission

test("control: a question offers no Allow / Deny, in the window or its menu, and says to answer it on its computer", async ({
  page,
}) => {
  await open(page, SMALL);
  const key = (await page.locator('.cv-win[data-state="needs_you"]').first().getAttribute("data-key"))!;
  await page.evaluate(({ k, i }) => window.__harness.world.raise(k, i), { k: key, i: QUESTION });
  await settle(page);
  const win = page.locator(`.cv-win[data-key="${key}"]`);
  await expect(win).toHaveAttribute("data-state", "needs_you");
  await expect(win).not.toHaveClass(/is-ask/);
  // Laid out at the height of a window with nothing to answer here, not the taller asking one.
  await expect.poll(() => win.evaluate((e) => (e as HTMLElement).offsetHeight)).toBe(WIN_H);
  await expect(win.getByRole("button", { name: "Allow" })).toBeHidden();
  await expect(win.getByRole("button", { name: "Deny" })).toBeHidden();
  const machine = await page.evaluate((k) => window.__harness.world.sessions().get(k)!.machine, key);
  expect(machine).toBeTruthy();
  await expect(win.locator(".cv-win-wait")).toHaveText(`Answer it on ${machine}`);
  // One line, however long the machine's name.
  expect(await win.locator(".cv-win-wait").evaluate((e) => getComputedStyle(e).whiteSpace)).toBe("nowrap");

  await win.locator(".cv-win-meta").click({ button: "right" });
  const m = (await menus(page)).at(-1)!;
  expect(m.key).toBe(key);
  expect(m.answer ?? []).toEqual([]);

  // A permission Allow can answer still offers both, with the terminal line hidden.
  await page.keyboard.press("Escape");
  await page.evaluate((k) => window.__harness.world.raise(k, 0), key);
  await expect(win).toHaveClass(/is-ask/);
  await expect.poll(() => win.evaluate((e) => (e as HTMLElement).offsetHeight)).toBe(132);
  await expect(win.getByRole("button", { name: "Allow" })).toBeVisible();
  await expect(win.locator(".cv-win-wait")).toBeHidden();
});
