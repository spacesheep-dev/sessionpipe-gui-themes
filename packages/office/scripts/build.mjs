// SPDX-License-Identifier: Apache-2.0
// Bundles src/index.tsx into one ES module at dist/index.js (+ dist/index.css), the files
// theme.json points at. React is not bundled: `react`, `react/jsx-runtime` and
// `react-dom/client` resolve to the shims in ../shims, which read the host's React from
// globalThis.__sessionpipeThemeReact at call time (mount() sets it from api.react).
// `--watch` rebuilds on change; `--minify` for a release.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shim = (file) => path.join(root, "shims", file);

/** react → shims/react.js, react/jsx-runtime → shims/jsx-runtime.js, react-dom → shims/react-dom.js,
 *  react-dom/client → shims/react-dom-client.js */
const hostReact = {
  name: "host-react",
  setup(b) {
    const map = {
      react: shim("react.js"),
      "react/jsx-runtime": shim("jsx-runtime.js"),
      "react/jsx-dev-runtime": shim("jsx-runtime.js"),
      "react-dom": shim("react-dom.js"),
      "react-dom/client": shim("react-dom-client.js"),
    };
    b.onResolve({ filter: /^react(\/jsx(-dev)?-runtime)?$|^react-dom(\/client)?$/ }, (args) => ({
      path: map[args.path],
    }));
  },
};

const options = {
  entryPoints: [path.join(root, "src/index.tsx")],
  outfile: path.join(root, "dist/index.js"),
  bundle: true,
  format: "esm",
  target: ["es2022", "chrome110", "safari16", "firefox115"],
  jsx: "automatic",
  minify: process.argv.includes("--minify"),
  sourcemap: true,
  legalComments: "none",
  metafile: true,
  logLevel: "info",
  plugins: [hostReact],
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
  process.stdout.write("office: watching src/ (link the package with `sessionpipe-gui theme link .`)\n");
} else {
  const result = await build(options);
  for (const [file, info] of Object.entries(result.metafile.outputs)) {
    if (file.endsWith(".map")) continue;
    process.stdout.write(`${file}  ${(info.bytes / 1024).toFixed(1)} KB\n`);
  }
  const js = fs.readFileSync(path.join(root, "dist/index.js"), "utf8");
  if (/react\.production|react-dom\.production|__SECRET_INTERNALS/.test(js)) {
    process.stderr.write("dist/index.js contains a copy of React; the shims are not being applied\n");
    process.exit(1);
  }
  if (js.length > 100 * 1024) {
    process.stderr.write(`dist/index.js is ${(js.length / 1024).toFixed(0)} KB, over the 100 KB budget\n`);
    process.exit(1);
  }
}
