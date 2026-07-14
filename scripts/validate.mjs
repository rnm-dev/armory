import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import semver from "semver";
import { formatAjvErrors, loadValidators, readJson, repoRoot } from "./schema-utils.mjs";

const OFFICIAL_RELEASE_PREFIX = "/rnm-dev/armory/releases/download/";
const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);
const key = (platform) => `${platform.os}/${platform.arch}`;

function unique(values, where) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(where, `duplicate value ${JSON.stringify(value)}`);
    seen.add(value);
  }
}

function validateHttpsUrl(value, where, hosts, pathPrefix) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") fail(where, "URL must use HTTPS");
    if (url.username || url.password || url.port) fail(where, "URL cannot contain credentials or a non-default port");
    if (!hosts.includes(url.hostname)) fail(where, `host ${url.hostname} is not allowed`);
    if (pathPrefix && !url.pathname.startsWith(pathPrefix)) fail(where, `path must begin with ${pathPrefix}`);
  } catch {
    fail(where, "invalid URL");
  }
}

function validateManifestSemantics(manifest, where) {
  unique(manifest.platforms.map(key), `${where}.platforms`);
  unique(manifest.dependencies.map((dependency) => dependency.id), `${where}.dependencies`);
  unique(manifest.permissions.networkHosts, `${where}.permissions.networkHosts`);
  unique(manifest.permissions.hostPaths.map((entry) => `${entry.mode}:${entry.path}`), `${where}.permissions.hostPaths`);

  if (manifest.configuration) {
    unique(manifest.configuration.fields.map((field) => field.id), `${where}.configuration.fields`);
    unique(manifest.configuration.managedPaths, `${where}.configuration.managedPaths`);
    for (const field of manifest.configuration.fields) {
      if (field.options) unique(field.options.map((option) => option.value), `${where}.configuration.fields.${field.id}.options`);
      if (field.validation?.pattern) {
        try { new RegExp(field.validation.pattern); } catch { fail(`${where}.configuration.fields.${field.id}`, "invalid validation pattern"); }
      }
    }
    for (const name of Object.keys(manifest.configuration.environment ?? {})) {
      if (name === "PATH" || name.startsWith("PEON_ARMORY_")) fail(`${where}.configuration.environment`, `reserved variable ${name}`);
    }
  }

  for (const dependency of manifest.dependencies) {
    if (!semver.validRange(dependency.versionRange) || dependency.versionRange === "*") {
      fail(`${where}.dependencies.${dependency.id}`, "invalid or unrestricted version range");
    }
    for (const strategy of dependency.strategies) {
      if ("platforms" in strategy) unique(strategy.platforms.map(key), `${where}.dependencies.${dependency.id}.${strategy.type}.platforms`);
      if (strategy.type === "managed") {
        for (const platform of strategy.platforms) {
          validateHttpsUrl(platform.archive.url, `${where}.dependencies.${dependency.id}.archive`, ["github.com"], OFFICIAL_RELEASE_PREFIX);
        }
      }
      if (strategy.type === "external") {
        try { new RegExp(strategy.version.pattern); } catch { fail(`${where}.dependencies.${dependency.id}.version`, "invalid version pattern"); }
      }
    }
  }
}

const validators = await loadValidators();
const catalogPath = path.join(repoRoot, "armory.json");
let catalog;
try {
  catalog = await readJson(catalogPath);
} catch (error) {
  fail("armory.json", `cannot read JSON: ${error.message}`);
}

if (catalog && !validators.catalog(catalog)) fail("armory.json", formatAjvErrors(validators.catalog.errors));

const catalogById = new Map();
if (catalog && validators.catalog(catalog)) {
  unique(catalog.packages.map((entry) => entry.id), "armory.json.packages");
  for (const entry of catalog.packages) {
    catalogById.set(entry.id, entry);
    unique(entry.versions.map((version) => version.version), `armory.json.${entry.id}.versions`);
    if (!entry.versions.some((version) => version.version === entry.latest)) fail(`armory.json.${entry.id}`, "latest is not a listed version");
    if (semver.prerelease(entry.latest)) fail(`armory.json.${entry.id}`, "latest cannot be a prerelease");
    validateHttpsUrl(entry.documentationUrl, `armory.json.${entry.id}.documentationUrl`, ["github.com"], `/rnm-dev/armory/`);
    for (const version of entry.versions) {
      unique(version.platforms.map(key), `armory.json.${entry.id}.${version.version}.platforms`);
      validateHttpsUrl(version.archive.url, `armory.json.${entry.id}.${version.version}.archive`, ["github.com"], OFFICIAL_RELEASE_PREFIX);
    }
  }
}

const packageRoot = path.join(repoRoot, "packages");
const packageDirs = (await fs.readdir(packageRoot, { withFileTypes: true }).catch(() => []))
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));

for (const dirent of packageDirs) {
  const manifestPath = path.join(packageRoot, dirent.name, "armory.package.json");
  let manifest;
  try {
    manifest = await readJson(manifestPath);
  } catch (error) {
    fail(`packages/${dirent.name}`, `cannot read armory.package.json: ${error.message}`);
    continue;
  }
  if (!validators.manifest(manifest)) {
    fail(`packages/${dirent.name}/armory.package.json`, formatAjvErrors(validators.manifest.errors));
    continue;
  }
  if (manifest.id !== dirent.name) fail(`packages/${dirent.name}`, `manifest id ${manifest.id} does not match directory`);
  validateManifestSemantics(manifest, `packages/${dirent.name}`);
  const catalogEntry = catalogById.get(manifest.id);
  const listed = catalogEntry?.versions.find((version) => version.version === manifest.version);
  if (listed) {
    if (listed.minPeonVersion !== manifest.minPeonVersion) fail(`packages/${dirent.name}`, "catalog and manifest minPeonVersion differ");
    if (JSON.stringify(listed.platforms) !== JSON.stringify(manifest.platforms)) fail(`packages/${dirent.name}`, "catalog and manifest platforms differ");
    const expectedRequirements = {
      credentials: Boolean(manifest.configuration?.fields.some((field) => field.required || field.sensitive)),
      localDependencies: manifest.dependencies.length > 0,
      hostWrites: manifest.permissions.hostPaths.some((entry) => entry.mode === "write"),
    };
    if (JSON.stringify(expectedRequirements) !== JSON.stringify(catalogEntry.requirements)) fail(`packages/${dirent.name}`, "catalog requirements do not summarize manifest");
  }
}

const hookFixtureRoot = path.join(repoRoot, "tests", "fixtures", "hooks");
for (const entry of await fs.readdir(hookFixtureRoot, { withFileTypes: true }).catch(() => [])) {
  if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
  const fixture = await readJson(path.join(hookFixtureRoot, entry.name));
  if (!validators.hookMessage(fixture)) fail(`tests/fixtures/hooks/${entry.name}`, formatAjvErrors(validators.hookMessage.errors));
}

const generated = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "generate-types.mjs"), "--check"], { encoding: "utf8" });
if (generated.status !== 0) fail("src/generated", (generated.stderr || generated.stdout).trim());

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Validated catalog, ${packageDirs.length} package manifest(s), schemas, and generated contracts.`);
