import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("echo tool is discoverable and returns its input", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(packageDir, "dist", "mcp.js")] });
  const client = new Client({ name: "fixture-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), ["echo"]);
    const result = await client.callTool({ name: "echo", arguments: { message: "hello armory" } });
    assert.deepEqual(result.content, [{ type: "text", text: "hello armory" }]);
  } finally {
    await client.close();
  }
});
