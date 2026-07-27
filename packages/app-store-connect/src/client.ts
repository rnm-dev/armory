import { createSign } from "node:crypto";
import type { AppStoreConnectConfig } from "./config.js";

const API_URL = "https://api.appstoreconnect.apple.com";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class AppStoreConnectApiError extends Error {
  constructor(readonly httpStatus: number, readonly apiCodes: string[] = []) {
    const codes = apiCodes.length ? `: ${apiCodes.join(", ")}` : "";
    super(`App Store Connect API request failed (HTTP ${httpStatus}${codes})`);
    this.name = "AppStoreConnectApiError";
  }
}

function apiBase(): string {
  const override = process.env.NODE_ENV === "test" ? process.env.APP_STORE_CONNECT_TEST_API_URL : undefined;
  return (override || API_URL).replace(/\/$/, "");
}

function queryString(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const rendered = params.toString();
  return rendered ? `?${rendered}` : "";
}

export class AppStoreConnectClient {
  private token?: { value: string; expiresAt: number };

  constructor(readonly config: AppStoreConnectConfig) {}

  private authorizationToken(): string {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 20 * 60;
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "ES256", kid: this.config.keyId, typ: "JWT" })}.${encode({
      ...(this.config.issuerId ? { iss: this.config.issuerId } : { sub: "user" }),
      iat: now,
      exp: expiresAt,
      aud: "appstoreconnect-v1",
    })}`;
    const signer = createSign("SHA256");
    signer.update(unsigned);
    const signature = signer.sign({ key: this.config.privateKey, dsaEncoding: "ieee-p1363" }, "base64url");
    const value = `${unsigned}.${signature}`;
    this.token = { value, expiresAt: expiresAt * 1000 };
    return value;
  }

  async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.authorizationToken()}`,
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new Error("App Store Connect response exceeded 2 MiB; reduce the result limit");
    }
    if (!response.ok) {
      let apiCodes: string[] = [];
      try {
        const payload = JSON.parse(text) as { errors?: Array<{ code?: unknown }> };
        apiCodes = [...new Set((payload.errors || [])
          .map((error) => typeof error.code === "string" ? error.code : "")
          .filter(Boolean))].slice(0, 5);
      } catch {
        // Apple occasionally returns a non-JSON gateway response. Never echo it.
      }
      throw new AppStoreConnectApiError(response.status, apiCodes);
    }
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("App Store Connect API returned an invalid response");
    }
  }

  async listApps(limit: number, bundleId?: string): Promise<unknown> {
    return this.request(`/v1/apps${queryString({
      limit,
      "filter[bundleId]": bundleId,
      "fields[apps]": "name,bundleId,sku,primaryLocale",
    })}`);
  }

  async listBuilds(appId: string, limit: number): Promise<unknown> {
    return this.request(`/v1/apps/${encodeURIComponent(appId)}/builds${queryString({
      limit,
      "fields[builds]": "version,uploadedDate,expirationDate,expired,minOsVersion,processingState,usesNonExemptEncryption",
    })}`);
  }

  async listAppStoreVersions(appId: string, limit: number): Promise<unknown> {
    return this.request(`/v1/apps/${encodeURIComponent(appId)}/appStoreVersions${queryString({
      limit,
      "fields[appStoreVersions]": "platform,versionString,appStoreState,copyright,releaseType,earliestReleaseDate,downloadable,createdDate",
    })}`);
  }

  async listBetaGroups(appId: string, limit: number): Promise<unknown> {
    return this.request(`/v1/apps/${encodeURIComponent(appId)}/betaGroups${queryString({
      limit,
      "fields[betaGroups]": "name,createdDate,isInternalGroup,hasAccessToAllBuilds,publicLinkEnabled,publicLinkLimit,feedbackEnabled",
    })}`);
  }

  async addBuildsToBetaGroup(betaGroupId: string, buildIds: string[]): Promise<unknown> {
    await this.request(`/v1/betaGroups/${encodeURIComponent(betaGroupId)}/relationships/builds`, {
      method: "POST",
      body: JSON.stringify({ data: buildIds.map((id) => ({ type: "builds", id })) }),
    });
    return { added: buildIds.length, betaGroupId, buildIds };
  }
}
