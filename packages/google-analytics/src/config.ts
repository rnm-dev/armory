import fs from "node:fs/promises";
import path from "node:path";

export type GoogleCredential = Record<string, unknown> & {
  type: "service_account" | "authorized_user";
};

export type GoogleAnalyticsConfig = {
  credential: GoogleCredential;
  defaultPropertyId?: string;
  measurementId?: string;
  measurementApiSecret?: string;
  measurementRegion: "global" | "eu";
};

export function configPath(home: string): string {
  return path.join(home, "config", "google-analytics.json");
}

export function parseCredential(value: string): GoogleCredential {
  const parsed = JSON.parse(value) as Partial<GoogleCredential>;
  if (!parsed || typeof parsed !== "object" || !["service_account", "authorized_user"].includes(String(parsed.type))) {
    throw new Error("credential must be a service_account or authorized_user JSON object");
  }
  if (parsed.type === "service_account"
    && (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string")) {
    throw new Error("service account credential is incomplete");
  }
  if (parsed.type === "authorized_user"
    && (typeof parsed.client_id !== "string" || typeof parsed.client_secret !== "string" || typeof parsed.refresh_token !== "string")) {
    throw new Error("authorized user credential is incomplete");
  }
  return parsed as GoogleCredential;
}

export async function readConfig(home: string): Promise<GoogleAnalyticsConfig> {
  const value = JSON.parse(await fs.readFile(configPath(home), "utf8")) as Partial<GoogleAnalyticsConfig>;
  if (!value.credential || typeof value.credential !== "object") throw new Error("Google credential is not configured");
  if (value.defaultPropertyId !== undefined && !/^[0-9]{1,32}$/.test(value.defaultPropertyId)) {
    throw new Error("default property ID is invalid");
  }
  if ((value.measurementId === undefined) !== (value.measurementApiSecret === undefined)) {
    throw new Error("Measurement Protocol ID and API secret must be configured together");
  }
  if (value.measurementRegion !== "global" && value.measurementRegion !== "eu") {
    throw new Error("measurement region is invalid");
  }
  return value as GoogleAnalyticsConfig;
}
