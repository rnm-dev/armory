import { createPrivateKey } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type AppStoreConnectConfig = {
  issuerId: string;
  keyId: string;
  privateKey: string;
  defaultAppId?: string;
};

const ISSUER_ID = /^[A-Za-z0-9-]{2,64}$/;
const KEY_ID = /^[A-Za-z0-9]{2,64}$/;
const RESOURCE_ID = /^[A-Za-z0-9.-]{1,128}$/;

export function configPath(home: string): string {
  return path.join(home, "config", "app-store-connect.json");
}

export function parseConfig(
  issuerId: string,
  keyId: string,
  privateKey: string,
  defaultAppId?: string,
): AppStoreConnectConfig {
  const appId = defaultAppId?.trim();
  if (!ISSUER_ID.test(issuerId) || !KEY_ID.test(keyId)
    || !privateKey.includes("BEGIN PRIVATE KEY")
    || Buffer.byteLength(privateKey) > 65_536
    || (appId && !RESOURCE_ID.test(appId))) {
    throw new Error("invalid App Store Connect configuration");
  }
  try {
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== "ec") throw new Error("not an EC key");
  } catch {
    throw new Error("invalid App Store Connect configuration");
  }
  return { issuerId, keyId, privateKey, ...(appId ? { defaultAppId: appId } : {}) };
}

export async function readConfig(home: string): Promise<AppStoreConnectConfig> {
  const value = JSON.parse(await fs.readFile(configPath(home), "utf8")) as Partial<AppStoreConnectConfig>;
  if (typeof value.issuerId !== "string" || typeof value.keyId !== "string" || typeof value.privateKey !== "string") {
    throw new Error("invalid App Store Connect configuration");
  }
  return parseConfig(value.issuerId, value.keyId, value.privateKey, value.defaultAppId);
}
