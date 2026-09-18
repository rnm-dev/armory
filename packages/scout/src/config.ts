import fs from "node:fs/promises";
import path from "node:path";

export const SCOUT_URL = process.env.NODE_ENV === "test" && process.env.SCOUT_TEST_URL
  ? process.env.SCOUT_TEST_URL.replace(/\/$/, "") : "https://scout.rnm.dev";
export const configPath = (home: string) => path.join(home, "config", "scout.json");
export async function readConfig(home: string): Promise<{ apiKey: string }> {
  const value = JSON.parse(await fs.readFile(configPath(home), "utf8")) as { apiKey?: unknown };
  if (typeof value.apiKey !== "string" || !value.apiKey) throw new Error("Scout API key is not configured");
  return { apiKey: value.apiKey };
}
