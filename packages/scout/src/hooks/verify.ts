import { readConfig, SCOUT_URL } from "../config.js";
import { readInput, result } from "./protocol.js";
try {
  const input = await readInput(); if (input.operation !== "verify") throw new Error();
  const { apiKey } = await readConfig(input.package.home);
  const response = await fetch(`${SCOUT_URL}/mcp.json`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error();
  result({ ok: true, message: "Scout connection verified" });
} catch { result({ ok: false, message: "Scout connection could not be verified", errorCode: "VERIFICATION_FAILED" }); process.exitCode = 1; }
