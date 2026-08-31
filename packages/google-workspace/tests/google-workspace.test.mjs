import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
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
const accessToken = "workspace_test_access_token_that_must_not_leak";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const privateKeySecret = privateKeyPem.split("\n")[1];
const credentials = JSON.stringify({ type: "service_account", client_email: "play@example.iam.gserviceaccount.com",
  private_key: privateKeyPem, private_key_id: "key-id", project_id: "example" });
const id = "abcdefghij1234567890";

async function runHook(name, input, env) {
  const child = spawn(process.execPath, [path.join(packageDir, "dist", "hooks", `${name}.js`)], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = ""; child.stdout.setEncoding("utf8").on("data", (part) => { stdout += part; }); child.stderr.setEncoding("utf8").on("data", (part) => { stderr += part; });
  child.stdin.end(`${JSON.stringify(input)}\n`); const code = await new Promise((resolve) => child.once("close", resolve)); return { code, stdout, stderr };
}

async function startApi() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk; requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/token") {
      const assertion = new URLSearchParams(body).get("assertion"); assert(assertion); const claims = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url"));
      assert.equal(claims.iss, "play@example.iam.gserviceaccount.com");
      assert.deepEqual(claims.scope.split(" "), ["https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/presentations", "https://www.googleapis.com/auth/spreadsheets"]);
      res.end(JSON.stringify({ access_token: accessToken, expires_in: 3600 })); return;
    }
    if (req.headers.authorization !== `Bearer ${accessToken}`) { res.writeHead(401).end(JSON.stringify({ error: { message: "unauthorized" } })); return; }
    if (req.method === "GET" && req.url.startsWith("/drive/files?")) {
      const q = new URL(req.url, "http://localhost").searchParams.get("q");
      if (q !== null) assert.match(q, /mimeType = 'application\/vnd\.google-apps\.document' or mimeType =/);
      res.end(JSON.stringify({ files: [{ id, name: "Plan" }] })); return;
    }
    if (req.method === "GET" && req.url.startsWith(`/docs/documents/${id}`)) { res.end(JSON.stringify({ documentId: id, title: "Plan" })); return; }
    if (req.method === "POST" && req.url === `/docs/documents/${id}:batchUpdate`) { res.end(JSON.stringify({ documentId: id, replies: [] })); return; }
    if (req.method === "GET" && req.url.startsWith(`/sheets/spreadsheets/${id}/values/`)) { res.end(JSON.stringify({ range: "Sheet1!A1", values: [["A"]] })); return; }
    if (req.method === "GET" && req.url.startsWith(`/sheets/spreadsheets/${id}?`)) { res.end(JSON.stringify({ spreadsheetId: id })); return; }
    if (["PUT", "POST"].includes(req.method) && req.url.startsWith(`/sheets/spreadsheets/${id}/values/`)) { res.end(JSON.stringify({ updatedRows: 1 })); return; }
    if (req.method === "POST" && req.url === `/sheets/spreadsheets/${id}:batchUpdate`) { res.end(JSON.stringify({ spreadsheetId: id, replies: [] })); return; }
    if (req.method === "GET" && req.url === `/slides/presentations/${id}`) { res.end(JSON.stringify({ presentationId: id })); return; }
    if (req.method === "POST" && req.url === `/slides/presentations/${id}:batchUpdate`) { res.end(JSON.stringify({ presentationId: id, replies: [] })); return; }
    res.writeHead(404).end(JSON.stringify({ error: { message: "not found" } }));
  });
  server.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve)); const address = server.address();
  return { requests, url: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

test("configures the reusable service account and edits Docs, Sheets, and Slides", async () => {
  const fake = await startApi(); const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-google-workspace-"));
  const packageInfo = { id: "google-workspace", version: "0.1.0", dir: packageDir, home };
  const platform = { os: process.platform === "darwin" ? "darwin" : "linux", arch: process.arch === "arm64" ? "arm64" : "x64" };
  const env = { NODE_ENV: "test", GOOGLE_WORKSPACE_TEST_TOKEN_URL: `${fake.url}/token`, GOOGLE_WORKSPACE_TEST_DRIVE_URL: `${fake.url}/drive`,
    GOOGLE_WORKSPACE_TEST_DOCS_URL: `${fake.url}/docs`, GOOGLE_WORKSPACE_TEST_SHEETS_URL: `${fake.url}/sheets`, GOOGLE_WORKSPACE_TEST_SLIDES_URL: `${fake.url}/slides` };
  try {
    const configured = await runHook("configure", { protocolVersion: 1, type: "input", operation: "configure", package: packageInfo, platform,
      configuration: { serviceAccountJson: credentials } }, env);
    assert.equal(configured.code, 0, configured.stderr); assert.equal(configured.stdout.includes(privateKeySecret), false);
    assert.equal((await fs.stat(path.join(home, "config", "google-workspace.json"))).mode & 0o777, 0o600);
    const verified = await runHook("verify", { protocolVersion: 1, type: "input", operation: "verify", package: packageInfo, platform }, env);
    assert.equal(verified.code, 0, verified.stderr);
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(packageDir, "dist", "mcp.js")], env: { ...process.env, ...env, PEON_ARMORY_HOME: home } });
    const client = new Client({ name: "test", version: "1" }); await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      assert.deepEqual(names, ["search_files", "get_document", "batch_update_document", "get_spreadsheet", "get_sheet_values", "update_sheet_values",
        "append_sheet_values", "batch_update_spreadsheet", "get_presentation", "batch_update_presentation"]);
      const calls = [
        ["search_files", { search: "Plan" }], ["get_document", { documentId: id }],
        ["batch_update_document", { documentId: id, requests: [{ replaceAllText: { containsText: { text: "old", matchCase: true }, replaceText: "new" } }], confirmation: "CONFIRM_WORKSPACE_EDIT" }],
        ["get_spreadsheet", { spreadsheetId: id }], ["get_sheet_values", { spreadsheetId: id, range: "Sheet1!A1" }],
        ["update_sheet_values", { spreadsheetId: id, range: "Sheet1!A1", values: [["A"]], confirmation: "CONFIRM_WORKSPACE_EDIT" }],
        ["append_sheet_values", { spreadsheetId: id, range: "Sheet1!A:A", values: [["B"]], confirmation: "CONFIRM_WORKSPACE_EDIT" }],
        ["batch_update_spreadsheet", { spreadsheetId: id, requests: [{ addSheet: { properties: { title: "New" } } }], confirmation: "CONFIRM_WORKSPACE_EDIT" }],
        ["get_presentation", { presentationId: id }],
        ["batch_update_presentation", { presentationId: id, requests: [{ replaceAllText: { containsText: { text: "old" }, replaceText: "new" } }], confirmation: "CONFIRM_WORKSPACE_EDIT" }],
      ];
      for (const [name, args] of calls) assert.notEqual((await client.callTool({ name, arguments: args })).isError, true, name);
    } finally { await client.close(); }
    assert.equal(JSON.stringify(fake.requests).includes(privateKeySecret), false); assert.equal(JSON.stringify(fake.requests).includes(accessToken), true);
  } finally { await fs.rm(home, { recursive: true, force: true }); await fake.close(); }
});

test("manifest documents same-key reuse and requests no host filesystem access", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, "armory.package.json"), "utf8"));
  assert.deepEqual(manifest.permissions.hostPaths, []); assert.match(manifest.configuration.fields[0].help, /same JSON key used for Google Play/);
});
