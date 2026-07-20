import { createSign } from "node:crypto";
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

  packageName(value?: string): string { return value || this.config.packageName; }

  async listReleases(packageName: string, track: string): Promise<{ releases?: unknown[] }> {
    return this.request(`/applications/${encodeURIComponent(packageName)}/tracks/${encodeURIComponent(track)}/releases`);
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
