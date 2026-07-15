import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./schema-utils.mjs";

const packagesDir = path.join(repoRoot, "packages");
const packages = (await fs.readdir(packagesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const name of packages) {
  const cwd = path.join(packagesDir, name);
  console.log(`Checking ${name}...`);
  for (const args of [["ci", "--ignore-scripts"], ["run", "build"], ["test"], ["audit", "--audit-level=moderate"]]) {
    const result = spawnSync("npm", args, { cwd, stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

console.log(`Checked ${packages.length} package(s).`);
