import fs from "node:fs/promises";
import path from "node:path";

export type GoogleCredential = {
  type: "service_account";
  client_email: string;
  private_key: string;
  private_key_id?: string;
  project_id?: string;
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
  if (parsed.type !== "service_account" || typeof parsed.client_email !== "string" || !parsed.client_email
    || typeof parsed.private_key !== "string" || !parsed.private_key.includes("BEGIN PRIVATE KEY")) {
    throw new Error("invalid service account credentials");
  }
  return {
    type: "service_account",
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    ...(typeof parsed.private_key_id === "string" ? { private_key_id: parsed.private_key_id } : {}),
    ...(typeof parsed.project_id === "string" ? { project_id: parsed.project_id } : {}),
  };
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
