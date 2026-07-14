import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function runHook(name, input) {
  const child = spawn(process.execPath, [path.join(packageDir, "dist", "hooks", `${name}.js`)], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(`${JSON.stringify(input)}\n`);
  const code = await new Promise((resolve) => child.once("close", resolve));
  return { code, stdout, stderr };
}

test("configuration, verification, dependency, and MCP stay offline and redact secrets", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-configured-fixture-"));
  const secret = "fixture-secret-that-must-not-be-printed";
  const packageInfo = { id: "fixture-configured", version: "1.0.0", dir: packageDir, home };
  const platform = { os: process.platform === "darwin" ? "darwin" : "linux", arch: process.arch === "arm64" ? "arm64" : "x64" };

  try {
    const configured = await runHook("configure", {
      protocolVersion: 1,
      type: "input",
      operation: "configure",
      package: packageInfo,
      platform,
      configuration: { projectName: "offline-project", apiToken: secret, region: "test-east", credentialsFile: "fixture-file-content" },
    });
    assert.equal(configured.code, 0, configured.stderr);
    assert.equal(configured.stdout.includes(secret), false);
    assert.deepEqual(JSON.parse(configured.stdout), {
      protocolVersion: 1,
      type: "result",
      ok: true,
      message: "Fixture configuration is ready",
      ownedPaths: ["config/config.json", "config/credentials-file.txt"],
    });

    const verified = await runHook("verify", {
      protocolVersion: 1,
      type: "input",
      operation: "verify",
      package: packageInfo,
      platform,
    });
    assert.equal(verified.code, 0, verified.stderr);
    assert.equal(verified.stdout.includes(secret), false);
    assert.equal(JSON.parse(verified.stdout).ok, true);

    const cli = spawnSync(path.join(packageDir, "dist", "fake-cli.js"), ["--version"], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout.trim(), "fixture-cli 1.0.0");

    const inherited = Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === "string"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(packageDir, "dist", "mcp.js")],
      env: { ...inherited, PEON_ARMORY_HOME: home },
    });
    const client = new Client({ name: "fixture-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), ["configuration_status"]);
      const response = await client.callTool({ name: "configuration_status", arguments: {} });
      const text = response.content[0].text;
      assert.equal(text.includes(secret), false);
      assert.deepEqual(JSON.parse(text), {
        projectName: "offline-project",
        region: "test-east",
        apiTokenConfigured: true,
        credentialsFileConfigured: true,
      });
    } finally {
      await client.close();
    }
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
