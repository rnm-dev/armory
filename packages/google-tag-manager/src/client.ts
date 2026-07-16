import { GoogleAuth, type AuthClient } from "google-auth-library";
import type { GoogleTagManagerConfig } from "./config.js";

const SCOPES = [
  "https://www.googleapis.com/auth/tagmanager.delete.containers",
  "https://www.googleapis.com/auth/tagmanager.edit.containers",
  "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
  "https://www.googleapis.com/auth/tagmanager.manage.accounts",
  "https://www.googleapis.com/auth/tagmanager.manage.users",
  "https://www.googleapis.com/auth/tagmanager.publish",
  "https://www.googleapis.com/auth/tagmanager.readonly",
];
const DEFAULT_BASE = "https://tagmanager.googleapis.com/tagmanager/v2";

function serviceBase(): string {
  const testBase = process.env.NODE_ENV === "test" ? process.env.GOOGLE_TAG_MANAGER_TEST_API_URL : undefined;
  return (testBase || DEFAULT_BASE).replace(/\/$/, "");
}

function safePath(value: string): string {
  const normalized = value.startsWith("/") ? value : `/${value}`;
  if (normalized !== "/accounts" && !normalized.startsWith("/accounts/")) {
    throw new Error("API path must begin with /accounts");
  }
  if (normalized.includes("..") || normalized.includes("\\") || normalized.includes("://")
    || normalized.includes("?") || normalized.includes("#")) {
    throw new Error("API path must be a relative Tag Manager REST path without a query string");
  }
  return normalized;
}

function queryString(query: Record<string, string | number | boolean | Array<string | number | boolean>> | undefined): string {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query ?? {})) {
    for (const value of Array.isArray(raw) ? raw : [raw]) params.append(key, String(value));
  }
  const rendered = params.toString();
  return rendered ? `?${rendered}` : "";
}

export class GoogleTagManagerClient {
  private authClient?: Promise<AuthClient>;

  constructor(readonly config: GoogleTagManagerConfig) {}

  private async headers(url: string): Promise<Record<string, string>> {
    const testToken = process.env.NODE_ENV === "test" ? process.env.GOOGLE_TAG_MANAGER_TEST_ACCESS_TOKEN : undefined;
    if (testToken) return { authorization: `Bearer ${testToken}` };
    this.authClient ??= new GoogleAuth({ credentials: this.config.credential, scopes: SCOPES }).getClient();
    const headers = await (await this.authClient).getRequestHeaders(url);
    return Object.fromEntries(headers.entries());
  }

  async request(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | Array<string | number | boolean>>,
  ): Promise<unknown> {
    const url = `${serviceBase()}${safePath(path)}${queryString(query)}`;
    const response = await fetch(url, {
      method,
      headers: { ...(await this.headers(url)), accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await response.text();
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error("Google Tag Manager response exceeded 2 MiB; paginate or narrow the request");
    let value: unknown;
    try { value = text ? JSON.parse(text) : {}; } catch { value = { message: text.slice(0, 1000) }; }
    if (!response.ok) {
      const detail = typeof value === "object" && value && "error" in value
        ? JSON.stringify((value as { error: unknown }).error).slice(0, 2000)
        : `HTTP ${response.status}`;
      throw new Error(`Google Tag Manager API request failed (HTTP ${response.status}): ${detail}`);
    }
    return value;
  }
}
