import fs from "node:fs/promises";
import path from "node:path";
import { configPath, parseCredential, type GoogleAnalyticsConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  const fields = input.configuration;
  if (input.operation !== "configure" || !fields || typeof fields.credentialJson !== "string") {
    throw new Error("invalid Google Analytics configuration");
  }
  const defaultPropertyId = fields.defaultPropertyId || undefined;
  const measurementId = fields.measurementId || undefined;
  const measurementApiSecret = fields.measurementApiSecret || undefined;
  const measurementRegion = fields.measurementRegion || "global";
  if (defaultPropertyId && !/^[0-9]{1,32}$/.test(defaultPropertyId)) throw new Error("invalid property ID");
  if ((measurementId === undefined) !== (measurementApiSecret === undefined)) throw new Error("incomplete measurement configuration");
  if (measurementRegion !== "global" && measurementRegion !== "eu") throw new Error("invalid measurement region");

  const config: GoogleAnalyticsConfig = {
    credential: parseCredential(fields.credentialJson),
    ...(defaultPropertyId ? { defaultPropertyId } : {}),
    ...(measurementId ? { measurementId, measurementApiSecret } : {}),
    measurementRegion,
  };
  const target = configPath(input.package.home);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  result({ ok: true, message: "Google Analytics credentials are configured", ownedPaths: ["config/google-analytics.json"] });
} catch {
  result({ ok: false, message: "Google Analytics configuration is invalid", errorCode: "CONFIGURATION_INVALID" });
  process.exitCode = 1;
}
