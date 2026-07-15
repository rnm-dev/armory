import { GeminiImagenClient } from "../client.js";
import { readConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  if (input.operation !== "verify") throw new Error("invalid verify input");
  await new GeminiImagenClient(await readConfig(input.package.home)).verify();
  result({ ok: true, message: "Gemini Imagen connection verified" });
} catch {
  result({ ok: false, message: "Gemini Imagen connection could not be verified", errorCode: "VERIFICATION_FAILED" });
  process.exitCode = 1;
}
