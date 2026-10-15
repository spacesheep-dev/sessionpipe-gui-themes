// SPDX-License-Identifier: Apache-2.0
// Bundles src/index.ts and its dependencies (ping-a-human's channel, zod) into one ES
// module at dist/index.js, the file plugin.json points at, so the installed copy needs no
// node_modules. Node's own modules stay external. `--watch` rebuilds on change.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const options = {
  entryPoints: [path.join(root, "src/index.ts")],
  outfile: path.join(root, "dist/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["node:*"],
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
  process.stdout.write("ping-a-human: watching src/ (link with `sessionpipe-gui plugin link .`, then Reload)\n");
} else {
  await build(options);
}
