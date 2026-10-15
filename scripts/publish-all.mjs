// SPDX-License-Identifier: Apache-2.0
// Publish every public package, in dependency order (types → views → skins → plugin),
// skipping versions the registry already has. A dry run by default: builds, checks each
// tarball (scripts/pack-check.mjs) and runs `npm publish --dry-run`. `--yes` publishes.
// Under GitHub Actions it adds --provenance (npm trusted publishing, no token); by hand it
// needs `npm login` first. Names and versions come from each package.json, so a rename
// (scripts/rename-unscoped.mjs) needs no change here. `--only <id,…>` limits it.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const yes = argv.includes("--yes");
const only = argv.includes("--only") ? new Set(argv[argv.indexOf("--only") + 1].split(",")) : null;
const ci = process.env.GITHUB_ACTIONS === "true";

const ORDER = { types: 0, view: 1, skin: 2, plugin: 3 };
function kindOf(dir) {
  if (existsSync(path.join(dir, "theme.json"))) return "view";
  if (existsSync(path.join(dir, "skin.json"))) return "skin";
  if (existsSync(path.join(dir, "plugin.json"))) return "plugin";
  return "types";
}
const packages = readdirSync(path.join(root, "packages"))
  .map((id) => {
    const dir = path.join(root, "packages", id);
    const file = path.join(dir, "package.json");
    if (!existsSync(file)) return null;
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    return { id, dir, pkg, kind: kindOf(dir) };
  })
  .filter((p) => p && !p.pkg.private && (!only || only.has(p.id)))
  .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.id.localeCompare(b.id));

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\n${cmd} ${args.join(" ")} failed in ${path.relative(root, cwd)}`);
    process.exit(r.status ?? 1);
  }
}

/** Is name@version on the registry already? E404 means no (also for a scope that does not exist yet). */
function published(name, version) {
  const r = spawnSync("npm", ["view", `${name}@${version}`, "version", "--json"], { encoding: "utf8" });
  if (r.status === 0) return r.stdout.trim() !== "" && r.stdout.trim() !== "[]";
  if (/E404|404 Not Found/.test(r.stderr + r.stdout)) return false;
  console.error(r.stderr || r.stdout);
  console.error(`could not ask the registry about ${name}@${version}`);
  process.exit(1);
}

console.log(`${yes ? "publishing" : "dry run (--yes publishes)"}: ${packages.map((p) => p.id).join(" → ")}\n`);
let done = 0;
for (const { dir, pkg, kind } of packages) {
  const spec = `${pkg.name}@${pkg.version}`;
  if (published(pkg.name, pkg.version)) {
    console.log(`— ${spec} is on the registry already, skipped`);
    continue;
  }
  console.log(`\n▸ ${spec} (${kind})`);
  if (pkg.scripts?.build) run("npm", ["run", "build", "--silent"], dir);
  run("node", [path.join(root, "scripts/pack-check.mjs"), dir], root);
  const args = ["publish", "--access", "public"];
  if (ci) args.push("--provenance");
  if (!yes) args.push("--dry-run");
  run("npm", args, dir);
  done++;
}
console.log(
  `\n${done} package${done === 1 ? "" : "s"} ${yes ? "published" : "would be published"}; the rest were on the registry already.`,
);
