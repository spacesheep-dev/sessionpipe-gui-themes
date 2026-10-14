// SPDX-License-Identifier: Apache-2.0
// The session tree, the map lanes, hand-drawn nodes and links, and control from a window.
import { expect, test } from "@playwright/test";
import { mapOn, open, settle, stored, worldPos } from "./helpers";

const SMALL = "&world=small";

test("subagents stand in a column to the right of their parent and move with it", async ({ page }) => {
  await open(page, SMALL);
  const subs = page.locator(".cv-win.is-sub");
  await expect(subs).toHaveCount(2);
  const subKey = (await subs.first().getAttribute("data-key"))!;
  const parentId = await page.evaluate((k) => window.__harness.sessions().find((s) => s.key === k)!.parentId, subKey);
  const parent = page.locator(`.cv-win[data-key$=":${parentId}"]`);
  const pKey = (await parent.getAttribute("data-key"))!;
  const p = await worldPos(page, pKey);
  const a = await worldPos(page, (await subs.nth(0).getAttribute("data-key"))!);
  const b = await worldPos(page, (await subs.nth(1).getAttribute("data-key"))!);
  expect(a.x).toBeGreaterThan(p.x + p.w);
  expect(b.x).toBe(a.x);
  expect(b.y).toBeGreaterThan(a.y);
  await expect(page.locator(".cv-tether")).toHaveCount(2);
  const bar = await parent.locator(".cv-win-bar").boundingBox();
  await page.mouse.move(bar!.x + 40, bar!.y + 12);
  await page.mouse.down();
  await page.mouse.move(bar!.x + 160, bar!.y + 72, { steps: 6 });
  await page.mouse.up();
  const p2 = await worldPos(page, pKey);
  const a2 = await worldPos(page, (await subs.nth(0).getAttribute("data-key"))!);
  expect(a2.x - a.x).toBeCloseTo(p2.x - p.x, 0);
  expect(a2.y - a.y).toBeCloseTo(p2.y - p.y, 0);
});

test("finished subagents fold into a chip on the parent and unfold on click", async ({ page }) => {
  await open(page, SMALL);
  const subKey = (await page.locator(".cv-win.is-sub").first().getAttribute("data-key"))!;
  const parentId = await page.evaluate((k) => window.__harness.sessions().find((s) => s.key === k)!.parentId, subKey);
  const parent = page.locator(`.cv-win[data-key$=":${parentId}"]`);
  await page.evaluate((k) => window.__harness.world.end(k), subKey);
  await expect(page.locator(`.cv-win[data-key="${subKey}"]`)).toHaveCount(0);
  await expect(parent.locator(".cv-win-kids")).toHaveText("1 done");
  await parent.locator(".cv-win-kids").click();
  await expect(page.locator(`.cv-win[data-key="${subKey}"]`)).toHaveAttribute("data-state", "done");
  await expect
    .poll(async () => (await stored(page)) as unknown as { showDone?: Record<string, true> })
    .toHaveProperty("showDone");
});

test("map lanes: devices, hub, agents with accounts, machines, repos", async ({ page }) => {
  await open(page, SMALL);
  await mapOn(page);
  await expect(page.locator('.cv-node[data-kind="machine"]')).toHaveCount(2);
  await expect(page.locator(".cv-chip-a")).toHaveCount(3);
  await expect(page.locator('.cv-node[data-kind="repo"]')).toHaveCount(2);
  await expect(page.locator('.cv-node[data-kind="device"]')).toHaveCount(5); // 3 viewers + 2 passkeys
  await expect(page.locator('.cv-node[data-kind="device"].is-current .cv-node-s')).toHaveText("you");
  await expect(page.locator('.cv-node[data-kind="hub"]')).toHaveCount(1);
  const ys = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>(".cv-lane")].map((l) => [
        l.dataset.lane,
        Number(/, ([-\d.]+)px/.exec(l.style.transform)![1]),
      ]),
    ),
  );
  expect(ys.devices).toBeLessThan(ys.agents);
  expect(ys.agents).toBeLessThan(ys.machines);
  expect(ys.machines).toBeLessThan(ys.storage);
  const edges = await page.locator(".cv-edge").count();
  expect(edges).toBeGreaterThan(5);
  await expect.poll(async () => (await stored(page)) as unknown as { mapOn?: boolean }).toHaveProperty("mapOn", true);
  // A lane node drags along its lane only.
  const m = page.locator('.cv-node[data-kind="machine"]').first();
  const b0 = await m.boundingBox();
  await page.mouse.move(b0!.x + 20, b0!.y + 16);
  await page.mouse.down();
  await page.mouse.move(b0!.x + 220, b0!.y + 116, { steps: 6 });
  await page.mouse.up();
  await settle(page);
  const b1 = await m.boundingBox();
  expect(b1!.x - b0!.x).toBeGreaterThan(150);
  expect(Math.abs(b1!.y - b0!.y)).toBeLessThan(2);
});

test("hovering a machine lights its lines and steps the rest back", async ({ page }) => {
  await open(page, SMALL);
  await mapOn(page);
  await page.hover('.cv-node[data-kind="machine"]');
  await expect(page.locator(".spcv")).toHaveClass(/is-focus/);
  await expect.poll(() => page.locator(".cv-edge.is-lit").count()).toBeGreaterThan(0);
  const dimmed = await page
    .locator('.cv-node[data-kind="repo"]:not(.is-lit)')
    .first()
    .evaluate((e) => getComputedStyle(e).opacity);
  expect(Number(dimmed)).toBeLessThan(1);
  await page.mouse.move(5, 500);
  await expect(page.locator(".spcv")).not.toHaveClass(/is-focus/);
});

test("hand-drawn nodes and a link persist; Backspace removes the selected link", async ({ page }) => {
  await open(page, SMALL);
  await page.click(".cv-btn-add");
  await page.keyboard.type("lavalier mic");
  await page.keyboard.press("Enter");
  await page.click(".cv-btn-add");
  await page.keyboard.type("pen");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cv-node-custom")).toHaveCount(2);
  await expect
    .poll(async () =>
      Object.values(
        ((await stored(page)) as unknown as { custom?: Record<string, { label: string }> } | null)?.custom ?? {},
      )
        .map((c) => c.label)
        .sort(),
    )
    .toEqual(["lavalier mic", "pen"]);
  const a = page.locator(".cv-node-custom").first();
  const b = page.locator(".cv-node-custom").nth(1);
  await a.hover();
  const h = await a.locator(".cv-node-h").boundingBox();
  const bb = await b.boundingBox();
  await page.mouse.move(h!.x + 4, h!.y + 4);
  await page.mouse.down();
  await page.mouse.move(bb!.x + bb!.width / 2, bb!.y + bb!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".cv-edge-custom:not(.is-temp)")).toHaveCount(1);
  await expect
    .poll(async () => ((await stored(page)) as unknown as { links?: unknown[] } | null)?.links?.length)
    .toBe(1);
  // The new link is selected; Backspace removes it.
  await page.keyboard.press("Backspace");
  await expect(page.locator(".cv-edge-custom:not(.is-temp)")).toHaveCount(0);
  await expect
    .poll(async () => ((await stored(page)) as unknown as { links?: unknown[] } | null)?.links?.length)
    .toBe(0);
});

test("control: a prompt line where the host can send, the reason where it cannot", async ({ page }) => {
  await open(page, SMALL);
  const online = page.locator(".cv-win:not(.is-sub)").filter({ hasText: "misha-air" }).first();
  await expect(online.locator(".cv-ctl-input")).toBeVisible();
  const offline = page.locator(".cv-win:not(.is-sub)").filter({ hasText: "studio" }).first();
  await expect(offline.locator(".cv-ctl-reason")).toHaveText("studio's daemon is offline");
  await expect(offline.locator(".cv-ctl-input")).toBeHidden();
});

test("control: Enter sends a prompt and the message's lifecycle renders under the line", async ({ page }) => {
  await open(page, SMALL);
  const win = page.locator('.cv-win[data-state="working"]:not(.is-sub)').filter({ hasText: "misha-air" }).first();
  const key = (await win.getAttribute("data-key"))!;
  await win.locator(".cv-ctl-input").fill("Run the e2e suite");
  await win.locator(".cv-ctl-input").press("Enter");
  const act = page.locator(`.cv-win[data-key="${key}"] .cv-act`).first();
  await expect(act).toHaveAttribute("data-outcome", /queued|taken/);
  await expect(act.locator(".cv-act-text")).toHaveText("Run the e2e suite");
  await expect(act).toHaveAttribute("data-outcome", "delivered", { timeout: 6000 });
  const calls = await page.evaluate(() => window.__harness.world.calls);
  expect(calls).toContainEqual({ kind: "send", args: [key, "Run the e2e suite"] });
  await expect(page.locator(`.cv-win[data-key="${key}"] .cv-ctl-input`)).toHaveValue("");
});

test("control: Allow answers in place, and `a` from the keyboard does too", async ({ page }) => {
  await open(page, SMALL);
  const win = page.locator('.cv-win[data-state="needs_you"]').first();
  const key = (await win.getAttribute("data-key"))!;
  await expect(win.locator(".cv-win-att")).toHaveClass(/is-local/);
  await win.locator(".cv-win-att .cv-link", { hasText: "Allow" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__harness.world.calls.filter((c) => c.kind === "answer").length))
    .toBe(1);
  const call = await page.evaluate(() => window.__harness.world.calls.find((c) => c.kind === "answer")!);
  expect(call.args[0]).toBe(key);
  expect(call.args[2]).toBe("allow");
  await expect(page.locator(`.cv-win[data-key="${key}"]`)).not.toHaveAttribute("data-state", "needs_you", {
    timeout: 6000,
  });
  // Raise another and answer with the key.
  await page.evaluate((k) => window.__harness.world.raise(k, 0), key);
  await page.locator(`.cv-win[data-key="${key}"]`).click({ position: { x: 100, y: 60 } });
  await page.keyboard.press("d");
  await expect
    .poll(() => page.evaluate(() => window.__harness.world.calls.filter((c) => c.kind === "answer").length))
    .toBe(2);
});

test("control: dragging an agent onto a machine starts a session there", async ({ page }) => {
  await open(page, SMALL);
  await mapOn(page);
  const chip = page.locator('.cv-chip-a[data-harness="claude-code"]').first();
  const account = await chip.getAttribute("data-account");
  const cb = await chip.boundingBox();
  const m = page.locator('.cv-node[data-id="machine:misha-air"]');
  const mb = await m.boundingBox();
  await page.mouse.move(cb!.x + 8, cb!.y + 8);
  await page.mouse.down();
  await page.mouse.move(mb!.x + 30, mb!.y + 16, { steps: 10 });
  await expect(page.locator(".cv-ghost")).toBeVisible();
  await page.mouse.up();
  const pop = page.locator(".cv-pop");
  await expect(pop).toBeVisible();
  await expect(pop.locator(".cv-pop-t")).toHaveText("Start claude on misha-air");
  await expect(pop.locator(".cv-pop-start")).toBeDisabled();
  await pop.locator(".cv-pop-text").fill("Fix the flaky phone test");
  await pop.locator(".cv-pop-start").click();
  await expect
    .poll(() => page.evaluate(() => window.__harness.world.calls.filter((c) => c.kind === "start").length))
    .toBe(1);
  const call = await page.evaluate(() => window.__harness.world.calls.find((c) => c.kind === "start")!);
  expect(call.args[0]).toBe("m_misha-air");
  expect(call.args[1]).toEqual({
    harness: "claude-code",
    cwd: "/Users/misha/Desktop/Projects/sessionpipe",
    text: "Fix the flaky phone test",
  });
  expect(account).toBeTruthy();
  await expect(pop).toBeHidden();
  // When the machine acks, the new window appears above its node.
  const win = page.locator(".cv-win").filter({ hasText: "Fix the flaky phone test" });
  await expect(win).toBeVisible({ timeout: 8000 });
  const wb = await win.boundingBox();
  const mb2 = await m.boundingBox();
  expect(wb!.y + wb!.height).toBeLessThanOrEqual(mb2!.y + 1);
  expect(Math.abs(wb!.x + wb!.width / 2 - (mb2!.x + mb2!.width / 2))).toBeLessThan(200);
});

test("control: the popover says why when the machine is offline", async ({ page }) => {
  await open(page, SMALL);
  await mapOn(page);
  const chip = await page.locator(".cv-chip-a").first().boundingBox();
  const m = await page.locator('.cv-node[data-id="machine:studio"]').boundingBox();
  await page.mouse.move(chip!.x + 8, chip!.y + 8);
  await page.mouse.down();
  await page.mouse.move(m!.x + 30, m!.y + 16, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".cv-pop-reason")).toHaveText("studio's daemon is offline");
  await expect(page.locator(".cv-pop-start")).toBeDisabled();
  await page.keyboard.press("Escape");
});

test("Enter on a focused window opens its prompt line", async ({ page }) => {
  await open(page, SMALL);
  const win = page.locator(".cv-win:not(.is-sub)").filter({ hasText: "misha-air" }).first();
  await win.click({ position: { x: 100, y: 60 } });
  await page.keyboard.press("Enter");
  await expect(win.locator(".cv-ctl-input")).toBeFocused();
});

for (const scheme of ["dark", "light"] as const) {
  test(`${scheme}: a window stands off the floor by at least the bg/bg-2 step`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, `&scheme=${scheme}`);
    const r = await page.evaluate(() => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      const rgb = (css: string) => {
        ctx.fillStyle = "#000";
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0]!, d[1]!, d[2]!];
      };
      const luma = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
      const root = document.querySelector(".spcv") as HTMLElement;
      const win = document.querySelector(".cv-win") as HTMLElement;
      const cs = getComputedStyle(root);
      const floor = luma(rgb(cs.backgroundColor));
      const card = luma(rgb(getComputedStyle(win).backgroundColor));
      const step = Math.abs(luma(rgb(cs.getPropertyValue("--bg"))) - luma(rgb(cs.getPropertyValue("--bg-2"))));
      return { floor, card, step };
    });
    expect(Math.abs(r.card - r.floor)).toBeGreaterThanOrEqual(r.step - 0.5);
    expect(r.step).toBeGreaterThan(0);
  });
}
