// SPDX-License-Identifier: Apache-2.0
// Prints the CHANGELOG.md section for one version (the body under `## [X.Y.Z]`, up to the
// next `## [`), for the GitHub Release the tag workflow creates. `node scripts/release-notes.mjs 0.1.0`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!version) {
  console.error("usage: release-notes.mjs <version>");
  process.exit(2);
}
const text = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "CHANGELOG.md"), "utf8");
const re = new RegExp(
  `^## \\[${version.replace(/\./g, "\\.")}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|^\\[[^\\]]+\\]: |(?![\\s\\S]))`,
  "m",
);
const m = re.exec(text);
if (!m) {
  console.error(`CHANGELOG.md has no "## [${version}]" section`);
  process.exit(1);
}
process.stdout.write(`${m[1].trim()}\n`);
