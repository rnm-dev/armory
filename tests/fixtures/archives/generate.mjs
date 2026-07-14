import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedDir = path.join(here, "generated");
const check = process.argv.includes("--check");

function writeString(buffer, offset, length, value) {
  Buffer.from(value).copy(buffer, offset, 0, length);
}

function writeOctal(buffer, offset, length, value) {
  const text = Math.max(0, value).toString(8).padStart(length - 1, "0").slice(-(length - 1));
  writeString(buffer, offset, length, `${text}\0`);
}

function tarHeader(entry) {
  const header = Buffer.alloc(512);
  const content = Buffer.from(entry.content ?? "");
  writeString(header, 0, 100, entry.name);
  writeOctal(header, 100, 8, entry.mode ?? (entry.type === "5" ? 0o755 : 0o644));
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.declaredSize ?? content.length);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, entry.type ?? "0");
  if (entry.linkname) writeString(header, 157, 100, entry.linkname);
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 265, 32, "root");
  writeString(header, 297, 32, "root");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return { header, content };
}

function makeTar(entries) {
  const chunks = [];
  for (const entry of entries) {
    const { header, content } = tarHeader(entry);
    chunks.push(header, content);
    const padding = (512 - (content.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });
}

const manifest = JSON.stringify({
  schemaVersion: 1,
  id: "fixture-echo",
  version: "1.0.0",
  minPeonVersion: "0.0.1",
  platforms: [{ os: "linux", arch: "x64" }],
  permissions: { networkHosts: [], hostPaths: [] },
  dependencies: [],
  mcp: { command: { executable: "node", args: ["dist/mcp.js"] }, toolPrefix: "fixture_echo" },
});

const root = "fixture-echo-1.0.0";
const base = [
  { name: `${root}/`, type: "5" },
  { name: `${root}/armory.package.json`, content: manifest },
];
const archives = new Map([
  ["valid.tar.gz", makeTar([...base, { name: `${root}/dist/mcp.js`, content: "process.stdin.resume();\n" }])],
  ["traversal.tar.gz", makeTar([...base, { name: `${root}/../../escape`, content: "escape" }])],
  ["escaping-symlink.tar.gz", makeTar([...base, { name: `${root}/escape-link`, type: "2", linkname: "../../outside" }])],
  ["escaping-hardlink.tar.gz", makeTar([...base, { name: `${root}/escape-hardlink`, type: "1", linkname: "../../outside" }])],
  ["duplicate-path.tar.gz", makeTar([...base, { name: `${root}/dist/mcp.js`, content: "first" }, { name: `${root}/dist/./mcp.js`, content: "second" }])],
  ["expanded-size.tar.gz", makeTar([...base, { name: `${root}/assets/large.bin`, content: Buffer.alloc(2048, 0x61) }])],
  ["malformed-manifest.tar.gz", makeTar([{ name: `${root}/`, type: "5" }, { name: `${root}/armory.package.json`, content: "{not-json" }])],
  ["mcp-crash.tar.gz", makeTar([...base, { name: `${root}/dist/mcp.js`, content: "process.exit(17);\n" }])],
  ["mcp-timeout.tar.gz", makeTar([...base, { name: `${root}/dist/mcp.js`, content: "setInterval(() => {}, 1000);\n" }])],
  ["mcp-oversized-result.tar.gz", makeTar([...base, { name: `${root}/dist/mcp.js`, content: "process.stdout.write('x'.repeat(16 * 1024 * 1024 + 1));\n" }])],
  ["hook-malformed.tar.gz", makeTar([...base, { name: `${root}/dist/hooks/configure.js`, content: "process.stdin.resume(); process.stdin.once('end', () => process.stdout.write('not-json\\n'));\n" }])],
  ["hook-duplicate-results.tar.gz", makeTar([...base, { name: `${root}/dist/hooks/configure.js`, content: "process.stdin.resume(); process.stdin.once('end', () => { const value = JSON.stringify({protocolVersion:1,type:'result',ok:true,message:'duplicate'}); process.stdout.write(value+'\\n'+value+'\\n'); });\n" }])],
  ["hook-timeout.tar.gz", makeTar([...base, { name: `${root}/dist/hooks/configure.js`, content: "process.stdin.resume(); setInterval(() => {}, 1000);\n" }])],
]);

await fs.mkdir(generatedDir, { recursive: true });
let stale = false;
for (const [name, bytes] of archives) {
  const destination = path.join(generatedDir, name);
  const existing = await fs.readFile(destination).catch(() => null);
  if (!existing?.equals(bytes)) {
    stale = true;
    if (!check) await fs.writeFile(destination, bytes);
  }
}

const expectedNames = new Set(archives.keys());
for (const entry of await fs.readdir(generatedDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".tar.gz") && !expectedNames.has(entry.name)) {
    stale = true;
    if (!check) await fs.rm(path.join(generatedDir, entry.name));
  }
}

const validDigest = crypto.createHash("sha256").update(archives.get("valid.tar.gz")).digest("hex");
const wrongDigest = `${validDigest[0] === "0" ? "1" : "0"}${validDigest.slice(1)}`;
const digestFile = `${wrongDigest}  valid.tar.gz\n`;
const digestPath = path.join(generatedDir, "digest-mismatch.sha256");
const existingDigest = await fs.readFile(digestPath, "utf8").catch(() => null);
if (existingDigest !== digestFile) {
  stale = true;
  if (!check) await fs.writeFile(digestPath, digestFile);
}

const limits = `${JSON.stringify({ archive: "expanded-size.tar.gz", maxExpandedBytes: 1024, actualExpandedBytes: 2048 }, null, 2)}\n`;
const limitsPath = path.join(generatedDir, "limits.json");
const existingLimits = await fs.readFile(limitsPath, "utf8").catch(() => null);
if (existingLimits !== limits) {
  stale = true;
  if (!check) await fs.writeFile(limitsPath, limits);
}

if (check && stale) throw new Error("Archive fixtures are stale; run npm run generate:fixtures");
if (!check) console.log(`Generated ${archives.size} deterministic archive fixtures.`);
