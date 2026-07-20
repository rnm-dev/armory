import fs from "node:fs/promises";
import path from "node:path";

export type GooglePlayConfig = {
  type: "service_account";
  client_email: string;
  private_key: string;
  private_key_id?: string;
  project_id?: string;
  packageName: string;
};

const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

export function configPath(home: string): string {
  return path.join(home, "config", "google-play.json");
}

export function parseConfig(rawCredentials: string, packageName: string): GooglePlayConfig {
  const value = JSON.parse(rawCredentials) as Partial<GooglePlayConfig>;
  if (value.type !== "service_account" || typeof value.client_email !== "string" || !value.client_email
    || typeof value.private_key !== "string" || !value.private_key.includes("BEGIN PRIVATE KEY")
    || !PACKAGE_NAME.test(packageName) || packageName.length > 255) {
    throw new Error("invalid Google Play configuration");
  }
  return {
    type: "service_account",
    client_email: value.client_email,
    private_key: value.private_key,
    packageName,
    ...(typeof value.private_key_id === "string" ? { private_key_id: value.private_key_id } : {}),
    ...(typeof value.project_id === "string" ? { project_id: value.project_id } : {}),
  };
}

export async function readConfig(home: string): Promise<GooglePlayConfig> {
  const value = JSON.parse(await fs.readFile(configPath(home), "utf8")) as GooglePlayConfig;
  return parseConfig(JSON.stringify(value), value.packageName);
}
