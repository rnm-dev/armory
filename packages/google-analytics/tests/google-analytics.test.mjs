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
const accessToken = "google_test_access_token_that_must_not_leak";
const clientSecret = "google_client_secret_that_must_not_leak";
const refreshToken = "google_refresh_token_that_must_not_leak";
const measurementSecret = "measurement_secret_that_must_not_leak";
const propertyId = "123456789";

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

async function startGoogleApis() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
    res.setHeader("content-type", "application/json");

    if (req.url?.startsWith("/mp/collect") || req.url?.startsWith("/debug/mp/collect")) {
      if (!req.url.includes(`api_secret=${measurementSecret}`)) {
        res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      res.end(req.url.startsWith("/debug/") ? JSON.stringify({ validationMessages: [] }) : "");
      return;
    }
    if (req.headers.authorization !== `Bearer ${accessToken}`) {
      res.writeHead(401).end(JSON.stringify({ error: { message: "unauthorized" } }));
      return;
    }
    if (req.url === "/v1beta/accountSummaries?pageSize=1") {
      res.end(JSON.stringify({ accountSummaries: [] }));
      return;
    }
    if (req.url === `/v1beta/properties/${propertyId}/metadata`) {
      res.end(JSON.stringify({ dimensions: [{ apiName: "country" }], metrics: [{ apiName: "activeUsers" }] }));
      return;
    }
    if (req.url === `/v1beta/properties/${propertyId}:runReport` && req.method === "POST") {
      res.end(JSON.stringify({ rows: [{ dimensionValues: [{ value: "Kazakhstan" }], metricValues: [{ value: "7" }] }] }));
      return;
    }
    if (req.url === `/v1alpha/properties/${propertyId}?updateMask=displayName` && req.method === "PATCH") {
      res.end(JSON.stringify({ name: `properties/${propertyId}`, ...JSON.parse(body) }));
      return;
    }
    if (req.url === "/userDeletion/userDeletionRequests:upsert" && req.method === "POST") {
      res.end(JSON.stringify({ deletionRequestTime: "2026-07-15T00:00:00Z" }));
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

test("manifest declares Google endpoints, secret credentials, and no host writes", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, "armory.package.json"), "utf8"));
  assert.equal(manifest.id, "google-analytics");
  assert.deepEqual(manifest.permissions.hostPaths, []);
  assert(manifest.permissions.networkHosts.includes("analyticsdata.googleapis.com"));
  assert(manifest.permissions.networkHosts.includes("analyticsadmin.googleapis.com"));
  assert(manifest.permissions.networkHosts.includes("www.google-analytics.com"));
  const fields = Object.fromEntries(manifest.configuration.fields.map((field) => [field.id, field]));
  assert.equal(fields.credentialJson.type, "secret");
  assert.equal(fields.credentialJson.required, true);
  assert.equal(fields.measurementApiSecret.type, "secret");
  assert.match(fields.credentialJson.help, /IAM & Admin > Service Accounts/);
  assert.match(fields.credentialJson.help, /Keys > Add key > Create new key > JSON/);
  assert.match(fields.credentialJson.help, /Property access management/);
  assert.match(fields.defaultPropertyId.help, /Admin > Property settings/);
  assert.match(fields.measurementId.help, /Admin > Data streams/);
  assert.match(fields.measurementApiSecret.help, /Measurement Protocol API secrets/);
});

test("configures, verifies, reports, administers, deletes, and measures without leaking secrets", async () => {
  const fake = await startGoogleApis();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-google-analytics-"));
  const packageInfo = { id: "google-analytics", version: "0.1.0", dir: packageDir, home };
  const platform = { os: process.platform === "darwin" ? "darwin" : "linux", arch: process.arch === "arm64" ? "arm64" : "x64" };
  const env = {
    NODE_ENV: "test",
    GOOGLE_ANALYTICS_TEST_API_URL: fake.url,
    GOOGLE_ANALYTICS_TEST_MEASUREMENT_URL: fake.url,
    GOOGLE_ANALYTICS_TEST_ACCESS_TOKEN: accessToken,
  };
  const credentialJson = JSON.stringify({
    type: "authorized_user",
    client_id: "client-id.apps.googleusercontent.com",
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  try {
    const configured = await runHook("configure", {
      protocolVersion: 1,
      type: "input",
      operation: "configure",
      package: packageInfo,
      platform,
      configuration: {
        credentialJson,
        defaultPropertyId: propertyId,
        measurementId: "G-TEST123",
        measurementApiSecret: measurementSecret,
        measurementRegion: "global",
      },
    }, env);
    assert.equal(configured.code, 0, configured.stderr);
    assert.equal(configured.stdout.includes(clientSecret), false);
    assert.equal(configured.stdout.includes(refreshToken), false);
    assert.equal(configured.stdout.includes(measurementSecret), false);
    assert.equal(configured.stderr, "");
    assert.equal(JSON.parse(configured.stdout).ok, true);

    const storedPath = path.join(home, "config", "google-analytics.json");
    const stored = JSON.parse(await fs.readFile(storedPath, "utf8"));
    assert.equal(stored.credential.refresh_token, refreshToken);
    assert.equal((await fs.stat(storedPath)).mode & 0o777, 0o600);

    const verified = await runHook("verify", {
      protocolVersion: 1,
      type: "input",
      operation: "verify",
      package: packageInfo,
      platform,
    }, env);
    assert.equal(verified.code, 0, verified.stderr);
    assert.equal(verified.stdout.includes(accessToken), false);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(packageDir, "dist", "mcp.js")],
      env: { ...process.env, ...env, PEON_ARMORY_HOME: home },
      stderr: "pipe",
    });
    const client = new Client({ name: "google-analytics-package-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), [
        "list_account_summaries",
        "run_report",
        "run_realtime_report",
        "run_funnel_report",
        "get_metadata",
        "data_api_request",
        "admin_api_request",
        "submit_user_deletion",
        "legacy_user_deletion",
        "validate_measurement_events",
        "send_measurement_events",
      ]);

      const report = await client.callTool({ name: "run_report", arguments: {
        request: { dimensions: [{ name: "country" }], metrics: [{ name: "activeUsers" }], dateRanges: [{ startDate: "7daysAgo", endDate: "today" }] },
      } });
      assert.match(report.content[0].text, /Kazakhstan/);

      const denied = await client.callTool({ name: "admin_api_request", arguments: {
        method: "PATCH",
        path: `/v1alpha/properties/${propertyId}`,
        query: { updateMask: "displayName" },
        body: { displayName: "Production" },
      } });
      assert.equal(denied.isError, true);

      await client.callTool({ name: "admin_api_request", arguments: {
        method: "PATCH",
        path: `/v1alpha/properties/${propertyId}`,
        query: { updateMask: "displayName" },
        body: { displayName: "Production" },
        confirm: true,
      } });
      await client.callTool({ name: "legacy_user_deletion", arguments: {
        request: { id: { type: "CLIENT_ID", userId: "user-1" }, propertyId, kind: "analytics#userDeletionRequest" },
        confirm: true,
      } });
      const payload = { client_id: "123.456", events: [{ name: "offline_purchase", params: { value: 10 } }] };
      await client.callTool({ name: "validate_measurement_events", arguments: { payload } });
      await client.callTool({ name: "send_measurement_events", arguments: { payload, confirm: true } });
    } finally {
      await client.close();
    }

    const apiRequests = fake.requests.filter((request) => !request.url.startsWith("/mp/") && !request.url.startsWith("/debug/"));
    assert(apiRequests.every((request) => request.authorization === `Bearer ${accessToken}`));
    const serializedBodies = JSON.stringify(fake.requests.map(({ method, body }) => ({ method, body })));
    assert.equal(serializedBodies.includes(clientSecret), false);
    assert.equal(serializedBodies.includes(refreshToken), false);
    assert(fake.requests.some((request) => request.url === `/v1beta/properties/${propertyId}:runReport`));
    assert(fake.requests.some((request) => request.method === "PATCH" && request.url.includes("updateMask=displayName")));
    assert(fake.requests.some((request) => request.url.startsWith("/debug/mp/collect")));
    assert(fake.requests.some((request) => request.url.startsWith("/mp/collect")));
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fake.close();
  }
});
