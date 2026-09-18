import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secret = "scout_test_secret";
async function run(file, input, env) {
  const child = spawn(process.execPath, [path.join(dir, "dist", file)], { env: { ...process.env, ...env }, stdio: ["pipe","pipe","pipe"] });
  let stdout = ""; let stderr = ""; child.stdout.setEncoding("utf8").on("data", c => stdout += c); child.stderr.setEncoding("utf8").on("data", c => stderr += c);
  child.stdin.end(`${JSON.stringify(input)}\n`); const code = await new Promise(resolve => child.once("close", resolve)); return { code, stdout, stderr };
}

test("workflow preserves claim idempotency key and lease headers", async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, auth: req.headers.authorization, key: req.headers["idempotency-key"], lease: req.headers["x-workflow-lease"], body });
    res.setHeader("content-type", "application/json");
    if (req.url === "/mcp.json") return res.end(JSON.stringify({ instructions: "Use Scout." }));
    if (req.url.endsWith("/claims")) return res.end(JSON.stringify({ execution: { id: 7, lease_token: "lease-7" }, work: { opportunity: { ref: "D-7" } } }));
    return res.end(JSON.stringify({ state: "active" }));
  });
  server.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const address = server.address(); const url = `http://127.0.0.1:${address.port}`;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "scout-test-"));
  await fs.mkdir(path.join(home, "config")); await fs.writeFile(path.join(home, "config", "scout.json"), JSON.stringify({ apiKey: secret }));
  try {
    const env = { NODE_ENV: "test", SCOUT_TEST_URL: url, PEON_ARMORY_HOME: home };
    const claim = await run("workflow.js", { operation: "claim", consumer: "peon", requestId: "request-1" }, env);
    assert.equal(claim.code, 0, claim.stderr); assert.equal(JSON.parse(claim.stdout).mcp.instructions, "Use Scout.");
    const heartbeat = await run("workflow.js", { operation: "heartbeat", executionId: "7", leaseToken: "lease-7", sessionId: "s", runId: "r", state: "running" }, env);
    assert.equal(heartbeat.code, 0, heartbeat.stderr);
    assert.equal(requests[0].key, "request-1"); assert.equal(requests[0].auth, `Bearer ${secret}`);
    assert.equal(requests.at(-1).lease, "lease-7");
    assert.equal(requests.some(request => JSON.stringify(request).includes(secret)), true);
  } finally { await fs.rm(home, { recursive: true, force: true }); await new Promise(resolve => server.close(resolve)); }
});

test("manifest declares Scout profile, MCP proxy and workflow command", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(dir, "armory.package.json"), "utf8"));
  assert.equal(manifest.profile.type, "scout-api-key");
  assert.equal(manifest.mcp.toolPrefix, "scout");
  assert.equal(manifest.background.protocol, "armory-workflows-v1");
});
