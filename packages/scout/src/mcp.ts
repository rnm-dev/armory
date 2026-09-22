import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readConfig, SCOUT_URL } from "./config.js";
const home = process.env.PEON_ARMORY_HOME; if (!home) throw new Error("PEON_ARMORY_HOME is required");
const { apiKey } = await readConfig(home);
const headers: Record<string,string> = { Authorization: `Bearer ${apiKey}` };
const remote = new Client({ name: "armory-scout", version: "1.0.0" });
await remote.connect(new StreamableHTTPClientTransport(new URL(`${SCOUT_URL}/mcp`), { requestInit: { headers } }));
const server = new Server({ name: "armory-scout", version: "1.0.0" }, { capabilities: { tools: {} } });
const close = async () => { await Promise.allSettled([remote.close(), server.close()]); };
server.setRequestHandler(ListToolsRequestSchema, ({ params }) => remote.listTools(params));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  return remote.callTool(params);
});
process.once("SIGINT", () => void close()); process.once("SIGTERM", () => void close());
await server.connect(new StdioServerTransport());
