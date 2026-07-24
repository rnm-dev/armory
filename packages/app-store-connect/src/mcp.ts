import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AppStoreConnectClient } from "./client.js";
import { readConfig } from "./config.js";

const home = process.env.PEON_ARMORY_HOME;
if (!home) throw new Error("PEON_ARMORY_HOME is required");
const api = new AppStoreConnectClient(await readConfig(home));
const server = new McpServer({ name: "armory-app-store-connect", version: "0.1.0" });

const resourceId = z.string().regex(/^[A-Za-z0-9.-]{1,128}$/);
const appId = resourceId.optional().describe("App Store Connect app resource ID; defaults to the configured app");
const limit = z.number().int().min(1).max(200).default(50);
const confirmation = z.literal("CONFIRM_TESTFLIGHT_CHANGE")
  .describe("Exact confirmation required because this changes TestFlight build access");
const output = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

server.registerTool("list_apps", {
  description: "List apps available to the configured App Store Connect team API key.",
  inputSchema: {
    limit,
    bundleId: z.string().min(3).max(255).optional().describe("Optional exact bundle ID filter"),
  },
}, async ({ limit, bundleId }) => output(await api.listApps(limit, bundleId)));

server.registerTool("list_builds", {
  description: "List uploaded and processed builds for an app, including processing and expiration state.",
  inputSchema: { appId, limit },
}, async ({ appId, limit }) => output(await api.listBuilds(api.appId(appId), limit)));

server.registerTool("list_app_store_versions", {
  description: "List App Store versions for an app across platforms and inspect their submission state.",
  inputSchema: { appId, limit },
}, async ({ appId, limit }) => output(await api.listAppStoreVersions(api.appId(appId), limit)));

server.registerTool("list_beta_groups", {
  description: "List TestFlight beta groups for an app and inspect their access settings.",
  inputSchema: { appId, limit },
}, async ({ appId, limit }) => output(await api.listBetaGroups(api.appId(appId), limit)));

server.registerTool("add_builds_to_beta_group", {
  description: "Give a TestFlight beta group access to existing builds. This affects testers and requires explicit confirmation.",
  inputSchema: {
    betaGroupId: resourceId,
    buildIds: z.array(resourceId).min(1).max(100),
    confirmation,
  },
}, async ({ betaGroupId, buildIds }) => output(await api.addBuildsToBetaGroup(betaGroupId, [...new Set(buildIds)])));

await server.connect(new StdioServerTransport());
