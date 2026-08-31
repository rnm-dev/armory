import { createSign } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import type { ServiceAccountCredentials } from "./config.js";

// Google's IPv6 routes are not consistently reachable from every Peon host.
// Avoid Node's connection-family racing, which can otherwise stall until ETIMEDOUT.
setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);

const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");
const URLS = {
  TOKEN: "https://oauth2.googleapis.com/token", DRIVE: "https://www.googleapis.com/drive/v3",
  DOCS: "https://docs.googleapis.com/v1", SHEETS: "https://sheets.googleapis.com/v4", SLIDES: "https://slides.googleapis.com/v1",
};
type Api = "DRIVE" | "DOCS" | "SHEETS" | "SLIDES";

function endpoint(kind: keyof typeof URLS): string {
  const override = process.env.NODE_ENV === "test" ? process.env[`GOOGLE_WORKSPACE_TEST_${kind}_URL`] : undefined;
  return (override || URLS[kind]).replace(/\/$/, "");
}

export class GoogleWorkspaceClient {
  private token?: { value: string; expiresAt: number };
  constructor(private readonly credentials: ServiceAccountCredentials) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const audience = endpoint("TOKEN");
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT", ...(this.credentials.private_key_id ? { kid: this.credentials.private_key_id } : {}) })}.${encode({
      iss: this.credentials.client_email, scope: SCOPES, aud: audience, iat: now, exp: now + 3600,
    })}`;
    const signer = createSign("RSA-SHA256"); signer.update(unsigned);
    const assertion = `${unsigned}.${signer.sign(this.credentials.private_key, "base64url")}`;
    const response = await fetch(audience, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), signal: AbortSignal.timeout(30_000) });
    const body = await response.json().catch(() => undefined) as { access_token?: string; expires_in?: number } | undefined;
    if (!response.ok || typeof body?.access_token !== "string") throw new Error(`Google authentication failed (HTTP ${response.status})`);
    this.token = { value: body.access_token, expiresAt: Date.now() + Math.max(1, body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  async request<T>(api: Api, path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${endpoint(api)}${path}`, { ...init,
      headers: { authorization: `Bearer ${await this.accessToken()}`, "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(60_000) });
    if (response.status === 204) return undefined as T;
    const body = await response.json().catch(() => undefined) as T | { error?: { message?: string } } | undefined;
    if (!response.ok) {
      const detail = body && typeof body === "object" && "error" in body ? body.error?.message : undefined;
      throw new Error(`Google Workspace API request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 1000)}` : ""}`);
    }
    if (body === undefined) throw new Error("Google Workspace API returned an invalid response");
    return body as T;
  }

  async verifyCredentials(): Promise<void> {
    await this.request("DRIVE", "/files?pageSize=1&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true");
  }
}
