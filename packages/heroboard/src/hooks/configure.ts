import fs from "node:fs/promises";
import path from "node:path";
import { configPath } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  const apiKey = input.configuration?.apiKey;
  if (input.operation !== "configure" || typeof apiKey !== "string" || !apiKey) {
    throw new Error("invalid Heroboard configuration");
  }

  const target = configPath(input.package.home);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, `${JSON.stringify({ apiKey })}\n`, { mode: 0o600 });
  result({ ok: true, message: "Heroboard credentials are configured", ownedPaths: ["config/heroboard.json"] });
} catch {
  result({ ok: false, message: "Heroboard configuration is invalid", errorCode: "CONFIGURATION_INVALID" });
  process.exitCode = 1;
}
