import { GoogleAnalyticsApiError, GoogleAnalyticsClient } from "../client.js";
import { readConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

type VerificationStep = "accounts" | "property";

function failure(error: unknown, step: VerificationStep): { message: string; errorCode: string } {
  if (error instanceof GoogleAnalyticsApiError) {
    const reasons = new Set(error.providerReasons.map((reason) => reason.toUpperCase()));
    if (reasons.has("SERVICE_DISABLED")) {
      const service = step === "accounts" ? "Google Analytics Admin API" : "Google Analytics Data API";
      const api = step === "accounts" ? "analyticsadmin.googleapis.com" : "analyticsdata.googleapis.com";
      return { errorCode: "GOOGLE_API_DISABLED", message: `${service} is disabled. Enable ${api} in the credential's Google Cloud project, then retry.` };
    }
    if (error.httpStatus === 401) {
      return { errorCode: "GOOGLE_CREDENTIAL_REJECTED", message: "Google rejected the credential. Create a new service-account JSON key or refresh the authorized-user credential, then retry." };
    }
    if (error.httpStatus === 403 && step === "accounts") {
      return { errorCode: "ANALYTICS_ACCESS_DENIED", message: "The credential is valid but has no Google Analytics access. Add its client_email under Admin > Account or Property access management, then retry." };
    }
    if (error.httpStatus === 403 && step === "property") {
      return { errorCode: "PROPERTY_ACCESS_DENIED", message: "The credential cannot access the configured GA4 property. Confirm the Property ID and add its client_email under Admin > Property access management." };
    }
    if (error.httpStatus === 404 && step === "property") {
      return { errorCode: "PROPERTY_NOT_FOUND", message: "The configured GA4 Property ID was not found. Copy the numeric Property ID from Admin > Property settings and confirm the credential can access it." };
    }
    if (error.httpStatus === 429) {
      return { errorCode: "GOOGLE_API_RATE_LIMITED", message: "Google Analytics temporarily rate-limited verification. Wait briefly, then retry." };
    }
    if (error.httpStatus >= 500) {
      return { errorCode: "GOOGLE_API_UNAVAILABLE", message: "Google Analytics is temporarily unavailable. Retry later." };
    }
  }
  const text = error instanceof Error ? error.message : "";
  if (/invalid_grant|invalid jwt|unauthorized_client/i.test(text)) {
    return { errorCode: "GOOGLE_CREDENTIAL_REJECTED", message: "Google rejected the credential. Create a new service-account JSON key or refresh the authorized-user credential, then retry." };
  }
  return { errorCode: "VERIFICATION_FAILED", message: "Google Analytics verification failed. Check the credential, enabled APIs, Analytics access, and optional GA4 Property ID, then retry." };
}

try {
  const input = await readInput();
  if (input.operation !== "verify") throw new Error("invalid verify input");
  const config = await readConfig(input.package.home);
  const client = new GoogleAnalyticsClient(config);
  try {
    await client.request("admin", "GET", "/v1beta/accountSummaries", undefined, { pageSize: 1 });
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error("account verification failed"), { verificationStep: "accounts" as const });
  }
  if (config.defaultPropertyId) {
    try {
      await client.request("data", "GET", `/v1beta/properties/${config.defaultPropertyId}/metadata`);
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error("property verification failed"), { verificationStep: "property" as const });
    }
  }
  result({ ok: true, message: "Google Analytics connection verified" });
} catch (error) {
  const step = error && typeof error === "object" && "verificationStep" in error && error.verificationStep === "property" ? "property" : "accounts";
  result({ ok: false, ...failure(error, step) });
  process.exitCode = 1;
}
