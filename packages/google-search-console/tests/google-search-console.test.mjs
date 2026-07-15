import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const accessToken = "gsc_test_access_token_that_must_not_leak";
const siteUrl = "https://example.com/";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const privateKeySecret = privateKeyPem.split("\n")[1];
const credentials = JSON.stringify({
  type: "service_account",
  client_email: "peon@example-project.iam.gserviceaccount.com",
  private_key: privateKeyPem,
  private_key_id: "test-key-id",
  project_id: "example-project",
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

async function startGoogleApi() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/token") {
      const params = new URLSearchParams(body);
      assert.equal(params.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      const assertion = params.get("assertion");
      assert(assertion);
      const claims = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString("utf8"));
      assert.equal(claims.iss, "peon@example-project.iam.gserviceaccount.com");
      assert.equal(claims.scope, "https://www.googleapis.com/auth/webmasters.readonly");
      assert.match(claims.aud, /\/token$/);
      res.end(JSON.stringify({ access_token: accessToken, expires_in: 3600, token_type: "Bearer" }));
      return;
    }
    if (req.headers.authorization !== `Bearer ${accessToken}`) {
      res.writeHead(401).end(JSON.stringify({ error: { message: "unauthorized" } }));
      return;
    }
    if (req.method === "GET" && req.url === "/webmasters/v3/sites") {
      res.end(JSON.stringify({ siteEntry: [{ siteUrl, permissionLevel: "siteOwner" }] }));
      return;
    }
    if (req.method === "GET" && req.url === `/webmasters/v3/sites/${encodeURIComponent(siteUrl)}`) {
      res.end(JSON.stringify({ siteUrl, permissionLevel: "siteOwner" }));
      return;
    }
    if (req.method === "POST" && req.url === `/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`) {
      res.end(JSON.stringify({ rows: [{ keys: ["example query"], clicks: 3, impressions: 10, ctr: 0.3, position: 2 }] }));
      return;
    }
    if (req.method === "GET" && req.url === `/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`) {
      res.end(JSON.stringify({ sitemap: [{ path: "https://example.com/sitemap.xml", isPending: false }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/urlInspection/index:inspect") {
      res.end(JSON.stringify({ inspectionResult: { indexStatusResult: { verdict: "PASS" } } }));
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

test("manifest requests only a service-account file and read-only API hosts", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, "armory.package.json"), "utf8"));
  assert.deepEqual(manifest.configuration.fields, [{
    id: "serviceAccountFile",
    label: "Service account JSON",
    help: "In Google Cloud Console, go to IAM & Admin > Service Accounts, open or create an account, then choose Keys > Add key > Create new key > JSON. In each Search Console property, go to Settings > Users and permissions > Add user and grant access to the JSON file's client_email. Select that downloaded JSON file here.",
    type: "file",
    required: true,
    validation: { maxLength: 1048576 },
  }]);
  assert.deepEqual(manifest.permissions.networkHosts, [
    "oauth2.googleapis.com", "searchconsole.googleapis.com", "www.googleapis.com",
  ]);
});

test("configures, verifies, and serves read-only Search Console tools without leaking credentials", async () => {
  const fake = await startGoogleApi();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-google-search-console-"));
  const packageInfo = { id: "google-search-console", version: "0.1.0", dir: packageDir, home };
  const platform = { os: process.platform === "darwin" ? "darwin" : "linux", arch: process.arch === "arm64" ? "arm64" : "x64" };
  const env = {
    NODE_ENV: "test",
    GOOGLE_SEARCH_CONSOLE_TEST_TOKEN_URL: `${fake.url}/token`,
    GOOGLE_SEARCH_CONSOLE_TEST_WEBMASTERS_URL: `${fake.url}/webmasters/v3`,
    GOOGLE_SEARCH_CONSOLE_TEST_INSPECTION_URL: `${fake.url}/v1`,
  };

  try {
    const configured = await runHook("configure", {
      protocolVersion: 1,
      type: "input",
      operation: "configure",
      package: packageInfo,
      platform,
      configuration: { serviceAccountFile: credentials },
    }, env);
    assert.equal(configured.code, 0, configured.stderr);
    assert.equal(configured.stdout.includes(privateKeySecret), false);
    assert.deepEqual(JSON.parse(configured.stdout), {
      protocolVersion: 1,
      type: "result",
      ok: true,
      message: "Google Search Console credentials are configured",
      ownedPaths: ["config/google-search-console.json"],
    });
    const stored = await fs.stat(path.join(home, "config", "google-search-console.json"));
    assert.equal(stored.mode & 0o777, 0o600);

    const verified = await runHook("verify", {
      protocolVersion: 1,
      type: "input",
      operation: "verify",
      package: packageInfo,
      platform,
    }, env);
    assert.equal(verified.code, 0, verified.stderr);
    assert.equal(verified.stdout.includes(privateKeySecret), false);
    assert.equal(verified.stdout.includes(accessToken), false);
    assert.equal(JSON.parse(verified.stdout).ok, true);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(packageDir, "dist", "mcp.js")],
      env: { ...process.env, ...env, PEON_ARMORY_HOME: home },
    });
    const client = new Client({ name: "google-search-console-package-test", version: "0.1.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), [
        "list_sites", "get_site", "query_search_analytics", "list_sitemaps", "get_sitemap", "inspect_url",
      ]);
      await client.callTool({ name: "list_sites", arguments: {} });
      await client.callTool({ name: "get_site", arguments: { siteUrl } });
      await client.callTool({ name: "query_search_analytics", arguments: {
        siteUrl, startDate: "2026-07-01", endDate: "2026-07-14", dimensions: ["query"], rowLimit: 10,
      } });
      await client.callTool({ name: "list_sitemaps", arguments: { siteUrl } });
      await client.callTool({ name: "inspect_url", arguments: { inspectionUrl: "https://example.com/page", siteUrl } });
    } finally {
      await client.close();
    }

    assert(fake.requests.length >= 8);
    const apiRequests = fake.requests.filter((request) => request.url !== "/token");
    assert(apiRequests.every((request) => request.authorization === `Bearer ${accessToken}`));
    const serializedRequests = JSON.stringify(fake.requests);
    assert.equal(serializedRequests.includes(privateKeySecret), false);
    const analytics = fake.requests.find((request) => request.url?.endsWith("/searchAnalytics/query"));
    assert.deepEqual(JSON.parse(analytics.body), {
      startDate: "2026-07-01",
      endDate: "2026-07-14",
      dimensions: ["query"],
      type: "web",
      aggregationType: "auto",
      dataState: "final",
      rowLimit: 10,
      startRow: 0,
    });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fake.close();
  }
});
