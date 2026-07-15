import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GoogleAdsClient } from "./client.js";
import { readConfig } from "./config.js";

const home = process.env.PEON_ARMORY_HOME;
if (!home) throw new Error("PEON_ARMORY_HOME is required");
const api = new GoogleAdsClient(await readConfig(home));
const server = new McpServer({ name: "armory-google-ads", version: "0.1.0" });

const customerId = z.string().regex(/^[0-9]{10}$/).describe("10-digit Google Ads customer ID without hyphens");
const limit = z.number().int().min(1).max(1000).default(100);

function output(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function assertBoundedQuery(query: string): void {
  if (!/^\s*SELECT\b/i.test(query) || query.includes(";")) {
    throw new Error("GAQL must be one SELECT query without a semicolon");
  }
  const match = query.match(/\bLIMIT\s+([0-9]+)(?:\s+PARAMETERS\s+.+)?\s*$/i);
  const rowLimit = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(rowLimit) || rowLimit < 1 || rowLimit > 1000) {
    throw new Error("GAQL must end with a LIMIT between 1 and 1000");
  }
}

server.registerTool("list_accessible_customers", {
  description: "List Google Ads customer resource names directly accessible to the authenticated Google user.",
  inputSchema: {},
}, async () => output(await api.listAccessibleCustomers()));

server.registerTool("get_customer", {
  description: "Get basic identity, currency, time zone, manager, test-account, and status details for a Google Ads customer.",
  inputSchema: { customerId },
}, async ({ customerId }) => output(await api.search(customerId, `
SELECT
  customer.id,
  customer.descriptive_name,
  customer.currency_code,
  customer.time_zone,
  customer.manager,
  customer.test_account,
  customer.status
FROM customer
LIMIT 1`.trim())));

server.registerTool("list_customer_clients", {
  description: "List client accounts below a Google Ads manager account, bounded by hierarchy depth and row count.",
  inputSchema: {
    customerId,
    maxDepth: z.number().int().min(1).max(10).default(1),
    limit,
  },
}, async ({ customerId, maxDepth, limit }) => output(await api.search(customerId, `
SELECT
  customer_client.client_customer,
  customer_client.id,
  customer_client.descriptive_name,
  customer_client.manager,
  customer_client.level,
  customer_client.status,
  customer_client.test_account,
  customer_client.currency_code,
  customer_client.time_zone
FROM customer_client
WHERE customer_client.level <= ${maxDepth}
ORDER BY customer_client.level, customer_client.id
LIMIT ${limit}`.trim())));

server.registerTool("run_gaql", {
  description: "Run one read-only Google Ads Query Language report. The query must end with LIMIT 1..1000.",
  inputSchema: {
    customerId,
    query: z.string().min(1).max(20000).describe("A single GAQL SELECT query ending with an explicit LIMIT of at most 1000"),
  },
}, async ({ customerId, query }) => {
  assertBoundedQuery(query);
  return output(await api.search(customerId, query));
});

await server.connect(new StdioServerTransport());
