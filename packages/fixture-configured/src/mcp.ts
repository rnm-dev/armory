import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "armory-fixture-configured", version: "1.0.0" });

server.registerTool(
  "configuration_status",
  { description: "Return safe metadata about the offline fixture configuration." },
  async () => {
    const home = process.env.PEON_ARMORY_HOME;
    if (!home) throw new Error("PEON_ARMORY_HOME is required");
    const raw = await fs.readFile(path.join(home, "config", "config.json"), "utf8");
    const config = JSON.parse(raw) as { projectName: string; apiToken: string; region: string };
    const fileConfigured = await fs.access(path.join(home, "config", "credentials-file.txt")).then(() => true).catch(() => false);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ projectName: config.projectName, region: config.region, apiTokenConfigured: Boolean(config.apiToken), credentialsFileConfigured: fileConfigured }),
      }],
    };
  },
);

await server.connect(new StdioServerTransport());
