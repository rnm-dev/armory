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
const issuerId = "57246542-96fe-1a63-e053-0824d011072a";
const keyId = "2X9R4HXF34";
const defaultAppId = "6446998023";
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const privateKeySecret = privateKeyPem.split("\n")[1];

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

async function startAppleApi() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });

    const token = req.headers.authorization?.replace(/^Bearer /, "");
    const parts = token?.split(".");
    if (!parts || parts.length !== 3) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ errors: [{ detail: "missing token" }] }));
      return;
    }
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    assert.deepEqual({ alg: header.alg, kid: header.kid, typ: header.typ }, { alg: "ES256", kid: keyId, typ: "JWT" });
    assert.equal(claims.iss, issuerId);
    assert.equal(claims.aud, "appstoreconnect-v1");
    assert(claims.exp - claims.iat <= 1200);
    assert.equal(Buffer.from(parts[2], "base64url").length, 64);

    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url?.startsWith("/v1/apps?")) {
      res.end(JSON.stringify({ data: [{ type: "apps", id: defaultAppId, attributes: { name: "Example", bundleId: "com.example.app" } }] }));
      return;
    }
    if (req.method === "GET" && req.url?.startsWith(`/v1/apps/${defaultAppId}/builds?`)) {
      res.end(JSON.stringify({ data: [{ type: "builds", id: "build-1", attributes: { version: "42", processingState: "VALID" } }] }));
      return;
    }
    if (req.method === "GET" && req.url?.startsWith(`/v1/apps/${defaultAppId}/appStoreVersions?`)) {
      res.end(JSON.stringify({ data: [{ type: "appStoreVersions", id: "version-1", attributes: { versionString: "1.2.0", appStoreState: "PREPARE_FOR_SUBMISSION" } }] }));
      return;
    }
    if (req.method === "GET" && req.url?.startsWith(`/v1/apps/${defaultAppId}/betaGroups?`)) {
      res.end(JSON.stringify({ data: [{ type: "betaGroups", id: "group-1", attributes: { name: "Internal" } }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/betaGroups/group-1/relationships/builds") {
      assert.deepEqual(JSON.parse(body), { data: [{ type: "builds", id: "build-1" }] });
      res.writeHead(204).end();
      return;
    }
    res.writeHead(404).end(JSON.stringify({ errors: [{ detail: "not found" }] }));
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

test("manifest declares bounded team credentials, Apple API access, and no host writes", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, "armory.package.json"), "utf8"));
  assert.equal(manifest.id, "app-store-connect");
  assert.deepEqual(manifest.permissions.networkHosts, ["api.appstoreconnect.apple.com"]);
  assert.deepEqual(manifest.permissions.hostPaths, []);
  assert.deepEqual(manifest.configuration.managedPaths, ["config/app-store-connect.json"]);
  const fields = Object.fromEntries(manifest.configuration.fields.map((field) => [field.id, field]));
  assert.equal(fields.privateKeyFile.type, "file");
  assert.equal(fields.privateKeyFile.validation.maxLength, 65_536);
  assert.match(fields.issuerId.help, /Team Keys/);
});

test("rejects invalid private keys without exposing their contents", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-app-store-connect-invalid-"));
  try {
    const response = await runHook("configure", {
      protocolVersion: 1,
      type: "input",
      operation: "configure",
      package: { id: "app-store-connect", version: "0.1.0", dir: packageDir, home },
      platform: { os: "darwin", arch: "arm64" },
      configuration: { issuerId, keyId, privateKeyFile: "-----BEGIN PRIVATE KEY-----\nsecret_invalid_key\n-----END PRIVATE KEY-----" },
    }, {});
    assert.equal(response.code, 1);
    assert.equal(response.stdout.includes("secret_invalid_key"), false);
    assert.equal(JSON.parse(response.stdout).errorCode, "CONFIGURATION_INVALID");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("configures, verifies, inspects releases, and guards TestFlight changes without leaking the private key", async () => {
  const fake = await startAppleApi();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-app-store-connect-"));
  const packageInfo = { id: "app-store-connect", version: "0.1.0", dir: packageDir, home };
  const platform = { os: process.platform === "darwin" ? "darwin" : "linux", arch: process.arch === "arm64" ? "arm64" : "x64" };
  const env = { NODE_ENV: "test", APP_STORE_CONNECT_TEST_API_URL: fake.url };
  try {
    const configured = await runHook("configure", {
      protocolVersion: 1,
      type: "input",
      operation: "configure",
      package: packageInfo,
      platform,
      configuration: { issuerId, keyId, privateKeyFile: privateKeyPem, defaultAppId },
    }, env);
    assert.equal(configured.code, 0, configured.stderr);
    assert.equal(configured.stderr, "");
    assert.equal(configured.stdout.includes(privateKeySecret), false);
    assert.equal(JSON.parse(configured.stdout).ok, true);
    const storedPath = path.join(home, "config", "app-store-connect.json");
    assert.equal((await fs.stat(storedPath)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await fs.readFile(storedPath, "utf8")).privateKey, privateKeyPem);

    const verified = await runHook("verify", {
      protocolVersion: 1,
      type: "input",
      operation: "verify",
      package: packageInfo,
      platform,
    }, env);
    assert.equal(verified.code, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).ok, true);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(packageDir, "dist", "mcp.js")],
      env: { ...process.env, ...env, PEON_ARMORY_HOME: home },
    });
    const client = new Client({ name: "app-store-connect-package-test", version: "0.1.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), [
        "list_apps",
        "list_builds",
        "list_app_store_versions",
        "list_beta_groups",
        "add_builds_to_beta_group",
      ]);
      await client.callTool({ name: "list_apps", arguments: { bundleId: "com.example.app" } });
      await client.callTool({ name: "list_builds", arguments: {} });
      await client.callTool({ name: "list_app_store_versions", arguments: {} });
      await client.callTool({ name: "list_beta_groups", arguments: {} });

      const rejected = await client.callTool({
        name: "add_builds_to_beta_group",
        arguments: { betaGroupId: "group-1", buildIds: ["build-1"], confirmation: "wrong" },
      });
      assert.equal(rejected.isError, true);
      assert.equal(fake.requests.filter((request) => request.method === "POST").length, 0);

      const changed = await client.callTool({
        name: "add_builds_to_beta_group",
        arguments: { betaGroupId: "group-1", buildIds: ["build-1", "build-1"], confirmation: "CONFIRM_TESTFLIGHT_CHANGE" },
      });
      assert.equal(changed.isError, undefined);
    } finally {
      await client.close();
    }

    assert.equal(fake.requests.filter((request) => request.method === "POST").length, 1);
    assert.equal(JSON.stringify(fake.requests).includes(privateKeySecret), false);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fake.close();
  }
});
