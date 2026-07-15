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
const apiKey = "gemini_test_key_that_must_not_leak";
const imageData = Buffer.from("fake generated image").toString("base64");

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

async function startGeminiApi() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      method: req.method,
      url: req.url,
      apiKey: req.headers["x-goog-api-key"],
      body,
    });
    res.setHeader("content-type", "application/json");
    if (req.headers["x-goog-api-key"] !== apiKey) {
      res.writeHead(401).end(JSON.stringify({ error: { message: "unauthorized" } }));
      return;
    }
    if (req.method === "GET" && req.url === "/models/imagen-4.0-generate-001") {
      res.end(JSON.stringify({ name: "models/imagen-4.0-generate-001" }));
      return;
    }
    if (req.method === "POST" && req.url?.endsWith(":predict")) {
      const sampleCount = JSON.parse(body).parameters.sampleCount;
      res.end(JSON.stringify({
        predictions: Array.from({ length: sampleCount }, () => ({ bytesBase64Encoded: imageData, mimeType: "image/png" })),
      }));
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

test("manifest declares one protected Gemini credential and only the Gemini API host", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, "armory.package.json"), "utf8"));
  assert.deepEqual(manifest.configuration.fields, [{
    id: "apiKey",
    label: "Gemini API key",
    help: "Create an API key in Google AI Studio and paste it here. The key is stored in Peon's protected Armory home and is never included in tool arguments or output.",
    type: "secret",
    required: true,
    validation: { maxLength: 4096 },
  }]);
  assert.deepEqual(manifest.permissions.networkHosts, ["generativelanguage.googleapis.com"]);
  assert.equal(manifest.mcp.toolPrefix, "image_generator");
});

test("configures, verifies, and generates images without leaking the API key", async () => {
  const fake = await startGeminiApi();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-image-generator-"));
  const packageInfo = { id: "image-generator", version: "0.1.0", dir: packageDir, home };
  const platform = { os: process.platform === "darwin" ? "darwin" : "linux", arch: process.arch === "arm64" ? "arm64" : "x64" };
  const env = { NODE_ENV: "test", IMAGE_GENERATOR_TEST_API_URL: fake.url };

  try {
    const configured = await runHook("configure", {
      protocolVersion: 1,
      type: "input",
      operation: "configure",
      package: packageInfo,
      platform,
      configuration: { apiKey },
    }, env);
    assert.equal(configured.code, 0, configured.stderr);
    assert.equal(configured.stdout.includes(apiKey), false);
    assert.deepEqual(JSON.parse(configured.stdout), {
      protocolVersion: 1,
      type: "result",
      ok: true,
      message: "Gemini API key is configured",
      ownedPaths: ["config/image-generator.json"],
    });
    const stored = await fs.stat(path.join(home, "config", "image-generator.json"));
    assert.equal(stored.mode & 0o777, 0o600);

    const verified = await runHook("verify", {
      protocolVersion: 1,
      type: "input",
      operation: "verify",
      package: packageInfo,
      platform,
    }, env);
    assert.equal(verified.code, 0, verified.stderr);
    assert.equal(verified.stdout.includes(apiKey), false);
    assert.deepEqual(JSON.parse(verified.stdout), {
      protocolVersion: 1,
      type: "result",
      ok: true,
      message: "Gemini Imagen connection verified",
    });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(packageDir, "dist", "mcp.js")],
      env: { ...process.env, ...env, PEON_ARMORY_HOME: home },
    });
    const client = new Client({ name: "image-generator-package-test", version: "0.1.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), ["gemini_imagen"]);

      const defaults = await client.callTool({ name: "gemini_imagen", arguments: { prompt: "A quiet mountain lake" } });
      assert.equal(defaults.isError, undefined);
      assert.equal(defaults.content[0].type, "image");
      assert.equal(defaults.content[0].data, imageData);

      const customized = await client.callTool({
        name: "gemini_imagen",
        arguments: {
          prompt: "A product photograph",
          model: "imagen-4.0-ultra-generate-001",
          aspectRatio: "16:9",
          imageSize: "2K",
          personGeneration: "dont_allow",
          numberOfImages: 2,
        },
      });
      assert.equal(customized.isError, undefined);
      assert.equal(customized.content.filter((item) => item.type === "image").length, 2);
    } finally {
      await client.close();
    }

    assert.equal(fake.requests.length, 3);
    assert(fake.requests.every((request) => request.apiKey === apiKey));
    const generations = fake.requests.filter((request) => request.url?.endsWith(":predict")).map((request) => ({ url: request.url, body: JSON.parse(request.body) }));
    assert.deepEqual(generations[0], {
      url: "/models/imagen-4.0-generate-001:predict",
      body: {
        instances: [{ prompt: "A quiet mountain lake" }],
        parameters: { sampleCount: 1, aspectRatio: "1:1", personGeneration: "allow_adult", imageSize: "1K" },
      },
    });
    assert.deepEqual(generations[1], {
      url: "/models/imagen-4.0-ultra-generate-001:predict",
      body: {
        instances: [{ prompt: "A product photograph" }],
        parameters: { sampleCount: 2, aspectRatio: "16:9", personGeneration: "dont_allow", imageSize: "2K" },
      },
    });
    assert.equal(JSON.stringify(generations).includes(apiKey), false);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fake.close();
  }
});

test("rejects incompatible model settings before making a billable request", async () => {
  const fake = await startGeminiApi();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-image-generator-invalid-"));
  await fs.mkdir(path.join(home, "config"), { recursive: true });
  await fs.writeFile(path.join(home, "config", "image-generator.json"), JSON.stringify({ apiKey }), { mode: 0o600 });
  const env = { ...process.env, NODE_ENV: "test", IMAGE_GENERATOR_TEST_API_URL: fake.url, PEON_ARMORY_HOME: home };
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(packageDir, "dist", "mcp.js")], env });
  const client = new Client({ name: "image-generator-validation-test", version: "0.1.0" });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "gemini_imagen",
      arguments: { prompt: "test", model: "imagen-4.0-fast-generate-001", imageSize: "2K" },
    });
    assert.equal(result.isError, true);
    assert.equal(fake.requests.length, 0);
  } finally {
    await client.close();
    await fs.rm(home, { recursive: true, force: true });
    await fake.close();
  }
});
