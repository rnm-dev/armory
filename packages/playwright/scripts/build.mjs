import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");

await fs.rm(dist, { recursive: true, force: true });
await build({
  entryPoints: [path.join(root, "src", "mcp.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["playwright-core"],
  outfile: path.join(dist, "mcp.js"),
});
await fs.mkdir(path.join(dist, "node_modules"), { recursive: true });
await fs.cp(
  path.join(root, "node_modules", "playwright-core"),
  path.join(dist, "node_modules", "playwright-core"),
  { recursive: true },
);
