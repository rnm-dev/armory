import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_API_URL = "https://generativelanguage.googleapis.com/v1beta";

export type ImageGeneratorConfig = { apiKey: string };

export function apiUrl(): string {
  return process.env.NODE_ENV === "test" && process.env.IMAGE_GENERATOR_TEST_API_URL
    ? process.env.IMAGE_GENERATOR_TEST_API_URL.replace(/\/$/, "")
    : DEFAULT_API_URL;
}

export function configPath(home: string): string {
  return path.join(home, "config", "image-generator.json");
}

export function parseApiKey(value: unknown): string {
  if (typeof value !== "string" || value.length < 10 || value.length > 4096) {
    throw new Error("Gemini API key is not configured");
  }
  return value;
}

export async function readConfig(home: string): Promise<ImageGeneratorConfig> {
  const value = JSON.parse(await fs.readFile(configPath(home), "utf8")) as Partial<ImageGeneratorConfig>;
  return { apiKey: parseApiKey(value.apiKey) };
}
