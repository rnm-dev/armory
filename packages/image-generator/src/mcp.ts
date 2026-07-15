import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GeminiImagenClient, IMAGEN_MODELS } from "./client.js";
import { readConfig } from "./config.js";

const home = process.env.PEON_ARMORY_HOME;
if (!home) throw new Error("PEON_ARMORY_HOME is required");
const api = new GeminiImagenClient(await readConfig(home));
const server = new McpServer({ name: "armory-image-generator", version: "0.1.0" });

server.registerTool("gemini_imagen", {
  description: "Generate images with Imagen 4 through the Gemini API. Defaults to Standard, one square 1K image, and adult-only person generation. Imagen is deprecated by Google and scheduled to shut down on August 17, 2026.",
  inputSchema: {
    prompt: z.string().min(1).max(4096).describe("English image prompt; Imagen accepts at most 480 tokens"),
    model: z.enum(IMAGEN_MODELS).default("imagen-4.0-generate-001").describe("Standard balances quality and latency; Ultra prioritizes quality; Fast prioritizes latency"),
    numberOfImages: z.number().int().min(1).max(4).default(1).describe("Number of images returned by one generation request"),
    aspectRatio: z.enum(["1:1", "3:4", "4:3", "9:16", "16:9"]).default("1:1"),
    imageSize: z.enum(["1K", "2K"]).optional().describe("Defaults to 1K for Standard and Ultra; unsupported by Fast"),
    personGeneration: z.enum(["dont_allow", "allow_adult", "allow_all"]).default("allow_adult").describe("allow_all is unavailable in some regions, including the EU, UK, Switzerland, and MENA"),
  },
}, async (request) => {
  const images = await api.generate(request);
  return {
    content: [
      ...images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
      {
        type: "text" as const,
        text: JSON.stringify({
          model: request.model,
          aspectRatio: request.aspectRatio,
          imageSize: request.imageSize ?? (request.model === "imagen-4.0-fast-generate-001" ? null : "1K"),
          personGeneration: request.personGeneration,
          numberOfImages: images.length,
          deprecation: "Imagen is scheduled to shut down on 2026-08-17; migrate this package to a Gemini-native image tool before then.",
        }, null, 2),
      },
    ],
  };
});

await server.connect(new StdioServerTransport());
