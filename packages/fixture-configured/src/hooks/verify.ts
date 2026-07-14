import fs from "node:fs/promises";
import path from "node:path";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  if (input.operation !== "verify") throw new Error("invalid verify input");
  const raw = await fs.readFile(path.join(input.package.home, "config", "config.json"), "utf8");
  const config = JSON.parse(raw) as { projectName?: string; apiToken?: string; region?: string };
  if (!config.projectName || !config.apiToken || !["test-east", "test-west"].includes(config.region ?? "")) throw new Error("invalid managed configuration");
  await fs.access(path.join(input.package.home, "config", "credentials-file.txt"));
  result({ ok: true, message: "Fixture configuration verified" });
} catch {
  result({ ok: false, message: "Fixture verification failed", errorCode: "CONFIGURATION_INVALID" });
  process.exitCode = 1;
}
