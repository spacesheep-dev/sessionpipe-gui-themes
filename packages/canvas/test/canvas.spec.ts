// SPDX-License-Identifier: Apache-2.0
// The views, the window, My layout (drag, areas, notes, undo), subagent pills, the
// right-click menus, and the document kept across reloads and devices.
import { expect, type Page, test } from "@playwright/test";
import { HARNESS, menuItem, menus, open, scale, settle, stored, view, windows, worldPos, zoom } from "./helpers";

const UNIT = 296; // a 280 px cell and its 16 px gap

/** Drag from the middle of a window's title bar by (dx, dy) screen px. */
async function dragWin(page: Page, key: string, dx: number, dy: number, shift = false) {
  const bar = await page.locator(`.cv-win[data-key="${key}"] .cv-win-title`).boundingBox();
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(bar!.x + 20, bar!.y + 8);
  await page.mouse.down();
  await page.mouse.move(bar!.x + 20 + dx / 2, bar!.y + 8 + dy / 2, { steps: 5 });
  await page.mouse.move(bar!.x + 20 + dx, bar!.y + 8 + dy, { steps: 5 });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
}

const keyOf = async (page: Page, sel: string) => (await page.locator(sel).first().getAttribute("data-key"))!;
/** The orchestrator with in-session agents in the default world. */
const parentKey = (page: Page) =>
  page.evaluate(() => window.__harness.sessions().find((s) => s.agents.some((a) => !a.session))!.key);

test("fresh: the State view, a clean grid under headings, nothing repeated in the windows", async ({ page }) => {
  await open(page);
  await expect(page.locator('.cv-view[data-view="state"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".cv-head .cv-head-t")).toHaveText(["Needs you", "Working", "Stale", "Idle"]);
  // Gone: footers, the latest word, the legend, zones, the prompt in every window, stripes.
  for (const gone of [".cv-win-foot", ".cv-win-latest", ".cv-legend", ".cv-zone", ".cv-win-close"]) {
    await expect(page.locator(gone)).toHaveCount(0);
  }
  await expect(page.locator(".cv-ctl-input:visible")).toHaveCount(0);
  const shadows = await windows(page).evaluateAll((els) => els.map((e) => getComputedStyle(e).boxShadow));
  for (const s of shadows) expect(s).toBe("none");
  // Every window sits on its group's grid: a whole number of cells from the heading.
  const r = await page.evaluate(() => {
    const tf = (e: HTMLElement) => {
      const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(e.style.transform)!;
      return { x: Number(m[1]), y: Number(m[2]) };
    };
    return {
      heads: [...document.querySelectorAll<HTMLElement>(".cv-head")].map(tf),
      wins: [...document.querySelectorAll<HTMLElement>(".cv-win")].map(tf),
    };
  });
  for (const w of r.wins) {
    const ok = r.heads.some((h) => w.x >= h.x && (w.x - h.x) % UNIT === 0 && w.y > h.y);
    expect(ok, JSON.stringify(w)).toBe(true);
  }
  // The control hint is said once, in the status bar, not in a window.
  await expect(page.locator(".cv-hint")).toHaveText(/daemon is offline/i);
  await expect(page.locator(".cv-win", { hasText: /daemon is offline/i })).toHaveCount(0);
});

test("the State view puts Needs you first, above everything else", async ({ page }) => {
  await open(page);
  await expect(page.locator(".cv-head").first()).toContainText("Needs you");
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".cv-win")].map((el) => ({
      state: el.dataset.state,
      y: Number(/translate3d\([-\d.]+px, ([-\d.]+)px/.exec(el.style.transform)![1]),
    })),
  );
  const needs = rows.filter((r) => r.state === "needs_you");
  expect(needs.length).toBeGreaterThan(0);
  const lowest = Math.max(...needs.map((r) => r.y));
  for (const r of rows.filter((r) => r.state !== "needs_you")) expect(r.y).toBeGreaterThan(lowest);
});

test("views: the keys switch, the move animates, every group has a heading, pills stay with their parent", async ({
  page,
}) => {
  await open(page);
  const parent = await parentKey(page);
  const cases: [string, string, RegExp][] = [
    ["3", "machine", /misha-air|studio/],
    ["4", "harness", /Claude Code/],
    ["5", "repo", /spacesheep-dev\/sessionpipe/],
    ["6", "label", /No label/],
    ["2", "state", /Needs you/],
  ];
  for (const [key, id, heading] of cases) {
    await page.keyboard.press(key);
    await expect(page.locator(".cv-world")).toHaveClass(/is-tidying/);
    await expect(page.locator(`.cv-view[data-view="${id}"]`)).toHaveAttribute("aria-checked", "true");
    await page.waitForTimeout(420);
    await expect(page.locator(".cv-head").filter({ hasText: heading }).first()).toBeVisible();
    // The parent's pills sit beside it, joined by tethers.
    const p = await worldPos(page, parent);
    const pills = page.locator(`.cv-pill[data-parent="${parent}"]`);
    await expect(pills).toHaveCount(3);
    const first = await worldPos(
      page,
      `${parent}#${await pills.first().getAttribute("data-agent")}`,
      ".cv-pill[data-pill=",
    );
    expect(first.x).toBe(p.x + p.w + 36);
    expect(first.y).toBe(p.y);
    expect(await page.locator(".cv-tether").count()).toBeGreaterThan(3);
  }
  expect(await page.evaluate(() => window.__harness.api.local.get("view"))).toBe("state");
});

test("a preset can't be arranged: a drag on a window pans and says where to arrange", async ({ page }) => {
  await open(page);
  const key = await keyOf(page, '.cv-win[data-state="idle"]');
  const before = await worldPos(page, key);
  await dragWin(page, key, 120, 60);
  expect(await worldPos(page, key)).toEqual(before);
  await expect(page.locator(".cv-say")).toHaveText("Arrange by hand in My layout");
  expect(Object.keys((await stored(page))?.windows ?? {})).toHaveLength(0);
});

test("My layout: a drag moves a window and the position lands in storage", async ({ page }) => {
  await open(page);
  await view(page, "layout");
  const key = await keyOf(page, '.cv-win[data-state="idle"]');
  const before = await worldPos(page, key);
  const k = await scale(page);
  await dragWin(page, key, 200, 160);
  const after = await worldPos(page, key);
  expect(after.x - before.x).toBeCloseTo(200 / k, 0);
  expect(after.y - before.y).toBeCloseTo(160 / k, 0);
  await expect.poll(async () => (await stored(page))?.windows[key]?.x).toBeCloseTo(after.x, 0);
  await expect.poll(async () => (await stored(page))?.windows[key]?.y).toBeCloseTo(after.y, 0);
});

test("My layout: shift snaps a drag to the 8 px grid; arrows nudge the selection", async ({ page }) => {
  await open(page);
  await view(page, "layout");
  const key = await keyOf(page, '.cv-win[data-state="idle"]');
  await dragWin(page, key, 77, 51, true);
  const p = await worldPos(page, key);
  expect(p.x % 8).toBe(0);
  expect(p.y % 8).toBe(0);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  const q = await worldPos(page, key);
  expect(q.x - p.x).toBe(1);
  expect(q.y - p.y).toBe(8);
  await expect.poll(async () => (await stored(page))?.windows[key]?.y).toBe(q.y);
});

test("double-click expands a window (360×420, rows streaming); in My layout it resizes and keeps it", async ({
  page,
}) => {
  await open(page);
  const key = await keyOf(page, '.cv-win[data-state="working"]');
  const win = page.locator(`.cv-win[data-key="${key}"]`);
  await win.locator(".cv-win-title").dblclick();
  await expect(win).toHaveClass(/is-expanded/);
  await expect(win.locator(".cv-row").first()).toBeVisible();
  expect((await worldPos(page, key)).w).toBe(360);
  const rows = await win.locator(".cv-row").count();
  await page.evaluate((k) => window.__harness.world.raise(k, 1), key);
  await expect.poll(() => win.locator(".cv-row").count()).toBeGreaterThan(rows);
  // No resizing in a preset; in My layout the corner grows it and the size is kept.
  await expect(win.locator(".cv-win-resize")).toBeHidden();
  await view(page, "layout");
  await win.locator(".cv-win-title").dblclick();
  await expect(win).toHaveClass(/is-expanded/);
  await settle(page);
  const h = await win.locator(".cv-win-resize").boundingBox();
  await page.mouse.move(h!.x + 4, h!.y + 4);
  await page.mouse.down();
  await page.mouse.move(h!.x + 104, h!.y + 64, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await worldPos(page, key)).w).toBeGreaterThan(400);
  const big = await worldPos(page, key);
  await expect.poll(async () => (await stored(page))?.windows[key]?.w).toBe(big.w);
  await page.keyboard.press("Enter");
  await expect(win).not.toHaveClass(/is-expanded/);
  expect((await worldPos(page, key)).w).toBe(280);
});

test("zoom: ctrl+wheel, keys, and 0 to fit; the zoom pop-up", async ({ page }) => {
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
  for (let i = 0; i < 12; i++) await page.keyboard.press("-");
  await expect.poll(() => zoom(page)).toBe(0.25);
  await page.click(".cv-zoom");
  await menuItem(page, "Actual size").click();
  await expect.poll(() => zoom(page)).toBe(1);
});

test("search: free text and tokens highlight and dim; Escape clears", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__harness.world.spawnSession({ title: "Zebra crossing audit", machine: "studio" }));
  await page.keyboard.press("/");
  await expect(page.locator(".cv-search input")).toBeFocused();
  await page.keyboard.type("zebra");
  await expect(page.locator(".cv-win.is-hit")).toHaveCount(1);
  await expect(page.locator(".cv-say")).toHaveText("1 match");
  await page.locator(".cv-search input").fill("machine:misha-air");
  const air = await page.locator(".cv-win", { hasText: "misha-air" }).count();
  await expect(page.locator(".cv-win.is-hit")).toHaveCount(air);
  await page.locator(".cv-search input").fill("harness:codex -machine:studio");
  await expect(page.locator(".cv-win.is-hit")).toHaveCount(
    await page.evaluate(
      () =>
        window.__harness.sessions().filter((s) => s.harness === "codex" && s.machine !== "studio" && s.state !== "done")
          .length,
    ),
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".cv-win.is-dim")).toHaveCount(0);
  await expect(page.locator(".cv-search input")).toHaveValue("");
});

test("My layout: a new session lands in free space, overlapping nothing, and is stored", async ({ page }) => {
  await open(page);
  await view(page, "layout");
  const key = await page.evaluate(() => window.__harness.world.spawnSession({ title: "Brand new" }));
  const win = page.locator(`.cv-win[data-key="${key}"]`);
  await expect(win).toBeVisible();
  await page.waitForTimeout(300);
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".cv-win, .cv-pill")].map((el) => ({
      key: el.dataset.key ?? el.dataset.pill,
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

test("Hide until it changes, from the window's menu: Hidden n in the status bar, back on a change", async ({
  page,
}) => {
  await open(page);
  const key = await keyOf(page, '.cv-win[data-state="idle"]');
  await page.locator(`.cv-win[data-key="${key}"] .cv-win-title`).click({ button: "right" });
  await menuItem(page, "Hide until it changes").click();
  await expect(page.locator(`.cv-win[data-key="${key}"]`)).toHaveCount(0);
  await expect(page.locator(".cv-hidden-btn")).toHaveText("Hidden 1 ▴");
  await page.evaluate((k) => window.__harness.world.raise(k, 0), key);
  await expect(page.locator(`.cv-win[data-key="${key}"]`)).toHaveClass(/is-needs/);
  await expect(page.locator(".cv-hidden-btn")).toBeHidden();
  await expect.poll(async () => Object.keys((await stored(page))?.hidden ?? {})).toEqual([]);
});

test("a session that ends leaves for Done n; its popover opens it", async ({ page }) => {
  await open(page);
  await expect(page.locator(".cv-done-btn")).toHaveText("Done 3 ▴");
  const key = await page.evaluate(() => {
    const k = window.__harness.world.keys("working").find((x) => {
      const s = window.__harness.sessions().find((s) => s.key === x)!;
      return !s.parentId && !s.agents.length;
    })!;
    window.__harness.world.end(k);
    return k;
  });
  await expect(page.locator(`.cv-win[data-key="${key}"]`)).toHaveCount(0);
  await expect(page.locator(".cv-done-btn")).toHaveText("Done 4 ▴");
  await page.click(".cv-done-btn");
  const m = (await menus(page)).at(-1)!;
  expect(m.title).toBe("Done");
  expect(m.items).toHaveLength(4);
});

test("subagents: pills derive from the parent, move with it, open the agent beside", async ({ page }) => {
  await open(page);
  await view(page, "layout");
  const parent = await parentKey(page);
  const pills = page.locator(`.cv-pill[data-parent="${parent}"]`);
  await expect(pills).toHaveCount(3);
  await expect(pills.first().locator(".cv-pill-type")).toHaveText("Explore");
  await expect(pills.first().locator(".cv-pill-desc")).toContainText("Find the flush call sites");
  // The done one shows its result, in --fg-3, after the open ones.
  await expect(pills.nth(2)).toHaveAttribute("data-state", "done");
  await expect(pills.nth(2).locator(".cv-pill-now")).toHaveText(/^Three callers/);
  const id = (await pills.first().getAttribute("data-pill"))!;
  const a0 = await worldPos(page, id, ".cv-pill[data-pill=");
  const p0 = await worldPos(page, parent);
  await dragWin(page, parent, 160, 80);
  const a1 = await worldPos(page, id, ".cv-pill[data-pill=");
  const p1 = await worldPos(page, parent);
  expect(a1.x - a0.x).toBeCloseTo(p1.x - p0.x, 0);
  expect(a1.y - a0.y).toBeCloseTo(p1.y - p0.y, 0);
  // Pills aren't stored: nothing in the document but the parent.
  const doc = await stored(page);
  expect(Object.keys(doc!.windows).some((k) => k.includes("#"))).toBe(false);
  await pills.first().dblclick();
  const opened = await page.evaluate(() => window.__harness.lastOpen());
  expect(opened?.key).toBe(parent);
  expect(opened?.opts).toMatchObject({ split: true, agent: id.split("#")[1] });
  // A child session (parent_id) is a pill too, and opens its own session.
  const child = page.locator(".cv-pill").filter({ hasText: "Search" });
  await expect(child).toHaveCount(1);
  await child.dblclick();
  const childKey = await page.evaluate(() => window.__harness.sessions().find((s) => s.parentId)!.key);
  expect((await page.evaluate(() => window.__harness.lastOpen()))?.key).toBe(childKey);
  await expect(page.locator(`.cv-win[data-key="${childKey}"]`)).toHaveCount(0);
});

test("subagents: four pills at most, then +n more; unfolding is kept", async ({ page }) => {
  await open(page);
  const parent = await parentKey(page);
  await page.evaluate((k) => {
    for (let i = 0; i < 3; i++) window.__harness.world.startAgent(k, "Explore", `Look ${i}`);
  }, parent);
  await expect(page.locator(`.cv-pill[data-parent="${parent}"]`)).toHaveCount(4);
  const more = page.locator(".cv-pill-more");
  await expect(more).toHaveText("+2 more");
  await more.click();
  await expect(page.locator(`.cv-pill[data-parent="${parent}"]`)).toHaveCount(6);
  await expect(more).toHaveText("Fold done");
  await expect.poll(async () => (await stored(page))?.showDone).toEqual([parent]);
});

test("right-click a window: the board's menu with the canvas's rows; Label ▸ Red puts the dot on it", async ({
  page,
}) => {
  await open(page);
  const key = await keyOf(page, '.cv-win[data-state="idle"]');
  await page.locator(`.cv-win[data-key="${key}"] .cv-win-meta`).click({ button: "right" });
  const m = (await menus(page)).at(-1)!;
  expect(m.kind).toBe("session");
  expect(m.key).toBe(key);
  expect(m.extra).toEqual(["Expand", "Hide until it changes"]);
  expect(m.items).toContain("Label ›");
  await menuItem(page, "Label ›").click();
  await page.locator(".hm").getByRole("menuitemradio", { name: "Red" }).click();
  await expect(page.locator(`.cv-win[data-key="${key}"] .cv-win-label.label-dot--red`)).toBeVisible();
  await expect(page.locator(`.cv-win[data-key="${key}"]`)).toHaveAttribute("aria-label", /label Red/);
  // The Label view groups it under Red, with the dot in the heading.
  await view(page, "label");
  await expect(page.locator(".cv-head").first()).toContainText("Red");
  await expect(page.locator(".cv-head").first().locator(".label-dot--red")).toBeVisible();
});

test("⌥⌘3 labels the selection yellow, ⌥⌘0 clears it; Shift+F10 opens its menu", async ({ page }) => {
  await open(page);
  const a = await keyOf(page, '.cv-win[data-state="idle"]');
  const b = (await page.locator('.cv-win[data-state="idle"]').nth(1).getAttribute("data-key"))!;
  await page.locator(`.cv-win[data-key="${a}"] .cv-win-meta`).click();
  await page.locator(`.cv-win[data-key="${b}"] .cv-win-meta`).click({ modifiers: ["Shift"] });
  await page.keyboard.press("ControlOrMeta+Alt+3");
  await expect(page.locator(".cv-win-label.label-dot--yellow")).toHaveCount(2);
  await page.keyboard.press("Shift+F10");
  const m = (await menus(page)).at(-1)!;
  expect(m.source).toBe("keyboard");
  expect(m.title).toBe("2 selected");
  expect(m.items).toContain("Label ›");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+Alt+0");
  await expect(page.locator(".cv-win-label:visible")).toHaveCount(0);
});

test("the ground's menu follows the view", async ({ page }) => {
  await open(page);
  await page.mouse.click(1380, 840, { button: "right" });
  expect((await menus(page)).at(-1)!.items).toEqual(["View ›", "Fit", "Show done sessions"]);
  await page.keyboard.press("Escape");
  await view(page, "layout");
  await page.mouse.click(1380, 840, { button: "right" });
  expect((await menus(page)).at(-1)!.items).toEqual([
    "New area",
    "New note",
    "Tidy",
    "Fit",
    "Paste note",
    "—",
    "Reset My layout…",
  ]);
  await page.keyboard.press("Escape");
  // A heading's menu, in a preset.
  await view(page, "state");
  await page.locator(".cv-head").first().click({ button: "right" });
  expect((await menus(page)).at(-1)!.items).toEqual(["Select group", "Open all beside"]);
});

test("areas: create, name, label, drop windows in, move with members, delete and undo", async ({ page }) => {
  await open(page);
  await view(page, "layout");
  await page.click(".cv-add-area");
  const area = page.locator(".cv-area");
  await expect(area).toHaveCount(1);
  await expect(area.locator(".cv-area-title")).toBeFocused();
  await page.keyboard.type("Billing");
  await page.keyboard.press("Enter");
  await expect.poll(async () => Object.values((await stored(page))?.areas ?? {})[0]?.title).toBe("Billing");
  // Label it blue from its menu.
  await area.locator(".cv-area-head").click({ button: "right" });
  expect((await menus(page)).at(-1)!.items).toEqual([
    "Rename",
    "Label ›",
    "Tidy this area",
    "Select members",
    "—",
    "Delete area",
  ]);
  await menuItem(page, "Label ›").click();
  await page.locator(".hm").getByRole("menuitemradio", { name: "Blue" }).click();
  await expect(area).toHaveClass(/is-labelled/);
  await expect(area.locator(".label-dot--blue")).toBeVisible();
  // Two windows dropped in become members.
  const keys = await page.locator(".cv-win").evaluateAll((els) => els.slice(0, 2).map((e) => e.dataset.key!));
  for (const k of keys) {
    const box = await area.boundingBox();
    const t = await page.locator(`.cv-win[data-key="${k}"] .cv-win-title`).boundingBox();
    await page.mouse.move(t!.x + 20, t!.y + 8);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 - 40, box!.y + box!.height / 2, { steps: 8 });
    await page.mouse.up();
  }
  await expect(area.locator(".cv-area-n")).toHaveText("2");
  const id = Object.keys((await stored(page))!.areas)[0]!;
  await expect.poll(async () => Object.keys((await stored(page))!.areas[id]!.members).sort()).toEqual([...keys].sort());
  // Moving the area carries its members.
  const w0 = await worldPos(page, keys[0]!);
  const head = await area.locator(".cv-area-head").boundingBox();
  await page.mouse.move(head!.x + 200, head!.y + 10);
  await page.mouse.down();
  await page.mouse.move(head!.x + 260, head!.y + 50, { steps: 6 });
  await page.mouse.up();
  const w1 = await worldPos(page, keys[0]!);
  const k = await scale(page);
  expect(w1.x - w0.x).toBeCloseTo(60 / k, 0);
  expect(w1.y - w0.y).toBeCloseTo(40 / k, 0);
  // Delete: the windows stay; Undo brings the area back with its members.
  await area.locator(".cv-area-head").click({ position: { x: 200, y: 10 } });
  await page.keyboard.press("Backspace");
  await expect(area).toHaveCount(0);
  expect(await worldPos(page, keys[0]!)).toMatchObject({ x: w1.x, y: w1.y });
  await expect(page.locator(".cv-say")).toContainText("Area deleted");
  await page.locator(".cv-say-btn").click();
  await expect(page.locator(".cv-area")).toHaveCount(1);
  await expect(page.locator(".cv-area-n")).toHaveText("2");
  await expect.poll(async () => Object.keys((await stored(page))?.areas ?? {})).toEqual([id]);
  // ⇧⌘Z redoes the delete, ⌘Z undoes it again.
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator(".cv-area")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".cv-area")).toHaveCount(1);
});

test("an area drawn with A held; New area from selection wraps the selected windows", async ({ page }) => {
  await open(page);
  await view(page, "layout");
  // Select two windows with a rectangle on the ground.
  const a = await page.locator(".cv-win").nth(0).boundingBox();
  await page.mouse.move(a!.x - 12, a!.y - 12);
  await page.mouse.down();
  await page.mouse.move(a!.x + a!.width + 330, a!.y + a!.height + 4, { steps: 6 });
  await page.mouse.up();
  const n = await page.locator(".cv-win.is-selected").count();
  expect(n).toBeGreaterThanOrEqual(2);
  await page.locator(".cv-win.is-selected .cv-win-meta").first().click({ button: "right" });
  await menuItem(page, "New area from selection").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cv-area")).toHaveCount(1);
  await expect(page.locator(".cv-area-n")).toHaveText(String(n));
  // Draw one: hold A and drag on empty ground.
  await page.mouse.move(80, 820);
  await page.keyboard.down("a");
  await page.mouse.down();
  await page.mouse.move(500, 860, { steps: 6 });
  await page.mouse.move(520, 880, { steps: 2 });
  await page.mouse.up();
  await page.keyboard.up("a");
  await expect(page.locator(".cv-area")).toHaveCount(2);
});

test("notes: multi-line text, ⌘↵ commits, an empty one goes; the layout survives a reload", async ({ page }) => {
  await open(page);
  await view(page, "layout");
  await page.click(".cv-add-note");
  const note = page.locator(".cv-note");
  await expect(note.locator(".cv-note-text")).toBeFocused();
  await page.keyboard.type("Ship after the");
  await page.keyboard.press("Enter");
  await page.keyboard.type("BM25 review");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect
    .poll(async () => Object.values((await stored(page))?.notes ?? {})[0]?.text)
    .toBe("Ship after the\nBM25 review");
  // An empty note on commit is no note.
  await page.click(".cv-add-note");
  await expect(page.locator(".cv-note")).toHaveCount(2);
  await expect(page.locator(".cv-note-text.is-editing")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cv-note")).toHaveCount(1);
  // The menu.
  await note.click({ button: "right" });
  expect((await menus(page)).at(-1)!.items).toEqual(["Edit", "Label ›", "Copy text", "—", "Delete note"]);
  await page.keyboard.press("Escape");
  const room = await page.evaluate(() => window.__harness.room);
  const before = await worldPos(page, (await note.getAttribute("data-note"))!, ".cv-note[data-note=");
  await page.goto(`${HARNESS}&room=${room}`);
  await page.waitForSelector(".cv-note");
  await settle(page);
  await expect(page.locator('.cv-view[data-view="layout"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".cv-note-text")).toHaveText("Ship after the\nBM25 review");
  expect(await worldPos(page, (await note.getAttribute("data-note"))!, ".cv-note[data-note=")).toMatchObject({
    x: before.x,
    y: before.y,
  });
});

test("Reset My layout asks first, then clears positions, areas and notes", async ({ page }) => {
  await open(page);
  await view(page, "layout");
  await page.click(".cv-add-note");
  await page.keyboard.type("keep?");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => Object.keys((await stored(page))?.notes ?? {}).length).toBe(1);
  await page.click(".cv-more");
  await menuItem(page, "Reset My layout…").click();
  await expect.poll(async () => (await menus(page)).at(-1)!.kind).toBe("confirm");
  expect((await menus(page)).at(-1)!.title).toBe("Reset My layout?");
  await expect(page.locator(".cv-note")).toHaveCount(0);
  await expect.poll(async () => Object.keys((await stored(page))?.notes ?? {}).length).toBe(0);
});

test("a v1 layout is migrated once: positions kept, rel and zones dropped, My layout first", async ({ page }) => {
  await open(page);
  const room = await page.evaluate(() => window.__harness.room);
  const [key, sub] = await page.evaluate(() => {
    const s = window.__harness.sessions();
    return [s.find((x) => !x.parentId && x.state === "idle")!.key, s.find((x) => x.parentId)!.key];
  });
  const v1 = {
    v: 1,
    windows: { [key]: { x: 4000, y: 4000, w: 280, h: 212 }, [sub]: { x: 308, y: 0, w: 224, h: 68, rel: true } },
    zones: { studio: { x: 0, y: 0, w: 10, h: 10 } },
    zonesOn: true,
    shelfOpen: false,
    custom: { c1: { id: "c1", label: "mic", x: 1, y: 2 } },
  };
  await page.evaluate(
    (v) => fetch(`/__state?room=${window.__harness.room}`, { method: "PUT", body: JSON.stringify(v) }),
    v1,
  );
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${HARNESS}&room=${room}`);
  await page.waitForSelector(".cv-win");
  await expect(page.locator('.cv-view[data-view="layout"]')).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await stored(page))?.v).toBe(2);
  const doc = (await stored(page))!;
  expect(doc.windows[key]).toEqual({ x: 4000, y: 4000 });
  expect(doc.windows[sub]).toBeUndefined();
  expect(doc.map.custom.c1?.label).toBe("mic");
  expect((doc as unknown as { zones?: unknown }).zones).toBeUndefined();
  expect(await worldPos(page, key)).toMatchObject({ x: 4000, y: 4000 });
});

test("the minimap shows only when something is off screen", async ({ page }) => {
  await open(page);
  await expect(page.locator(".cv-minimap")).toBeHidden();
  for (let i = 0; i < 5; i++) await page.keyboard.press("+");
  await expect(page.locator(".cv-minimap")).toBeVisible();
  await page.click(".cv-more");
  await menuItem(page, "Show minimap").click();
  await expect(page.locator(".cv-minimap")).toBeHidden();
});

test("two devices: each change arrives live, each keeps its own view", async ({ browser }) => {
  const room = `two${Date.now().toString(36)}`;
  const a = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await open(a, `&room=${room}`);
  const b = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await open(b, `&room=${room}`);
  await view(a, "layout");
  await view(b, "layout");
  await a.click(".cv-add-area");
  await expect(a.locator(".cv-area-title")).toBeFocused();
  await a.keyboard.type("Shared");
  await a.keyboard.press("Enter");
  await expect(b.locator(".cv-area-title")).toHaveText("Shared");
  const key = await keyOf(a, '.cv-win[data-state="idle"]');
  await dragWin(a, key, 100, 100);
  const pa = await worldPos(a, key);
  await expect.poll(async () => (await worldPos(b, key)).x).toBe(pa.x);
  // B looks at Harness; A stays in My layout.
  await view(b, "harness");
  await a.reload();
  await a.waitForSelector(".cv-win");
  await expect(a.locator('.cv-view[data-view="layout"]')).toHaveAttribute("aria-checked", "true");
});

test("two devices writing at the same moment: both changes survive (412 and retry)", async ({ browser }) => {
  const a = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await open(a);
  const room = await a.evaluate(() => window.__harness.room);
  const b = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await open(b, `&room=${room}`);
  await view(a, "layout");
  await view(b, "layout");
  const ka = await keyOf(a, '.cv-win[data-state="idle"]');
  const kb = (await a.locator('.cv-win[data-state="working"]').first().getAttribute("data-key"))!;
  await Promise.all([dragWin(a, ka, 140, 90), dragWin(b, kb, -120, 70)]);
  const pa = await worldPos(a, ka);
  const pb = await worldPos(b, kb);
  await expect.poll(async () => (await stored(a))?.windows[ka]?.x).toBe(pa.x);
  await expect.poll(async () => (await stored(a))?.windows[kb]?.x).toBe(pb.x);
  // And raw: two updates racing on one document.
  await Promise.all(
    [a, b].map((p, i) =>
      p.evaluate(
        (n) =>
          window.__harness.api.storage.update!((cur) => ({
            ...(cur as object),
            [`race${n}`]: true,
          })),
        i,
      ),
    ),
  );
  const raw = (await stored(a)) as unknown as Record<string, unknown>;
  expect(raw.race0).toBe(true);
  expect(raw.race1).toBe(true);
});
