import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CloudflareClient } from "./client.js";
import { readConfig } from "./config.js";
import { directUploadPagesProject } from "./pages-direct-upload.js";

const home = process.env.PEON_ARMORY_HOME;
if (!home) throw new Error("PEON_ARMORY_HOME is required");
const config = await readConfig(home);
const api = new CloudflareClient(config);
const server = new McpServer({ name: "armory-cloudflare", version: "0.4.0" });

const id = z.string().min(1).max(64);
const zoneId = id.describe("Cloudflare zone ID");
const recordId = id.describe("Cloudflare DNS record ID");
const tunnelId = z.string().uuid().describe("Cloudflare Tunnel UUID");
const turnstileSitekey = z.string().min(1).max(32).describe("Turnstile widget sitekey");
const confirm = z.literal(true).describe("Must be true to confirm this destructive operation");
const jsonObject = z.record(z.string(), z.unknown());

function output(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function query(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, String(value));
  const rendered = params.toString();
  return rendered ? `?${rendered}` : "";
}

server.registerTool("list_zones", {
  description: "List Cloudflare DNS zones accessible to the configured API token.",
  inputSchema: {
    name: z.string().max(253).optional().describe("Exact zone name to filter by"),
    status: z.enum(["initializing", "pending", "active", "moved"]).optional(),
  },
}, async ({ name, status }) => output(await api.list(`/zones${query({ name, status })}`)));

server.registerTool("get_zone", {
  description: "Get details for a Cloudflare DNS zone.",
  inputSchema: { zoneId },
}, async ({ zoneId }) => output(await api.request(`/zones/${encodeURIComponent(zoneId)}`)));

server.registerTool("create_zone", {
  description: "Add a DNS zone to the configured Cloudflare account.",
  inputSchema: {
    name: z.string().min(1).max(253),
    type: z.enum(["full", "partial", "secondary"]).default("full"),
  },
}, async ({ name, type }) => output(await api.request("/zones", {
  method: "POST",
  body: JSON.stringify({ account: { id: config.accountId }, name, type }),
})));

server.registerTool("update_zone", {
  description: "Update mutable settings on a Cloudflare DNS zone.",
  inputSchema: {
    zoneId,
    paused: z.boolean().optional(),
    type: z.enum(["full", "partial", "secondary"]).optional(),
    vanityNameServers: z.array(z.string().min(1).max(253)).max(20).optional(),
  },
}, async ({ zoneId, paused, type, vanityNameServers }) => output(await api.request(`/zones/${encodeURIComponent(zoneId)}`, {
  method: "PATCH",
  body: JSON.stringify({
    ...(paused === undefined ? {} : { paused }),
    ...(type === undefined ? {} : { type }),
    ...(vanityNameServers === undefined ? {} : { vanity_name_servers: vanityNameServers }),
  }),
})));

server.registerTool("delete_zone", {
  description: "Permanently remove a DNS zone from Cloudflare.",
  inputSchema: { zoneId, confirm },
}, async ({ zoneId }) => output(await api.request(`/zones/${encodeURIComponent(zoneId)}`, { method: "DELETE" })));

server.registerTool("list_dns_records", {
  description: "List DNS records in a Cloudflare zone.",
  inputSchema: {
    zoneId,
    type: z.string().min(1).max(16).optional(),
    name: z.string().max(253).optional(),
    content: z.string().max(32768).optional(),
  },
}, async ({ zoneId, type, name, content }) => output(await api.list(
  `/zones/${encodeURIComponent(zoneId)}/dns_records${query({ type, name, content })}`,
)));

server.registerTool("get_dns_record", {
  description: "Get one DNS record from a Cloudflare zone.",
  inputSchema: { zoneId, recordId },
}, async ({ zoneId, recordId }) => output(await api.request(
  `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
)));

const dnsRecordFields = {
  type: z.string().min(1).max(16).describe("DNS record type, for example A, AAAA, CNAME, TXT, MX, or SRV"),
  name: z.string().min(1).max(253),
  content: z.string().max(32768).optional().describe("Record content for standard record types"),
  data: jsonObject.optional().describe("Structured record data for types such as SRV or CAA"),
  ttl: z.number().int().min(1).max(86400).default(1).describe("TTL in seconds; 1 means automatic"),
  proxied: z.boolean().optional(),
  priority: z.number().int().min(0).max(65535).optional(),
  comment: z.string().max(500).optional(),
  tags: z.array(z.string().max(256)).max(100).optional(),
};

server.registerTool("create_dns_record", {
  description: "Create a DNS record in a Cloudflare zone. Supply content or structured data as required by the record type.",
  inputSchema: { zoneId, ...dnsRecordFields },
}, async ({ zoneId, ...record }) => {
  if (record.content === undefined && record.data === undefined) throw new Error("content or data is required");
  return output(await api.request(`/zones/${encodeURIComponent(zoneId)}/dns_records`, {
    method: "POST",
    body: JSON.stringify(record),
  }));
});

server.registerTool("update_dns_record", {
  description: "Partially update an existing DNS record in a Cloudflare zone.",
  inputSchema: {
    zoneId,
    recordId,
    type: dnsRecordFields.type.optional(),
    name: dnsRecordFields.name.optional(),
    content: dnsRecordFields.content,
    data: dnsRecordFields.data,
    ttl: z.number().int().min(1).max(86400).optional(),
    proxied: dnsRecordFields.proxied,
    priority: dnsRecordFields.priority,
    comment: dnsRecordFields.comment,
    tags: dnsRecordFields.tags,
  },
}, async ({ zoneId, recordId, ...record }) => output(await api.request(
  `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
  { method: "PATCH", body: JSON.stringify(record) },
)));

server.registerTool("delete_dns_record", {
  description: "Permanently delete a DNS record from a Cloudflare zone.",
  inputSchema: { zoneId, recordId, confirm },
}, async ({ zoneId, recordId }) => output(await api.request(
  `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
  { method: "DELETE" },
)));

server.registerTool("list_tunnels", {
  description: "List active Cloudflare Tunnels in the configured account.",
  inputSchema: { name: z.string().max(100).optional() },
}, async ({ name }) => output(await api.list(
  `/accounts/${config.accountId}/cfd_tunnel${query({ is_deleted: false, name })}`,
)));

server.registerTool("get_tunnel", {
  description: "Get details and status for a Cloudflare Tunnel.",
  inputSchema: { tunnelId },
}, async ({ tunnelId }) => output(await api.request(`/accounts/${config.accountId}/cfd_tunnel/${tunnelId}`)));

server.registerTool("create_tunnel", {
  description: "Create a remotely managed Cloudflare Tunnel. This does not return or expose its connector token.",
  inputSchema: { name: z.string().min(1).max(100) },
}, async ({ name }) => output(await api.request(`/accounts/${config.accountId}/cfd_tunnel`, {
  method: "POST",
  body: JSON.stringify({ name, config_src: "cloudflare" }),
})));

server.registerTool("update_tunnel", {
  description: "Rename a Cloudflare Tunnel.",
  inputSchema: { tunnelId, name: z.string().min(1).max(100) },
}, async ({ tunnelId, name }) => output(await api.request(`/accounts/${config.accountId}/cfd_tunnel/${tunnelId}`, {
  method: "PATCH",
  body: JSON.stringify({ name }),
})));

server.registerTool("delete_tunnel", {
  description: "Delete a Cloudflare Tunnel. Active connections may prevent deletion.",
  inputSchema: { tunnelId, confirm },
}, async ({ tunnelId }) => output(await api.request(
  `/accounts/${config.accountId}/cfd_tunnel/${tunnelId}`,
  { method: "DELETE" },
)));

server.registerTool("get_tunnel_configuration", {
  description: "Get ingress and origin settings for a remotely managed Cloudflare Tunnel.",
  inputSchema: { tunnelId },
}, async ({ tunnelId }) => output(await api.request(
  `/accounts/${config.accountId}/cfd_tunnel/${tunnelId}/configurations`,
)));

const ingressRule = z.object({
  hostname: z.string().max(253).optional(),
  path: z.string().max(4096).optional(),
  service: z.string().min(1).max(4096),
  originRequest: jsonObject.optional(),
}).passthrough();

server.registerTool("put_tunnel_configuration", {
  description: "Replace ingress and origin settings for a remotely managed Cloudflare Tunnel. Include a final catch-all ingress rule.",
  inputSchema: {
    tunnelId,
    ingress: z.array(ingressRule).min(1).max(1000),
    originRequest: jsonObject.optional(),
    warpRoutingEnabled: z.boolean().optional(),
  },
}, async ({ tunnelId, ingress, originRequest, warpRoutingEnabled }) => output(await api.request(
  `/accounts/${config.accountId}/cfd_tunnel/${tunnelId}/configurations`,
  {
    method: "PUT",
    body: JSON.stringify({ config: {
      ingress,
      ...(originRequest === undefined ? {} : { originRequest }),
      ...(warpRoutingEnabled === undefined ? {} : { "warp-routing": { enabled: warpRoutingEnabled } }),
    } }),
  },
)));

const turnstileMode = z.enum(["non-interactive", "invisible", "managed"]);
const turnstileClearanceLevel = z.enum(["no_clearance", "jschallenge", "managed", "interactive"]);
const turnstileDomains = z.array(z.string().min(1).max(253)).max(10)
  .describe("Hostnames or IP addresses where the widget is allowed to run");

server.registerTool("list_turnstile_widgets", {
  description: "List Turnstile widgets in the configured Cloudflare account.",
  inputSchema: {
    filter: z.string().max(512).optional().describe("Case-insensitive field filter, for example name:login or sitekey:0x4AAA"),
    order: z.enum(["id", "sitekey", "name", "created_on", "modified_on"]).optional(),
    direction: z.enum(["asc", "desc"]).optional(),
  },
}, async ({ filter, order, direction }) => output(await api.list(
  `/accounts/${config.accountId}/challenges/widgets${query({ filter, order, direction })}`,
)));

server.registerTool("get_turnstile_widget", {
  description: "Get the configuration and credentials for a Turnstile widget.",
  inputSchema: { sitekey: turnstileSitekey },
}, async ({ sitekey }) => output(await api.request(
  `/accounts/${config.accountId}/challenges/widgets/${encodeURIComponent(sitekey)}`,
)));

const turnstileWidgetFields = {
  domains: turnstileDomains,
  mode: turnstileMode,
  name: z.string().min(1).max(254),
  botFightMode: z.boolean().optional().describe("Enable computationally expensive bot challenges (Enterprise only)"),
  clearanceLevel: turnstileClearanceLevel.optional(),
  ephemeralId: z.boolean().optional().describe("Return an ephemeral ID from Siteverify (Enterprise only)"),
  offlabel: z.boolean().optional().describe("Hide Cloudflare branding (Enterprise only)"),
};

function turnstileWidgetBody(fields: {
  domains: string[];
  mode: z.infer<typeof turnstileMode>;
  name: string;
  botFightMode?: boolean;
  clearanceLevel?: z.infer<typeof turnstileClearanceLevel>;
  ephemeralId?: boolean;
  offlabel?: boolean;
  region?: "world" | "china";
}) {
  const { botFightMode, clearanceLevel, ephemeralId, ...rest } = fields;
  return {
    ...rest,
    ...(botFightMode === undefined ? {} : { bot_fight_mode: botFightMode }),
    ...(clearanceLevel === undefined ? {} : { clearance_level: clearanceLevel }),
    ...(ephemeralId === undefined ? {} : { ephemeral_id: ephemeralId }),
  };
}

server.registerTool("create_turnstile_widget", {
  description: "Create a Turnstile widget. The response includes the new sitekey and secret key.",
  inputSchema: {
    ...turnstileWidgetFields,
    region: z.enum(["world", "china"]).optional().describe("Deployment region; cannot be changed after creation"),
  },
}, async (fields) => output(await api.request(`/accounts/${config.accountId}/challenges/widgets`, {
  method: "POST",
  body: JSON.stringify(turnstileWidgetBody(fields)),
})));

server.registerTool("update_turnstile_widget", {
  description: "Replace the mutable configuration of a Turnstile widget.",
  inputSchema: { sitekey: turnstileSitekey, ...turnstileWidgetFields },
}, async ({ sitekey, ...fields }) => output(await api.request(
  `/accounts/${config.accountId}/challenges/widgets/${encodeURIComponent(sitekey)}`,
  { method: "PUT", body: JSON.stringify(turnstileWidgetBody(fields)) },
)));

server.registerTool("rotate_turnstile_widget_secret", {
  description: "Rotate a Turnstile widget secret. The response includes the new secret; the old secret may remain valid briefly.",
  inputSchema: {
    sitekey: turnstileSitekey,
    invalidateImmediately: z.boolean().default(false),
    confirm,
  },
}, async ({ sitekey, invalidateImmediately }) => output(await api.request(
  `/accounts/${config.accountId}/challenges/widgets/${encodeURIComponent(sitekey)}/rotate_secret`,
  { method: "POST", body: JSON.stringify({ invalidate_immediately: invalidateImmediately }) },
)));

server.registerTool("delete_turnstile_widget", {
  description: "Permanently delete a Turnstile widget.",
  inputSchema: { sitekey: turnstileSitekey, confirm },
}, async ({ sitekey }) => output(await api.request(
  `/accounts/${config.accountId}/challenges/widgets/${encodeURIComponent(sitekey)}`,
  { method: "DELETE" },
)));

const pagesProjectName = z.string().min(1).max(58).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/)
  .describe("Cloudflare Pages project name");
const pagesEnvironment = z.enum(["production", "preview"]);

server.registerTool("set_pages_secret", {
  description: "Set an encrypted environment secret for a Cloudflare Pages project without returning its value.",
  inputSchema: {
    projectName: pagesProjectName,
    environment: pagesEnvironment,
    secretName: z.string().min(1).max(256).regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default("TURNSTILE_SECRET"),
    secretValue: z.string().min(1).max(65536).describe("Secret value; it is sent only to Cloudflare and is not returned"),
    confirm,
  },
}, async ({ projectName, environment, secretName, secretValue }) => {
  try {
    await api.request(`/accounts/${config.accountId}/pages/projects/${encodeURIComponent(projectName)}`, {
      method: "PATCH",
      body: JSON.stringify({
        deployment_configs: {
          [environment]: {
            env_vars: { [secretName]: { type: "secret_text", value: secretValue } },
          },
        },
      }),
    });
  } catch {
    throw new Error("Cloudflare Pages secret update failed");
  }
  return output({ projectName, environment, secretName, updated: true });
});

type PagesDeployment = {
  id?: string;
  project_name?: string;
  environment?: string;
  url?: string;
  aliases?: string[];
  created_on?: string;
  latest_stage?: unknown;
  deployment_trigger?: unknown;
};

server.registerTool("deploy_pages_project", {
  description: "Start a deployment from the remote source of a Git-connected Pages project. Do not use for local-only projects or local artifacts.",
  inputSchema: {
    projectName: pagesProjectName,
    branch: z.string().min(1).max(255).optional(),
    commitHash: z.string().min(1).max(64).optional(),
    commitMessage: z.string().max(1024).optional(),
    commitDirty: z.boolean().default(false),
    confirm,
  },
}, async ({ projectName, branch, commitHash, commitMessage, commitDirty }) => {
  const form = new FormData();
  if (branch !== undefined) form.set("branch", branch);
  if (commitHash !== undefined) form.set("commit_hash", commitHash);
  if (commitMessage !== undefined) form.set("commit_message", commitMessage);
  form.set("commit_dirty", String(commitDirty));
  const deployment = await api.request<PagesDeployment>(
    `/accounts/${config.accountId}/pages/projects/${encodeURIComponent(projectName)}/deployments`,
    { method: "POST", body: form },
  );
  return output({
    id: deployment.id,
    projectName: deployment.project_name ?? projectName,
    environment: deployment.environment,
    url: deployment.url,
    aliases: deployment.aliases,
    createdOn: deployment.created_on,
    latestStage: deployment.latest_stage,
    deploymentTrigger: deployment.deployment_trigger,
  });
});

server.registerTool("direct_upload_pages_project", {
  description: "Upload the current local artifact and Pages Functions to a direct-upload Pages project. Uses the project's local Wrangler only to compile functions offline.",
  inputSchema: {
    projectName: pagesProjectName,
    projectPath: z.string().min(1).max(4096).describe("Absolute project path under ~/Projects"),
    artifactPath: z.string().min(1).max(1024).describe("Build artifact directory relative to projectPath, for example dist"),
    functionsPath: z.string().min(1).max(1024).default("functions").describe("Pages Functions directory relative to projectPath"),
    branch: z.string().min(1).max(255).optional().describe("Preview branch; omit to deploy to production"),
    commitHash: z.string().min(1).max(64).optional(),
    commitMessage: z.string().max(384).optional(),
    commitDirty: z.boolean().default(false),
    confirm,
  },
}, async ({ projectName, projectPath, artifactPath, functionsPath, branch, commitHash, commitMessage, commitDirty }) => output(
  await directUploadPagesProject({
    api,
    home,
    accountId: config.accountId,
    projectName,
    projectPath,
    artifactPath,
    functionsPath,
    branch,
    commitHash,
    commitMessage,
    commitDirty,
  }),
));

await server.connect(new StdioServerTransport());
