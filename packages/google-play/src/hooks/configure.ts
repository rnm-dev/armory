import fs from "node:fs/promises";
import path from "node:path";
import { configPath, parseConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  const raw = input.configuration?.serviceAccountFile;
  const packageName = input.configuration?.packageName;
  if (input.operation !== "configure" || typeof raw !== "string" || Buffer.byteLength(raw) > 1024 * 1024
    || typeof packageName !== "string") throw new Error("invalid Google Play configuration");
  const config = parseConfig(raw, packageName);
  const target = configPath(input.package.home);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  result({ ok: true, message: "Google Play credentials are configured", ownedPaths: ["config/google-play.json"] });
} catch {
  result({ ok: false, message: "Google Play configuration is invalid", errorCode: "CONFIGURATION_INVALID" });
  process.exitCode = 1;
}
