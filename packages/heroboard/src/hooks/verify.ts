import { apiUrl, readConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  if (input.operation !== "verify") throw new Error("invalid verify input");
  const { apiKey } = await readConfig(input.package.home);
  const response = await fetch(`${apiUrl()}/api/agent/v1/context`, {
    headers: { "X-Api-Key": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Heroboard returned HTTP ${response.status}`);
  result({ ok: true, message: "Heroboard connection verified" });
} catch {
  result({ ok: false, message: "Heroboard connection could not be verified", errorCode: "VERIFICATION_FAILED" });
  process.exitCode = 1;
}
