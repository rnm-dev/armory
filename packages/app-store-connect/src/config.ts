import { createPrivateKey } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type AppStoreConnectConfig = {
  issuerId?: string;
  keyId: string;
  privateKey: string;
};

const ISSUER_ID = /^[A-Za-z0-9-]{2,64}$/;
const KEY_ID = /^[A-Za-z0-9]{2,64}$/;

export function configPath(home: string): string {
  return path.join(home, "config", "app-store-connect.json");
}

export function parseConfig(
  issuerId: string | undefined,
  keyId: string,
  privateKey: string,
): AppStoreConnectConfig {
  const normalizedIssuerId = issuerId?.trim();
  if ((normalizedIssuerId !== undefined && normalizedIssuerId !== "" && !ISSUER_ID.test(normalizedIssuerId))
    || !KEY_ID.test(keyId)
    || !privateKey.includes("BEGIN PRIVATE KEY")
    || Buffer.byteLength(privateKey) > 65_536) {
    throw new Error("invalid App Store Connect configuration");
  }
  try {
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== "ec") throw new Error("not an EC key");
  } catch {
    throw new Error("invalid App Store Connect configuration");
  }
  return {
    ...(normalizedIssuerId ? { issuerId: normalizedIssuerId } : {}),
    keyId,
    privateKey,
  };
}

export async function readConfig(home: string): Promise<AppStoreConnectConfig> {
  const value = JSON.parse(await fs.readFile(configPath(home), "utf8")) as Partial<AppStoreConnectConfig>;
  if ((value.issuerId !== undefined && typeof value.issuerId !== "string")
    || typeof value.keyId !== "string" || typeof value.privateKey !== "string") {
    throw new Error("invalid App Store Connect configuration");
  }
  return parseConfig(value.issuerId, value.keyId, value.privateKey);
}
