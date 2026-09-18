import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readConfig, SCOUT_URL } from "./config.js";
const home = process.env.PEON_ARMORY_HOME; if (!home) throw new Error("PEON_ARMORY_HOME is required");
const { apiKey } = await readConfig(home);
const headers: Record<string,string> = { Authorization: `Bearer ${apiKey}` };
if (process.env.PEON_WORKFLOW_EXECUTION && process.env.PEON_WORKFLOW_LEASE) {
  headers["X-Workflow-Execution"] = process.env.PEON_WORKFLOW_EXECUTION;
  headers["X-Workflow-Lease"] = process.env.PEON_WORKFLOW_LEASE;
}
const remote = new Client({ name: "armory-scout", version: "1.0.0" });
await remote.connect(new StreamableHTTPClientTransport(new URL(`${SCOUT_URL}/mcp`), { requestInit: { headers } }));
const server = new Server({ name: "armory-scout", version: "1.0.0" }, { capabilities: { tools: {} } });
const close = async () => { await Promise.allSettled([remote.close(), server.close()]); };
server.setRequestHandler(ListToolsRequestSchema, ({ params }) => remote.listTools(params));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const answer = await remote.callTool(params);
  const text = JSON.stringify(answer);
  if (text.includes('"error":"lease_lost"')) {
    process.stderr.write("SCOUT_LEASE_LOST\n");
    process.exitCode = 75;
    setTimeout(() => void close(), 10).unref();
  }
  return answer;
});
process.once("SIGINT", () => void close()); process.once("SIGTERM", () => void close());
await server.connect(new StdioServerTransport());
