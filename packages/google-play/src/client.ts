import { createSign } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import type { GooglePlayConfig } from "./config.js";

const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_URL = "https://androidpublisher.googleapis.com/androidpublisher/v3";

export type LocalizedText = { language: string; text: string };
export type Release = {
  name?: string;
  versionCodes?: string[];
  releaseNotes?: LocalizedText[];
  status?: "draft" | "inProgress" | "halted" | "completed";
  userFraction?: number;
  countryTargeting?: { countries?: string[]; includeRestOfWorld?: boolean };
  inAppUpdatePriority?: number;
};
export type Track = { track?: string; releases?: Release[] };
export type Listing = { language?: string; title?: string; shortDescription?: string; fullDescription?: string; video?: string };
export type Image = { id?: string; url?: string; sha1?: string; sha256?: string; aiGeneratedState?: string };

function endpoint(kind: "TOKEN" | "API", fallback: string): string {
  const override = process.env.NODE_ENV === "test" ? process.env[`GOOGLE_PLAY_TEST_${kind}_URL`] : undefined;
  return (override || fallback).replace(/\/$/, "");
}

export class GooglePlayClient {
  private token?: { value: string; expiresAt: number };

  constructor(private readonly config: GooglePlayConfig) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const audience = endpoint("TOKEN", TOKEN_URL);
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT", ...(this.config.private_key_id ? { kid: this.config.private_key_id } : {}) })}.${encode({
      iss: this.config.client_email, scope: SCOPE, aud: audience, iat: now, exp: now + 3600,
    })}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    const assertion = `${unsigned}.${signer.sign(this.config.private_key, "base64url")}`;
    const response = await fetch(audience, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => undefined) as { access_token?: string; expires_in?: number } | undefined;
    if (!response.ok || typeof body?.access_token !== "string") throw new Error(`Google authentication failed (HTTP ${response.status})`);
    this.token = { value: body.access_token, expiresAt: Date.now() + Math.max(1, body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${endpoint("API", API_URL)}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${await this.accessToken()}`, "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 204) return undefined as T;
    const body = await response.json().catch(() => undefined) as T | { error?: { message?: string } } | undefined;
    if (!response.ok) {
      const detail = body && typeof body === "object" && "error" in body ? body.error?.message : undefined;
      throw new Error(`Google Play API request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 1000)}` : ""}`);
    }
    if (body === undefined) throw new Error("Google Play API returned an invalid response");
    return body as T;
  }

  private async upload<T>(path: string, contentType: string, bytes: Uint8Array): Promise<T> {
    const api = endpoint("API", API_URL);
    const uploadApi = api.replace(/\/androidpublisher\/v3$/, "/upload/androidpublisher/v3");
    const response = await fetch(`${uploadApi}${path}${path.includes("?") ? "&" : "?"}uploadType=media`, {
      method: "POST",
      headers: { authorization: `Bearer ${await this.accessToken()}`, "content-type": contentType },
      body: bytes,
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => undefined) as T | { error?: { message?: string } } | undefined;
    if (!response.ok) {
      const detail = body && typeof body === "object" && "error" in body ? body.error?.message : undefined;
      throw new Error(`Google Play API request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 1000)}` : ""}`);
    }
    if (body === undefined) throw new Error("Google Play API returned an invalid response");
    return body as T;
  }

  private async uploadFile<T>(path: string, contentType: string, filePath: string): Promise<T> {
    const api = endpoint("API", API_URL);
    const uploadApi = api.replace(/\/androidpublisher\/v3$/, "/upload/androidpublisher/v3");
    const details = await fs.stat(filePath);
    const response = await fetch(`${uploadApi}${path}${path.includes("?") ? "&" : "?"}uploadType=media`, {
      method: "POST",
      headers: { authorization: `Bearer ${await this.accessToken()}`, "content-type": contentType, "content-length": String(details.size) },
      body: createReadStream(filePath) as unknown as BodyInit,
      duplex: "half",
      signal: AbortSignal.timeout(15 * 60_000),
    } as RequestInit & { duplex: "half" });
    const body = await response.json().catch(() => undefined) as T | { error?: { message?: string } } | undefined;
    if (!response.ok) {
      const detail = body && typeof body === "object" && "error" in body ? body.error?.message : undefined;
      throw new Error(`Google Play API request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 1000)}` : ""}`);
    }
    if (body === undefined) throw new Error("Google Play API returned an invalid response");
    return body as T;
  }

  async verifyCredentials(): Promise<void> {
    await this.accessToken();
  }

  async listReleases(packageName: string, track: string): Promise<{ releases?: Release[] }> {
    const editId = await this.createEdit(packageName);
    try {
      const result = await this.request<Track>(`${this.editPath(packageName, editId)}/tracks/${encodeURIComponent(track)}`);
      return { releases: result.releases };
    } finally {
      await this.deleteEdit(packageName, editId);
    }
  }

  private async createEdit(packageName: string): Promise<string> {
    const edit = await this.request<{ id?: string }>(`/applications/${encodeURIComponent(packageName)}/edits`, { method: "POST", body: "{}" });
    if (!edit.id) throw new Error("Google Play API did not return an edit ID");
    return edit.id;
  }

  private editPath(packageName: string, editId: string): string {
    return `/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}`;
  }

  private async deleteEdit(packageName: string, editId: string): Promise<void> {
    await this.request<void>(this.editPath(packageName, editId), { method: "DELETE" });
  }

  async listTracks(packageName: string): Promise<{ tracks?: Track[] }> {
    const editId = await this.createEdit(packageName);
    try {
      return await this.request(`${this.editPath(packageName, editId)}/tracks`);
    } finally {
      await this.deleteEdit(packageName, editId);
    }
  }

  async listListings(packageName: string): Promise<{ listings?: Listing[] }> {
    const editId = await this.createEdit(packageName);
    try {
      return await this.request(`${this.editPath(packageName, editId)}/listings`);
    } finally {
      await this.deleteEdit(packageName, editId);
    }
  }

  async updateListing(packageName: string, language: string, listing: Listing): Promise<unknown> {
    return await this.committedEdit(packageName, async (editId) => {
      const path = `${this.editPath(packageName, editId)}/listings/${encodeURIComponent(language)}`;
      return await this.request<Listing>(path, { method: "PATCH", body: JSON.stringify(listing) });
    });
  }

  async listImages(packageName: string, language: string, imageType: string): Promise<{ images?: Image[] }> {
    const editId = await this.createEdit(packageName);
    try {
      return await this.request(`${this.editPath(packageName, editId)}/listings/${encodeURIComponent(language)}/${encodeURIComponent(imageType)}`);
    } finally {
      await this.deleteEdit(packageName, editId);
    }
  }

  async uploadImage(packageName: string, language: string, imageType: string, contentType: string, bytes: Uint8Array,
    aiGeneratedState?: string): Promise<unknown> {
    return await this.committedEdit(packageName, async (editId) => {
      const query = aiGeneratedState ? `?aiGeneratedState=${encodeURIComponent(aiGeneratedState)}` : "";
      return await this.upload(`${this.editPath(packageName, editId)}/listings/${encodeURIComponent(language)}/${encodeURIComponent(imageType)}${query}`, contentType, bytes);
    });
  }

  async uploadBundle(packageName: string, filePath: string, deviceTierConfigId?: string): Promise<unknown> {
    return await this.committedEdit(packageName, async (editId) => {
      const query = deviceTierConfigId ? `?deviceTierConfigId=${encodeURIComponent(deviceTierConfigId)}` : "";
      return await this.uploadFile(`${this.editPath(packageName, editId)}/bundles${query}`, "application/octet-stream", filePath);
    });
  }

  async deleteImage(packageName: string, language: string, imageType: string, imageId: string): Promise<unknown> {
    return await this.committedEdit(packageName, async (editId) => {
      const path = `${this.editPath(packageName, editId)}/listings/${encodeURIComponent(language)}/${encodeURIComponent(imageType)}/${encodeURIComponent(imageId)}`;
      await this.request<void>(path, { method: "DELETE" });
      return { deleted: true, imageId };
    });
  }

  async updateDataSafety(packageName: string, safetyLabels: string): Promise<unknown> {
    return await this.request(`/applications/${encodeURIComponent(packageName)}/dataSafety`, {
      method: "POST", body: JSON.stringify({ safetyLabels }),
    });
  }

  async convertRegionPrices(packageName: string, price: { currencyCode: string; units: string; nanos?: number },
    productTaxCategoryCode?: string): Promise<unknown> {
    return await this.request(`/applications/${encodeURIComponent(packageName)}/pricing:convertRegionPrices`, {
      method: "POST", body: JSON.stringify({ price, ...(productTaxCategoryCode ? { productTaxCategoryCode } : {}) }),
    });
  }

  private async committedEdit(packageName: string, mutate: (editId: string) => Promise<unknown>): Promise<unknown> {
    const editId = await this.createEdit(packageName);
    let committed = false;
    try {
      const mutation = await mutate(editId);
      await this.request(`${this.editPath(packageName, editId)}:validate`, { method: "POST", body: "{}" });
      const commit = await this.request(`${this.editPath(packageName, editId)}:commit`, { method: "POST", body: "{}" });
      committed = true;
      return { mutation, commit };
    } finally {
      if (!committed) await this.deleteEdit(packageName, editId).catch(() => undefined);
    }
  }

  async updateRelease(packageName: string, trackName: string, versionCode: string,
    change: { status: Release["status"]; userFraction?: number }): Promise<unknown> {
    const editId = await this.createEdit(packageName);
    let committed = false;
    try {
      const trackPath = `${this.editPath(packageName, editId)}/tracks/${encodeURIComponent(trackName)}`;
      const track = await this.request<Track>(trackPath);
      const release = track.releases?.find((item) => item.versionCodes?.includes(versionCode));
      if (!release) throw new Error(`Version code ${versionCode} is not active on track ${trackName}`);
      release.status = change.status;
      if (change.status === "inProgress" || change.status === "halted") release.userFraction = change.userFraction;
      else delete release.userFraction;
      await this.request<Track>(trackPath, { method: "PUT", body: JSON.stringify(track) });
      await this.request(`${this.editPath(packageName, editId)}:validate`, { method: "POST", body: "{}" });
      const result = await this.request(`${this.editPath(packageName, editId)}:commit`, { method: "POST", body: "{}" });
      committed = true;
      return result;
    } finally {
      if (!committed) await this.deleteEdit(packageName, editId).catch(() => undefined);
    }
  }

  async promoteRelease(packageName: string, targetTrack: string, release: Release): Promise<unknown> {
    const editId = await this.createEdit(packageName);
    let committed = false;
    try {
      const trackPath = `${this.editPath(packageName, editId)}/tracks/${encodeURIComponent(targetTrack)}`;
      const track = await this.request<Track>(trackPath);
      const requested = new Set(release.versionCodes);
      if (track.releases?.some((item) => item.versionCodes?.some((code) => requested.has(code)))) {
        throw new Error("One or more version codes are already active on the target track");
      }
      track.track = targetTrack;
      track.releases = [...(track.releases ?? []), release];
      await this.request<Track>(trackPath, { method: "PUT", body: JSON.stringify(track) });
      await this.request(`${this.editPath(packageName, editId)}:validate`, { method: "POST", body: "{}" });
      const result = await this.request(`${this.editPath(packageName, editId)}:commit`, { method: "POST", body: "{}" });
      committed = true;
      return result;
    } finally {
      if (!committed) await this.deleteEdit(packageName, editId).catch(() => undefined);
    }
  }
}
