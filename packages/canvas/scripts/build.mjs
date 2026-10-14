// SPDX-License-Identifier: Apache-2.0
// Bundles src/index.ts into a single ES module at dist/index.js (+ dist/index.css), the
// files theme.json points at. No externals: the theme carries everything it needs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const result = await build({
  entryPoints: [path.join(root, "src/index.ts")],
  outfile: path.join(root, "dist/index.js"),
  bundle: true,
  format: "esm",
  target: ["es2022", "chrome110", "safari16", "firefox115"],
  minify: process.argv.includes("--minify"),
  sourcemap: true,
  legalComments: "none",
  metafile: true,
  logLevel: "info",
});

for (const [file, info] of Object.entries(result.metafile.outputs)) {
  if (file.endsWith(".map")) continue;
  process.stdout.write(`${file}  ${(info.bytes / 1024).toFixed(1)} KB\n`);
}
const js = fs.statSync(path.join(root, "dist/index.js")).size;
if (js > 150 * 1024) {
  process.stderr.write(`dist/index.js is ${(js / 1024).toFixed(0)} KB, over the 150 KB budget\n`);
  process.exit(1);
}
