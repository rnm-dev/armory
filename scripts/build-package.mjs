import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as tar from "tar";
import { formatAjvErrors, loadValidators, readJson, repoRoot } from "./schema-utils.mjs";

const args = process.argv.slice(2);
const id = args.find((arg) => !arg.startsWith("--"));
const json = args.includes("--json");
if (!id || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) {
  console.error("Usage: npm run build:package -- <package-id> [--json]");
  process.exit(2);
}

const packageDir = path.join(repoRoot, "packages", id);
const manifest = await readJson(path.join(packageDir, "armory.package.json"));
const { manifest: validateManifest } = await loadValidators();
if (!validateManifest(manifest) || manifest.id !== id) {
  throw new Error(`Invalid manifest: ${formatAjvErrors(validateManifest.errors)}`);
}

const packageJsonPath = path.join(packageDir, "package.json");
if (await fs.stat(packageJsonPath).then(() => true).catch(() => false)) {
  if (!(await fs.stat(path.join(packageDir, "package-lock.json")).then(() => true).catch(() => false))) {
    throw new Error(`${id} has package.json but no package-lock.json`);
  }
  const install = spawnSync("npm", ["ci", "--ignore-scripts"], { cwd: packageDir, stdio: "inherit" });
  if (install.status !== 0) process.exit(install.status ?? 1);
  const build = spawnSync("npm", ["run", "build", "--if-present"], { cwd: packageDir, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
  const test = spawnSync("npm", ["test", "--if-present"], { cwd: packageDir, stdio: "inherit" });
  if (test.status !== 0) process.exit(test.status ?? 1);
}

for (const required of ["dist", "LICENSE", "THIRD_PARTY_NOTICES"]) {
  if (!(await fs.stat(path.join(packageDir, required)).then(() => true).catch(() => false))) {
    throw new Error(`Package ${id} is missing runtime artifact ${required}`);
  }
}

const rootName = `${id}-${manifest.version}`;
const staging = await fs.mkdtemp(path.join(os.tmpdir(), "armory-build-"));
const archiveRoot = path.join(staging, rootName);
const outputDir = path.join(repoRoot, "dist");
const output = path.join(outputDir, `${rootName}.tar.gz`);

try {
  await fs.mkdir(archiveRoot, { recursive: true });
  for (const name of ["armory.package.json", "dist", "assets", "LICENSE", "THIRD_PARTY_NOTICES"]) {
    const source = path.join(packageDir, name);
    if (await fs.stat(source).then(() => true).catch(() => false)) {
      await fs.cp(source, path.join(archiveRoot, name), { recursive: true, dereference: false, preserveTimestamps: false });
    }
  }

  const archiveEntries = [];
  const normalize = async (target) => {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) throw new Error(`Package archives cannot contain symbolic links: ${target}`);
    await fs.chmod(target, stat.isDirectory() ? 0o755 : 0o644);
    await fs.utimes(target, new Date(0), new Date(0));
    archiveEntries.push(path.relative(staging, target).split(path.sep).join("/"));
    if (stat.isDirectory()) {
      const children = await fs.readdir(target);
      for (const child of children.sort()) await normalize(path.join(target, child));
    }
  };
  await normalize(archiveRoot);
  await fs.mkdir(outputDir, { recursive: true });
  await tar.c({ cwd: staging, file: output, gzip: { level: 9, mtime: 0 }, portable: true, mtime: new Date(0), noMtime: false, noDirRecurse: true }, archiveEntries.sort());

  const bytes = await fs.readFile(output);
  const result = {
    id,
    version: manifest.version,
    path: output,
    size: bytes.byteLength,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
  console.log(json ? JSON.stringify(result) : `Built ${output}\nsha256 ${result.sha256}\nsize ${result.size}`);
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}
