import fs from "node:fs/promises";
import path from "node:path";
import { configPath, parseCredentials } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  const raw = input.configuration?.serviceAccountFile;
  if (input.operation !== "configure" || typeof raw !== "string" || Buffer.byteLength(raw) > 1024 * 1024) {
    throw new Error("invalid Google Search Console configuration");
  }
  const credentials = parseCredentials(raw);
  const target = configPath(input.package.home);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, `${JSON.stringify(credentials)}\n`, { mode: 0o600 });
  result({
    ok: true,
    message: "Google Search Console credentials are configured",
    ownedPaths: ["config/google-search-console.json"],
  });
} catch {
  result({ ok: false, message: "Google Search Console configuration is invalid", errorCode: "CONFIGURATION_INVALID" });
  process.exitCode = 1;
}
