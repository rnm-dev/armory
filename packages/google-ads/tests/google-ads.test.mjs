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
const developerToken = "google_ads_developer_token_that_must_not_leak";
const clientId = "client-id.apps.googleusercontent.com";
const clientSecret = "google_ads_client_secret_that_must_not_leak";
const refreshToken = "google_ads_refresh_token_that_must_not_leak";
const accessToken = "short_lived_access_token_that_must_not_leak";
const loginCustomerId = "1234567890";
const customerId = "9876543210";

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

async function startGoogleAds() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      developerToken: req.headers["developer-token"],
      loginCustomerId: req.headers["login-customer-id"],
      body,
    });
    res.setHeader("content-type", "application/json");

    if (req.url === "/token" && req.method === "POST") {
      const values = new URLSearchParams(body);
      if (values.get("client_id") !== clientId || values.get("client_secret") !== clientSecret
        || values.get("refresh_token") !== refreshToken || values.get("grant_type") !== "refresh_token") {
        res.writeHead(401).end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      res.end(JSON.stringify({ access_token: accessToken, expires_in: 3600, token_type: "Bearer" }));
      return;
    }

    if (req.headers.authorization !== `Bearer ${accessToken}` || req.headers["developer-token"] !== developerToken) {
      res.writeHead(401).end(JSON.stringify({ error: { message: "unauthorized" } }));
      return;
    }
    if (req.url === "/v24/customers:listAccessibleCustomers" && req.method === "GET") {
      res.end(JSON.stringify({ resourceNames: [`customers/${customerId}`] }));
      return;
    }
    if (req.url === `/v24/customers/${customerId}/googleAds:search` && req.method === "POST") {
      const { query } = JSON.parse(body);
      res.end(JSON.stringify({
        results: [{ customer: { id: customerId, descriptiveName: "Example" } }],
        fieldMask: query.includes("customer_client") ? "customerClient.id" : "customer.id,customer.descriptiveName",
      }));
      return;
    }
    res.writeHead(404).end(JSON.stringify({ error: { message: "not found" } }));
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

test("manifest declares only Google Ads API and OAuth network access", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, "armory.package.json"), "utf8"));
  assert.deepEqual(manifest.permissions, {
    networkHosts: ["googleads.googleapis.com", "oauth2.googleapis.com"],
    hostPaths: [],
  });
  assert.deepEqual(manifest.configuration.fields.map(({ id, type, required }) => ({ id, type, required })), [
    { id: "developerToken", type: "secret", required: true },
    { id: "clientId", type: "text", required: true },
    { id: "clientSecret", type: "secret", required: true },
    { id: "refreshToken", type: "secret", required: true },
    { id: "loginCustomerId", type: "text", required: false },
  ]);
  const helpById = Object.fromEntries(manifest.configuration.fields.map((field) => [field.id, field.help]));
  assert.match(helpById.developerToken, /ads\.google\.com\/aw\/apicenter/);
  assert.match(helpById.clientId, /Google Cloud Console.*OAuth client ID/);
  assert.match(helpById.clientSecret, /client_secret.*downloaded credentials JSON/);
  assert.match(helpById.refreshToken, /single-user-authentication.*application_default_credentials\.json/);
  assert.match(helpById.loginCustomerId, /Remove hyphens.*1234567890/);
});

test("configures, verifies, and serves bounded read-only Google Ads tools without leaking secrets", async () => {
  const fake = await startGoogleAds();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-google-ads-"));
  const packageInfo = { id: "google-ads", version: "0.1.0", dir: packageDir, home };
  const platform = { os: process.platform === "darwin" ? "darwin" : "linux", arch: process.arch === "arm64" ? "arm64" : "x64" };
  const env = {
    NODE_ENV: "test",
    GOOGLE_ADS_TEST_API_URL: `${fake.url}/v24`,
    GOOGLE_ADS_TEST_TOKEN_URL: `${fake.url}/token`,
  };
  const secrets = [developerToken, clientSecret, refreshToken, accessToken];

  try {
    const configured = await runHook("configure", {
      protocolVersion: 1,
      type: "input",
      operation: "configure",
      package: packageInfo,
      platform,
      configuration: { developerToken, clientId, clientSecret, refreshToken, loginCustomerId },
    }, env);
    assert.equal(configured.code, 0, configured.stderr);
    assert(secrets.every((secret) => !configured.stdout.includes(secret) && !configured.stderr.includes(secret)));
    assert.equal(JSON.parse(configured.stdout).ok, true);

    const storedPath = path.join(home, "config", "google-ads.json");
    const stored = JSON.parse(await fs.readFile(storedPath, "utf8"));
    assert.deepEqual(stored, { developerToken, clientId, clientSecret, refreshToken, loginCustomerId });
    assert.equal((await fs.stat(storedPath)).mode & 0o777, 0o600);

    const verified = await runHook("verify", {
      protocolVersion: 1,
      type: "input",
      operation: "verify",
      package: packageInfo,
      platform,
    }, env);
    assert.equal(verified.code, 0, verified.stderr);
    assert(secrets.every((secret) => !verified.stdout.includes(secret) && !verified.stderr.includes(secret)));

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(packageDir, "dist", "mcp.js")],
      env: { ...process.env, ...env, PEON_ARMORY_HOME: home },
      stderr: "pipe",
    });
    const client = new Client({ name: "google-ads-package-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), [
        "list_accessible_customers", "get_customer", "list_customer_clients", "run_gaql",
      ]);
      await client.callTool({ name: "list_accessible_customers", arguments: {} });
      await client.callTool({ name: "get_customer", arguments: { customerId } });
      await client.callTool({ name: "list_customer_clients", arguments: { customerId, maxDepth: 2, limit: 25 } });
      await client.callTool({
        name: "run_gaql",
        arguments: { customerId, query: "SELECT campaign.id, campaign.name FROM campaign LIMIT 50" },
      });
      const unbounded = await client.callTool({
        name: "run_gaql",
        arguments: { customerId, query: "SELECT campaign.id FROM campaign" },
      });
      assert.equal(unbounded.isError, true);
    } finally {
      await client.close();
    }

    const apiRequests = fake.requests.filter((request) => request.url !== "/token");
    assert(apiRequests.length >= 5);
    assert(apiRequests.every((request) => request.authorization === `Bearer ${accessToken}`));
    assert(apiRequests.every((request) => request.developerToken === developerToken));
    const accessibleRequests = apiRequests.filter((request) => request.url === "/v24/customers:listAccessibleCustomers");
    assert(accessibleRequests.every((request) => request.loginCustomerId === undefined));
    const searchRequests = apiRequests.filter((request) => request.url?.endsWith("/googleAds:search"));
    assert(searchRequests.every((request) => request.loginCustomerId === loginCustomerId));
    assert(searchRequests.some((request) => JSON.parse(request.body).query.endsWith("LIMIT 25")));
    assert.equal(searchRequests.length, 3);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fake.close();
  }
});
