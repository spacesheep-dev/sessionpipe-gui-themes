#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Renders a skin package's preview.png with Playwright against a real GUI in demo mode:
//   node scripts/preview.mjs [package dir = this package] [--dark]
// The GUI checkout is ../../../sessionpipe-gui (or SPGUI_DIR), built (dist/cli.js). The
// skin is linked into a scratch state dir, the server starts on a spare port, the board
// opens, the appearance popover picks the skin, and the board is captured at 1280 × 800.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const pkg = path.resolve(args[0] ?? path.join(here, ".."));
const dark = process.argv.includes("--dark");
const gui = path.resolve(process.env.SPGUI_DIR ?? path.join(here, "..", "..", "..", "..", "sessionpipe-gui"));
const cli = path.join(gui, "dist", "cli.js");
if (!existsSync(cli)) throw new Error(`no built GUI at ${cli} (npm run build there, or SPGUI_DIR=…)`);
const manifest = JSON.parse(readFileSync(path.join(pkg, "skin.json"), "utf8"));
const out = path.join(pkg, manifest.preview ?? "preview.png");
const port = 7440 + Math.floor(Math.random() * 50);
const state = mkdtempSync(path.join(os.tmpdir(), "spgui-preview-"));

// The manifest names the preview the script is about to make: a placeholder first, so the
// validator (every named file must exist) lets the skin link.
if (manifest.preview && !existsSync(out)) {
  writeFileSync(
    out,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    ),
  );
}
// A package whose id the GUI has built in (skin-spacesheep) cannot be linked: the built-in
// of that id is what the popover shows, so the capture is of that.
try {
  execFileSync(process.execPath, [cli, "skin", "link", pkg, "--state", state], { stdio: "inherit" });
} catch {
  console.log(`(${manifest.id} could not be linked; capturing the GUI's built-in of that id)`);
}
const server = spawn(
  process.execPath,
  [cli, "--port", String(port), "--state", state, "--no-outbox", "--demo", "--speed", "20", "--quiet"],
  { stdio: "inherit" },
);
const url = `http://127.0.0.1:${port}`;
try {
  const t0 = Date.now();
  for (;;) {
    try {
      if ((await fetch(`${url}/api/ui/info`)).ok) break;
    } catch {}
    if (Date.now() - t0 > 20_000) throw new Error("the GUI did not start");
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: dark ? "dark" : "light" });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("sessionpipe-gui.setup.seen", "1");
    } catch {}
  });
  await page.goto(url);
  await page.locator(".conn", { hasText: "live" }).first().waitFor({ timeout: 15_000 });
  await page.locator("section.group").first().waitFor();
  await page.locator("nav.rail button[aria-label='Quick settings']").click();
  await page.locator(`button[data-skin='${manifest.id}']`).click();
  await page.keyboard.press("Escape");
  await page.waitForFunction((id) => document.documentElement.getAttribute("data-skin") === id, manifest.id);
  // The pointer off the gear, so no tooltip sits in the picture.
  await page.mouse.move(640, 420);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out, animations: "disabled" });
  await browser.close();
  console.log(`wrote ${out}`);
} finally {
  server.kill("SIGTERM");
  rmSync(state, { recursive: true, force: true });
}
