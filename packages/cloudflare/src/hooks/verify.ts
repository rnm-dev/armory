import { CloudflareClient } from "../client.js";
import { readConfig } from "../config.js";
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
  await Promise.all([
    client.request(`/zones?account.id=${config.accountId}&page=1&per_page=5`),
    client.request(`/accounts/${config.accountId}/cfd_tunnel?is_deleted=false&page=1&per_page=1`),
    client.request(`/accounts/${config.accountId}/challenges/widgets?page=1&per_page=5`),
  ]);
  result({ ok: true, message: "Cloudflare connection verified" });
} catch {
  result({ ok: false, message: "Cloudflare connection could not be verified", errorCode: "VERIFICATION_FAILED" });
  process.exitCode = 1;
}
