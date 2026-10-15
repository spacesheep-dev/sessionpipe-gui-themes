// SPDX-License-Identifier: Apache-2.0
// The scope question, answered in one command. The packages are @sessionpipe-gui/<kind>-<id>,
// which needs the npm org "sessionpipe-gui" (RELEASING.md). If the owner would rather not
// create it, `node scripts/rename-unscoped.mjs --yes` rewrites every name to
// sessionpipe-gui-<kind>-<id>: package.json names and devDependencies, package-lock.json,
// every import of the types package, READMEs, CHANGELOG, CONTRIBUTING, RELEASING, and the
// GUI's catalogue, README and tests in a ../sessionpipe-gui checkout when one is there.
// `--scoped` goes the other way. Without --yes it only lists the files it would change.
// Afterwards: `npm install` (the lock file's workspace links), commit, publish.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const yes = argv.includes("--yes");
const toScoped = argv.includes("--scoped");
const SCOPE = "@sessionpipe-gui/";
const PREFIX = "sessionpipe-gui-";

// The exact names, from the packages themselves (either spelling), so nothing else that
// starts with "sessionpipe-gui-" (the repo name, the GUI's own bin) is ever touched.
const ids = readdirSync(path.join(root, "packages"))
  .map((d) => {
    try {
      return JSON.parse(readFileSync(path.join(root, "packages", d, "package.json"), "utf8")).name;
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .map((n) => n.replace(SCOPE, "").replace(new RegExp(`^${PREFIX}`), ""));
const pairs = ids.map((id) => [`${SCOPE}${id}`, `${PREFIX}${id}`]);
const [from, to] = toScoped ? [1, 0] : [0, 1];

const EXT = new Set([".json", ".md", ".ts", ".tsx", ".mjs", ".js", ".yml", ".yaml", ".css"]);
const SKIP = new Set(["node_modules", "dist", ".git", "test-results", "playwright-report", ".tmp"]);
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    if (p === fileURLToPath(import.meta.url)) continue; // not this script's own comments
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.has(path.extname(name))) yield p;
  }
}

const roots = [root];
const gui = path.resolve(root, "..", "sessionpipe-gui");
try {
  if (JSON.parse(readFileSync(path.join(gui, "package.json"), "utf8")).name === "sessionpipe-gui") roots.push(gui);
} catch {}

let changed = 0;
for (const r of roots) {
  for (const file of walk(r)) {
    const before = readFileSync(file, "utf8");
    let after = before;
    for (const pair of pairs) after = after.split(pair[from]).join(pair[to]);
    // The generic spelling in prose and docs: "@sessionpipe-gui/<kind>-<id>" ↔ "sessionpipe-gui-<kind>-<id>".
    after = toScoped
      ? after.split(`${PREFIX}<kind>-<id>`).join(`${SCOPE}<kind>-<id>`).split(`${PREFIX}*`).join(`${SCOPE}*`)
      : after.split(`${SCOPE}<kind>-<id>`).join(`${PREFIX}<kind>-<id>`).split(`${SCOPE}*`).join(`${PREFIX}*`);
    if (after === before) continue;
    changed++;
    console.log(`${yes ? "rewrote" : "would rewrite"} ${path.relative(path.dirname(root), file)}`);
    if (yes) writeFileSync(file, after);
  }
}
console.log(
  `\n${changed} file${changed === 1 ? "" : "s"} ${yes ? "rewritten" : "would change"} (${pairs.map((p) => p[from]).join(", ")} → ${toScoped ? "scoped" : "unscoped"}).` +
    (yes
      ? "\nNext: npm install (lock file), npm run build && npm test, commit; the GUI too if it was rewritten."
      : "\n--yes does it."),
);
