import assert from "node:assert/strict";
import test from "node:test";
import { loadValidators } from "../scripts/schema-utils.mjs";

const validators = await loadValidators();

test("empty official catalog is valid", () => {
  assert.equal(validators.catalog({
    schemaVersion: 1,
    name: "rnm-dev/armory",
    updatedAt: "2026-07-14T00:00:00.000Z",
    packages: [],
  }), true);
});

test("catalog rejects unknown fields", () => {
  assert.equal(validators.catalog({
    schemaVersion: 1,
    name: "rnm-dev/armory",
    updatedAt: "2026-07-14T00:00:00.000Z",
    packages: [],
    typo: true,
  }), false);
});

test("minimal package manifest is valid", () => {
  assert.equal(validators.manifest({
    schemaVersion: 1,
    id: "fixture-echo",
    version: "1.0.0",
    minPeonVersion: "0.0.1",
    platforms: [{ os: "darwin", arch: "arm64" }],
    permissions: { networkHosts: [], hostPaths: [] },
    dependencies: [],
    mcp: { command: { executable: "node", args: ["dist/mcp.js"] }, toolPrefix: "fixture_echo" },
  }), true);
});

test("managed dependency platform contract is valid", () => {
  assert.equal(validators.manifest({
    schemaVersion: 1,
    id: "fixture-managed",
    version: "1.0.0",
    minPeonVersion: "0.0.1",
    platforms: [{ os: "linux", arch: "x64" }],
    permissions: { networkHosts: [], hostPaths: [] },
    dependencies: [{
      id: "fake-cli",
      displayName: "Fake CLI",
      versionRange: "^1.0.0",
      strategies: [{
        type: "managed",
        platforms: [{
          os: "linux",
          arch: "x64",
          archive: {
            url: "https://github.com/rnm-dev/armory/releases/download/fake-cli-v1.0.0/fake-cli.tar.gz",
            size: 12,
            sha256: "a".repeat(64),
          },
          format: "tar.gz",
          executablePath: "bin/fake-cli",
          version: "1.0.0",
        }],
      }],
    }],
    mcp: { command: { executable: "node", args: ["dist/mcp.js"] }, toolPrefix: "fixture_managed" },
  }), true);
});

test("configure input requires configuration values", () => {
  const base = {
    protocolVersion: 1,
    type: "input",
    operation: "configure",
    package: { id: "fixture", version: "1.0.0", dir: "/tmp/package", home: "/tmp/home" },
    platform: { os: "linux", arch: "x64" },
  };
  assert.equal(validators.hookMessage(base), false);
  assert.equal(validators.hookMessage({ ...base, configuration: { token: "secret" } }), true);
});

test("failed hook result requires a safe error code", () => {
  assert.equal(validators.hookMessage({ protocolVersion: 1, type: "result", ok: false, message: "failed" }), false);
  assert.equal(validators.hookMessage({ protocolVersion: 1, type: "result", ok: false, message: "failed", errorCode: "VERIFY_FAILED" }), true);
});
