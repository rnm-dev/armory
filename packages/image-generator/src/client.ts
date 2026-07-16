import { apiUrl, type ImageGeneratorConfig } from "./config.js";

export const GEMINI_IMAGE_MODELS = [
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-lite-image",
  "gemini-3-pro-image",
] as const;

export type GeminiImageModel = typeof GEMINI_IMAGE_MODELS[number];
export type GeminiImageRequest = {
  prompt: string;
  model: GeminiImageModel;
  aspectRatio: string;
  imageSize: "512px" | "1K" | "2K" | "4K";
  outputMimeType: "image/png" | "image/jpeg";
  negativePrompt?: string;
  grounding: "none" | "web" | "web_and_images";
};

export type GeneratedImage = {
  data: string;
  mimeType: "image/png" | "image/jpeg";
  text?: string;
};

type InteractionResponse = {
  steps?: Array<{
    type?: string;
    content?: Array<{ type?: string; data?: string; mime_type?: string; text?: string }>;
  }>;
  error?: { message?: string };
};

function validateCompatibility(request: GeminiImageRequest): void {
  if (request.model === "gemini-3.1-flash-lite-image" && request.imageSize !== "1K") {
    throw new Error("gemini-3.1-flash-lite-image supports only 1K output");
  }
  if (request.model === "gemini-3-pro-image" && request.imageSize === "512px") {
    throw new Error("gemini-3-pro-image does not support 512px output");
  }
  if (request.grounding === "web_and_images" && request.model !== "gemini-3.1-flash-image") {
    throw new Error("web and image Search grounding requires gemini-3.1-flash-image");
  }
}

export class GeminiImageClient {
  constructor(private readonly config: ImageGeneratorConfig) {}

  private async request(path: string, init: RequestInit): Promise<InteractionResponse> {
    const response = await fetch(`${apiUrl()}${path}`, {
      ...init,
      headers: {
        "api-revision": "2026-05-20",
        "content-type": "application/json",
        "x-goog-api-key": this.config.apiKey,
        ...init.headers,
      },
      signal: AbortSignal.timeout(55_000),
    });
    const body = await response.json().catch(() => undefined) as InteractionResponse | undefined;
    if (!response.ok) {
      const detail = typeof body?.error?.message === "string" ? body.error.message.slice(0, 500) : undefined;
      throw new Error(`Gemini image API request failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
    }
    if (!body) throw new Error("Gemini image API returned an invalid response");
    return body;
  }

  async verify(): Promise<void> {
    await this.request(`/models/${GEMINI_IMAGE_MODELS[0]}`, { method: "GET" });
  }

  async generate(request: GeminiImageRequest): Promise<GeneratedImage> {
    validateCompatibility(request);
    const prompt = request.negativePrompt
      ? `${request.prompt}\n\nAvoid the following in the generated image: ${request.negativePrompt}`
      : request.prompt;
    const tools = request.grounding === "none" ? undefined : [{
      type: "google_search",
      ...(request.grounding === "web_and_images" ? { search_types: ["web_search", "image_search"] } : {}),
    }];
    const body = await this.request("/interactions", {
      method: "POST",
      body: JSON.stringify({
        model: request.model,
        input: prompt,
        ...(tools ? { tools } : {}),
        response_format: {
          type: "image",
          mime_type: request.outputMimeType,
          aspect_ratio: request.aspectRatio,
          image_size: request.imageSize,
        },
      }),
    });
    const contents = body.steps
      ?.filter((step) => step.type === "model_output")
      .flatMap((step) => step.content ?? []) ?? [];
    const image = contents.find((content) => content.type === "image" && typeof content.data === "string");
    if (!image?.data) throw new Error("Gemini image API returned no generated image");
    const mimeType = image.mime_type === "image/jpeg" ? "image/jpeg" : image.mime_type === "image/png" ? "image/png" : request.outputMimeType;
    const text = contents.filter((content) => content.type === "text" && typeof content.text === "string").map((content) => content.text).join("\n");
    return { data: image.data, mimeType, ...(text ? { text } : {}) };
  }
}
