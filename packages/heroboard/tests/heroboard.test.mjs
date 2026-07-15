import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secret = "hb_test_secret_that_must_not_leak";

test("manifest exposes exactly one required secret apiKey field", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, "armory.package.json"), "utf8"));
  assert.deepEqual(manifest.configuration.fields, [{
    id: "apiKey",
    label: "API key",
    help: "Create an agent API key in Heroboard and paste it here.",
    type: "secret",
    required: true,
    validation: { maxLength: 4096 },
  }]);
});

async function runHook(name, input, env) {
  const child = spawn(process.execPath, [path.join(packageDir, "dist", "hooks", `${name}.js`)], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(`${JSON.stringify(input)}\n`);
  const code = await new Promise((resolve) => child.once("close", resolve));
  return { code, stdout, stderr };
}

async function startHeroboard() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push({ url: req.url, apiKey: req.headers["x-api-key"] });
    if (req.headers["x-api-key"] !== secret) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (req.url === "/api/agent/v1/context") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ projects: [] }));
      return;
    }
    if (req.url === "/api/mcp/mcp" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const mcp = new McpServer({ name: "fake-heroboard", version: "1.0.0" });
      mcp.registerTool("list_projects", { description: "List accessible projects." }, async () => ({
        content: [{ type: "text", text: "[]" }],
      }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await mcp.connect(transport);
      try {
        await transport.handleRequest(req, res, JSON.parse(raw));
      } finally {
        await transport.close();
        await mcp.close();
      }
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    requests,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("configures, verifies, and proxies Heroboard MCP tools without leaking the API key", async () => {
  const fake = await startHeroboard();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-heroboard-"));
  const packageInfo = { id: "heroboard", version: "1.0.0", dir: packageDir, home };
  const platform = { os: process.platform === "darwin" ? "darwin" : "linux", arch: process.arch === "arm64" ? "arm64" : "x64" };
  const env = { NODE_ENV: "test", HEROBOARD_TEST_API_URL: fake.url };

  try {
    const configured = await runHook("configure", {
      protocolVersion: 1,
      type: "input",
      operation: "configure",
      package: packageInfo,
      platform,
      configuration: { apiKey: secret },
    }, env);
    assert.equal(configured.code, 0, configured.stderr);
    assert.equal(configured.stdout.includes(secret), false);
    assert.deepEqual(JSON.parse(configured.stdout), {
      protocolVersion: 1,
      type: "result",
      ok: true,
      message: "Heroboard credentials are configured",
      ownedPaths: ["config/heroboard.json"],
    });

    const verified = await runHook("verify", {
      protocolVersion: 1,
      type: "input",
      operation: "verify",
      package: packageInfo,
      platform,
    }, env);
    assert.equal(verified.code, 0, verified.stderr);
    assert.equal(verified.stdout.includes(secret), false);
    assert.equal(JSON.parse(verified.stdout).ok, true);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(packageDir, "dist", "mcp.js")],
      env: { ...process.env, ...env, PEON_ARMORY_HOME: home },
    });
    const client = new Client({ name: "heroboard-package-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), ["list_projects"]);
      const response = await client.callTool({ name: "list_projects", arguments: {} });
      assert.deepEqual(response.content, [{ type: "text", text: "[]" }]);
    } finally {
      await client.close();
    }

    assert(fake.requests.length >= 4);
    assert(fake.requests.every((request) => request.apiKey === secret));
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fake.close();
  }
});
