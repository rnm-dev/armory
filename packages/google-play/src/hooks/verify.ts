import { GooglePlayClient } from "../client.js";
import { readConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  if (input.operation !== "verify") throw new Error("invalid verify input");
  const config = await readConfig(input.package.home);
  await new GooglePlayClient(config).listReleases(config.packageName, "production");
  result({ ok: true, message: "Google Play connection verified" });
} catch {
  result({ ok: false, message: "Google Play connection could not be verified", errorCode: "VERIFICATION_FAILED" });
  process.exitCode = 1;
}
