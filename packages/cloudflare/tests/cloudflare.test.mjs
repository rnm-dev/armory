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

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiToken = "cloudflare_test_token_that_must_not_leak";
const accountId = "0123456789abcdef0123456789abcdef";
const zoneId = "fedcba9876543210fedcba9876543210";
const tunnelId = "11111111-2222-4333-8444-555555555555";

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

async function startCloudflare() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== `Bearer ${apiToken}`) {
      res.writeHead(401).end(JSON.stringify({ success: false, errors: [{ message: "unauthorized" }] }));
      return;
    }
    if (req.url === "/user/tokens/verify") {
      res.end(JSON.stringify({ success: true, result: { status: "active" } }));
      return;
    }
    if (req.url === `/zones?account.id=${accountId}&page=1&per_page=5`) {
      res.end(JSON.stringify({ success: true, result: [] }));
      return;
    }
    if (req.url === `/accounts/${accountId}/cfd_tunnel?is_deleted=false&page=1&per_page=1`) {
      res.end(JSON.stringify({ success: true, result: [] }));
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/zones?")) {
      res.end(JSON.stringify({ success: true, result: [{ id: zoneId, name: "example.com" }], result_info: { total_pages: 1 } }));
      return;
    }
    if (req.method === "GET" && req.url?.startsWith(`/accounts/${accountId}/cfd_tunnel?`)) {
      res.end(JSON.stringify({ success: true, result: [{ id: tunnelId, name: "app" }], result_info: { total_pages: 1 } }));
      return;
    }
    if (req.method === "POST" && req.url === "/zones") {
      res.end(JSON.stringify({ success: true, result: { id: zoneId, ...JSON.parse(body) } }));
      return;
    }
    if (req.method === "POST" && req.url === `/zones/${zoneId}/dns_records`) {
      res.end(JSON.stringify({ success: true, result: { id: "record-1", ...JSON.parse(body) } }));
      return;
    }
    if (req.method === "POST" && req.url === `/accounts/${accountId}/cfd_tunnel`) {
      res.end(JSON.stringify({ success: true, result: { id: tunnelId, ...JSON.parse(body) } }));
      return;
    }
    if (req.method === "PUT" && req.url === `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`) {
      res.end(JSON.stringify({ success: true, result: { tunnel_id: tunnelId, ...JSON.parse(body) } }));
      return;
    }
    res.writeHead(404).end(JSON.stringify({ success: false, errors: [{ message: "not found" }] }));
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

test("manifest declares scoped credential configuration and no host writes", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, "armory.package.json"), "utf8"));
  assert.deepEqual(manifest.permissions, { networkHosts: ["api.cloudflare.com"], hostPaths: [] });
  assert.deepEqual(manifest.configuration.fields.map(({ id, type, required }) => ({ id, type, required })), [
    { id: "apiToken", type: "secret", required: true },
    { id: "accountId", type: "text", required: true },
  ]);
  assert.match(manifest.configuration.fields[0].help, /My Profile > API Tokens/);
  assert.match(manifest.configuration.fields[0].help, /Zone DNS Edit/);
  assert.match(manifest.configuration.fields[0].help, /Cloudflare Tunnel Write/);
  assert.match(manifest.configuration.fields[1].help, /Account home/);
  assert.match(manifest.configuration.fields[1].help, /Copy account ID/);
});

test("configures, verifies, and manages zones, records, and tunnels without leaking credentials", async () => {
  const fake = await startCloudflare();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-cloudflare-"));
  const packageInfo = { id: "cloudflare", version: "0.1.0", dir: packageDir, home };
  const platform = { os: process.platform === "darwin" ? "darwin" : "linux", arch: process.arch === "arm64" ? "arm64" : "x64" };
  const env = { NODE_ENV: "test", CLOUDFLARE_TEST_API_URL: fake.url };

  try {
    const configured = await runHook("configure", {
      protocolVersion: 1,
      type: "input",
      operation: "configure",
      package: packageInfo,
      platform,
      configuration: { apiToken, accountId },
    }, env);
    assert.equal(configured.code, 0, configured.stderr);
    assert.equal(configured.stdout.includes(apiToken), false);
    assert.equal(configured.stderr.includes(apiToken), false);
    assert.equal(JSON.parse(configured.stdout).ok, true);

    const stored = await fs.readFile(path.join(home, "config", "cloudflare.json"), "utf8");
    assert.equal(JSON.parse(stored).apiToken, apiToken);
    assert.equal((await fs.stat(path.join(home, "config", "cloudflare.json"))).mode & 0o777, 0o600);

    const verified = await runHook("verify", {
      protocolVersion: 1,
      type: "input",
      operation: "verify",
      package: packageInfo,
      platform,
    }, env);
    assert.equal(verified.code, 0, verified.stderr);
    assert.equal(verified.stdout.includes(apiToken), false);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(packageDir, "dist", "mcp.js")],
      env: { ...process.env, ...env, PEON_ARMORY_HOME: home },
      stderr: "pipe",
    });
    const client = new Client({ name: "cloudflare-package-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), [
        "list_zones", "get_zone", "create_zone", "update_zone", "delete_zone",
        "list_dns_records", "get_dns_record", "create_dns_record", "update_dns_record", "delete_dns_record",
        "list_tunnels", "get_tunnel", "create_tunnel", "update_tunnel", "delete_tunnel",
        "get_tunnel_configuration", "put_tunnel_configuration",
      ]);
      await client.callTool({ name: "list_zones", arguments: {} });
      await client.callTool({ name: "create_zone", arguments: { name: "example.com", type: "full" } });
      await client.callTool({ name: "create_dns_record", arguments: {
        zoneId, type: "A", name: "app.example.com", content: "192.0.2.1", ttl: 1, proxied: true,
      } });
      await client.callTool({ name: "list_tunnels", arguments: {} });
      await client.callTool({ name: "create_tunnel", arguments: { name: "app" } });
      await client.callTool({ name: "put_tunnel_configuration", arguments: {
        tunnelId,
        ingress: [{ hostname: "app.example.com", service: "http://localhost:8080" }, { service: "http_status:404" }],
      } });
    } finally {
      await client.close();
    }

    assert(fake.requests.length >= 7);
    assert(fake.requests.every((request) => request.authorization === `Bearer ${apiToken}`));
    assert.equal(JSON.stringify(fake.requests.map(({ method, url, body }) => ({ method, url, body }))).includes(apiToken), false);
    assert(fake.requests.some((request) => request.url === "/zones" && request.body.includes(accountId)));
    assert(fake.requests.some((request) => request.url?.includes("cfd_tunnel") && request.body.includes('"config_src":"cloudflare"')));
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fake.close();
  }
});
