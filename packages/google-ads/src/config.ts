import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_API_URL = "https://googleads.googleapis.com/v24";
const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";

export type GoogleAdsConfig = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  loginCustomerId?: string;
};

export function apiUrl(): string {
  return process.env.NODE_ENV === "test" && process.env.GOOGLE_ADS_TEST_API_URL
    ? process.env.GOOGLE_ADS_TEST_API_URL.replace(/\/$/, "")
    : DEFAULT_API_URL;
}

export function tokenUrl(): string {
  return process.env.NODE_ENV === "test" && process.env.GOOGLE_ADS_TEST_TOKEN_URL
    ? process.env.GOOGLE_ADS_TEST_TOKEN_URL
    : DEFAULT_TOKEN_URL;
}

export function configPath(home: string): string {
  return path.join(home, "config", "google-ads.json");
}

export function validateConfig(value: Partial<GoogleAdsConfig>): GoogleAdsConfig {
  for (const key of ["developerToken", "clientId", "clientSecret", "refreshToken"] as const) {
    if (typeof value[key] !== "string" || !value[key]) throw new Error(`Google Ads ${key} is not configured`);
  }
  if (value.loginCustomerId !== undefined && !/^[0-9]{10}$/.test(value.loginCustomerId)) {
    throw new Error("Google Ads manager customer ID must contain exactly 10 digits");
  }
  return {
    developerToken: value.developerToken,
    clientId: value.clientId,
    clientSecret: value.clientSecret,
    refreshToken: value.refreshToken,
    ...(value.loginCustomerId ? { loginCustomerId: value.loginCustomerId } : {}),
  };
}

export async function readConfig(home: string): Promise<GoogleAdsConfig> {
  return validateConfig(JSON.parse(await fs.readFile(configPath(home), "utf8")) as Partial<GoogleAdsConfig>);
}
