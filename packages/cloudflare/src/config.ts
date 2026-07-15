import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_API_URL = "https://api.cloudflare.com/client/v4";

export type CloudflareConfig = {
  apiToken: string;
  accountId: string;
};

export function apiUrl(): string {
  return process.env.NODE_ENV === "test" && process.env.CLOUDFLARE_TEST_API_URL
    ? process.env.CLOUDFLARE_TEST_API_URL.replace(/\/$/, "")
    : DEFAULT_API_URL;
}

export function configPath(home: string): string {
  return path.join(home, "config", "cloudflare.json");
}

export async function readConfig(home: string): Promise<CloudflareConfig> {
  const value = JSON.parse(await fs.readFile(configPath(home), "utf8")) as Partial<CloudflareConfig>;
  if (typeof value.apiToken !== "string" || !value.apiToken) throw new Error("Cloudflare API token is not configured");
  if (typeof value.accountId !== "string" || !/^[0-9a-f]{32}$/i.test(value.accountId)) {
    throw new Error("Cloudflare account ID is not configured");
  }
  return { apiToken: value.apiToken, accountId: value.accountId };
}
