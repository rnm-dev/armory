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
const accessToken = "google_play_test_access_token_that_must_not_leak";
const defaultPackage = "com.example.app";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const privateKeySecret = privateKeyPem.split("\n")[1];
const credentials = JSON.stringify({
  type: "service_account",
  client_email: "play-releases@example-project.iam.gserviceaccount.com",
  private_key: privateKeyPem,
  private_key_id: "test-key-id",
  project_id: "example-project",
});

async function runHook(name, input, env) {
  const child = spawn(process.execPath, [path.join(packageDir, "dist", "hooks", `${name}.js`)], {
    env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"],
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
  let nextEdit = 0;
  const tracks = {
    production: { track: "production", releases: [{ name: "1.0", versionCodes: ["100"], status: "inProgress", userFraction: 0.2 }] },
    beta: { track: "beta", releases: [] },
  };
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/token") {
      const params = new URLSearchParams(body);
      const assertion = params.get("assertion");
      assert(assertion);
      const claims = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString("utf8"));
      assert.equal(claims.iss, "play-releases@example-project.iam.gserviceaccount.com");
      assert.equal(claims.scope, "https://www.googleapis.com/auth/androidpublisher");
      res.end(JSON.stringify({ access_token: accessToken, expires_in: 3600 }));
      return;
    }
    if (req.headers.authorization !== `Bearer ${accessToken}`) {
      res.writeHead(401).end(JSON.stringify({ error: { message: "unauthorized" } }));
      return;
    }
    const base = `/androidpublisher/v3/applications/${defaultPackage}`;
    if (req.method === "GET" && req.url === `${base}/tracks/production/releases`) {
      res.end(JSON.stringify({ releases: tracks.production.releases })); return;
    }
    if (req.method === "POST" && req.url === `${base}/edits`) {
      res.end(JSON.stringify({ id: String(++nextEdit) })); return;
    }
    const editMatch = req.url?.match(new RegExp(`^${base}/edits/([0-9]+)(.*)$`));
    if (editMatch) {
      const suffix = editMatch[2];
      if (req.method === "DELETE" && suffix === "") { res.writeHead(204).end(); return; }
      if (req.method === "GET" && suffix === "/tracks") {
        res.end(JSON.stringify({ tracks: Object.values(tracks) })); return;
      }
      const trackMatch = suffix.match(/^\/tracks\/(.+)$/);
      if (trackMatch && req.method === "GET") {
        res.end(JSON.stringify(tracks[decodeURIComponent(trackMatch[1])])); return;
      }
      if (trackMatch && req.method === "PUT") {
        tracks[decodeURIComponent(trackMatch[1])] = JSON.parse(body);
        res.end(body); return;
      }
      if (req.method === "POST" && suffix === ":validate") { res.end(JSON.stringify({ id: editMatch[1] })); return; }
      if (req.method === "POST" && suffix === ":commit") { res.end(JSON.stringify({ id: editMatch[1], expiryTimeSeconds: "0" })); return; }
    }
    res.writeHead(404).end(JSON.stringify({ error: { message: "not found" } }));
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  return { requests, tracks, url: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

test("manifest declares bounded credentials, API hosts, and no host writes", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, "armory.package.json"), "utf8"));
  assert.equal(manifest.id, "google-play");
  assert.deepEqual(manifest.permissions.networkHosts, ["androidpublisher.googleapis.com", "oauth2.googleapis.com"]);
  assert.deepEqual(manifest.permissions.hostPaths, []);
  assert.deepEqual(manifest.configuration.managedPaths, ["config/google-play.json"]);
  assert.equal(manifest.configuration.fields[0].type, "file");
});

test("configures, verifies, inspects, and safely commits release changes without leaking secrets", async () => {
  const fake = await startGoogleApi();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-google-play-"));
  const packageInfo = { id: "google-play", version: "0.1.0", dir: packageDir, home };
  const platform = { os: process.platform === "darwin" ? "darwin" : "linux", arch: process.arch === "arm64" ? "arm64" : "x64" };
  const env = { NODE_ENV: "test", GOOGLE_PLAY_TEST_TOKEN_URL: `${fake.url}/token`, GOOGLE_PLAY_TEST_API_URL: `${fake.url}/androidpublisher/v3` };
  try {
    const configured = await runHook("configure", {
      protocolVersion: 1, type: "input", operation: "configure", package: packageInfo, platform,
      configuration: { serviceAccountFile: credentials, packageName: defaultPackage },
    }, env);
    assert.equal(configured.code, 0, configured.stderr);
    assert.equal(configured.stdout.includes(privateKeySecret), false);
    assert.equal(JSON.parse(configured.stdout).ok, true);
    const stored = await fs.stat(path.join(home, "config", "google-play.json"));
    assert.equal(stored.mode & 0o777, 0o600);

    const verified = await runHook("verify", { protocolVersion: 1, type: "input", operation: "verify", package: packageInfo, platform }, env);
    assert.equal(verified.code, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).ok, true);

    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(packageDir, "dist", "mcp.js")], env: { ...process.env, ...env, PEON_ARMORY_HOME: home } });
    const client = new Client({ name: "google-play-package-test", version: "0.1.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), ["list_releases", "list_tracks", "promote_release", "update_rollout"]);
      await client.callTool({ name: "list_releases", arguments: {} });
      await client.callTool({ name: "list_tracks", arguments: {} });
      await client.callTool({ name: "promote_release", arguments: { targetTrack: "beta", versionCodes: ["100"], name: "1.0 beta", status: "draft", confirmation: "CONFIRM_RELEASE_CHANGE" } });
      await client.callTool({ name: "update_rollout", arguments: { track: "production", versionCode: "100", status: "completed", confirmation: "CONFIRM_RELEASE_CHANGE" } });
    } finally { await client.close(); }

    assert.equal(fake.tracks.beta.releases[0].status, "draft");
    assert.equal(fake.tracks.production.releases[0].status, "completed");
    assert.equal("userFraction" in fake.tracks.production.releases[0], false);
    assert(fake.requests.some((request) => request.method === "DELETE"));
    assert.equal(fake.requests.filter((request) => request.url?.endsWith(":validate")).length, 2);
    assert.equal(fake.requests.filter((request) => request.url?.endsWith(":commit")).length, 2);
    const serialized = JSON.stringify(fake.requests);
    assert.equal(serialized.includes(privateKeySecret), false);
    assert.equal(serialized.includes(accessToken), true);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fake.close();
  }
});
