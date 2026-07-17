import { GoogleAuth, type AuthClient } from "google-auth-library";
import type { GoogleAnalyticsConfig } from "./config.js";

const SCOPES = [
  "https://www.googleapis.com/auth/analytics",
  "https://www.googleapis.com/auth/analytics.edit",
  "https://www.googleapis.com/auth/analytics.manage.users",
  "https://www.googleapis.com/auth/analytics.manage.users.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
];

const DEFAULT_BASES = {
  admin: "https://analyticsadmin.googleapis.com",
  data: "https://analyticsdata.googleapis.com",
  legacy: "https://www.googleapis.com/analytics/v3",
} as const;

export class GoogleAnalyticsApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly providerStatus: string | undefined,
    readonly providerReasons: string[],
    detail: string,
  ) {
    super(`Google Analytics API request failed (HTTP ${httpStatus}): ${detail}`);
    this.name = "GoogleAnalyticsApiError";
  }
}

function providerError(value: unknown): { status?: string; reasons: string[] } {
  if (!value || typeof value !== "object" || !("error" in value)) return { reasons: [] };
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return { reasons: [] };
  const record = error as Record<string, unknown>;
  const reasons = new Set<string>();
  for (const candidate of [record.errors, record.details]) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      if (!item || typeof item !== "object") continue;
      const reason = (item as Record<string, unknown>).reason;
      if (typeof reason === "string") reasons.add(reason);
    }
  }
  return {
    status: typeof record.status === "string" ? record.status : undefined,
    reasons: [...reasons],
  };
}

function serviceBase(service: keyof typeof DEFAULT_BASES): string {
  const testBase = process.env.NODE_ENV === "test" ? process.env.GOOGLE_ANALYTICS_TEST_API_URL : undefined;
  return (testBase || DEFAULT_BASES[service]).replace(/\/$/, "");
}

function safePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized.includes("..") || normalized.includes("\\") || normalized.includes("://")) {
    throw new Error("API path must be a relative Google Analytics REST path");
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

export class GoogleAnalyticsClient {
  private authClient?: Promise<AuthClient>;

  constructor(readonly config: GoogleAnalyticsConfig) {}

  private async headers(url: string): Promise<Record<string, string>> {
    const testToken = process.env.NODE_ENV === "test" ? process.env.GOOGLE_ANALYTICS_TEST_ACCESS_TOKEN : undefined;
    if (testToken) return { authorization: `Bearer ${testToken}` };
    this.authClient ??= new GoogleAuth({ credentials: this.config.credential, scopes: SCOPES }).getClient();
    const headers = await (await this.authClient).getRequestHeaders(url);
    return Object.fromEntries(headers.entries());
  }

  async request(
    service: keyof typeof DEFAULT_BASES,
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | Array<string | number | boolean>>,
  ): Promise<unknown> {
    const url = `${serviceBase(service)}${safePath(path)}${queryString(query)}`;
    const response = await fetch(url, {
      method,
      headers: { ...(await this.headers(url)), accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await response.text();
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error("Google Analytics response exceeded 2 MiB; paginate or narrow the request");
    let value: unknown;
    try { value = text ? JSON.parse(text) : {}; } catch { value = { message: text.slice(0, 1000) }; }
    if (!response.ok) {
      const provider = providerError(value);
      const detail = typeof value === "object" && value && "error" in value
        ? JSON.stringify((value as { error: unknown }).error).slice(0, 2000)
        : `HTTP ${response.status}`;
      throw new GoogleAnalyticsApiError(response.status, provider.status, provider.reasons, detail);
    }
    return value;
  }

  async sendMeasurement(events: unknown, validationOnly: boolean): Promise<unknown> {
    const { measurementId, measurementApiSecret, measurementRegion } = this.config;
    if (!measurementId || !measurementApiSecret) throw new Error("Measurement Protocol credentials are not configured");
    const firebase = !measurementId.startsWith("G-");
    const host = measurementRegion === "eu" ? "region1.google-analytics.com" : "www.google-analytics.com";
    const testBase = process.env.NODE_ENV === "test" ? process.env.GOOGLE_ANALYTICS_TEST_MEASUREMENT_URL : undefined;
    const endpoint = validationOnly ? "/debug/mp/collect" : "/mp/collect";
    const params = new URLSearchParams(firebase
      ? { firebase_app_id: measurementId, api_secret: measurementApiSecret }
      : { measurement_id: measurementId, api_secret: measurementApiSecret });
    const url = `${testBase?.replace(/\/$/, "") || `https://${host}`}${endpoint}?${params}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(events),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Measurement Protocol request failed (HTTP ${response.status})`);
    return text ? JSON.parse(text) : { accepted: true };
  }
}
