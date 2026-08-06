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

export function profileDeclarationErrors(manifest) {
  const errors = [];
  const fields = manifest.configuration?.fields ?? [];
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const credentialed = fields.some((field) => field.required || field.type === "secret" || field.type === "file");

  if (!manifest.profile) {
    if (credentialed) errors.push("credentialed configuration must declare a profile");
    return errors;
  }

  if (!credentialed) errors.push("credential-free packages must omit profile");
  if (!manifest.configuration) errors.push("profile requires configuration fields");

  const declared = new Set(manifest.profile.requiredFields);
  for (const fieldId of manifest.profile.requiredFields) {
    const field = fieldById.get(fieldId);
    if (!field) errors.push(`profile.requiredFields references undeclared field ${JSON.stringify(fieldId)}`);
    else if (!field.required) errors.push(`profile.requiredFields includes optional field ${JSON.stringify(fieldId)}`);
  }
  for (const field of fields) {
    if (field.required && !declared.has(field.id)) {
      errors.push(`profile.requiredFields omits required configuration field ${JSON.stringify(field.id)}`);
    }
  }
  return errors;
}

export function profileTypeCompatibilityErrors(entries) {
  const errors = [];
  const contracts = new Map();
  for (const { manifest, where } of entries) {
    if (!manifest.profile || !manifest.configuration) continue;
    for (const field of manifest.configuration.fields) {
      const key = `${manifest.profile.type}\u0000${field.id}`;
      const contract = JSON.stringify({
        type: field.type,
        options: field.options?.map(({ value }) => value),
        validation: field.validation,
      });
      const previous = contracts.get(key);
      if (previous && previous.contract !== contract) {
        errors.push(`${where}.configuration.fields.${field.id}: incompatible with ${previous.where} for shared profile type ${JSON.stringify(manifest.profile.type)}`);
      } else if (!previous) {
        contracts.set(key, { contract, where: `${where}.configuration.fields.${field.id}` });
      }
    }
  }
  return errors;
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
