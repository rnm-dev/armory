import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CloudflareClient } from "./client.js";
import { readConfig } from "./config.js";

const home = process.env.PEON_ARMORY_HOME;
if (!home) throw new Error("PEON_ARMORY_HOME is required");
const config = await readConfig(home);
const api = new CloudflareClient(config);
const server = new McpServer({ name: "armory-cloudflare", version: "0.1.1" });

const id = z.string().min(1).max(64);
const zoneId = id.describe("Cloudflare zone ID");
const recordId = id.describe("Cloudflare DNS record ID");
const tunnelId = z.string().uuid().describe("Cloudflare Tunnel UUID");
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

await server.connect(new StdioServerTransport());
