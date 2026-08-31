import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GoogleWorkspaceClient } from "./client.js";
import { readConfig } from "./config.js";

const home = process.env.PEON_ARMORY_HOME;
if (!home) throw new Error("PEON_ARMORY_HOME is required");
const api = new GoogleWorkspaceClient(await readConfig(home));
const server = new McpServer({ name: "armory-google-workspace", version: "0.1.1" });
const fileId = z.string().regex(/^[A-Za-z0-9_-]+$/).min(10).max(200);
const range = z.string().min(1).max(1000);
const jsonObject = z.record(z.string(), z.unknown());
const requests = z.array(jsonObject).min(1).max(500);
const confirmation = z.literal("CONFIRM_WORKSPACE_EDIT").describe("Exact confirmation required because this changes a Google Workspace file");
const output = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const query = (values: Record<string, string | number | boolean | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, String(value));
  return params.toString();
};

server.registerTool("search_files", {
  description: "Find Google Docs, Sheets, and Slides shared with the service account. Supports Drive query syntax.",
  inputSchema: { search: z.string().max(500).optional().describe("Text contained in the file name"),
    driveQuery: z.string().max(2000).optional().describe("Additional Google Drive v3 q expression"), pageSize: z.number().int().min(1).max(100).default(50),
    pageToken: z.string().max(2000).optional() },
}, async ({ search, driveQuery, pageSize, pageToken }) => {
  const clauses = ["trashed = false", "(mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.google-apps.presentation')"];
  if (search) clauses.push(`name contains '${search.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`);
  if (driveQuery) clauses.push(`(${driveQuery})`);
  const params = query({ q: clauses.join(" and "), pageSize, pageToken,
    fields: "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,driveId,capabilities(canEdit))", orderBy: "modifiedTime desc",
    supportsAllDrives: true, includeItemsFromAllDrives: true });
  return output(await api.request("DRIVE", `/files?${params}`));
});

server.registerTool("get_document", { description: "Read a Google Doc, including its structural content.",
  inputSchema: { documentId: fileId, suggestionsViewMode: z.enum(["DEFAULT_FOR_CURRENT_ACCESS", "SUGGESTIONS_INLINE", "PREVIEW_SUGGESTIONS_ACCEPTED", "PREVIEW_WITHOUT_SUGGESTIONS"]).optional() } },
async ({ documentId, suggestionsViewMode }) => output(await api.request("DOCS", `/documents/${documentId}?${query({ suggestionsViewMode })}`)));

server.registerTool("batch_update_document", {
  description: "Apply Google Docs API batchUpdate requests (insert/delete/replace/style/table operations). Requires confirmation.",
  inputSchema: { documentId: fileId, requests, requiredRevisionId: z.string().max(200).optional(), confirmation },
}, async ({ documentId, requests, requiredRevisionId }) => output(await api.request("DOCS", `/documents/${documentId}:batchUpdate`, {
  method: "POST", body: JSON.stringify({ requests, ...(requiredRevisionId ? { writeControl: { requiredRevisionId } } : {}) }),
})));

server.registerTool("get_spreadsheet", { description: "Read spreadsheet metadata and optionally selected grid ranges.",
  inputSchema: { spreadsheetId: fileId, ranges: z.array(range).max(100).optional(), includeGridData: z.boolean().default(false) } },
async ({ spreadsheetId, ranges, includeGridData }) => {
  const params = new URLSearchParams({ includeGridData: String(includeGridData) }); for (const item of ranges ?? []) params.append("ranges", item);
  return output(await api.request("SHEETS", `/spreadsheets/${spreadsheetId}?${params}`));
});

server.registerTool("get_sheet_values", { description: "Read values from an A1 range in a Google Sheet.",
  inputSchema: { spreadsheetId: fileId, range, majorDimension: z.enum(["ROWS", "COLUMNS"]).default("ROWS"),
    valueRenderOption: z.enum(["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"]).default("FORMATTED_VALUE") } },
async ({ spreadsheetId, range, majorDimension, valueRenderOption }) => output(await api.request("SHEETS",
  `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?${query({ majorDimension, valueRenderOption })}`)));

server.registerTool("update_sheet_values", { description: "Replace values in an A1 range. Requires confirmation.",
  inputSchema: { spreadsheetId: fileId, range, values: z.array(z.array(z.unknown()).max(10000)).max(10000),
    majorDimension: z.enum(["ROWS", "COLUMNS"]).default("ROWS"), valueInputOption: z.enum(["RAW", "USER_ENTERED"]).default("USER_ENTERED"), confirmation } },
async ({ spreadsheetId, range, values, majorDimension, valueInputOption }) => output(await api.request("SHEETS",
  `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?${query({ valueInputOption })}`,
  { method: "PUT", body: JSON.stringify({ range, majorDimension, values }) })));

server.registerTool("append_sheet_values", { description: "Append rows or columns after a table in an A1 range. Requires confirmation.",
  inputSchema: { spreadsheetId: fileId, range, values: z.array(z.array(z.unknown()).max(10000)).min(1).max(10000),
    majorDimension: z.enum(["ROWS", "COLUMNS"]).default("ROWS"), valueInputOption: z.enum(["RAW", "USER_ENTERED"]).default("USER_ENTERED"), confirmation } },
async ({ spreadsheetId, range, values, majorDimension, valueInputOption }) => output(await api.request("SHEETS",
  `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?${query({ valueInputOption, insertDataOption: "INSERT_ROWS" })}`,
  { method: "POST", body: JSON.stringify({ range, majorDimension, values }) })));

server.registerTool("batch_update_spreadsheet", { description: "Apply Google Sheets API batchUpdate requests for formatting, sheets, cells, charts, and other structural edits. Requires confirmation.",
  inputSchema: { spreadsheetId: fileId, requests, includeSpreadsheetInResponse: z.boolean().default(false), confirmation } },
async ({ spreadsheetId, requests, includeSpreadsheetInResponse }) => output(await api.request("SHEETS", `/spreadsheets/${spreadsheetId}:batchUpdate`,
  { method: "POST", body: JSON.stringify({ requests, includeSpreadsheetInResponse }) })));

server.registerTool("get_presentation", { description: "Read a Google Slides presentation, including pages and elements.",
  inputSchema: { presentationId: fileId } },
async ({ presentationId }) => output(await api.request("SLIDES", `/presentations/${presentationId}`)));

server.registerTool("batch_update_presentation", { description: "Apply Google Slides API batchUpdate requests (text, shapes, images, slides, and styling). Requires confirmation.",
  inputSchema: { presentationId: fileId, requests, requiredRevisionId: z.string().max(200).optional(), confirmation } },
async ({ presentationId, requests, requiredRevisionId }) => output(await api.request("SLIDES", `/presentations/${presentationId}:batchUpdate`, {
  method: "POST", body: JSON.stringify({ requests, ...(requiredRevisionId ? { writeControl: { requiredRevisionId } } : {}) }),
})));

await server.connect(new StdioServerTransport());
