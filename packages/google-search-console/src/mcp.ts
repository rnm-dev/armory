import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SearchConsoleClient } from "./client.js";
import { readConfig } from "./config.js";

const home = process.env.PEON_ARMORY_HOME;
if (!home) throw new Error("PEON_ARMORY_HOME is required");
const api = new SearchConsoleClient(await readConfig(home));
const server = new McpServer({ name: "armory-google-search-console", version: "0.2.0" });

const siteUrl = z.string().min(1).max(2048).describe("Search Console property URL, such as https://example.com/ or sc-domain:example.com");
const absoluteUrl = z.string().url().max(4096);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date in YYYY-MM-DD format, interpreted in Pacific Time");

function output(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

server.registerTool("list_sites", {
  description: "List Search Console properties accessible to the configured service account and their permission levels.",
}, async () => output(await api.request("webmasters", "/sites")));

server.registerTool("get_site", {
  description: "Get the permission level for a Search Console property.",
  inputSchema: { siteUrl },
}, async ({ siteUrl }) => output(await api.request("webmasters", `/sites/${encodeURIComponent(siteUrl)}`)));

server.registerTool("add_site", {
  description: "Add a property to the configured service account's set of Search Console properties. This does not verify ownership.",
  inputSchema: { siteUrl },
}, async ({ siteUrl }) => {
  await api.request("webmasters", `/sites/${encodeURIComponent(siteUrl)}`, { method: "PUT" }, true);
  return output({ success: true, siteUrl });
});

server.registerTool("delete_site", {
  description: "Remove a property from the configured service account's set of Search Console properties. This does not delete the website.",
  inputSchema: { siteUrl },
}, async ({ siteUrl }) => {
  await api.request("webmasters", `/sites/${encodeURIComponent(siteUrl)}`, { method: "DELETE" }, true);
  return output({ success: true, siteUrl });
});

const filter = z.object({
  dimension: z.enum(["country", "device", "page", "query", "searchAppearance"]),
  operator: z.enum(["contains", "equals", "notContains", "notEquals", "includingRegex", "excludingRegex"]).default("equals"),
  expression: z.string().min(1).max(4096),
});

server.registerTool("query_search_analytics", {
  description: "Query Search Console performance metrics. Results include clicks, impressions, CTR, and average position.",
  inputSchema: {
    siteUrl,
    startDate: date,
    endDate: date,
    dimensions: z.array(z.enum(["country", "date", "device", "hour", "page", "query", "searchAppearance"])).max(7).optional(),
    type: z.enum(["discover", "googleNews", "news", "image", "video", "web"]).default("web"),
    filters: z.array(filter).max(20).optional().describe("Filters combined with AND semantics"),
    aggregationType: z.enum(["auto", "byPage", "byProperty"]).default("auto"),
    dataState: z.enum(["all", "final", "hourly_all"]).default("final"),
    rowLimit: z.number().int().min(1).max(25000).default(1000),
    startRow: z.number().int().min(0).default(0),
  },
}, async ({ siteUrl, filters, ...query }) => output(await api.request(
  "webmasters",
  `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
  {
    method: "POST",
    body: JSON.stringify({
      ...query,
      ...(filters?.length ? { dimensionFilterGroups: [{ groupType: "and", filters }] } : {}),
    }),
  },
)));

server.registerTool("list_sitemaps", {
  description: "List sitemaps submitted for a Search Console property.",
  inputSchema: { siteUrl, sitemapIndex: absoluteUrl.optional().describe("Return sitemaps contained in this sitemap index") },
}, async ({ siteUrl, sitemapIndex }) => {
  const query = sitemapIndex ? `?sitemapIndex=${encodeURIComponent(sitemapIndex)}` : "";
  return output(await api.request("webmasters", `/sites/${encodeURIComponent(siteUrl)}/sitemaps${query}`));
});

server.registerTool("get_sitemap", {
  description: "Get details and processing status for one submitted sitemap.",
  inputSchema: { siteUrl, feedpath: absoluteUrl.describe("Absolute sitemap URL") },
}, async ({ siteUrl, feedpath }) => output(await api.request(
  "webmasters",
  `/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`,
)));

server.registerTool("submit_sitemap", {
  description: "Submit a sitemap to Google Search Console for crawling.",
  inputSchema: { siteUrl, feedpath: absoluteUrl.describe("Absolute sitemap URL") },
}, async ({ siteUrl, feedpath }) => {
  await api.request(
    "webmasters",
    `/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`,
    { method: "PUT" },
    true,
  );
  return output({ success: true, siteUrl, feedpath });
});

server.registerTool("delete_sitemap", {
  description: "Remove a sitemap submission from Google Search Console. This does not delete the sitemap file from the website.",
  inputSchema: { siteUrl, feedpath: absoluteUrl.describe("Absolute sitemap URL") },
}, async ({ siteUrl, feedpath }) => {
  await api.request(
    "webmasters",
    `/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`,
    { method: "DELETE" },
    true,
  );
  return output({ success: true, siteUrl, feedpath });
});

server.registerTool("inspect_url", {
  description: "Inspect a URL's indexed version, including coverage, crawl, canonical, mobile usability, and rich-results status.",
  inputSchema: {
    inspectionUrl: absoluteUrl.describe("Fully qualified URL to inspect; must belong to the property"),
    siteUrl,
    languageCode: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/).default("en-US"),
  },
}, async ({ inspectionUrl, siteUrl, languageCode }) => output(await api.request(
  "inspection",
  "/urlInspection/index:inspect",
  { method: "POST", body: JSON.stringify({ inspectionUrl, siteUrl, languageCode }) },
)));

await server.connect(new StdioServerTransport());
