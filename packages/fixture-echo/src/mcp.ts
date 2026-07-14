import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "armory-fixture-echo", version: "1.0.0" });

server.registerTool(
  "echo",
  {
    description: "Return the supplied fixture message unchanged.",
    inputSchema: { message: z.string().max(4096) },
  },
  async ({ message }) => ({ content: [{ type: "text", text: message }] }),
);

await server.connect(new StdioServerTransport());
