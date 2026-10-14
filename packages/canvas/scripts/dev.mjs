// SPDX-License-Identifier: Apache-2.0
// The dev harness: dev/harness.html mounts the theme against a fake ThemeApi (dev/harness.ts).
// esbuild rebuilds on change and serves dev/ on --port (default 7420; never 7373).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { context } from "esbuild";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const portArg = process.argv.indexOf("--port");
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 7420;

const ctx = await context({
  entryPoints: [path.join(root, "dev/harness.ts")],
  outdir: path.join(root, "dev/dist"),
  bundle: true,
  format: "esm",
  target: ["es2022"],
  sourcemap: true,
  logLevel: "info",
});
await ctx.watch();
const { hosts, port: p } = await ctx.serve({ servedir: path.join(root, "dev"), port, host: "127.0.0.1" });
process.stdout.write(`canvas harness: http://${hosts[0]}:${p}/harness.html\n`);
