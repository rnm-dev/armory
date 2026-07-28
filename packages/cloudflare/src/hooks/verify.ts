import { CloudflareClient } from "../client.js";
import { detectCapabilities } from "../capabilities.js";
import { readConfig, writeConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  if (input.operation !== "verify") throw new Error("invalid verify input");
  const config = await readConfig(input.package.home);
  const client = new CloudflareClient(config);
  if (config.apiToken.startsWith("cfat_")) {
    await client.request<{ status: string }>(`/accounts/${config.accountId}/tokens/verify`);
  } else {
    try {
      await client.request<{ status: string }>("/user/tokens/verify");
    } catch {
      // Account-owned tokens issued before the scannable cfat_ format are unprefixed.
      await client.request<{ status: string }>(`/accounts/${config.accountId}/tokens/verify`);
    }
  }
  config.capabilities = await detectCapabilities(client, config);
  await writeConfig(input.package.home, config);
  const disabled = Object.entries(config.capabilities).filter(([, enabled]) => !enabled).map(([name]) => name);
  result({
    ok: true,
    message: disabled.length === 0
      ? "Cloudflare connection verified; all features enabled"
      : `Cloudflare connection verified; unavailable features disabled: ${disabled.join(", ")}`,
  });
} catch {
  result({ ok: false, message: "Cloudflare connection could not be verified", errorCode: "VERIFICATION_FAILED" });
  process.exitCode = 1;
}
