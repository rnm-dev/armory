import { GoogleAdsClient } from "../client.js";
import { readConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  if (input.operation !== "verify") throw new Error("invalid verify input");
  const client = new GoogleAdsClient(await readConfig(input.package.home));
  await client.listAccessibleCustomers();
  result({ ok: true, message: "Google Ads connection verified" });
} catch {
  result({ ok: false, message: "Google Ads connection could not be verified", errorCode: "VERIFICATION_FAILED" });
  process.exitCode = 1;
}
