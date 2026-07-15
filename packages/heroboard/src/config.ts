import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_API_URL = "https://heroboard.app";

export type HeroboardConfig = {
  apiKey: string;
};

export function apiUrl(): string {
  return process.env.NODE_ENV === "test" && process.env.HEROBOARD_TEST_API_URL
    ? process.env.HEROBOARD_TEST_API_URL.replace(/\/$/, "")
    : DEFAULT_API_URL;
}

export function configPath(home: string): string {
  return path.join(home, "config", "heroboard.json");
}

export async function readConfig(home: string): Promise<HeroboardConfig> {
  const value = JSON.parse(await fs.readFile(configPath(home), "utf8")) as Partial<HeroboardConfig>;
  if (typeof value.apiKey !== "string" || !value.apiKey) throw new Error("Heroboard API key is not configured");
  return { apiKey: value.apiKey };
}
