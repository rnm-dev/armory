import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("manifest declares Scout profile and MCP proxy", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(dir, "armory.package.json"), "utf8"));
  assert.equal(manifest.profile.type, "scout-api-key");
  assert.equal(manifest.mcp.toolPrefix, "scout");
});
