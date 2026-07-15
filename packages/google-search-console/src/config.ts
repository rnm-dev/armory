import fs from "node:fs/promises";
import path from "node:path";

export type ServiceAccountCredentials = {
  type: "service_account";
  client_email: string;
  private_key: string;
  private_key_id?: string;
  project_id?: string;
};

export function configPath(home: string): string {
  return path.join(home, "config", "google-search-console.json");
}

export function parseCredentials(raw: string): ServiceAccountCredentials {
  const value = JSON.parse(raw) as Partial<ServiceAccountCredentials>;
  if (value.type !== "service_account" || typeof value.client_email !== "string" || !value.client_email
    || typeof value.private_key !== "string" || !value.private_key.includes("BEGIN PRIVATE KEY")) {
    throw new Error("invalid service account credentials");
  }
  return {
    type: "service_account",
    client_email: value.client_email,
    private_key: value.private_key,
    ...(typeof value.private_key_id === "string" ? { private_key_id: value.private_key_id } : {}),
    ...(typeof value.project_id === "string" ? { project_id: value.project_id } : {}),
  };
}

export async function readConfig(home: string): Promise<ServiceAccountCredentials> {
  return parseCredentials(await fs.readFile(configPath(home), "utf8"));
}
