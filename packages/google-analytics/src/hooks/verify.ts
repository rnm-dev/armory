import { GoogleAnalyticsClient } from "../client.js";
import { readConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  if (input.operation !== "verify") throw new Error("invalid verify input");
  const config = await readConfig(input.package.home);
  const client = new GoogleAnalyticsClient(config);
  await client.request("admin", "GET", "/v1beta/accountSummaries", undefined, { pageSize: 1 });
  if (config.defaultPropertyId) {
    await client.request("data", "GET", `/v1beta/properties/${config.defaultPropertyId}/metadata`);
  }
  result({ ok: true, message: "Google Analytics connection verified" });
} catch {
  result({ ok: false, message: "Google Analytics connection could not be verified", errorCode: "VERIFICATION_FAILED" });
  process.exitCode = 1;
}
