import path from "node:path";
import { spawnSync } from "node:child_process";
import { readJson, repoRoot } from "./schema-utils.mjs";

const args = process.argv.slice(2);
const id = args.find((arg) => !arg.startsWith("--"));
const confirmed = args.includes("--confirm");
if (!id || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id) || !confirmed) {
  console.error("Usage: npm run release:package -- <package-id> --confirm");
  console.error("This creates an immutable GitHub Release, commits armory.json, and pushes main.");
  process.exit(2);
}

const gh = process.env.GH_BIN || (process.platform === "darwin" ? "/opt/homebrew/bin/gh" : "gh");
const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const detail = result.error?.message || result.stderr || result.stdout || `${command} failed`;
    throw new Error(detail.trim());
  }
  return (result.stdout ?? "").trim();
};
const inherit = (command, commandArgs) => run(command, commandArgs, { stdio: "inherit" });

const manifest = await readJson(path.join(repoRoot, "packages", id, "armory.package.json"));
if (manifest.id !== id) throw new Error(`Manifest ID does not match ${id}`);
const version = manifest.version;
const tag = `${id}-v${version}`;
const metadataPath = path.join("packages", id, "catalog.package.json");

if (run("git", ["status", "--porcelain"])) throw new Error("Refusing to release from a dirty checkout");
if (run("git", ["branch", "--show-current"]) !== "main") throw new Error("Releases must run from main");
inherit("git", ["fetch", "origin", "main", "--tags"]);
if (run("git", ["rev-parse", "HEAD"]) !== run("git", ["rev-parse", "origin/main"])) {
  throw new Error("Local main must exactly match origin/main");
}

inherit("npm", ["ci"]);
inherit("npm", ["run", "generate:types"]);
inherit("npm", ["run", "check"]);
inherit("npm", ["run", "build:package", "--", id]);

try {
  inherit(process.execPath, [path.join(repoRoot, "scripts", "publish-package.mjs"), id, "--catalog-entry", metadataPath]);
} catch (error) {
  console.error(`Publisher failed. Check whether ${tag} was created before retrying; published versions are immutable.`);
  throw error;
}

const changed = run("git", ["status", "--porcelain"]).split("\n").filter(Boolean);
if (changed.length !== 1 || changed[0] !== " M armory.json") {
  throw new Error(`Publisher left unexpected working-tree changes: ${changed.join(", ") || "none"}`);
}
inherit("npm", ["run", "validate"]);
inherit("git", ["diff", "--", "armory.json"]);
inherit("git", ["add", "armory.json"]);
inherit("git", ["diff", "--cached", "--check"]);
if (run("git", ["diff", "--cached", "--name-only"]) !== "armory.json") {
  throw new Error("Catalog commit must contain only armory.json");
}
inherit("git", ["commit", "-m", `Publish ${id} ${version} catalog entry`]);
inherit("git", ["push", "origin", "main"]);
inherit("git", ["fetch", "origin", "main", "--tags"]);

const commit = run("git", ["rev-parse", "HEAD"]);
if (commit !== run("git", ["rev-parse", "origin/main"])) throw new Error("Pushed main did not synchronize");
if (run("git", ["status", "--porcelain"])) throw new Error("Release finished with a dirty checkout");

const release = JSON.parse(run(gh, ["release", "view", tag, "--repo", "rnm-dev/armory", "--json", "url,tagName,isDraft,isPrerelease,assets"]));
if (release.isDraft || release.isPrerelease || release.tagName !== tag) throw new Error("GitHub Release verification failed");
const publicCatalog = JSON.parse(run(gh, [
  "api",
  `repos/rnm-dev/armory/contents/armory.json?ref=${commit}`,
  "-H",
  "Accept: application/vnd.github.raw+json",
]));
const entry = publicCatalog.packages.find((candidate) => candidate.id === id);
const published = entry?.versions.find((candidate) => candidate.version === version);
if (entry?.latest !== version || !published) throw new Error("Public exact-commit catalog verification failed");

console.log(JSON.stringify({
  id,
  version,
  tag,
  releaseUrl: release.url,
  catalogCommit: commit,
  archive: published.archive,
}, null, 2));
