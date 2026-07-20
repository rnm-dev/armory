import { createSign } from "node:crypto";
import type { ServiceAccountCredentials } from "./config.js";

const WEBMASTERS_SCOPE = "https://www.googleapis.com/auth/webmasters";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_WEBMASTERS_URL = "https://www.googleapis.com/webmasters/v3";
const DEFAULT_INSPECTION_URL = "https://searchconsole.googleapis.com/v1";

function tokenUrl(): string {
  return process.env.NODE_ENV === "test" && process.env.GOOGLE_SEARCH_CONSOLE_TEST_TOKEN_URL
    ? process.env.GOOGLE_SEARCH_CONSOLE_TEST_TOKEN_URL
    : TOKEN_URL;
}

function endpoint(name: "WEBMASTERS" | "INSPECTION", fallback: string): string {
  const override = process.env.NODE_ENV === "test" ? process.env[`GOOGLE_SEARCH_CONSOLE_TEST_${name}_URL`] : undefined;
  return (override || fallback).replace(/\/$/, "");
}

export class SearchConsoleClient {
  private token?: { value: string; expiresAt: number };

  constructor(private readonly credentials: ServiceAccountCredentials) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const now = Math.floor(Date.now() / 1000);
    const audience = tokenUrl();
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT", ...(this.credentials.private_key_id ? { kid: this.credentials.private_key_id } : {}) })}.${encode({
      iss: this.credentials.client_email,
      scope: WEBMASTERS_SCOPE,
      aud: audience,
      iat: now,
      exp: now + 3600,
    })}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    const assertion = `${unsigned}.${signer.sign(this.credentials.private_key, "base64url")}`;
    const response = await fetch(audience, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => undefined) as { access_token?: string; expires_in?: number } | undefined;
    if (!response.ok || typeof body?.access_token !== "string") {
      throw new Error(`Google authentication failed (HTTP ${response.status})`);
    }
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(1, body.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  async request<T>(
    service: "webmasters" | "inspection",
    path: string,
    init: RequestInit = {},
    allowEmptyResponse = false,
  ): Promise<T> {
    const base = service === "webmasters"
      ? endpoint("WEBMASTERS", DEFAULT_WEBMASTERS_URL)
      : endpoint("INSPECTION", DEFAULT_INSPECTION_URL);
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        "content-type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(30_000),
    });
    const responseText = await response.text();
    let body: T | { error?: { message?: string } } | undefined;
    if (responseText) {
      try {
        body = JSON.parse(responseText) as T | { error?: { message?: string } };
      } catch {
        body = undefined;
      }
    }
    if (!response.ok) {
      const detail = body && typeof body === "object" && "error" in body ? body.error?.message : undefined;
      throw new Error(`Google Search Console API request failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
    }
    // Google returns an empty body for successful write operations.
    if (!responseText && allowEmptyResponse) return undefined as T;
    if (body === undefined) throw new Error("Google Search Console API returned an invalid response");
    return body as T;
  }
}
