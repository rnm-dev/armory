import fs from "node:fs/promises";
import path from "node:path";
import { configPath, validateConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  if (input.operation !== "configure") throw new Error("invalid configure input");
  const values = input.configuration ?? {};
  const config = validateConfig({
    developerToken: values.developerToken,
    clientId: values.clientId,
    clientSecret: values.clientSecret,
    refreshToken: values.refreshToken,
    ...(values.loginCustomerId ? { loginCustomerId: values.loginCustomerId } : {}),
  });
  const target = configPath(input.package.home);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  result({ ok: true, message: "Google Ads credentials are configured", ownedPaths: ["config/google-ads.json"] });
} catch {
  result({ ok: false, message: "Google Ads configuration is invalid", errorCode: "CONFIGURATION_INVALID" });
  process.exitCode = 1;
}
