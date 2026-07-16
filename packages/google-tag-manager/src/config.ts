import fs from "node:fs/promises";
import path from "node:path";

export type GoogleCredential = Record<string, unknown> & {
  type: "service_account" | "authorized_user";
};

export type GoogleTagManagerConfig = {
  credential: GoogleCredential;
  defaultAccountId?: string;
  defaultContainerId?: string;
  defaultWorkspaceId?: string;
};

const ID_PATTERN = /^[0-9]{1,32}$/;

export function configPath(home: string): string {
  return path.join(home, "config", "google-tag-manager.json");
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

export function optionalId(value: unknown, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

export async function readConfig(home: string): Promise<GoogleTagManagerConfig> {
  const value = JSON.parse(await fs.readFile(configPath(home), "utf8")) as Partial<GoogleTagManagerConfig>;
  if (!value.credential || typeof value.credential !== "object") throw new Error("Google credential is not configured");
  const config: GoogleTagManagerConfig = {
    credential: value.credential as GoogleCredential,
    ...(optionalId(value.defaultAccountId, "default account ID") ? { defaultAccountId: value.defaultAccountId } : {}),
    ...(optionalId(value.defaultContainerId, "default container ID") ? { defaultContainerId: value.defaultContainerId } : {}),
    ...(optionalId(value.defaultWorkspaceId, "default workspace ID") ? { defaultWorkspaceId: value.defaultWorkspaceId } : {}),
  };
  return config;
}
