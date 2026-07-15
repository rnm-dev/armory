import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import zlib from "node:zlib";
import { repoRoot } from "../scripts/schema-utils.mjs";

const archiveDir = path.join(repoRoot, "tests", "fixtures", "archives", "generated");
const processDir = path.join(repoRoot, "tests", "fixtures", "processes");

function readTarEntries(gzipBytes) {
  const bytes = zlib.gunzipSync(gzipBytes);
  const entries = [];
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const size = Number.parseInt(text(124, 12).trim() || "0", 8);
    entries.push({ name: text(0, 100), type: text(156, 1) || "0", linkname: text(157, 100), size });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

test("deterministic archive corpus contains every adversarial shape", async () => {
  const expected = [
    "valid.tar.gz",
    "traversal.tar.gz",
    "escaping-symlink.tar.gz",
    "escaping-hardlink.tar.gz",
    "duplicate-path.tar.gz",
    "expanded-size.tar.gz",
    "malformed-manifest.tar.gz",
    "mcp-crash.tar.gz",
    "mcp-timeout.tar.gz",
    "mcp-oversized-result.tar.gz",
    "hook-malformed.tar.gz",
    "hook-duplicate-results.tar.gz",
    "hook-timeout.tar.gz",
  ];
  for (const name of expected) assert.ok((await fs.stat(path.join(archiveDir, name))).size > 0, name);

  const traversal = readTarEntries(await fs.readFile(path.join(archiveDir, "traversal.tar.gz")));
  assert.ok(traversal.some((entry) => entry.name.includes("../")));
  const symlink = readTarEntries(await fs.readFile(path.join(archiveDir, "escaping-symlink.tar.gz")));
  assert.ok(symlink.some((entry) => entry.type === "2" && entry.linkname === "../../outside"));
  const hardlink = readTarEntries(await fs.readFile(path.join(archiveDir, "escaping-hardlink.tar.gz")));
  assert.ok(hardlink.some((entry) => entry.type === "1" && entry.linkname === "../../outside"));
  const duplicates = readTarEntries(await fs.readFile(path.join(archiveDir, "duplicate-path.tar.gz")));
  assert.ok(duplicates.some((entry) => entry.name.includes("/./")));

  const limits = JSON.parse(await fs.readFile(path.join(archiveDir, "limits.json"), "utf8"));
  assert.ok(limits.actualExpandedBytes > limits.maxExpandedBytes);
  const [declaredDigest] = (await fs.readFile(path.join(archiveDir, "digest-mismatch.sha256"), "utf8")).trim().split(/\s+/);
  const actualDigest = crypto.createHash("sha256").update(await fs.readFile(path.join(archiveDir, "valid.tar.gz"))).digest("hex");
  assert.notEqual(declaredDigest, actualDigest);
});

test("package fixture source has no network, real-home, or privilege behavior", async () => {
  const sourceFiles = [];
  const visit = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (/\.(?:ts|mjs|js)$/.test(entry.name)) sourceFiles.push(target);
    }
  };
  const packageEntries = await fs.readdir(path.join(repoRoot, "packages"), { withFileTypes: true });
  for (const entry of packageEntries) {
    if (entry.isDirectory() && entry.name.startsWith("fixture-")) {
      await visit(path.join(repoRoot, "packages", entry.name));
    }
  }
  for (const file of sourceFiles) {
    const source = await fs.readFile(file, "utf8");
    assert.doesNotMatch(source, /\b(?:fetch|https?\.request|net\.connect|dns\.resolve|os\.homedir|sudo)\b/, file);
  }
});

function runProcess(file, { input = "", env = {}, killAfterMs } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(processDir, file)], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.stdin.end(input);
    let timedOut = false;
    const timer = killAfterMs ? setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, killAfterMs) : null;
    child.once("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

test("process fixtures deterministically crash, hang, and exceed output limits", async () => {
  const crash = await runProcess("mcp-crash.mjs");
  assert.equal(crash.code, 17);
  const mcpTimeout = await runProcess("mcp-timeout.mjs", { killAfterMs: 100 });
  assert.equal(mcpTimeout.timedOut, true);
  const hookTimeout = await runProcess("hook-timeout.mjs", { input: "{}\n", killAfterMs: 100 });
  assert.equal(hookTimeout.timedOut, true);
  const oversized = await runProcess("mcp-oversized-result.mjs", { input: "{}\n", env: { FIXTURE_RESULT_BYTES: "4097" } });
  assert.equal(Buffer.byteLength(oversized.stdout), 4097);
  const malformed = await runProcess("hook-malformed.mjs", { input: "{}\n" });
  assert.throws(() => JSON.parse(malformed.stdout.trim()));
  const duplicate = await runProcess("hook-duplicate-results.mjs", { input: "{}\n" });
  assert.equal(duplicate.stdout.trim().split("\n").length, 2);
});

test("invalid hook transcript corpus covers terminal and redaction failures", async () => {
  const dir = path.join(repoRoot, "tests", "fixtures", "hooks", "invalid");
  const malformed = await fs.readFile(path.join(dir, "malformed-json.ndjson"), "utf8");
  assert.throws(() => JSON.parse(malformed));
  const duplicate = (await fs.readFile(path.join(dir, "duplicate-results.ndjson"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(duplicate.filter((message) => message.type === "result").length, 2);
  const eof = (await fs.readFile(path.join(dir, "eof-without-result.ndjson"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(eof.some((message) => message.type === "result"), false);
  const unsafe = await fs.readFile(path.join(dir, "echoed-secret.ndjson"), "utf8");
  assert.ok(unsafe.includes("fixture-secret-that-must-be-redacted"));
});
