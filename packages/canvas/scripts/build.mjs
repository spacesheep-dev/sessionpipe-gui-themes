// SPDX-License-Identifier: Apache-2.0
// Bundles src/index.ts into an ES module at dist/index.js (+ dist/index.css), the files
// theme.json points at, and the Map view into dist/map.js beside it: the Map is imported
// the first time it is shown, so opening the canvas doesn't parse it. No externals: the
// theme carries everything it needs (map.js keeps its own copy of the few helpers it
// shares). Minified, as it ships (the source maps keep it readable); --no-minify for a look.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const common = {
  bundle: true,
  format: "esm",
  target: ["es2022", "chrome110", "safari16", "firefox115"],
  minify: !process.argv.includes("--no-minify"),
  sourcemap: true,
  legalComments: "none",
  metafile: true,
  logLevel: "info",
};

/** `import("./map")` stays a request for ./map.js, built on its own below. */
const lazyMap = {
  name: "lazy-map",
  setup(b) {
    b.onResolve({ filter: /^\.\/map$/ }, (a) =>
      a.kind === "dynamic-import" ? { path: "./map.js", external: true } : undefined,
    );
  },
};

const result = await build({
  ...common,
  entryPoints: [path.join(root, "src/index.ts")],
  outfile: path.join(root, "dist/index.js"),
  plugins: [lazyMap],
});
const mapResult = await build({
  ...common,
  entryPoints: [path.join(root, "src/map.ts")],
  outfile: path.join(root, "dist/map.js"),
});
Object.assign(result.metafile.outputs, mapResult.metafile.outputs);

for (const [file, info] of Object.entries(result.metafile.outputs)) {
  if (file.endsWith(".map")) continue;
  process.stdout.write(`${file}  ${(info.bytes / 1024).toFixed(1)} KB\n`);
}
const js = fs.statSync(path.join(root, "dist/index.js")).size;
if (js > 150 * 1024) {
  process.stderr.write(`dist/index.js is ${(js / 1024).toFixed(0)} KB, over the 150 KB budget\n`);
  process.exit(1);
}
