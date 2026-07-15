import fs from "node:fs/promises";
import path from "node:path";
import { configPath, parseApiKey } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  if (input.operation !== "configure") throw new Error("invalid configure input");
  const apiKey = parseApiKey(input.configuration?.apiKey);
  const target = configPath(input.package.home);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, `${JSON.stringify({ apiKey })}\n`, { mode: 0o600 });
  result({ ok: true, message: "Gemini API key is configured", ownedPaths: ["config/image-generator.json"] });
} catch {
  result({ ok: false, message: "Gemini configuration is invalid", errorCode: "CONFIGURATION_INVALID" });
  process.exitCode = 1;
}
