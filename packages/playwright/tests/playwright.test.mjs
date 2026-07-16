import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function startSite() {
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html><body>
      <h1>Armory test page</h1>
      <label>Name <input id="name"></label>
      <button id="submit" onclick="document.querySelector('#result').textContent = document.querySelector('#name').value">Submit</button>
      <p id="result">Waiting</p>
    </body></html>`);
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("manifest limits browser access to local testing", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, "armory.package.json"), "utf8"));
  assert.deepEqual(manifest.permissions.networkHosts, ["localhost", "127.0.0.1"]);
  assert(manifest.permissions.hostPaths.every(({ mode }) => mode === "read"));
  assert.deepEqual(manifest.dependencies, []);
  assert(manifest.permissions.hostPaths.some(({ path: browserPath }) => browserPath.includes("Google Chrome")));
  assert.equal(manifest.mcp.toolPrefix, "playwright");
});

test("navigates, inspects, interacts with, and captures a local page", async () => {
  const site = await startSite();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-playwright-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageDir, "dist", "mcp.js")],
    env: { ...process.env, PEON_ARMORY_HOME: home },
    stderr: "pipe",
  });
  const client = new Client({ name: "playwright-package-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name), [
      "navigate", "snapshot", "wait_for", "click", "fill", "text_content", "screenshot", "close",
    ]);

    const navigation = await client.callTool({ name: "navigate", arguments: { url: site.url } });
    assert.equal(JSON.parse(navigation.content[0].text).status, 200);

    const snapshot = await client.callTool({ name: "snapshot", arguments: {} });
    assert.match(snapshot.content[0].text, /Armory test page/);

    await client.callTool({ name: "fill", arguments: { selector: "#name", value: "Playwright works" } });
    await client.callTool({ name: "click", arguments: { selector: "#submit" } });
    await client.callTool({ name: "wait_for", arguments: { selector: "text=Playwright works" } });
    const text = await client.callTool({ name: "text_content", arguments: { selector: "#result" } });
    assert.equal(text.content[0].text, "Playwright works");

    const screenshot = await client.callTool({ name: "screenshot", arguments: { fullPage: true } });
    assert.equal(screenshot.content[0].type, "image");
    assert.equal(screenshot.content[0].mimeType, "image/png");
    assert(Buffer.from(screenshot.content[0].data, "base64").subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));

    const rejected = await client.callTool({ name: "navigate", arguments: { url: "https://example.com" } });
    assert.equal(rejected.isError, true);
    await client.callTool({ name: "close", arguments: {} });
  } finally {
    await client.close();
    await site.close();
    await fs.rm(home, { recursive: true, force: true });
  }
});
