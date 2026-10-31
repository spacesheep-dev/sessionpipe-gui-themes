#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Validates the color themes in this package the way the GUI's parseColorTheme does
// (shared/color-theme.ts, mirrored in packages/shared-types/color-theme.ts) and prints
// the WCAG contrast of every text tier and accent against the grounds it sits on.
//   node scripts/check.mjs            # every *.json beside this script's parent
//   node scripts/check.mjs --quiet    # exit code only
//   node scripts/check.mjs --skin skin.json   # a skin package's manifest: each scheme's token set
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const quiet = process.argv.includes("--quiet");

// --- the token list, read from the shared-types mirror so the two cannot drift ---
const src = readFileSync(join(pkg, "..", "shared-types", "color-theme.ts"), "utf8");
const list = /COLOR_TOKEN_NAMES = \[([\s\S]*?)\] as const/.exec(src);
if (!list) throw new Error("COLOR_TOKEN_NAMES not found in shared-types/color-theme.ts");
const NAMES = [...list[1].matchAll(/"(--[a-z0-9-]+)"/g)].map((m) => m[1]);
const ID = /^[a-z][a-z0-9-]{1,40}$/;
const VALUE = /^[A-Za-z0-9#%.,\s()/+-]{1,120}$/;

function parseColorTheme(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return { error: "not an object" };
  if (typeof d.id !== "string" || !ID.test(d.id)) return { error: "id must match [a-z][a-z0-9-]{1,40}" };
  if (d.id === "default") return { error: '"default" is the built-in scheme' };
  if (typeof d.name !== "string" || !d.name.trim() || d.name.length > 60) return { error: "name must be 1–60 chars" };
  if (d.scheme !== "dark" && d.scheme !== "light") return { error: 'scheme must be "dark" or "light"' };
  if (!d.tokens || typeof d.tokens !== "object" || Array.isArray(d.tokens))
    return { error: "tokens must be an object" };
  for (const [k, v] of Object.entries(d.tokens)) {
    if (!NAMES.includes(k)) return { error: `unknown token ${k}` };
    if (typeof v !== "string" || !VALUE.test(v)) return { error: `${k} must be a CSS colour value` };
  }
  if (!d.tokens["--bg"] || !d.tokens["--fg"]) return { error: "tokens must set at least --bg and --fg" };
  return { theme: d };
}

// --- CSS colour → sRGB → WCAG, no deps. Mirrors parseCssColor in the GUI's shared/contrast.ts
// (packages/shared-types/contrast.ts here): oklch(L C H) with L as 0–1 or a percentage and an
// optional / alpha, #rgb and #rrggbb, rgb(r, g, b) and rgb(r g b), so every pair the GUI
// measures is measured here with the numbers the GUI reports. Inlined rather than imported:
// the package has no build step and node >=20 does not load .ts. Alpha is ignored, as there. ---
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const clamp01 = (c) => Math.min(1, Math.max(0, c));
// { rgb, clipped, C } for oklch (C is its chroma); { rgb } for hex and rgb(); null for anything
// else (var(), color-mix(), keywords), which the GUI leaves unmeasured too.
function parseCssColor(value) {
  const s = value.trim();
  let m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/.*)?\)$/i.exec(s);
  if (m) {
    const L = m[2] ? +m[1] / 100 : +m[1],
      C = +m[3];
    const r = (+m[4] * Math.PI) / 180,
      a = C * Math.cos(r),
      b = C * Math.sin(r);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
      mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
      ss = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const rgb = [
      4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * ss,
      -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * ss,
      -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * ss,
    ];
    const clipped = rgb.some((c) => c < -0.002 || c > 1.002);
    return { rgb: rgb.map((c) => gam(clamp01(c))), clipped, C };
  }
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return { rgb: [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) };
  }
  m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/].*)?\)$/i.exec(s);
  if (m) return { rgb: [+m[1] / 255, +m[2] / 255, +m[3] / 255].map(clamp01) };
  return null;
}
const lum = ({ rgb }) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// Text or marks on a ground, and the floor each must clear (tokens.css's own rule).
const PAIRS = [
  ["--fg", "--bg", 7],
  ["--fg", "--bg-2", 7],
  ["--fg", "--bg-3", 7],
  ["--fg-2", "--bg", 7],
  ["--fg-2", "--bg-2", 7],
  ["--fg-3", "--bg", 5],
  ["--fg-3", "--bg-2", 5],
  ["--fg-3", "--bg-3", 4.5],
  ["--fg-4", "--bg", 3],
  ["--fg-4", "--bg-2", 3],
  ["--fg", "--bg-4", 7],
  ["--fg-2", "--bg-3", 4.5],
  ["--fg-3", "--bg-4", 3],
  ["--needs-fg", "--bg-3", 4.5],
  ["--err", "--bg-2", 4.5],
  ["--err-soft", "--bg-2", 4.5],
  ["--needs-fg", "--bg", 4.5],
  ["--needs-fg", "--bg-2", 4.5],
  ["--fg", "--needs-bg", 7],
  ["--needs", "--bg", 3],
  ["--state-working", "--bg", 3],
  ["--state-stale", "--bg", 3],
  ["--ok", "--bg", 3],
  ["--err", "--bg", 4.5],
  ["--err-soft", "--bg", 4.5],
  ["--err", "--err-bg", 4.5],
  ["--focus", "--bg", 3],
  ["--focus", "--bg-2", 3],
  ["--mark-fg", "--mark", 4.5],
  ["--line-2", "--bg", 1.5],
  ["--state-working", "--state-working-bg", 3],
  ["--state-stale", "--state-stale-bg", 3],
];
// Surfaces stay near-neutral (≤ 0.03) except in a "vivid" pair, which may carry real
// chroma on its cards; the text tiers are then checked on those cards as well.
const SURFACE_MAX_CHROMA = (id) => (/-vivid(-|$)/.test(id) ? 0.08 : 0.03);

let failed = false;
// A file that is not JSON is a failure, reported as the GUI's readColorThemes reports it.
function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.log(`${label}: INVALID: not JSON: ${e.message}`);
    failed = true;
    return undefined;
  }
}
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
// A skin manifest (skin-authoring.md in the GUI repo) carries one token set per scheme;
// each is checked like a color theme of that scheme. Style tokens are left out of the check.
const STYLE = ["--font-ui", "--font-mono", "--radius", "--radius-sm", "--hairline"];
const skinArg = process.argv.indexOf("--skin");
const inputs = [];
if (skinArg >= 0) {
  const label = process.argv[skinArg + 1];
  const m = readJson(resolve(label), label);
  // A "both" skin carries both sets; the GUI's validateSkinManifest refuses one without.
  if (m && m.scheme === "both" && !(isObject(m.tokens) && isObject(m.tokens.dark) && isObject(m.tokens.light))) {
    console.log(`${label}: INVALID: scheme "both" needs tokens.dark and tokens.light`);
    failed = true;
  } else if (m) {
    const sets = m.scheme === "both" ? m.tokens : { [m.scheme]: m.tokens };
    for (const [scheme, tokens] of Object.entries(sets)) {
      const t = isObject(tokens)
        ? Object.fromEntries(Object.entries(tokens).filter(([k]) => !STYLE.includes(k)))
        : tokens;
      inputs.push([`${m.id} (${scheme})`, { id: m.id, name: m.name, scheme, tokens: t }]);
    }
  }
} else {
  for (const f of readdirSync(pkg)
    .filter((f) => f.endsWith(".json") && f !== "package.json")
    .sort()) {
    const doc = readJson(join(pkg, f), f);
    if (doc !== undefined) inputs.push([f, doc]);
  }
}
for (const [f, doc] of inputs) {
  const res = parseColorTheme(doc);
  if ("error" in res) {
    console.log(`${f}: INVALID: ${res.error}`);
    failed = true;
    continue;
  }
  const t = res.theme.tokens;
  const missing = NAMES.filter((n) => !(n in t));
  if (!quiet)
    console.log(
      `\n${f}  (${res.theme.name}, ${res.theme.scheme})  ${Object.keys(t).length}/${NAMES.length} tokens${missing.length ? `, missing ${missing.join(" ")}` : ""}`,
    );
  // A token the theme does not set is nothing to measure (the header lists it). One it sets
  // but the GUI could not read is named once and fails the run, so no pair is skipped silently.
  const unmeasured = new Set();
  const color = (k) => {
    if (t[k] === undefined) return null;
    const c = parseCssColor(t[k]);
    if (!c && !unmeasured.has(k)) {
      unmeasured.add(k);
      console.log(`  unmeasured ${k}: ${t[k]}`);
      failed = true;
    }
    return c;
  };
  for (const n of ["--bg", "--bg-2", "--bg-3", "--bg-4"]) {
    const c = color(n);
    const cap = SURFACE_MAX_CHROMA(res.theme.id);
    // Chroma is read off an oklch() value only; a hex or rgb() surface has none to read.
    if (c?.C !== undefined && c.C > cap + 1e-9) {
      console.log(`  ${n} chroma ${c.C} > ${cap}: surfaces over this theme's cap`);
      failed = true;
    }
  }
  for (const [k, v] of Object.entries(t)) {
    const c = parseCssColor(v);
    if (c?.clipped) console.log(`  note: ${k} ${v} is outside sRGB and will clip`);
  }
  for (const [fg, bg, floor] of PAIRS) {
    const a = color(fg),
      b = color(bg);
    if (!a || !b) continue;
    const r = ratio(a, b);
    const ok = r >= floor;
    if (!ok) failed = true;
    if (!quiet || !ok)
      console.log(
        `  ${ok ? "ok  " : "LOW "} ${fg.padEnd(18)} on ${bg.padEnd(18)} ${r.toFixed(2).padStart(6)}  (≥ ${floor})`,
      );
  }
}
if (failed) {
  console.log("\nFAILED");
  process.exit(1);
}
if (!quiet) console.log("\nall good");
