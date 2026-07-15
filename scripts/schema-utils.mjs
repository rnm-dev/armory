import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import semver from "semver";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const schemaDir = path.join(repoRoot, "schemas");

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export function createAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  ajv.addFormat("semver", {
    type: "string",
    validate: (value) => semver.valid(value, { loose: false }) === value,
  });
  ajv.addFormat("semver-range", {
    type: "string",
    validate: (value) => value !== "*" && semver.validRange(value, { loose: false }) !== null,
  });
  return ajv;
}

export function formatAjvErrors(errors) {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

export function summarizeRequirements(manifest) {
  return {
    credentials: Boolean(manifest.configuration?.fields.some((field) =>
      field.required || field.type === "secret" || field.type === "file"
    )),
    hostWrites: manifest.permissions.hostPaths.some((entry) => entry.mode === "write"),
  };
}

export async function loadValidators() {
  const ajv = createAjv();
  const [catalogSchema, packageSchema, hookSchema] = await Promise.all([
    readJson(path.join(schemaDir, "armory-v1.schema.json")),
    readJson(path.join(schemaDir, "package-v1.schema.json")),
    readJson(path.join(schemaDir, "hook-message-v1.schema.json")),
  ]);
  return {
    catalog: ajv.compile(catalogSchema),
    manifest: ajv.compile(packageSchema),
    hookMessage: ajv.compile(hookSchema),
  };
}
