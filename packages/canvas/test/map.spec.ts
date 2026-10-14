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

test("ten repos and a stale layout: every node inside its lane, lanes wrap, Fit shows them", async ({ page }) => {
  // A layout saved by an earlier build: absolute node x's far to the right, viewer ids
  // that no longer exist, an unlabelled custom node, lanes already anchored.
  const stale = {
    v: 1,
    windows: {},
    zones: {},
    zonesOn: false,
    shelfOpen: false,
    mapOn: true,
    lanes: { top: -48, bottom: 784 },
    nodes: {
      "dev:gone-1": { x: 1032 },
      "dev:gone-2": { x: 1085 },
      "repo:acme/service-01": { x: 2798 },
      "repo:acme/service-02": { x: 2530 },
      "machine:studio": { x: 4000 },
    },
    custom: { c_old: { id: "c_old", label: "", x: 768, y: 312 } },
  };
  await open(page, `${SMALL}&repos=10&layout=${encodeURIComponent(JSON.stringify(stale))}`);
  await page.waitForTimeout(400);
  await expect(page.locator('.cv-node[data-kind="repo"]')).toHaveCount(12);
  await expect(page.locator(".cv-node-custom")).toHaveCount(0);
  const r = await page.evaluate(() => {
    const tf = (e: HTMLElement) => {
      const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(e.style.transform)!;
      return { x: Number(m[1]), y: Number(m[2]) };
    };
    const lanes = [...document.querySelectorAll<HTMLElement>(".cv-lane")].map((l) => ({
      name: l.dataset.lane,
      ...tf(l),
      w: Number.parseFloat(l.style.width),
      h: Number.parseFloat(l.style.height),
    }));
    const order = ["devices", "", "agents", "machines", "storage"];
    const outside: string[] = [];
    for (const n of document.querySelectorAll<HTMLElement>(".cv-node:not(.cv-node-custom)")) {
      const kind = n.dataset.kind!;
      const lane = lanes[{ device: 0, hub: 1, agent: 2, machine: 3, repo: 4 }[kind]!]!;
      const p = tf(n);
      const inside =
        p.x >= lane.x &&
        p.x + n.offsetWidth <= lane.x + lane.w &&
        p.y >= lane.y &&
        p.y + n.offsetHeight <= lane.y + lane.h;
      if (!inside) outside.push(`${n.dataset.id} ${JSON.stringify(p)} vs ${JSON.stringify(lane)}`);
    }
    const storage = lanes[order.indexOf("storage")]!;
    return { outside, storageRows: Math.round((storage.h - 20) / 44), laneW: storage.w, lanes };
  });
  expect(r.outside).toEqual([]);
  expect(r.storageRows).toBeGreaterThanOrEqual(2);
  expect(r.laneW).toBeLessThanOrEqual(1400);
  // Fit brings the lanes on screen.
  await page.keyboard.press("0");
  await page.waitForTimeout(350);
  const vis = await page.evaluate(() => {
    const root = document.querySelector(".spcv")!.getBoundingClientRect();
    return [...document.querySelectorAll(".cv-lane")].every((l) => {
      const b = l.getBoundingClientRect();
      return (
        b.left >= root.left - 1 && b.right <= root.right + 1 && b.top >= root.top - 1 && b.bottom <= root.bottom + 1
      );
    });
  });
  expect(vis).toBe(true);
  // The stale positions are gone from storage; the kept ones are lane-relative and small.
  await expect
    .poll(async () => {
      const st = (await stored(page)) as unknown as { nodes?: Record<string, { x: number }> } | null;
      const nodes = st?.nodes ?? {};
      return Object.keys(nodes).some((k) => k.startsWith("dev:gone"))
        ? "stale"
        : Math.max(...Object.values(nodes).map((n) => n.x));
    })
    .toBeLessThan(1400);
});

test("colour: each state wears its own rule, tint and dot; the toggle takes it all away", async ({ page }) => {
  await open(page, SMALL);
  await expect(page.locator(".spcv")).toHaveClass(/has-colour/);
  await expect(page.locator(".cv-btn:has-text('Colour')")).toHaveClass(/is-on/);
  const styles = async () =>
    page.evaluate(() => {
      const pick = (state: string) =>
        document.querySelector(`.cv-win[data-state="${state}"]:not(.is-sub)`) as HTMLElement;
      const read = (w: HTMLElement) => ({
        rule: getComputedStyle(w).boxShadow,
        bar: getComputedStyle(w.querySelector(".cv-win-bar")!).backgroundColor,
        dot: getComputedStyle(w.querySelector(".cv-dot")!).backgroundColor,
        border: getComputedStyle(w).borderTopStyle,
        body: getComputedStyle(w.querySelector(".cv-win-body")!).opacity,
        now: getComputedStyle(w.querySelector(".cv-win-now-l")!).color,
      });
      const working = read(pick("working"));
      const idle = read(pick("idle"));
      const needs = read(pick("needs_you"));
      return { working, idle, needs };
    });
  const on = await styles();
  expect(on.working.rule).toContain("inset");
  expect(on.needs.rule).toContain("inset");
  expect(on.idle.rule).not.toContain("inset");
  expect(on.working.bar).not.toBe(on.idle.bar);
  expect(on.working.dot).not.toBe(on.idle.dot);
  expect(on.working.now).not.toBe(on.idle.now);
  // A stale one: dashed, body at 70 %.
  const key = (await page.locator('.cv-win[data-state="working"]:not(.is-sub)').first().getAttribute("data-key"))!;
  await page.evaluate((k) => window.__harness.world.age(k, 12 * 60_000), key);
  await page.evaluate((k) => {
    const s = window.__harness.sessions().find((x) => x.key === k)!;
    (s as { state: string }).state = "stale";
    window.__harness.world.onChange();
  }, key);
  const stale = page.locator(`.cv-win[data-key="${key}"]`);
  await expect(stale).toHaveAttribute("data-state", "stale");
  expect(await stale.evaluate((w) => getComputedStyle(w).borderTopStyle)).toBe("dashed");
  expect(await stale.locator(".cv-win-body").evaluate((b) => getComputedStyle(b).opacity)).toBe("0.7");
  // Off: grey again.
  await page.click(".cv-btn:has-text('Colour')");
  await expect(page.locator(".spcv")).not.toHaveClass(/has-colour/);
  const off = await styles();
  expect(off.working.rule).not.toContain("inset");
  expect(off.working.bar).toBe(off.idle.bar);
  expect(off.working.dot).not.toBe(on.working.dot);
  expect(off.working.now).not.toBe(on.working.now);
  expect(await stale.evaluate((w) => getComputedStyle(w).borderTopStyle)).toBe("solid");
  await expect.poll(() => page.evaluate(() => window.__harness.local.get("colour"))).toBe(false);
});

test("recency: the latest window is marked and the mark moves; old windows fade by bucket", async ({ page }) => {
  await open(page, SMALL);
  await expect(page.locator(".cv-win.is-latest")).toHaveCount(1);
  await expect(page.locator(".cv-win.is-latest .cv-win-latest")).toHaveText("latest");
  const other = page.locator('.cv-win[data-state="idle"]:not(.is-sub)').first();
  const key = (await other.getAttribute("data-key"))!;
  await page.evaluate((k) => window.__harness.world.touch(k), key);
  await expect(page.locator(`.cv-win[data-key="${key}"]`)).toHaveClass(/is-latest/);
  await expect(page.locator(".cv-win.is-latest")).toHaveCount(1);
  // Six hours old: the last bucket, border and title faded, body text not.
  const old = (await page.locator('.cv-win[data-state="working"]:not(.is-sub)').first().getAttribute("data-key"))!;
  await page.evaluate((k) => window.__harness.world.age(k, 7 * 3600_000), old);
  const w = page.locator(`.cv-win[data-key="${old}"]`);
  await expect(w).toHaveAttribute("data-age", "4");
  expect(await w.locator(".cv-win-title").evaluate((t) => getComputedStyle(t).opacity)).toBe("0.45");
  expect(await w.locator(".cv-win-text").evaluate((t) => getComputedStyle(t).opacity)).toBe("1");
  // Fresh again: bucket 0.
  await page.evaluate((k) => window.__harness.world.touch(k), old);
  await expect(w).toHaveAttribute("data-age", "0");
  // `?` shows the legend.
  await page.keyboard.press("?");
  await expect(page.locator(".cv-legend")).toBeVisible();
  await expect(page.locator(".cv-legend")).toContainText("needs you");
});

test("map: a machine's dot takes the strongest state of its sessions", async ({ page }) => {
  await open(page, SMALL);
  await mapOn(page);
  const dot = (m: string) => page.locator(`.cv-node[data-id="machine:${m}"] .cv-node-dot`);
  await expect(dot("misha-air")).toHaveAttribute("data-s", "needs");
  await expect(dot("studio")).toHaveAttribute("data-s", "working");
  const needsKey = (await page.locator('.cv-win[data-state="needs_you"]').first().getAttribute("data-key"))!;
  await page.evaluate((k) => window.__harness.world.clear(k), needsKey);
  await expect(dot("misha-air")).toHaveAttribute("data-s", "working");
  const teal = await dot("studio").evaluate((d) => getComputedStyle(d).backgroundColor);
  await page.click(".cv-btn:has-text('Colour')");
  expect(await dot("studio").evaluate((d) => getComputedStyle(d).backgroundColor)).not.toBe(teal);
});

test("edges: one trunk per target, hidden until hover by default, repos ordered by the windows", async ({ page }) => {
  await open(page, `${SMALL}&repos=4`);
  await page.click(".cv-btn:has-text('Tidy')");
  await page.waitForTimeout(400);
  await mapOn(page);
  await expect(page.locator(".cv-lines")).toHaveText("Lines · hovered");
  // Hovered mode: nothing drawn until something is hovered.
  expect(await page.locator(".cv-edge-session:visible").count()).toBe(0);
  expect(await page.locator(".cv-trunk:visible").count()).toBe(0);
  await page.hover('.cv-node[data-id="machine:misha-air"]');
  await expect.poll(() => page.locator(".cv-edge.is-lit:visible").count()).toBeGreaterThan(0);
  await expect(page.locator('.cv-trunk.is-lit[data-b="machine:misha-air"]')).toHaveCount(1);
  await page.mouse.move(5, 500);
  // All: one trunk per machine, every session edge ends on its bus (3 segments, no diagonals).
  await page.click(".cv-lines");
  await expect(page.locator(".cv-lines")).toHaveText("Lines · all");
  await expect(page.locator('.cv-trunk[data-b="machine:misha-air"]')).toHaveCount(1);
  const sessionsOnAir = await page.locator('.cv-edge-session[data-b="machine:misha-air"]').count();
  expect(sessionsOnAir).toBeGreaterThan(1);
  const shapes = await page.evaluate(() =>
    [...document.querySelectorAll<SVGPathElement>(".cv-edge-session")].map((p) => p.getAttribute("d")!),
  );
  for (const d of shapes) expect(d).toMatch(/^M[-\d.]+,[-\d.]+ L[-\d.]+,[-\d.]+ Q/); // down, then a rounded turn onto the bus
  await expect.poll(() => page.evaluate(() => window.__harness.local.get("lines"))).toBe("all");
  // Repo nodes follow the x of the windows they connect to.
  const order = await page.evaluate(() => {
    const wins = new Map<string, number>();
    for (const w of document.querySelectorAll<HTMLElement>(".cv-win:not(.is-sub)")) {
      const r = w.getBoundingClientRect();
      wins.set(`win:${w.dataset.key}`, r.x + r.width / 2);
    }
    const bary = new Map<string, number[]>();
    for (const e of document.querySelectorAll<SVGPathElement>('.cv-edge-session[data-b^="repo:"]')) {
      const x = wins.get(e.dataset.a!);
      if (x === undefined) continue;
      bary.set(e.dataset.b!, [...(bary.get(e.dataset.b!) ?? []), x]);
    }
    const nodes = [...document.querySelectorAll<HTMLElement>('.cv-node[data-kind="repo"]')]
      .map((n) => ({ id: n.dataset.id!, x: n.getBoundingClientRect().x, y: n.getBoundingClientRect().y }))
      .filter((n) => bary.has(n.id));
    const rows = new Map<number, typeof nodes>();
    for (const n of nodes) rows.set(Math.round(n.y), [...(rows.get(Math.round(n.y)) ?? []), n]);
    const sorted: boolean[] = [];
    for (const row of rows.values()) {
      row.sort((a, b) => a.x - b.x);
      const means = row.map((n) => bary.get(n.id)!.reduce((a, b) => a + b, 0) / bary.get(n.id)!.length);
      sorted.push(means.every((m, i) => i === 0 || m >= means[i - 1]! - 1));
    }
    return { rows: sorted, repos: nodes.length };
  });
  expect(order.repos).toBeGreaterThan(2);
  expect(order.rows.every(Boolean)).toBe(true);
  // None.
  await page.click(".cv-lines");
  await expect(page.locator(".cv-lines")).toHaveText("Lines · none");
  await page.hover('.cv-node[data-id="machine:misha-air"]');
  await page.waitForTimeout(100);
  expect(await page.locator(".cv-edge-session:visible").count()).toBe(0);
});
