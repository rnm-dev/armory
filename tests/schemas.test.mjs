import assert from "node:assert/strict";
import test from "node:test";
import { loadValidators, summarizeRequirements } from "../scripts/schema-utils.mjs";

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

test("catalog accepts only official package icon asset URLs", () => {
  const packageEntry = {
    id: "fixture-echo",
    displayName: "Fixture Echo",
    iconUrl: "https://raw.githubusercontent.com/rnm-dev/armory/main/packages/fixture-echo/assets/icon.png",
    summary: "Fixture package.",
    publisher: "rnm-dev",
    documentationUrl: "https://github.com/rnm-dev/armory/tree/main/packages/fixture-echo",
    latest: "1.0.0",
    requirements: { credentials: false, hostWrites: false },
    versions: [{
      version: "1.0.0",
      minPeonVersion: "0.0.1",
      platforms: [{ os: "linux", arch: "x64" }],
      archive: {
        url: "https://github.com/rnm-dev/armory/releases/download/fixture-echo-v1.0.0/fixture-echo-1.0.0.tar.gz",
        size: 1,
        sha256: "a".repeat(64),
      },
    }],
  };
  const catalog = { schemaVersion: 1, name: "rnm-dev/armory", updatedAt: "2026-07-16T00:00:00.000Z", packages: [packageEntry] };
  assert.equal(validators.catalog(catalog), true);
  assert.equal(validators.catalog({ ...catalog, packages: [{ ...packageEntry, iconUrl: "https://example.com/icon.png" }] }), false);
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

test("configuration fields use type-driven credential handling", () => {
  const manifest = {
    schemaVersion: 1,
    id: "fixture-configured",
    version: "1.0.0",
    minPeonVersion: "0.0.1",
    platforms: [{ os: "linux", arch: "x64" }],
    permissions: { networkHosts: [], hostPaths: [] },
    dependencies: [],
    configuration: {
      fields: [{
        id: "apiKey",
        label: "API key",
        help: "Paste an API key.",
        type: "secret",
        required: true,
        validation: { maxLength: 4096 },
      }],
      handler: { executable: "node", args: ["dist/hooks/configure.js"] },
      managedPaths: [],
    },
    mcp: { command: { executable: "node", args: ["dist/mcp.js"] }, toolPrefix: "fixture_configured" },
  };

  assert.equal(validators.manifest(manifest), true);
  assert.deepEqual(summarizeRequirements(manifest), { credentials: true, hostWrites: false });
  const removedField = ["sensi", "tive"].join("");
  assert.equal(validators.manifest({
    ...manifest,
    configuration: {
      ...manifest.configuration,
      fields: [{ ...manifest.configuration.fields[0], [removedField]: true }],
    },
  }), false, "removed field must be rejected");
  assert.equal(validators.manifest({
    ...manifest,
    configuration: {
      ...manifest.configuration,
      fields: [{ id: "apiKey", label: "API key", type: "secret" }],
    },
  }), false, "required must remain explicit");
});

test("select options are non-empty and exclusive to select fields", () => {
  const configured = (field) => ({
    schemaVersion: 1,
    id: "fixture-field",
    version: "1.0.0",
    minPeonVersion: "0.0.1",
    platforms: [{ os: "linux", arch: "x64" }],
    permissions: { networkHosts: [], hostPaths: [] },
    dependencies: [],
    configuration: {
      fields: [field],
      handler: { executable: "node", args: ["dist/hooks/configure.js"] },
      managedPaths: [],
    },
    mcp: { command: { executable: "node", args: ["dist/mcp.js"] }, toolPrefix: "fixture_field" },
  });

  assert.equal(validators.manifest(configured({
    id: "region",
    label: "Region",
    type: "select",
    required: false,
    options: [{ value: "east", label: "East" }],
  })), true);
  assert.equal(validators.manifest(configured({ id: "region", label: "Region", type: "select", required: false, options: [] })), false);
  assert.equal(validators.manifest(configured({
    id: "token",
    label: "Token",
    type: "secret",
    required: false,
    options: [{ value: "x", label: "X" }],
  })), false);
});

test("catalog requirements include secret, file, or required configuration fields", () => {
  const manifest = (field) => ({
    permissions: { hostPaths: [] },
    configuration: { fields: [field] },
  });
  assert.equal(summarizeRequirements(manifest({ type: "secret", required: false })).credentials, true);
  assert.equal(summarizeRequirements(manifest({ type: "file", required: false })).credentials, true);
  assert.equal(summarizeRequirements(manifest({ type: "text", required: true })).credentials, true);
  assert.equal(summarizeRequirements(manifest({ type: "text", required: false })).credentials, false);
});

test("non-empty dependency declarations are rejected in V1", () => {
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
  }), false);
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
