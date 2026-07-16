import { GeminiImageClient } from "../client.js";
import { readConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  if (input.operation !== "verify") throw new Error("invalid verify input");
  await new GeminiImageClient(await readConfig(input.package.home)).verify();
  result({ ok: true, message: "Gemini image generation connection verified" });
} catch {
  result({ ok: false, message: "Gemini image generation connection could not be verified", errorCode: "VERIFICATION_FAILED" });
  process.exitCode = 1;
}
