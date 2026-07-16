import fs from "node:fs/promises";
import path from "node:path";
import { configPath, optionalId, parseCredential, type GoogleTagManagerConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  const fields = input.configuration;
  if (input.operation !== "configure" || !fields || typeof fields.credentialJson !== "string"
    || Buffer.byteLength(fields.credentialJson) > 1024 * 1024) {
    throw new Error("invalid Google Tag Manager configuration");
  }
  const defaultAccountId = optionalId(fields.defaultAccountId, "default account ID");
  const defaultContainerId = optionalId(fields.defaultContainerId, "default container ID");
  const defaultWorkspaceId = optionalId(fields.defaultWorkspaceId, "default workspace ID");
  if (defaultContainerId && !defaultAccountId) throw new Error("a default account ID is required with a default container ID");
  if (defaultWorkspaceId && (!defaultAccountId || !defaultContainerId)) {
    throw new Error("default account and container IDs are required with a default workspace ID");
  }
  const config: GoogleTagManagerConfig = {
    credential: parseCredential(fields.credentialJson),
    ...(defaultAccountId ? { defaultAccountId } : {}),
    ...(defaultContainerId ? { defaultContainerId } : {}),
    ...(defaultWorkspaceId ? { defaultWorkspaceId } : {}),
  };
  const target = configPath(input.package.home);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  result({ ok: true, message: "Google Tag Manager credentials are configured", ownedPaths: ["config/google-tag-manager.json"] });
} catch {
  result({ ok: false, message: "Google Tag Manager configuration is invalid", errorCode: "CONFIGURATION_INVALID" });
  process.exitCode = 1;
}
