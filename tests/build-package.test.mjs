import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import * as tar from "tar";
import { repoRoot } from "../scripts/schema-utils.mjs";

test("package archives are deterministic and have one logical root", async () => {
  const id = "builder-fixture";
  const packageDir = path.join(repoRoot, "packages", id);
  const archive = path.join(repoRoot, "dist", `${id}-1.0.0.tar.gz`);
  const manifest = {
    schemaVersion: 1,
    id,
    version: "1.0.0",
    minPeonVersion: "0.0.1",
    platforms: [{ os: "darwin", arch: "arm64" }],
    permissions: { networkHosts: [], hostPaths: [] },
    dependencies: [],
    mcp: { command: { executable: "node", args: ["dist/mcp.js"] }, toolPrefix: "builder_fixture" },
  };

  await fs.mkdir(path.join(packageDir, "dist"), { recursive: true });
  await fs.writeFile(path.join(packageDir, "armory.package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(packageDir, "dist", "mcp.js"), "process.stdin.resume();\n");
  await fs.writeFile(path.join(packageDir, "LICENSE"), "fixture license\n");
  await fs.writeFile(path.join(packageDir, "THIRD_PARTY_NOTICES"), "none\n");

  const build = () => {
    const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "build-package.mjs"), id, "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim().split("\n").at(-1));
  };

  try {
    const first = build();
    const firstBytes = await fs.readFile(archive);
    const second = build();
    const secondBytes = await fs.readFile(archive);
    assert.equal(first.sha256, second.sha256);
    assert.equal(crypto.createHash("sha256").update(firstBytes).digest("hex"), crypto.createHash("sha256").update(secondBytes).digest("hex"));

    const entries = [];
    await tar.t({ file: archive, onentry: (entry) => entries.push(entry.path) });
    assert.ok(entries.length >= 5);
    assert.ok(entries.every((entry) => entry === `${id}-1.0.0` || entry.startsWith(`${id}-1.0.0/`)));
    assert.ok(entries.includes(`${id}-1.0.0/armory.package.json`));
    assert.ok(entries.includes(`${id}-1.0.0/dist/mcp.js`));
  } finally {
    await fs.rm(packageDir, { recursive: true, force: true });
    await fs.rm(archive, { force: true });
  }
});
