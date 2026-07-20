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
const accountApiToken = "cfat_cloudflare_account_test_token_that_must_not_leak";
const accountId = "0123456789abcdef0123456789abcdef";
const zoneId = "fedcba9876543210fedcba9876543210";
const tunnelId = "11111111-2222-4333-8444-555555555555";
const turnstileSitekey = "0x4AAAAAAAAAAAAAAAAAAAAAAA";
const pagesProjectName = "turnstile-app";
const pagesSecret = "pages_turnstile_secret_that_must_not_leak";
const pagesUploadJwt = "pages_upload_jwt_that_must_not_leak";
const compiledFunctionsWorker = "export default { fetch() { return new Response('compiled-functions-marker'); } };";

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
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      contentType: req.headers["content-type"],
      body,
    });
    res.setHeader("content-type", "application/json");
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (token !== apiToken && token !== accountApiToken && token !== pagesUploadJwt) {
      res.writeHead(401).end(JSON.stringify({ success: false, errors: [{ message: "unauthorized" }] }));
      return;
    }
    if (req.url === "/user/tokens/verify") {
      res.end(JSON.stringify({ success: true, result: { status: "active" } }));
      return;
    }
    if (req.url === `/accounts/${accountId}/tokens/verify`) {
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
    if (req.url === `/accounts/${accountId}/challenges/widgets?page=1&per_page=5`) {
      res.end(JSON.stringify({ success: true, result: [] }));
      return;
    }
    if (req.url === `/accounts/${accountId}/pages/projects?page=1&per_page=1`) {
      res.end(JSON.stringify({ success: true, result: [] }));
      return;
    }
    if (req.method === "GET" && req.url === `/accounts/${accountId}/pages/projects/${pagesProjectName}/upload-token`) {
      res.end(JSON.stringify({ success: true, result: { jwt: pagesUploadJwt } }));
      return;
    }
    if (req.method === "POST" && req.url === "/pages/assets/check-missing") {
      res.end(JSON.stringify({ success: true, result: JSON.parse(body).hashes }));
      return;
    }
    if (req.method === "POST" && (req.url === "/pages/assets/upload" || req.url === "/pages/assets/upsert-hashes")) {
      res.end(JSON.stringify({ success: true, result: null }));
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
    if (req.method === "GET" && req.url?.startsWith(`/accounts/${accountId}/challenges/widgets?`)) {
      res.end(JSON.stringify({
        success: true,
        result: [{ sitekey: turnstileSitekey, name: "login", domains: ["example.com"], mode: "managed" }],
        result_info: { page: 1, per_page: 50, total_count: 1 },
      }));
      return;
    }
    if (req.method === "GET" && req.url === `/accounts/${accountId}/challenges/widgets/${turnstileSitekey}`) {
      res.end(JSON.stringify({ success: true, result: { sitekey: turnstileSitekey, secret: "turnstile-secret", name: "login" } }));
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
    if (req.method === "POST" && req.url === `/accounts/${accountId}/challenges/widgets`) {
      res.end(JSON.stringify({ success: true, result: { sitekey: turnstileSitekey, secret: "turnstile-secret", ...JSON.parse(body) } }));
      return;
    }
    if (req.method === "PUT" && req.url === `/accounts/${accountId}/challenges/widgets/${turnstileSitekey}`) {
      res.end(JSON.stringify({ success: true, result: { sitekey: turnstileSitekey, ...JSON.parse(body) } }));
      return;
    }
    if (req.method === "POST" && req.url === `/accounts/${accountId}/challenges/widgets/${turnstileSitekey}/rotate_secret`) {
      res.end(JSON.stringify({ success: true, result: { sitekey: turnstileSitekey, secret: "rotated-turnstile-secret" } }));
      return;
    }
    if (req.method === "DELETE" && req.url === `/accounts/${accountId}/challenges/widgets/${turnstileSitekey}`) {
      res.end(JSON.stringify({ success: true, result: { sitekey: turnstileSitekey } }));
      return;
    }
    if (req.method === "PATCH" && req.url === `/accounts/${accountId}/pages/projects/${pagesProjectName}`) {
      res.end(JSON.stringify({ success: true, result: {
        name: pagesProjectName,
        deployment_configs: JSON.parse(body).deployment_configs,
      } }));
      return;
    }
    if (req.method === "POST" && req.url === `/accounts/${accountId}/pages/projects/${pagesProjectName}/deployments`) {
      res.end(JSON.stringify({ success: true, result: {
        id: "pages-deployment-1",
        project_name: pagesProjectName,
        environment: "production",
        url: `https://${pagesProjectName}.pages.dev`,
        aliases: [`https://${pagesProjectName}.pages.dev`],
        env_vars: { TURNSTILE_SECRET: { type: "secret_text", value: pagesSecret } },
        latest_stage: { name: "queued", status: "active" },
      } }));
      return;
    }
    if (req.method === "GET" && req.url === `/accounts/${accountId}/pages/projects/${pagesProjectName}/deployments/pages-deployment-1`) {
      res.end(JSON.stringify({ success: true, result: {
        id: "pages-deployment-1",
        short_id: "pages-de",
        project_name: pagesProjectName,
        environment: "production",
        url: `https://${pagesProjectName}.pages.dev`,
        aliases: [`https://${pagesProjectName}.pages.dev`],
        env_vars: { TURNSTILE_SECRET: { type: "secret_text", value: pagesSecret } },
        latest_stage: { name: "deploy", status: "failure", started_on: "2026-07-20T10:00:00Z", ended_on: "2026-07-20T10:01:00Z" },
        stages: [{ name: "deploy", status: "failure", started_on: "2026-07-20T10:00:00Z", ended_on: "2026-07-20T10:01:00Z" }],
        uses_functions: true,
      } }));
      return;
    }
    if (req.method === "GET" && req.url === `/accounts/${accountId}/pages/projects/${pagesProjectName}/deployments/pages-deployment-1/history/logs?size=100`) {
      res.end(JSON.stringify({ success: true, result: {
        data: [
          { line: "Building Pages Functions", ts: "2026-07-20T10:00:30Z" },
          { line: `Error: Functions startup failed; TURNSTILE_SECRET=${pagesSecret}`, ts: "2026-07-20T10:01:00Z" },
        ],
        total: 2,
        includes_container_logs: false,
      } }));
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
  assert.deepEqual(manifest.permissions.networkHosts, ["api.cloudflare.com"]);
  assert.deepEqual(manifest.permissions.hostPaths, [{
    path: "~/Projects",
    mode: "read",
    purpose: "Read an operator-selected Pages build artifact, Pages Functions, and the project's local Wrangler compiler for direct upload.",
  }]);
  assert.deepEqual(manifest.configuration.fields.map(({ id, type, required }) => ({ id, type, required })), [
    { id: "apiToken", type: "secret", required: true },
    { id: "accountId", type: "text", required: true },
  ]);
  assert.match(manifest.configuration.fields[0].help, /My Profile > API Tokens/);
  assert.match(manifest.configuration.fields[0].help, /Manage Account > Account API Tokens/);
  assert.match(manifest.configuration.fields[0].help, /Zone DNS Edit/);
  assert.match(manifest.configuration.fields[0].help, /Cloudflare Tunnel Write/);
  assert.match(manifest.configuration.fields[0].help, /Turnstile Sites Write/);
  assert.match(manifest.configuration.fields[0].help, /Pages Write/);
  assert.match(manifest.configuration.fields[1].help, /Account home/);
  assert.match(manifest.configuration.fields[1].help, /Copy account ID/);
});

test("verifies account-owned API tokens with the account-scoped endpoint", async () => {
  const fake = await startCloudflare();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-cloudflare-account-token-"));
  const packageInfo = { id: "cloudflare", version: "0.5.1", dir: packageDir, home };
  const platform = { os: process.platform === "darwin" ? "darwin" : "linux", arch: process.arch === "arm64" ? "arm64" : "x64" };
  const env = { NODE_ENV: "test", CLOUDFLARE_TEST_API_URL: fake.url };

  try {
    const configured = await runHook("configure", {
      protocolVersion: 1,
      type: "input",
      operation: "configure",
      package: packageInfo,
      platform,
      configuration: { apiToken: accountApiToken, accountId },
    }, env);
    assert.equal(configured.code, 0, configured.stderr);

    const verified = await runHook("verify", {
      protocolVersion: 1,
      type: "input",
      operation: "verify",
      package: packageInfo,
      platform,
    }, env);
    assert.equal(verified.code, 0, verified.stderr);
    assert.equal(verified.stdout.includes(accountApiToken), false);
    assert(fake.requests.some((request) => request.url === `/accounts/${accountId}/tokens/verify`));
    assert.equal(fake.requests.some((request) => request.url === "/user/tokens/verify"), false);
  } finally {
    await fake.close();
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("configures, verifies, and manages DNS, tunnels, Turnstile, and Pages without leaking credentials", async () => {
  const fake = await startCloudflare();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-cloudflare-"));
  const packageInfo = { id: "cloudflare", version: "0.5.1", dir: packageDir, home };
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

    const projectRoot = path.join(home, "project");
    const artifactRoot = path.join(projectRoot, "dist");
    const functionsRoot = path.join(projectRoot, "functions");
    const wranglerBin = path.join(projectRoot, "node_modules", "wrangler", "bin");
    await fs.mkdir(artifactRoot, { recursive: true });
    await fs.mkdir(functionsRoot, { recursive: true });
    await fs.mkdir(wranglerBin, { recursive: true });
    await fs.writeFile(path.join(artifactRoot, "index.html"), "<!doctype html><h1>RNM</h1>");
    await fs.writeFile(path.join(functionsRoot, "api.js"), "export const onRequest = () => new Response('ok');");
    await fs.writeFile(path.join(wranglerBin, "wrangler.js"), `
      import fs from "node:fs/promises";
      import path from "node:path";
      const args = process.argv.slice(2);
      const value = (flag) => args[args.indexOf(flag) + 1];
      const outdir = value("--outdir");
      await fs.mkdir(outdir, { recursive: true });
      await fs.writeFile(path.join(outdir, "index.js"), ${JSON.stringify(compiledFunctionsWorker)});
      await fs.writeFile(path.join(process.cwd(), ".wrangler-test-args.json"), JSON.stringify(args));
      process.stdout.write("diagnostic worker.mjs payload that must not be uploaded");
      for (const [flag, contents] of [
        ["--output-routes-path", JSON.stringify({ version: 1, include: ["/*"], exclude: [] })],
        ["--output-config-path", JSON.stringify({ routes: [{ routePath: "/api" }] })],
      ]) {
        const filename = value(flag);
        await fs.mkdir(path.dirname(filename), { recursive: true });
        await fs.writeFile(filename, contents);
      }
    `);

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
        "list_turnstile_widgets", "get_turnstile_widget", "create_turnstile_widget", "update_turnstile_widget",
        "rotate_turnstile_widget_secret", "delete_turnstile_widget",
        "set_pages_secret", "deploy_pages_project",
        "direct_upload_pages_project", "get_pages_deployment_status",
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
      await client.callTool({ name: "list_turnstile_widgets", arguments: { filter: "name:login" } });
      await client.callTool({ name: "get_turnstile_widget", arguments: { sitekey: turnstileSitekey } });
      await client.callTool({ name: "create_turnstile_widget", arguments: {
        name: "login", domains: ["example.com"], mode: "managed", clearanceLevel: "managed",
      } });
      await client.callTool({ name: "update_turnstile_widget", arguments: {
        sitekey: turnstileSitekey, name: "login form", domains: ["example.com"], mode: "invisible",
        ephemeralId: true,
      } });
      await client.callTool({ name: "rotate_turnstile_widget_secret", arguments: {
        sitekey: turnstileSitekey, invalidateImmediately: false, confirm: true,
      } });
      await client.callTool({ name: "delete_turnstile_widget", arguments: { sitekey: turnstileSitekey, confirm: true } });
      const secretResult = await client.callTool({ name: "set_pages_secret", arguments: {
        projectName: pagesProjectName,
        environment: "production",
        secretName: "TURNSTILE_SECRET",
        secretValue: pagesSecret,
        confirm: true,
      } });
      assert.equal(JSON.stringify(secretResult).includes(pagesSecret), false);
      const deployResult = await client.callTool({ name: "deploy_pages_project", arguments: {
        projectName: pagesProjectName,
        branch: "main",
        commitHash: "0123456789abcdef",
        commitMessage: "Deploy Turnstile integration",
        confirm: true,
      } });
      assert.equal(JSON.stringify(deployResult).includes(pagesSecret), false);
      const deploymentStatusResult = await client.callTool({ name: "get_pages_deployment_status", arguments: {
        projectName: pagesProjectName,
        deploymentId: "pages-deployment-1",
      } });
      const deploymentStatus = JSON.parse(deploymentStatusResult.content[0].text);
      assert.equal(deploymentStatus.latestStage.status, "failure");
      assert.equal(deploymentStatus.failureDetailsAvailable, true);
      assert.match(deploymentStatus.failureMessage, /TURNSTILE_SECRET=\[REDACTED\]/);
      assert.equal(JSON.stringify(deploymentStatusResult).includes(pagesSecret), false);
      assert.equal(JSON.stringify(deploymentStatusResult).includes("env_vars"), false);
      const directUploadResult = await client.callTool({ name: "direct_upload_pages_project", arguments: {
        projectName: pagesProjectName,
        projectPath: projectRoot,
        artifactPath: "dist",
        functionsPath: "functions",
        commitMessage: "Deploy local RNM artifact",
        confirm: true,
      } });
      const directUpload = JSON.parse(directUploadResult.content[0].text);
      assert.equal(directUpload.functionsIncluded, true);
      assert.equal(directUpload.functionsWorkerBytes, Buffer.byteLength(compiledFunctionsWorker));
      assert.equal(directUpload.files, 1);
      assert.equal(JSON.stringify(directUploadResult).includes(pagesSecret), false);
    } finally {
      await client.close();
    }

    assert(fake.requests.length >= 7);
    assert(fake.requests.every((request) => [
      `Bearer ${apiToken}`,
      `Bearer ${pagesUploadJwt}`,
    ].includes(request.authorization)));
    assert.equal(JSON.stringify(fake.requests.map(({ method, url, body }) => ({ method, url, body }))).includes(apiToken), false);
    assert(fake.requests.some((request) => request.url === "/zones" && request.body.includes(accountId)));
    assert(fake.requests.some((request) => request.url?.includes("cfd_tunnel") && request.body.includes('"config_src":"cloudflare"')));
    assert(fake.requests.some((request) => request.url?.includes("challenges/widgets") && request.body.includes('"clearance_level":"managed"')));
    assert(fake.requests.some((request) => request.url?.endsWith("rotate_secret") && request.body === '{"invalidate_immediately":false}'));
    assert(fake.requests.some((request) => request.method === "PATCH"
      && request.url?.endsWith(`/pages/projects/${pagesProjectName}`)
      && request.body.includes(`\"TURNSTILE_SECRET\":{\"type\":\"secret_text\",\"value\":\"${pagesSecret}\"}`)));
    assert(fake.requests.some((request) => request.method === "POST"
      && request.url?.endsWith(`/pages/projects/${pagesProjectName}/deployments`)
      && request.contentType?.startsWith("multipart/form-data; boundary=")
      && request.body.includes('name="branch"')
      && request.body.includes("main")));
    assert(fake.requests.some((request) => request.url === "/pages/assets/upload"
      && request.authorization === `Bearer ${pagesUploadJwt}`
      && request.body.includes('"base64":true')));
    assert(fake.requests.some((request) => request.method === "POST"
      && request.url?.endsWith(`/pages/projects/${pagesProjectName}/deployments`)
      && request.body.includes('name="manifest"')
      && request.body.includes('name="_worker.bundle"; filename="_worker.bundle"')
      && request.body.includes('name="index.js"; filename="index.js"')
      && request.body.includes(compiledFunctionsWorker)
      && !request.body.includes('name="_worker.js"')
      && !request.body.includes("worker.mjs")));
    const wranglerArgs = JSON.parse(await fs.readFile(path.join(projectRoot, ".wrangler-test-args.json"), "utf8"));
    assert.deepEqual(wranglerArgs.slice(0, 4), ["pages", "functions", "build", await fs.realpath(functionsRoot)]);
    assert(wranglerArgs.includes("--outdir"));
    assert.equal(wranglerArgs.includes("--outfile"), false);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fake.close();
  }
});
