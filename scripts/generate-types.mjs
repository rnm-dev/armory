import fs from "node:fs/promises";
import path from "node:path";
import { compileFromFile } from "json-schema-to-typescript";
import { repoRoot, schemaDir } from "./schema-utils.mjs";

const check = process.argv.includes("--check");
const targets = [
  ["armory-v1.schema.json", "armory-v1.ts"],
  ["package-v1.schema.json", "package-v1.ts"],
  ["hook-message-v1.schema.json", "hook-message-v1.ts"],
];

const outDir = path.join(repoRoot, "src", "generated");
await fs.mkdir(outDir, { recursive: true });

let changed = false;
for (const [schemaName, outputName] of targets) {
  const output = await compileFromFile(path.join(schemaDir, schemaName), {
    bannerComment: "/* Generated from the checked-in V1 JSON schema. Do not edit. */",
    cwd: schemaDir,
    format: true,
    style: { singleQuote: false },
    unknownAny: false,
  });
  const outputPath = path.join(outDir, outputName);
  const previous = await fs.readFile(outputPath, "utf8").catch(() => null);
  if (previous !== output) {
    changed = true;
    if (!check) await fs.writeFile(outputPath, output, "utf8");
  }
}

if (check && changed) {
  throw new Error("Generated TypeScript contracts are stale; run npm run generate:types");
}

if (!check) console.log(`Generated ${targets.length} TypeScript contract files.`);
