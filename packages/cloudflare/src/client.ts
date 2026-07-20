import { apiUrl, type CloudflareConfig } from "./config.js";

type ApiEnvelope<T> = {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result: T;
  result_info?: { page?: number; per_page?: number; total_pages?: number; total_count?: number };
};

export type ApiList<T> = {
  result: T[];
  resultInfo?: ApiEnvelope<T[]>["result_info"];
};

export class CloudflareClient {
  constructor(private readonly config: CloudflareConfig) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${apiUrl()}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.config.apiToken}`,
        "content-type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(30_000),
    });
    const envelope = await response.json().catch(() => undefined) as ApiEnvelope<T> | undefined;
    if (!response.ok || !envelope?.success) {
      const detail = envelope?.errors?.map((error) => error.message || `code ${error.code ?? "unknown"}`).join("; ");
      throw new Error(`Cloudflare API request failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
    }
    return envelope.result;
  }

  async list<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const response = await fetch(`${apiUrl()}${path}${separator}page=${page}&per_page=50`, {
        headers: { authorization: `Bearer ${this.config.apiToken}`, "content-type": "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      const envelope = await response.json().catch(() => undefined) as ApiEnvelope<T[]> | undefined;
      if (!response.ok || !envelope?.success) {
        const detail = envelope?.errors?.map((error) => error.message || `code ${error.code ?? "unknown"}`).join("; ");
        throw new Error(`Cloudflare API request failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
      }
      results.push(...envelope.result);
      const resultInfo = envelope.result_info;
      if (resultInfo?.total_pages && page < resultInfo.total_pages) continue;
      if (resultInfo?.total_count !== undefined) {
        const currentPage = resultInfo.page ?? page;
        const perPage = resultInfo.per_page ?? 50;
        if (currentPage * perPage < resultInfo.total_count) continue;
      }
      return results;
    }
    throw new Error("Cloudflare API pagination exceeded 100 pages; narrow the request");
  }
}
