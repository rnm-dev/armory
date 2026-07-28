import { disabledCapabilities, writeConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  const apiToken = input.configuration?.apiToken;
  const accountId = input.configuration?.accountId;
  if (input.operation !== "configure" || typeof apiToken !== "string" || !apiToken
    || typeof accountId !== "string" || !/^[0-9a-f]{32}$/i.test(accountId)) {
    throw new Error("invalid Cloudflare configuration");
  }
  await writeConfig(input.package.home, { apiToken, accountId, capabilities: { ...disabledCapabilities } });
  result({ ok: true, message: "Cloudflare credentials are configured", ownedPaths: ["config/cloudflare.json"] });
} catch {
  result({ ok: false, message: "Cloudflare configuration is invalid", errorCode: "CONFIGURATION_INVALID" });
  process.exitCode = 1;
}
