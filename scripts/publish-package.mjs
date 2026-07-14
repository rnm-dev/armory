import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readJson, repoRoot } from "./schema-utils.mjs";

const argv = process.argv.slice(2);
const id = argv[0];
const metadataFlag = argv.indexOf("--catalog-entry");
if (!id || metadataFlag < 0 || !argv[metadataFlag + 1]) {
  console.error("Usage: npm run publish:package -- <package-id> --catalog-entry <metadata.json>");
  process.exit(2);
}

const gh = process.env.GH_BIN || (process.platform === "darwin" ? "/opt/homebrew/bin/gh" : "gh");
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  return (result.stdout ?? "").trim();
};

if (run("git", ["status", "--porcelain"])) throw new Error("Refusing to publish from a dirty checkout");
if (run("git", ["branch", "--show-current"]) !== "main") throw new Error("Manual releases must be published from main");
run("git", ["fetch", "origin", "main", "--tags"]);
if (run("git", ["rev-parse", "HEAD"]) !== run("git", ["rev-parse", "origin/main"])) throw new Error("Local main must exactly match origin/main");
run(process.execPath, [path.join(repoRoot, "scripts", "validate.mjs")], { stdio: "inherit" });

const buildOutput = run(process.execPath, [path.join(repoRoot, "scripts", "build-package.mjs"), id, "--json"]);
const build = JSON.parse(buildOutput.split("\n").at(-1));
const tag = `${id}-v${build.version}`;
const tagExists = spawnSync("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], { cwd: repoRoot, stdio: "ignore" }).status === 0;
const releaseExists = spawnSync(gh, ["release", "view", tag, "--repo", "rnm-dev/armory"], { stdio: "ignore" }).status === 0;
if (tagExists || releaseExists) throw new Error(`Refusing to replace existing tag or release ${tag}`);

const metadataPath = path.resolve(repoRoot, argv[metadataFlag + 1]);
const metadata = await readJson(metadataPath);
const requiredKeys = ["id", "displayName", "summary", "publisher", "documentationUrl", "requirements"];
if (requiredKeys.some((key) => !(key in metadata)) || metadata.id !== id || metadata.publisher !== "rnm-dev") {
  throw new Error("Catalog metadata is incomplete or does not match the package");
}
if (metadata.testOnly === true) throw new Error("Test-only packages cannot be published to the production catalog");

const manifest = await readJson(path.join(repoRoot, "packages", id, "armory.package.json"));
const catalogPath = path.join(repoRoot, "armory.json");
const catalog = await readJson(catalogPath);
let entry = catalog.packages.find((candidate) => candidate.id === id);
if (entry?.versions.some((version) => version.version === build.version)) {
  throw new Error(`Catalog already contains ${id} ${build.version}`);
}

run(gh, ["release", "create", tag, build.path, "--repo", "rnm-dev/armory", "--target", "main", "--title", `${id} ${build.version}`, "--notes", `Armory package ${id} ${build.version}`], { stdio: "inherit" });

const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), "armory-release-verify-"));
try {
  run(gh, ["release", "download", tag, "--repo", "rnm-dev/armory", "--pattern", path.basename(build.path), "--dir", downloadDir], { stdio: "inherit" });
  const downloaded = await fs.readFile(path.join(downloadDir, path.basename(build.path)));
  const digest = crypto.createHash("sha256").update(downloaded).digest("hex");
  if (downloaded.byteLength !== build.size || digest !== build.sha256) throw new Error("Downloaded release asset does not match the local archive");
} finally {
  await fs.rm(downloadDir, { recursive: true, force: true });
}

if (!entry) {
  const { testOnly: _testOnly, ...catalogMetadata } = metadata;
  entry = { ...catalogMetadata, latest: build.version, versions: [] };
  catalog.packages.push(entry);
}
entry.versions.push({
  version: build.version,
  minPeonVersion: manifest.minPeonVersion,
  platforms: manifest.platforms,
  archive: {
    url: `https://github.com/rnm-dev/armory/releases/download/${tag}/${path.basename(build.path)}`,
    size: build.size,
    sha256: build.sha256,
  },
});
entry.latest = build.version;
catalog.updatedAt = new Date().toISOString();

const temporary = `${catalogPath}.tmp-${process.pid}`;
await fs.writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o644 });
await fs.rename(temporary, catalogPath);
run(process.execPath, [path.join(repoRoot, "scripts", "validate.mjs")], { stdio: "inherit" });
console.log(`Published ${tag}; armory.json is validated and ready to commit to main.`);
