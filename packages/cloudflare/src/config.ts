import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_API_URL = "https://api.cloudflare.com/client/v4";

export type CloudflareConfig = {
  apiToken: string;
  accountId: string;
  capabilities: CloudflareCapabilities;
};

export type CloudflareCapabilities = {
  zones: boolean;
  dns: boolean;
  tunnels: boolean;
  turnstile: boolean;
  pages: boolean;
};

export const disabledCapabilities: CloudflareCapabilities = {
  zones: false,
  dns: false,
  tunnels: false,
  turnstile: false,
  pages: false,
};

export const enabledCapabilities: CloudflareCapabilities = {
  zones: true,
  dns: true,
  tunnels: true,
  turnstile: true,
  pages: true,
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
  const capabilities = value.capabilities === undefined
    ? { ...enabledCapabilities }
    : {
      zones: value.capabilities.zones === true,
      dns: value.capabilities.dns === true,
      tunnels: value.capabilities.tunnels === true,
      turnstile: value.capabilities.turnstile === true,
      pages: value.capabilities.pages === true,
    };
  return {
    apiToken: value.apiToken,
    accountId: value.accountId,
    capabilities,
  };
}

export async function writeConfig(home: string, config: CloudflareConfig): Promise<void> {
  const target = configPath(home);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, `${JSON.stringify(config)}\n`, { mode: 0o600 });
}
