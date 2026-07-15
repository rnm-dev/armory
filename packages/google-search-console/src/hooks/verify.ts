import { SearchConsoleClient } from "../client.js";
import { readConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  if (input.operation !== "verify") throw new Error("invalid verify input");
  const client = new SearchConsoleClient(await readConfig(input.package.home));
  await client.request("webmasters", "/sites");
  result({ ok: true, message: "Google Search Console connection verified" });
} catch {
  result({ ok: false, message: "Google Search Console connection could not be verified", errorCode: "VERIFICATION_FAILED" });
  process.exitCode = 1;
}
