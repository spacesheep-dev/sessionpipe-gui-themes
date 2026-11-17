// SPDX-License-Identifier: Apache-2.0
// The Map view (lanes, sessions as rows under their machine, lines on hover, hand-drawn
// nodes and links), control from a window, and the one-signal rule for windows.
import { expect, test } from "@playwright/test";
import { menuItem, open, settle, stored, view } from "./helpers";

const SMALL = "&world=small";

test("map: four lanes, no hub; devices once each, agents without account ids, machines and repos plain", async ({
  page,
}) => {
  await open(page, SMALL);
  await view(page, "map");
  const lanes = await page.locator(".cv-lane-l").allTextContents();
  expect(lanes).toEqual(["Devices", "Agents", "Machines", "Repos"]);
  await expect(page.locator('.cv-node[data-kind="hub"]')).toHaveCount(0);
  await expect(page.locator('.cv-node[data-kind="machine"]')).toHaveCount(2);
  await expect(page.locator('.cv-node[data-kind="device"]')).toHaveCount(5); // 3 browsers + 2 passkeys
  await expect(page.locator('.cv-node[data-kind="device"].is-current .cv-node-s')).toHaveText("you");
  // Agents by name; an account only by its email, never its id.
  await expect(page.locator('.cv-node[data-kind="agent"] .cv-node-l')).toHaveText(["Claude Code", "Codex"]);
  await expect(page.locator('.cv-node[data-id="agent:claude-code"] .cv-node-s')).toHaveText("2 accounts");
  const map = (await page.locator(".cv-nodes").first().textContent()) ?? "";
  expect(map).not.toMatch(/acct_|not paired|github\.com/);
  // One glyph per machine: the strongest state of its sessions.
  await expect(page.locator('.cv-node[data-id="machine:misha-air"] .dot')).toHaveClass(/dot--needs_you/);
  await expect(page.locator('.cv-node[data-id="machine:misha-air"] .dot')).toHaveCount(1);
  // Sessions are rows under their machine.
  const r = await page.evaluate(() => {
    const tf = (e: HTMLElement) => {
      const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(e.style.transform)!;
      return { x: Number(m[1]), y: Number(m[2]) };
    };
    const node = tf(document.querySelector<HTMLElement>('.cv-node[data-id="machine:studio"]')!);
    const rows = [...document.querySelectorAll<HTMLElement>(".cv-win.is-row")]
      .filter((w) => w.textContent?.includes("Playwright flake hunt"))
      .map(tf);
    return { node, rows, all: document.querySelectorAll(".cv-win.is-row").length };
  });
  expect(r.all).toBe(4);
  expect(r.rows[0]!.x).toBe(r.node.x);
  expect(r.rows[0]!.y).toBeGreaterThan(r.node.y);
  // No pills on the map.
  await expect(page.locator(".cv-pill")).toHaveCount(0);
});

test("map: lines show for what is hovered, and only then", async ({ page }) => {
  await open(page, SMALL);
  await view(page, "map");
  expect(await page.locator(".cv-edge:visible").count()).toBe(0);
  await page.hover('.cv-node[data-id="machine:misha-air"]');
  await expect(page.locator(".spcv")).toHaveClass(/is-focus/);
  await expect.poll(() => page.locator(".cv-edge.is-lit:visible").count()).toBeGreaterThan(0);
  await page.mouse.move(5, 500);
  await expect(page.locator(".spcv")).not.toHaveClass(/is-focus/);
  expect(await page.locator(".cv-edge:visible").count()).toBe(0);
});

test("map: hand-drawn nodes and a link are kept; Backspace removes the selected link", async ({ page }) => {
  await open(page, SMALL);
  await view(page, "map");
  for (const [label, x] of [
    ["lavalier mic", 1200],
    ["pen", 1300],
  ] as const) {
    await page.mouse.click(x, 820, { button: "right" });
    await menuItem(page, "New node").click();
    await page.keyboard.type(label);
    await page.keyboard.press("Enter");
  }
  await expect(page.locator(".cv-node-custom")).toHaveCount(2);
  await expect
    .poll(async () =>
      Object.values((await stored(page))?.map.custom ?? {})
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
  await expect.poll(async () => (await stored(page))?.map.links.length).toBe(1);
  await page.keyboard.press("Backspace");
  await expect(page.locator(".cv-edge-custom:not(.is-temp)")).toHaveCount(0);
  await expect.poll(async () => (await stored(page))?.map.links.length).toBe(0);
  // Hand-drawn nodes belong to the Map only.
  await view(page, "state");
  await expect(page.locator(".cv-node-custom:visible")).toHaveCount(0);
});

test("control: the expanded window carries the prompt where the host can send, nothing where it can't", async ({
  page,
}) => {
  await open(page, SMALL);
  const online = page.locator('.cv-win[data-state="working"]').filter({ hasText: "misha-air" }).first();
  await online.locator(".cv-win-title").dblclick();
  await expect(online.locator(".cv-ctl-input")).toBeVisible();
  const offline = page.locator(".cv-win").filter({ hasText: "studio" }).first();
  await offline.locator(".cv-win-title").dblclick();
  await expect(offline).toHaveClass(/is-expanded/);
  await expect(offline.locator(".cv-ctl-input")).toBeHidden();
  // The reason is the status bar's, said once.
  await expect(page.locator(".cv-hint > span").first()).toHaveText("Studio's daemon is offline");
  await expect(page.locator(".cv-pair")).toBeHidden();
});

test("control: Enter sends a prompt and the message's lifecycle renders above the line", async ({ page }) => {
  await open(page, SMALL);
  const win = page.locator('.cv-win[data-state="working"]').filter({ hasText: "misha-air" }).first();
  const key = (await win.getAttribute("data-key"))!;
  await win.locator(".cv-win-title").dblclick();
  await win.locator(".cv-ctl-input").fill("Run the e2e suite");
  await win.locator(".cv-ctl-input").press("Enter");
  const act = page.locator(`.cv-win[data-key="${key}"] .cv-act`).first();
  await expect(act).toHaveAttribute("data-outcome", /queued|taken/);
  await expect(act.locator(".cv-act-text")).toHaveText("Run the e2e suite");
  await expect(act).toHaveAttribute("data-outcome", "delivered", { timeout: 6000 });
  const calls = await page.evaluate(() => window.__harness.world.calls);
  expect(calls).toContainEqual({ kind: "send", args: [key, "Run the e2e suite"] });
});

test("control: a send nobody can vouch for is said in words, not as its raw outcome", async ({ page }) => {
  await open(page, SMALL);
  const win = page.locator('.cv-win[data-state="working"]').filter({ hasText: "misha-air" }).first();
  const key = (await win.getAttribute("data-key"))!;
  await win.locator(".cv-win-title").dblclick();
  // Rows as the GUI (0.8.2 and later) hands them to a view: `unconfirmed` is newer than this
  // repo's copy of the wire types, so they go in as plain data.
  await page.evaluate((session) => {
    const w = window.__harness.world;
    const at = new Date().toISOString();
    const rows = [
      { id: "msg_word", outcome: "unconfirmed" },
      { id: "msg_job", outcome: "unconfirmed", code: "no_job" },
      { id: "msg_gone", outcome: "failed", code: "untracked" },
    ].map((r) => ({ machineId: "m_misha-air", kind: "prompt", session, text: r.id, at, expiresAt: at, ...r }));
    w.control = [...(rows as unknown as typeof w.control), ...w.control];
    w.onChange();
  }, key);
  const state = (id: string) => page.locator(`.cv-win[data-key="${key}"] .cv-act[data-message="${id}"] .cv-act-state`);
  await expect(state("msg_word")).toHaveText("No word · misha-air took it and said nothing more");
  await expect(state("msg_job")).toHaveText("Not followed · spacesheep didn't say which job it is");
  await expect(state("msg_gone")).toHaveText("Not followed · sent through an account that's no longer connected");
  const row = (id: string) => page.locator(`.cv-win[data-key="${key}"] .cv-act[data-message="${id}"]`);
  // Not known to have failed, so not shown as a failure.
  await expect(row("msg_gone")).toHaveAttribute("data-outcome", "untracked");
  // The same row without the code is a failure like any other, and is read again.
  await page.evaluate(() => {
    const w = window.__harness.world;
    w.control = w.control.map((a) => (a.id === "msg_gone" ? { ...a, code: undefined } : a));
    w.onChange();
  });
  await expect(state("msg_gone")).toHaveText("Failed · the path errored");
  await expect(row("msg_gone")).toHaveAttribute("data-outcome", "failed");
});

test("control: a send nobody heard the answer to says it may have been sent", async ({ page }) => {
  await open(page, SMALL);
  const win = page.locator('.cv-win[data-state="working"]').filter({ hasText: "misha-air" }).first();
  const key = (await win.getAttribute("data-key"))!;
  await win.locator(".cv-win-title").dblclick();
  // Rows as the GUI's account/unheard.ts hands them over: `unheard` is newer than this repo's
  // copy of the wire types, so they go in as plain data. The window lists three rows, so each
  // step puts in at most three, in place of the session's others.
  const put = (rows: Record<string, unknown>[]) =>
    page.evaluate(
      ({ session, rows }) => {
        const w = window.__harness.world;
        const at = new Date().toISOString();
        const full = rows.map((r) => ({
          machineId: "m_misha-air",
          kind: "prompt",
          session,
          text: r.id,
          at,
          expiresAt: at,
          ...r,
        }));
        w.control = [...(full as unknown as typeof w.control), ...w.control.filter((x) => x.session !== session)];
        w.onChange();
      },
      { session: key, rows },
    );
  const state = (id: string) => page.locator(`.cv-win[data-key="${key}"] .cv-act[data-message="${id}"] .cv-act-state`);
  const row = (id: string) => page.locator(`.cv-win[data-key="${key}"] .cv-act[data-message="${id}"]`);
  const why = "spacesheep did not answer in time.";
  await put([
    { id: "msg_asking", code: "hub_unknown", detail: why, unheard: { state: "asking" } },
    { id: "msg_unknown", outcome: "unconfirmed", code: "hub_unknown", detail: why, unheard: { state: "unknown" } },
    {
      id: "msg_unsent",
      outcome: "failed",
      code: "never_started",
      detail: "the machine is busy",
      unheard: { state: "unsent", status: 409 },
    },
  ]);
  const maybe = "May have been sent · spacesheep did not answer in time. Look at the session before sending it again";
  await expect(state("msg_asking")).toHaveText(maybe);
  await expect(state("msg_unknown")).toHaveText(maybe);
  await expect(state("msg_unsent")).toHaveText("Not sent · the machine is busy");
  // Still being asked about: neither queued nor failed. Known not sent: shown as an error.
  await expect(row("msg_asking")).toHaveAttribute("data-outcome", "unheard");
  await expect(row("msg_unsent")).toHaveAttribute("data-outcome", "failed");
  // The cut line is whole on hover.
  await expect(state("msg_asking")).toHaveAttribute("title", maybe);
  // The app's words for it change while the row stays unheard: the row is drawn again.
  await page.evaluate(() => {
    const w = window.__harness.world;
    w.control = w.control.map((a) => (a.id === "msg_asking" ? { ...a, detail: "spacesheep is restarting" } : a));
    w.onChange();
  });
  await expect(state("msg_asking")).toHaveText(
    "May have been sent · spacesheep is restarting. Look at the session before sending it again",
  );
  // No detail of its own (an empty one counts as none): the app's reason is said, and words
  // that end in their own stop get no second one.
  await put([
    { id: "msg_blank", code: "hub_unknown", detail: "", unheard: { state: "unknown", reason: "the hub timed out" } },
    { id: "msg_asked", code: "hub_unknown", detail: "did it start?", unheard: { state: "asking" } },
    { id: "msg_reason", detail: " ", unheard: { state: "unsent", reason: "spacesheep is down" } },
  ]);
  await expect(state("msg_blank")).toHaveText(
    "May have been sent · the hub timed out. Look at the session before sending it again",
  );
  await expect(state("msg_asked")).toHaveText(
    "May have been sent · did it start? Look at the session before sending it again",
  );
  await expect(state("msg_reason")).toHaveText("Not sent · spacesheep is down");
  // Known not sent, worded by spacesheep's status and code the way the GUI's sendErrorWords
  // words them.
  await put([
    { id: "msg_refused", code: "bad_session", detail: "x", unheard: { state: "unsent", status: 422 } },
    { id: "msg_unpaired", code: "not_found", detail: "x", unheard: { state: "unsent", status: 404 } },
    { id: "msg_key", code: "spacesheep_unauthorized", unheard: { state: "unsent", status: 401 } },
  ]);
  await expect(state("msg_refused")).toHaveText("Not sent · bad session");
  await expect(state("msg_unpaired")).toHaveText("Not sent · this machine is no longer paired here");
  await expect(state("msg_key")).toHaveText(
    "Not sent · spacesheep no longer takes this app's key: connect again in Settings → App",
  );
  // The two refusals the GUI's account code itself settles a row with, in the GUI's words.
  await put([
    { id: "msg_old", code: "too_old", unheard: { state: "unsent", status: 422 } },
    { id: "msg_confirm", code: "confirm_required", unheard: { state: "unsent", status: 422 } },
  ]);
  await expect(state("msg_old")).toHaveText("Not sent · signed too long ago; send it again");
  await expect(state("msg_confirm")).toHaveText(
    "Not sent · held for you to confirm; send it from the session's page to confirm it",
  );
});

test("control: Allow answers in place (a taller window with two buttons); Deny from the menu", async ({ page }) => {
  await open(page, SMALL);
  const win = page.locator('.cv-win[data-state="needs_you"]').first();
  const key = (await win.getAttribute("data-key"))!;
  await expect(win).toHaveClass(/is-ask/);
  expect(await win.evaluate((e) => (e as HTMLElement).offsetHeight)).toBe(132);
  await expect(win.locator(".cv-win-ask-x code")).toHaveText("rm -rf dist && npm run build");
  await win.getByRole("button", { name: "Allow" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__harness.world.calls.filter((c) => c.kind === "answer").length))
    .toBe(1);
  const call = await page.evaluate(() => window.__harness.world.calls.find((c) => c.kind === "answer")!);
  expect(call.args).toEqual([key, expect.any(String), "allow", undefined]);
  await expect(page.locator(`.cv-win[data-key="${key}"]`)).not.toHaveAttribute("data-state", "needs_you", {
    timeout: 6000,
  });
  await page.evaluate((k) => window.__harness.world.raise(k, 0), key);
  await page.locator(`.cv-win[data-key="${key}"] .cv-win-meta`).click({ button: "right" });
  await menuItem(page, "Deny").click();
  await expect
    .poll(() => page.evaluate(() => window.__harness.world.calls.filter((c) => c.kind === "answer").length))
    .toBe(2);
});

test("control: dragging an agent onto a machine starts a session there", async ({ page }) => {
  await open(page, SMALL);
  await view(page, "map");
  const agent = page.locator('.cv-node[data-id="agent:claude-code"] .cv-node-l');
  const cb = await agent.boundingBox();
  const m = page.locator('.cv-node[data-id="machine:misha-air"]');
  const mb = await m.boundingBox();
  await page.mouse.move(cb!.x + 8, cb!.y + 8);
  await page.mouse.down();
  await page.mouse.move(mb!.x + 30, mb!.y + 16, { steps: 10 });
  await expect(page.locator(".cv-ghost")).toBeVisible();
  await page.mouse.up();
  const pop = page.locator(".cv-pop");
  await expect(pop).toBeVisible();
  await expect(pop.locator(".cv-pop-t")).toHaveText("Start Claude Code on misha-air");
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
  await expect(pop).toBeHidden();
  await expect(page.locator(".cv-win.is-row").filter({ hasText: "Fix the flaky phone test" })).toBeVisible({
    timeout: 8000,
  });
});

test("control: the start form says why when the machine is offline", async ({ page }) => {
  await open(page, SMALL);
  await view(page, "map");
  const chip = await page.locator('.cv-node[data-kind="agent"]').first().boundingBox();
  const m = await page.locator('.cv-node[data-id="machine:studio"]').boundingBox();
  await page.mouse.move(chip!.x + 8, chip!.y + 8);
  await page.mouse.down();
  await page.mouse.move(m!.x + 30, m!.y + 16, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".cv-pop-reason")).toHaveText("studio's daemon is offline");
  await expect(page.locator(".cv-pop-start")).toBeDisabled();
  await page.keyboard.press("Escape");
});

test("one signal: no stripe, tint, coloured border, age fade or latest mark on any window", async ({ page }) => {
  await open(page, SMALL);
  await settle(page);
  const look = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".cv-win")].map((w) => {
      const cs = getComputedStyle(w);
      return {
        state: w.dataset.state,
        shadow: cs.boxShadow,
        border: cs.borderTopColor,
        style: cs.borderTopStyle,
        bar: getComputedStyle(w.querySelector(".cv-win-bar")!).backgroundColor,
        age: w.dataset.age ?? null,
        opacity: getComputedStyle(w.querySelector(".cv-win-body")!).opacity,
      };
    }),
  );
  const borders = new Set(look.map((l) => l.border));
  expect(borders.size).toBe(1);
  for (const l of look) {
    expect(l.shadow).toBe("none");
    expect(l.style).toBe("solid");
    expect(l.bar).toBe("rgba(0, 0, 0, 0)");
    expect(l.age).toBeNull();
    expect(l.opacity).toBe("1");
  }
  // The state is the glyph alone.
  await expect(page.locator('.cv-win[data-state="needs_you"] .cv-win-glyph')).toHaveClass(/dot--needs_you/);
  await expect(page.locator('.cv-win[data-state="working"] .cv-win-glyph').first()).toHaveClass(/dot--working/);
  await expect(page.locator(".cv-btn:has-text('Colour'), .cv-legend, .cv-win-latest")).toHaveCount(0);
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
