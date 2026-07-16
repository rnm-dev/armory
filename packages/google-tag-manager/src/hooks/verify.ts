import { GoogleTagManagerClient } from "../client.js";
import { readConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  if (input.operation !== "verify") throw new Error("invalid verify input");
  const config = await readConfig(input.package.home);
  const client = new GoogleTagManagerClient(config);
  await client.request("GET", "/accounts");
  if (config.defaultAccountId) {
    await client.request("GET", `/accounts/${config.defaultAccountId}`);
  }
  if (config.defaultAccountId && config.defaultContainerId) {
    await client.request("GET", `/accounts/${config.defaultAccountId}/containers/${config.defaultContainerId}`);
  }
  if (config.defaultAccountId && config.defaultContainerId && config.defaultWorkspaceId) {
    await client.request("GET", `/accounts/${config.defaultAccountId}/containers/${config.defaultContainerId}/workspaces/${config.defaultWorkspaceId}`);
  }
  result({ ok: true, message: "Google Tag Manager connection verified" });
} catch {
  result({ ok: false, message: "Google Tag Manager connection could not be verified", errorCode: "VERIFICATION_FAILED" });
  process.exitCode = 1;
}
