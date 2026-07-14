import fs from "node:fs/promises";
import path from "node:path";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  if (input.operation !== "configure" || !input.configuration) throw new Error("invalid configure input");
  const { projectName, apiToken, region, credentialsFile } = input.configuration;
  if (!projectName || !apiToken || !region || credentialsFile === undefined) throw new Error("missing required configuration");
  if (!["test-east", "test-west"].includes(region)) throw new Error("invalid region");

  const configDir = path.join(input.package.home, "config");
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(configDir, "config.json"), `${JSON.stringify({ projectName, apiToken, region })}\n`, { mode: 0o600 });
  await fs.writeFile(path.join(configDir, "credentials-file.txt"), credentialsFile, { mode: 0o600 });
  result({ ok: true, message: "Fixture configuration is ready", ownedPaths: ["config/config.json", "config/credentials-file.txt"] });
} catch {
  result({ ok: false, message: "Fixture configuration is invalid", errorCode: "CONFIGURATION_INVALID" });
  process.exitCode = 1;
}
