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
const accessToken = "gtm_test_access_token_that_must_not_leak";
const clientSecret = "gtm_client_secret_that_must_not_leak";
const refreshToken = "gtm_refresh_token_that_must_not_leak";
const accountId = "1001";
const containerId = "2002";
const workspaceId = "3";

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
    if (req.headers.authorization !== `Bearer ${accessToken}`) {
      res.writeHead(401).end(JSON.stringify({ error: { message: "unauthorized" } }));
      return;
    }

    const workspaceBase = `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`;
    if (req.method === "GET" && req.url === `/accounts/${accountId}`) {
      res.end(JSON.stringify({ path: `accounts/${accountId}`, accountId, name: "Example" }));
      return;
    }
    if (req.method === "GET" && req.url === `/accounts/${accountId}/containers/${containerId}`) {
      res.end(JSON.stringify({ path: `accounts/${accountId}/containers/${containerId}`, containerId, publicId: "GTM-TEST" }));
      return;
    }
    if (req.method === "GET" && req.url === workspaceBase) {
      res.end(JSON.stringify({ path: workspaceBase.slice(1), workspaceId, name: "Default Workspace" }));
      return;
    }
    if (req.method === "GET" && (req.url === "/accounts" || req.url === "/accounts?includeGoogleTags=false")) {
      res.end(JSON.stringify({ account: [{ accountId, name: "Example" }] }));
      return;
    }
    if (req.method === "GET" && req.url === `/accounts/${accountId}/containers`) {
      res.end(JSON.stringify({ container: [{ containerId, publicId: "GTM-TEST" }] }));
      return;
    }
    if (req.method === "GET" && req.url === `/accounts/${accountId}/containers/${containerId}/workspaces`) {
      res.end(JSON.stringify({ workspace: [{ workspaceId, name: "Default Workspace" }] }));
      return;
    }
    if (req.method === "GET" && req.url === `${workspaceBase}/status`) {
      res.end(JSON.stringify({ workspaceChange: [], mergeConflict: [] }));
      return;
    }
    if (req.method === "GET" && req.url === `${workspaceBase}/tags`) {
      res.end(JSON.stringify({ tag: [{ tagId: "7", name: "Analytics" }] }));
      return;
    }
    if (req.method === "GET" && req.url === `/accounts/${accountId}/containers/${containerId}/version_headers?includeDeleted=false`) {
      res.end(JSON.stringify({ containerVersionHeader: [{ containerVersionId: "9" }] }));
      return;
    }
    if (req.method === "POST" && req.url === `${workspaceBase}:create_version`) {
      res.end(JSON.stringify({ containerVersion: { containerVersionId: "10", ...JSON.parse(body) } }));
      return;
    }
    if (req.method === "POST" && req.url === `/accounts/${accountId}/containers/${containerId}/versions/10:publish`) {
      res.end(JSON.stringify({ containerVersion: { containerVersionId: "10" } }));
      return;
    }
    if (req.method === "PUT" && req.url === `${workspaceBase}/tags/7`) {
      res.end(JSON.stringify({ tagId: "7", ...JSON.parse(body) }));
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

test("manifest declares GTM endpoints, secret credentials, and no host writes", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, "armory.package.json"), "utf8"));
  assert.equal(manifest.id, "google-tag-manager");
  assert.deepEqual(manifest.permissions.networkHosts, ["oauth2.googleapis.com", "tagmanager.googleapis.com"]);
  assert.deepEqual(manifest.permissions.hostPaths, []);
  const fields = Object.fromEntries(manifest.configuration.fields.map((field) => [field.id, field]));
  assert.equal(fields.credentialJson.type, "secret");
  assert.equal(fields.credentialJson.required, true);
  assert.match(fields.credentialJson.help, /Tag Manager API/);
  assert.match(fields.credentialJson.help, /User Management/);
  assert.match(fields.defaultContainerId.help, /not the public GTM-XXXX ID/);
});

test("configures, verifies, reads, versions, publishes, and guards generic mutations without leaking secrets", async () => {
  const fake = await startGoogleApi();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-google-tag-manager-"));
  const packageInfo = { id: "google-tag-manager", version: "0.1.0", dir: packageDir, home };
  const platform = { os: process.platform === "darwin" ? "darwin" : "linux", arch: process.arch === "arm64" ? "arm64" : "x64" };
  const env = {
    NODE_ENV: "test",
    GOOGLE_TAG_MANAGER_TEST_API_URL: fake.url,
    GOOGLE_TAG_MANAGER_TEST_ACCESS_TOKEN: accessToken,
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
        defaultAccountId: accountId,
        defaultContainerId: containerId,
        defaultWorkspaceId: workspaceId,
      },
    }, env);
    assert.equal(configured.code, 0, configured.stderr);
    assert.equal(configured.stderr, "");
    assert.equal(configured.stdout.includes(clientSecret), false);
    assert.equal(configured.stdout.includes(refreshToken), false);
    assert.equal(JSON.parse(configured.stdout).ok, true);

    const storedPath = path.join(home, "config", "google-tag-manager.json");
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
    assert.equal(JSON.parse(verified.stdout).ok, true);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(packageDir, "dist", "mcp.js")],
      env: { ...process.env, ...env, PEON_ARMORY_HOME: home },
      stderr: "pipe",
    });
    const client = new Client({ name: "google-tag-manager-package-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), [
        "list_accounts",
        "list_containers",
        "list_workspaces",
        "get_workspace_status",
        "list_workspace_entities",
        "list_container_versions",
        "create_container_version",
        "publish_container_version",
        "tag_manager_api_request",
      ]);

      assert.match((await client.callTool({ name: "list_accounts", arguments: {} })).content[0].text, /Example/);
      await client.callTool({ name: "list_containers", arguments: {} });
      await client.callTool({ name: "list_workspaces", arguments: {} });
      await client.callTool({ name: "get_workspace_status", arguments: {} });
      assert.match((await client.callTool({ name: "list_workspace_entities", arguments: { entity: "tags" } })).content[0].text, /Analytics/);
      await client.callTool({ name: "list_container_versions", arguments: {} });
      await client.callTool({ name: "create_container_version", arguments: { name: "Release 10", notes: "Test", confirm: true } });
      await client.callTool({ name: "publish_container_version", arguments: { versionId: "10", confirm: true } });

      const denied = await client.callTool({ name: "tag_manager_api_request", arguments: {
        method: "PUT",
        path: `${workspaceBaseForTest()}/tags/7`,
        body: { name: "Updated Analytics" },
      } });
      assert.equal(denied.isError, true);
      await client.callTool({ name: "tag_manager_api_request", arguments: {
        method: "PUT",
        path: `${workspaceBaseForTest()}/tags/7`,
        body: { name: "Updated Analytics" },
        confirm: true,
      } });

      const unsafe = await client.callTool({ name: "tag_manager_api_request", arguments: {
        method: "GET",
        path: "/accounts/../token",
      } });
      assert.equal(unsafe.isError, true);
    } finally {
      await client.close();
    }

    assert(fake.requests.every((request) => request.authorization === `Bearer ${accessToken}`));
    const serializedRequests = JSON.stringify(fake.requests);
    assert.equal(serializedRequests.includes(clientSecret), false);
    assert.equal(serializedRequests.includes(refreshToken), false);
    assert(fake.requests.some((request) => request.url?.endsWith(":create_version")));
    assert(fake.requests.some((request) => request.url?.endsWith(":publish")));
    assert.equal(fake.requests.filter((request) => request.method === "PUT").length, 1);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fake.close();
  }
});

function workspaceBaseForTest() {
  return `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`;
}
