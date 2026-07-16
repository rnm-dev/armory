import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GEMINI_IMAGE_MODELS, GeminiImageClient } from "./client.js";
import { readConfig } from "./config.js";

const home = process.env.PEON_ARMORY_HOME;
if (!home) throw new Error("PEON_ARMORY_HOME is required");
const api = new GeminiImageClient(await readConfig(home));
const server = new McpServer({ name: "armory-image-generator", version: "0.2.0" });

server.registerTool("gemini_image", {
  description: "Generate one or more images with a selectable Gemini-native image model. Defaults to the balanced Gemini 3.1 Flash Image model, square 1K PNG output, one image, and no Search grounding.",
  inputSchema: {
    prompt: z.string().min(1).max(32768).describe("Detailed description of the image to generate"),
    model: z.enum(GEMINI_IMAGE_MODELS).default("gemini-3.1-flash-image").describe("Flash is the balanced default; Flash Lite prioritizes cost and speed; Pro prioritizes complex professional output"),
    aspectRatio: z.enum(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]).default("1:1"),
    imageSize: z.enum(["512px", "1K", "2K", "4K"]).default("1K").describe("Flash Lite supports only 1K; Pro supports 1K, 2K, and 4K"),
    outputMimeType: z.enum(["image/png", "image/jpeg"]).default("image/png"),
    negativePrompt: z.string().min(1).max(8192).optional().describe("Elements, styles, or artifacts to discourage"),
    grounding: z.enum(["none", "web", "web_and_images"]).default("none").describe("Optional Google Search grounding; web_and_images requires Gemini 3.1 Flash Image"),
    numberOfImages: z.number().int().min(1).max(4).default(1).describe("Each image is a separate billable generation request"),
  },
}, async ({ numberOfImages, ...request }) => {
  const images = await Promise.all(Array.from({ length: numberOfImages }, () => api.generate(request)));
  return {
    content: [
      ...images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
      {
        type: "text" as const,
        text: JSON.stringify({
          model: request.model,
          aspectRatio: request.aspectRatio,
          imageSize: request.imageSize,
          outputMimeType: request.outputMimeType,
          numberOfImages: images.length,
          grounding: request.grounding,
          notes: images.map((image) => image.text).filter(Boolean),
        }, null, 2),
      },
    ],
  };
});

await server.connect(new StdioServerTransport());
