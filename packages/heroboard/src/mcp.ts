import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { apiUrl, readConfig } from "./config.js";

const home = process.env.PEON_ARMORY_HOME;
if (!home) throw new Error("PEON_ARMORY_HOME is required");
const { apiKey } = await readConfig(home);

const remote = new Client({ name: "armory-heroboard", version: "1.0.0" });
await remote.connect(new StreamableHTTPClientTransport(new URL(`${apiUrl()}/api/mcp/mcp`), {
  requestInit: { headers: { "X-Api-Key": apiKey } },
}));

const server = new Server(
  { name: "armory-heroboard", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, ({ params }) => remote.listTools(params));
server.setRequestHandler(CallToolRequestSchema, ({ params }) => remote.callTool(params));

const close = async () => {
  await Promise.allSettled([remote.close(), server.close()]);
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

await server.connect(new StdioServerTransport());
