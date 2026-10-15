// SPDX-License-Identifier: Apache-2.0
// What one package's tarball would carry, checked against its manifest: the manifest and
// README are in, so is every file the manifest points at (entry, style, fonts, css,
// preview) and, when fonts ship, their license; no source maps, tests, dev harness or
// scratch. `node scripts/pack-check.mjs packages/<id>` (or `.` from inside a package; the
// skins' prepublishOnly). Exit 1 with the reasons, else one line with the size.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? ".");
const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
if (pkg.private) {
  console.log(`${pkg.name}: private, not published`);
  process.exit(0);
}
const r = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: dir, encoding: "utf8" });
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(r.status ?? 1);
}
const [tar] = JSON.parse(r.stdout);
const files = tar.files.map((f) => f.path);
const problems = [];
const need = (f, why) => {
  if (!files.includes(f)) problems.push(`missing ${f} (${why})`);
};

const manifestFile = ["theme.json", "skin.json", "plugin.json"].find((m) => existsSync(path.join(dir, m)));
need("README.md", "what npm shows");
if (manifestFile) {
  need(manifestFile, "the manifest the installer reads");
  const m = JSON.parse(readFileSync(path.join(dir, manifestFile), "utf8"));
  if (manifestFile === "skin.json") {
    for (const f of m.fonts ?? []) need(f.src, "a font the manifest names");
    if ((m.fonts ?? []).length && !files.some((f) => /^fonts\/LICENSE/i.test(f)))
      problems.push("fonts ship without their license (fonts/LICENSE-*.md)");
    if (m.css) need(m.css, "the stylesheet the manifest names");
    if (m.preview) need(m.preview, "the preview the manifest names");
  } else {
    need(m.entry ?? "index.js", "the entry the manifest names");
    if (m.style) need(m.style, "the stylesheet the manifest names");
  }
} else if (!files.some((f) => f.endsWith(".ts") || f.endsWith(".d.ts"))) {
  problems.push("no manifest and no type files: what is this package?");
}
const stray = files.filter(
  (f) =>
    f.endsWith(".map") ||
    /(^|\/)(test|tests|e2e|dev|test-results|playwright-report|scratch|\.tmp)\//.test(f) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) ||
    /(^|\/)\.env/.test(f),
);
if (stray.length) problems.push(`should not ship: ${stray.join(", ")}`);
const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(
  `${pkg.name}@${pkg.version}: ${files.length} files, ${kb(tar.size)} packed, ${kb(tar.unpackedSize)} unpacked`,
);
if (problems.length) {
  for (const p of problems) console.error(`  ✘ ${p}`);
  process.exit(1);
}
