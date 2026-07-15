import { apiUrl, type ImageGeneratorConfig } from "./config.js";

export const IMAGEN_MODELS = [
  "imagen-4.0-generate-001",
  "imagen-4.0-ultra-generate-001",
  "imagen-4.0-fast-generate-001",
] as const;

export type ImagenModel = typeof IMAGEN_MODELS[number];
export type ImagenRequest = {
  prompt: string;
  model: ImagenModel;
  numberOfImages: number;
  aspectRatio: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
  imageSize?: "1K" | "2K";
  personGeneration: "dont_allow" | "allow_adult" | "allow_all";
};

export type GeneratedImage = { data: string; mimeType: string };

type PredictResponse = {
  predictions?: Array<{
    bytesBase64Encoded?: string;
    mimeType?: string;
    raiFilteredReason?: string;
  }>;
  error?: { message?: string };
};

export class GeminiImagenClient {
  constructor(private readonly config: ImageGeneratorConfig) {}

  private async request(path: string, init: RequestInit): Promise<PredictResponse> {
    const response = await fetch(`${apiUrl()}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.config.apiKey,
        ...init.headers,
      },
      signal: AbortSignal.timeout(55_000),
    });
    const body = await response.json().catch(() => undefined) as PredictResponse | undefined;
    if (!response.ok) {
      const detail = typeof body?.error?.message === "string" ? body.error.message.slice(0, 500) : undefined;
      throw new Error(`Gemini Imagen API request failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
    }
    if (!body) throw new Error("Gemini Imagen API returned an invalid response");
    return body;
  }

  async verify(): Promise<void> {
    const response = await fetch(`${apiUrl()}/models/${IMAGEN_MODELS[0]}`, {
      headers: { "x-goog-api-key": this.config.apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Gemini Imagen model verification failed (HTTP ${response.status})`);
  }

  async generate(request: ImagenRequest): Promise<GeneratedImage[]> {
    if (request.model === "imagen-4.0-fast-generate-001" && request.imageSize !== undefined) {
      throw new Error("Imagen 4 Fast does not support the imageSize setting");
    }
    const imageSize = request.imageSize ?? (request.model === "imagen-4.0-fast-generate-001" ? undefined : "1K");
    const body = await this.request(`/models/${request.model}:predict`, {
      method: "POST",
      body: JSON.stringify({
        instances: [{ prompt: request.prompt }],
        parameters: {
          sampleCount: request.numberOfImages,
          aspectRatio: request.aspectRatio,
          personGeneration: request.personGeneration,
          ...(imageSize ? { imageSize } : {}),
        },
      }),
    });
    const images = (body.predictions ?? [])
      .filter((prediction) => typeof prediction.bytesBase64Encoded === "string")
      .map((prediction) => ({
        data: prediction.bytesBase64Encoded as string,
        mimeType: prediction.mimeType === "image/jpeg" ? "image/jpeg" : "image/png",
      }));
    if (images.length === 0) {
      const reason = body.predictions?.map((prediction) => prediction.raiFilteredReason).find(Boolean);
      throw new Error(reason ? `Imagen returned no image: ${reason}` : "Imagen returned no generated image");
    }
    return images;
  }
}
