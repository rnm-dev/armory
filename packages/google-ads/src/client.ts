import { apiUrl, tokenUrl, type GoogleAdsConfig } from "./config.js";

type AccessTokenResponse = { access_token?: string; expires_in?: number };

export type SearchResponse = {
  results?: unknown[];
  fieldMask?: string;
  nextPageToken?: string;
  totalResultsCount?: string;
};

function errorDetail(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message.slice(0, 1000) : undefined;
}

export class GoogleAdsClient {
  private accessToken?: string;
  private accessTokenExpiresAt = 0;

  constructor(private readonly config: GoogleAdsConfig) {}

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) return this.accessToken;
    const response = await fetch(tokenUrl(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => undefined) as AccessTokenResponse | undefined;
    if (!response.ok || typeof payload?.access_token !== "string") {
      throw new Error(`Google OAuth token refresh failed (HTTP ${response.status})`);
    }
    this.accessToken = payload.access_token;
    this.accessTokenExpiresAt = Date.now() + Math.max(1, payload.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  private async send<T>(path: string, init: RequestInit, includeLoginCustomer: boolean, retry: boolean): Promise<T> {
    const accessToken = await this.getAccessToken();
    const response = await fetch(`${apiUrl()}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "developer-token": this.config.developerToken,
        "content-type": "application/json",
        ...(includeLoginCustomer && this.config.loginCustomerId
          ? { "login-customer-id": this.config.loginCustomerId }
          : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => undefined) as T | undefined;
    if (response.status === 401 && retry) {
      this.accessToken = undefined;
      return this.send(path, init, includeLoginCustomer, false);
    }
    if (!response.ok || payload === undefined) {
      const detail = errorDetail(payload);
      const requestId = response.headers.get("request-id");
      throw new Error(
        `Google Ads API request failed (HTTP ${response.status})`
        + (detail ? `: ${detail}` : "")
        + (requestId ? ` [request ${requestId}]` : ""),
      );
    }
    return payload;
  }

  async listAccessibleCustomers(): Promise<{ resourceNames?: string[] }> {
    return this.send("/customers:listAccessibleCustomers", { method: "GET" }, false, true);
  }

  async search(customerId: string, query: string): Promise<SearchResponse> {
    return this.send(
      `/customers/${encodeURIComponent(customerId)}/googleAds:search`,
      { method: "POST", body: JSON.stringify({ query }) },
      true,
      true,
    );
  }
}
