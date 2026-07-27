import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AppStoreConnectClient } from "./client.js";
import { readConfig } from "./config.js";

const home = process.env.PEON_ARMORY_HOME;
if (!home) throw new Error("PEON_ARMORY_HOME is required");
const api = new AppStoreConnectClient(await readConfig(home));
const server = new McpServer({ name: "armory-app-store-connect", version: "0.1.1" });

const resourceId = z.string().regex(/^[A-Za-z0-9.-]{1,128}$/);
const appId = resourceId.describe("Opaque App Store Connect app resource ID returned by list_apps");
const limit = z.number().int().min(1).max(200).default(50);
const confirmation = z.literal("CONFIRM_TESTFLIGHT_CHANGE")
  .describe("Exact confirmation required because this changes TestFlight build access");
const output = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});
const apiPath = z.string().max(1004)
  .regex(/^\/v1\/(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$))(?:[A-Za-z0-9._~-]+\/?)+$/)
  .describe("App Store Connect REST path beginning with /v1/; put query parameters in query");
const queryValue = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(1000)).max(200),
]);
const query = z.record(z.string().min(1).max(200), queryValue).optional();
const jsonValue = z.json();

function withQuery(path: string, values?: Record<string, string | number | boolean | string[]>): string {
  if (!values) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const rendered = params.toString();
  return rendered ? `${path}?${rendered}` : path;
}

server.registerTool("list_apps", {
  description: "List apps available to the configured App Store Connect API key.",
  inputSchema: {
    limit,
    bundleId: z.string().min(3).max(255).optional().describe("Optional exact bundle ID filter"),
  },
}, async ({ limit, bundleId }) => output(await api.listApps(limit, bundleId)));

server.registerTool("list_builds", {
  description: "List uploaded and processed builds for an app, including processing and expiration state.",
  inputSchema: { appId, limit },
}, async ({ appId, limit }) => output(await api.listBuilds(appId, limit)));

server.registerTool("list_app_store_versions", {
  description: "List App Store versions for an app across platforms and inspect their submission state.",
  inputSchema: { appId, limit },
}, async ({ appId, limit }) => output(await api.listAppStoreVersions(appId, limit)));

server.registerTool("list_beta_groups", {
  description: "List TestFlight beta groups for an app and inspect their access settings.",
  inputSchema: { appId, limit },
}, async ({ appId, limit }) => output(await api.listBetaGroups(appId, limit)));

server.registerTool("add_builds_to_beta_group", {
  description: "Give a TestFlight beta group access to existing builds. This affects testers and requires explicit confirmation.",
  inputSchema: {
    betaGroupId: resourceId,
    buildIds: z.array(resourceId).min(1).max(100),
    confirmation,
  },
}, async ({ betaGroupId, buildIds }) => output(await api.addBuildsToBetaGroup(betaGroupId, [...new Set(buildIds)])));

server.registerTool("api_get", {
  description: "Call any read-only App Store Connect API v1 endpoint. Use this for TestFlight, metadata, review, release, IAP, subscriptions, analytics, and newly added Apple resources.",
  inputSchema: { path: apiPath, query },
}, async ({ path, query }) => output(await api.request(withQuery(path, query))));

server.registerTool("api_mutate", {
  description: "Call any state-changing App Store Connect API v1 endpoint. This can affect testers, metadata, submissions, releases, pricing, IAP, and subscriptions, so exact confirmation is mandatory.",
  inputSchema: {
    method: z.enum(["POST", "PATCH", "DELETE"]),
    path: apiPath,
    query,
    body: jsonValue.optional(),
    confirmation: z.literal("CONFIRM_APP_STORE_CONNECT_CHANGE"),
  },
}, async ({ method, path, query, body }) => output(await api.request(withQuery(path, query), {
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})));

await server.connect(new StdioServerTransport());
