import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GoogleAnalyticsClient } from "./client.js";
import { readConfig } from "./config.js";

const home = process.env.PEON_ARMORY_HOME;
if (!home) throw new Error("PEON_ARMORY_HOME is required");
const config = await readConfig(home);
const api = new GoogleAnalyticsClient(config);
const server = new McpServer({ name: "armory-google-analytics", version: "0.1.1" });

const propertyId = z.string().regex(/^[0-9]{1,32}$/).optional()
  .describe("Numeric GA4 property ID; uses the configured default when omitted");
const method = z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]);
const apiPath = z.string().min(1).max(4096)
  .describe("Relative REST path beginning with /v1alpha/ or /v1beta/");
const query = z.record(z.string(), z.union([
  z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()])).max(100),
])).optional().describe("URL query parameters; arrays emit repeated parameters");
const body = z.record(z.string(), z.unknown()).optional().describe("JSON request body");
const confirm = z.literal(true).describe("Must be true to confirm this mutating or destructive operation");

function output(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function property(value: string | undefined): string {
  const resolved = value || config.defaultPropertyId;
  if (!resolved) throw new Error("propertyId is required because no default property is configured");
  return resolved;
}

function versionedPath(value: string): string {
  const normalized = value.startsWith("/") ? value : `/${value}`;
  if (!/^\/v1(?:alpha|beta)\//.test(normalized)) throw new Error("path must begin with /v1alpha/ or /v1beta/");
  return normalized;
}

server.registerTool("list_account_summaries", {
  description: "List Google Analytics accounts and property summaries accessible to the configured identity.",
  inputSchema: {
    pageSize: z.number().int().min(1).max(200).default(50),
    pageToken: z.string().max(2048).optional(),
  },
}, async ({ pageSize, pageToken }) => output(await api.request(
  "admin", "GET", "/v1beta/accountSummaries", undefined, { pageSize, ...(pageToken ? { pageToken } : {}) },
)));

server.registerTool("run_report", {
  description: "Run a GA4 core report. Supports dimensions, metrics, date ranges, filters, cohorts, comparisons, ordering, pagination, and quota details accepted by Data API v1beta.",
  inputSchema: { propertyId, request: z.record(z.string(), z.unknown()) },
}, async ({ propertyId: id, request }) => output(await api.request(
  "data", "POST", `/v1beta/properties/${property(id)}:runReport`, request,
)));

server.registerTool("run_realtime_report", {
  description: "Run a GA4 realtime report using the complete Data API v1beta request body.",
  inputSchema: { propertyId, request: z.record(z.string(), z.unknown()) },
}, async ({ propertyId: id, request }) => output(await api.request(
  "data", "POST", `/v1beta/properties/${property(id)}:runRealtimeReport`, request,
)));

server.registerTool("run_funnel_report", {
  description: "Run a GA4 funnel report using the complete Data API v1beta request body.",
  inputSchema: { propertyId, request: z.record(z.string(), z.unknown()) },
}, async ({ propertyId: id, request }) => output(await api.request(
  "data", "POST", `/v1beta/properties/${property(id)}:runFunnelReport`, request,
)));

server.registerTool("get_metadata", {
  description: "Get the dimensions and metrics available for a GA4 property, including its custom definitions.",
  inputSchema: { propertyId },
}, async ({ propertyId: id }) => output(await api.request(
  "data", "GET", `/v1beta/properties/${property(id)}/metadata`,
)));

server.registerTool("data_api_request", {
  description: "Call any Google Analytics Data API v1alpha or v1beta REST method. This covers batch and pivot reports, compatibility checks, audience exports, recurring audience lists, and future resources not wrapped by convenience tools. Use exact paths from Google's REST reference.",
  inputSchema: { method, path: apiPath, query, body, confirm: z.boolean().optional() },
}, async ({ method: verb, path, query, body, confirm: confirmed }) => {
  if (verb === "DELETE" && confirmed !== true) throw new Error("confirm must be true for DELETE requests");
  return output(await api.request("data", verb, versionedPath(path), body, query));
});

server.registerTool("admin_api_request", {
  description: "Call any Google Analytics Admin API v1alpha or v1beta REST method. This provides full account, property, access, stream, event, audience, attribution, retention, integration-link, annotation, subproperty, rollup, and other configuration coverage. Non-GET requests require confirmation.",
  inputSchema: { method, path: apiPath, query, body, confirm: z.boolean().optional() },
}, async ({ method: verb, path, query, body, confirm: confirmed }) => {
  if (verb !== "GET" && confirmed !== true) throw new Error("confirm must be true for mutating Admin API requests");
  return output(await api.request("admin", verb, versionedPath(path), body, query));
});

server.registerTool("submit_user_deletion", {
  description: "Submit a GA4 user-data deletion request through the Admin API for a property. This privacy-sensitive operation requires explicit confirmation.",
  inputSchema: {
    propertyId,
    user: z.object({ userId: z.string().min(1).max(256), type: z.string().min(1).max(128) }).passthrough(),
    confirm,
  },
}, async ({ propertyId: id, user }) => output(await api.request(
  "admin", "POST", `/v1alpha/properties/${property(id)}:submitUserDeletion`, { user },
)));

server.registerTool("legacy_user_deletion", {
  description: "Submit a legacy Google Analytics User Deletion API v3 upsert request. Prefer submit_user_deletion for GA4. Requires explicit confirmation.",
  inputSchema: { request: z.record(z.string(), z.unknown()), confirm },
}, async ({ request }) => output(await api.request(
  "legacy", "POST", "/userDeletion/userDeletionRequests:upsert", request,
)));

const measurementPayload = z.object({
  client_id: z.string().min(1).max(256).optional(),
  app_instance_id: z.string().min(1).max(256).optional(),
  user_id: z.string().max(256).optional(),
  timestamp_micros: z.union([z.string(), z.number().int()]).optional(),
  user_properties: z.record(z.string(), z.unknown()).optional(),
  consent: z.record(z.string(), z.unknown()).optional(),
  events: z.array(z.object({ name: z.string().min(1).max(40), params: z.record(z.string(), z.unknown()).optional() })).min(1).max(25),
}).passthrough().refine((value) => value.client_id || value.app_instance_id, {
  message: "client_id or app_instance_id is required",
});

server.registerTool("validate_measurement_events", {
  description: "Validate a GA4 Measurement Protocol payload without collecting its events.",
  inputSchema: { payload: measurementPayload },
}, async ({ payload }) => output(await api.sendMeasurement(payload, true)));

server.registerTool("send_measurement_events", {
  description: "Send up to 25 server-side or offline events through GA4 Measurement Protocol using the configured stream secret. This writes analytics data and requires explicit confirmation.",
  inputSchema: { payload: measurementPayload, confirm },
}, async ({ payload }) => output(await api.sendMeasurement(payload, false)));

await server.connect(new StdioServerTransport());
