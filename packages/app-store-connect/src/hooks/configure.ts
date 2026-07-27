import fs from "node:fs/promises";
import path from "node:path";
import { configPath, parseConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  const issuerId = input.configuration?.issuerId;
  const keyId = input.configuration?.keyId;
  const privateKey = input.configuration?.privateKeyFile;
  if (input.operation !== "configure"
    || (issuerId !== undefined && typeof issuerId !== "string")
    || typeof keyId !== "string" || typeof privateKey !== "string") {
    throw new Error("invalid App Store Connect configuration");
  }
  const config = parseConfig(issuerId, keyId, privateKey);
  const target = configPath(input.package.home);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  result({
    ok: true,
    message: "App Store Connect credentials are configured",
    ownedPaths: ["config/app-store-connect.json"],
  });
} catch {
  result({
    ok: false,
    message: "App Store Connect configuration is invalid",
    errorCode: "CONFIGURATION_INVALID",
  });
  process.exitCode = 1;
}
