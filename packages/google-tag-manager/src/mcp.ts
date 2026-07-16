import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GoogleTagManagerClient } from "./client.js";
import { readConfig } from "./config.js";

const home = process.env.PEON_ARMORY_HOME;
if (!home) throw new Error("PEON_ARMORY_HOME is required");
const config = await readConfig(home);
const api = new GoogleTagManagerClient(config);
const server = new McpServer({ name: "armory-google-tag-manager", version: "0.1.0" });

const resourceId = z.string().regex(/^[0-9]{1,32}$/);
const accountId = resourceId.optional().describe("Numeric GTM account ID; uses the configured default when omitted");
const containerId = resourceId.optional().describe("Numeric API container ID; uses the configured default when omitted");
const workspaceId = resourceId.optional().describe("Numeric workspace ID; uses the configured default when omitted");
const pageToken = z.string().max(2048).optional();
const method = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const query = z.record(z.string(), z.union([
  z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()])).max(100),
])).optional().describe("URL query parameters; arrays emit repeated parameters");
const body = z.record(z.string(), z.unknown()).optional().describe("JSON request body");
const confirm = z.literal(true).describe("Must be true to confirm this mutating or destructive operation");

function output(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function resolve(value: string | undefined, fallback: string | undefined, label: string): string {
  const resolved = value || fallback;
  if (!resolved) throw new Error(`${label} is required because no default is configured`);
  return resolved;
}

function account(value: string | undefined): string {
  return resolve(value, config.defaultAccountId, "accountId");
}

function container(value: string | undefined): string {
  return resolve(value, config.defaultContainerId, "containerId");
}

function workspace(value: string | undefined): string {
  return resolve(value, config.defaultWorkspaceId, "workspaceId");
}

function containerPath(accountValue: string | undefined, containerValue: string | undefined): string {
  return `/accounts/${account(accountValue)}/containers/${container(containerValue)}`;
}

function workspacePath(accountValue: string | undefined, containerValue: string | undefined, workspaceValue: string | undefined): string {
  return `${containerPath(accountValue, containerValue)}/workspaces/${workspace(workspaceValue)}`;
}

server.registerTool("list_accounts", {
  description: "List Google Tag Manager accounts accessible to the configured identity.",
  inputSchema: { includeGoogleTags: z.boolean().default(false), pageToken },
}, async ({ includeGoogleTags, pageToken }) => output(await api.request(
  "GET", "/accounts", undefined, { includeGoogleTags, ...(pageToken ? { pageToken } : {}) },
)));

server.registerTool("list_containers", {
  description: "List containers in a Google Tag Manager account.",
  inputSchema: { accountId, pageToken },
}, async ({ accountId: accountValue, pageToken }) => output(await api.request(
  "GET", `/accounts/${account(accountValue)}/containers`, undefined, pageToken ? { pageToken } : undefined,
)));

server.registerTool("list_workspaces", {
  description: "List workspaces in a Google Tag Manager container.",
  inputSchema: { accountId, containerId, pageToken },
}, async ({ accountId: accountValue, containerId: containerValue, pageToken }) => output(await api.request(
  "GET", `${containerPath(accountValue, containerValue)}/workspaces`, undefined, pageToken ? { pageToken } : undefined,
)));

server.registerTool("get_workspace_status", {
  description: "Get the modified entities and merge conflicts in a GTM workspace.",
  inputSchema: { accountId, containerId, workspaceId },
}, async ({ accountId: accountValue, containerId: containerValue, workspaceId: workspaceValue }) => output(await api.request(
  "GET", `${workspacePath(accountValue, containerValue, workspaceValue)}/status`,
)));

server.registerTool("list_workspace_entities", {
  description: "List one kind of entity in a GTM workspace, including tags, triggers, variables, folders, templates, clients, zones, transformations, Google tag configs, and built-in variables.",
  inputSchema: {
    accountId,
    containerId,
    workspaceId,
    entity: z.enum([
      "built_in_variables", "clients", "folders", "gtag_config", "tags", "templates",
      "transformations", "triggers", "variables", "zones",
    ]),
    pageToken,
  },
}, async ({ accountId: accountValue, containerId: containerValue, workspaceId: workspaceValue, entity, pageToken }) => output(await api.request(
  "GET", `${workspacePath(accountValue, containerValue, workspaceValue)}/${entity}`, undefined, pageToken ? { pageToken } : undefined,
)));

server.registerTool("list_container_versions", {
  description: "List version headers for a GTM container.",
  inputSchema: { accountId, containerId, pageToken, includeDeleted: z.boolean().default(false) },
}, async ({ accountId: accountValue, containerId: containerValue, pageToken, includeDeleted }) => output(await api.request(
  "GET", `${containerPath(accountValue, containerValue)}/version_headers`, undefined,
  { includeDeleted, ...(pageToken ? { pageToken } : {}) },
)));

server.registerTool("create_container_version", {
  description: "Create a container version from a workspace. This consumes the workspace and requires explicit confirmation.",
  inputSchema: {
    accountId,
    containerId,
    workspaceId,
    name: z.string().min(1).max(200),
    notes: z.string().max(2000).optional(),
    confirm,
  },
}, async ({ accountId: accountValue, containerId: containerValue, workspaceId: workspaceValue, name, notes }) => output(await api.request(
  "POST", `${workspacePath(accountValue, containerValue, workspaceValue)}:create_version`, { name, ...(notes ? { notes } : {}) },
)));

server.registerTool("publish_container_version", {
  description: "Publish a GTM container version to make it live. This production-changing operation requires explicit confirmation.",
  inputSchema: { accountId, containerId, versionId: resourceId, confirm },
}, async ({ accountId: accountValue, containerId: containerValue, versionId }) => output(await api.request(
  "POST", `${containerPath(accountValue, containerValue)}/versions/${versionId}:publish`, {},
)));

server.registerTool("tag_manager_api_request", {
  description: "Call any Google Tag Manager API v2 accounts resource. Use exact paths from Google's REST reference. All non-GET requests require explicit confirmation.",
  inputSchema: {
    method,
    path: z.string().min(1).max(4096).describe("Relative v2 path beginning with /accounts"),
    query,
    body,
    confirm: z.boolean().optional(),
  },
}, async ({ method: verb, path, query, body, confirm: confirmed }) => {
  if (verb !== "GET" && confirmed !== true) throw new Error("confirm must be true for mutating Tag Manager API requests");
  return output(await api.request(verb, path, body, query));
});

await server.connect(new StdioServerTransport());
