import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { GooglePlayClient } from "./client.js";
import { readConfig } from "./config.js";

const home = process.env.PEON_ARMORY_HOME;
if (!home) throw new Error("PEON_ARMORY_HOME is required");
const api = new GooglePlayClient(await readConfig(home));
const server = new McpServer({ name: "armory-google-play", version: "0.4.0" });
const packageName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/).max(255);
const track = z.string().min(1).max(255);
const versionCode = z.string().regex(/^[1-9][0-9]*$/).max(20);
const confirmation = z.literal("CONFIRM_RELEASE_CHANGE").describe("Exact confirmation required because this change can affect users");
const publishConfirmation = z.literal("CONFIRM_PLAY_CONSOLE_CHANGE").describe("Exact confirmation required because this publishes a Google Play Console change");
const language = z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).max(35);
const imageType = z.enum(["phoneScreenshots", "sevenInchScreenshots", "tenInchScreenshots", "tvScreenshots", "wearScreenshots", "icon", "featureGraphic", "tvBanner"]);
const output = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const projectsRoot = process.env.NODE_ENV === "test" && process.env.GOOGLE_PLAY_TEST_PROJECTS_ROOT
  ? process.env.GOOGLE_PLAY_TEST_PROJECTS_ROOT
  : path.join(process.env.PEON_ARMORY_HOST_HOME ?? os.homedir(), "Projects");
type BundleUploadOperation = {
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
};
const bundleUploads = new Map<string, BundleUploadOperation>();
const MAX_BUNDLE_OPERATIONS = 20;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

type ImageUploadMetadata = {
  committed: true;
  image: {
    id: string;
    sha256?: string;
    url?: string;
  };
};

class ProjectFileError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
  }
}

function rememberBundleUpload(operationId: string, operation: BundleUploadOperation): void {
  bundleUploads.set(operationId, operation);
  while (bundleUploads.size > MAX_BUNDLE_OPERATIONS) bundleUploads.delete(bundleUploads.keys().next().value!);
}

async function projectFile(filePath: string, extension: RegExp, maxBytes: number, label: string): Promise<{ path: string; size: number }> {
  if (!path.isAbsolute(filePath)) throw new Error(`${label} path must be absolute and under ~/Projects`);
  const root = await fs.realpath(projectsRoot).catch(() => undefined);
  const candidate = await fs.realpath(filePath).catch(() => undefined);
  if (!root || !candidate) throw new Error(`${label} file does not exist`);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} path must stay under ~/Projects`);
  const original = await fs.lstat(filePath);
  const details = await fs.stat(candidate);
  if (original.isSymbolicLink() || !details.isFile()) throw new Error(`${label} must be a regular file, not a symbolic link`);
  if (!extension.test(path.extname(candidate)) || details.size < 1 || details.size > maxBytes) throw new Error(`${label} has an invalid extension or size`);
  return { path: candidate, size: details.size };
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function imageMediaType(bytes: Buffer): "image/png" | "image/jpeg" | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    return "image/jpeg";
  }
  return null;
}

async function readImageFile(filePath: string): Promise<{ bytes: Buffer; contentType: "image/png" | "image/jpeg" }> {
  if (!path.isAbsolute(filePath)) throw new ProjectFileError("IMAGE_PATH_INVALID", "image path must be absolute and under ~/Projects");
  const root = await fs.realpath(projectsRoot).catch(() => undefined);
  if (!root) throw new ProjectFileError("IMAGE_ROOT_UNAVAILABLE", "authorized project root is unavailable");
  const candidate = await fs.realpath(filePath).catch(() => undefined);
  if (!candidate) throw new ProjectFileError("IMAGE_FILE_MISSING", "image file does not exist");
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ProjectFileError("IMAGE_PATH_OUTSIDE_ROOT", "image path must stay under ~/Projects");
  }
  const original = await fs.lstat(filePath).catch(() => undefined);
  if (!original) throw new ProjectFileError("IMAGE_FILE_MISSING", "image file does not exist");
  if (original.isSymbolicLink()) throw new ProjectFileError("IMAGE_SYMLINK_UNSUPPORTED", "image must not be a symbolic link");
  if (!/^\.(?:png|jpe?g)$/i.test(path.extname(candidate))) {
    throw new ProjectFileError("IMAGE_MEDIA_UNSUPPORTED", "image extension must be .png, .jpg, or .jpeg");
  }

  const handle = await fs.open(candidate, "r").catch(() => undefined);
  if (!handle) throw new ProjectFileError("IMAGE_FILE_MISSING", "image file could not be opened");
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new ProjectFileError("IMAGE_NOT_REGULAR", "image must be a regular file");
    if (!sameFile(original, before)) throw new ProjectFileError("IMAGE_FILE_CHANGED", "image changed before it could be validated");
    if (before.size < 1 || before.size > MAX_IMAGE_BYTES) {
      throw new ProjectFileError("IMAGE_SIZE_INVALID", "image must be between 1 byte and 15 MiB");
    }
    const testDelay = process.env.NODE_ENV === "test" ? Number(process.env.GOOGLE_PLAY_TEST_IMAGE_READ_DELAY_MS ?? 0) : 0;
    if (Number.isFinite(testDelay) && testDelay > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(testDelay, 1000)));
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const current = await fs.stat(candidate).catch(() => undefined);
    if (!current || !sameFile(before, after) || !sameFile(after, current) || bytes.length !== before.size) {
      throw new ProjectFileError("IMAGE_FILE_CHANGED", "image changed while it was being validated");
    }
    const contentType = imageMediaType(bytes);
    if (!contentType) throw new ProjectFileError("IMAGE_MEDIA_UNSUPPORTED", "image bytes must be PNG or JPEG");
    const expected = /\.png$/i.test(candidate) ? "image/png" : "image/jpeg";
    if (contentType !== expected) throw new ProjectFileError("IMAGE_MEDIA_MISMATCH", "image extension does not match its bytes");
    return { bytes, contentType };
  } finally {
    await handle.close();
  }
}

function boundedImageUploadMetadata(value: unknown): ImageUploadMetadata {
  const image = value && typeof value === "object" && "mutation" in value
    ? (value as { mutation?: unknown }).mutation
    : undefined;
  const record = image && typeof image === "object" && "image" in image
    ? (image as { image?: unknown }).image
    : undefined;
  if (!record || typeof record !== "object") throw new Error("IMAGE_UPLOAD_RESPONSE_INVALID: Google Play returned no image metadata");
  const raw = record as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.slice(0, 255) : "";
  if (!id) throw new Error("IMAGE_UPLOAD_RESPONSE_INVALID: Google Play returned no image id");
  const sha256 = typeof raw.sha256 === "string" && raw.sha256.length <= 128 ? raw.sha256 : undefined;
  const url = typeof raw.url === "string" && raw.url.length <= 2048 ? raw.url : undefined;
  return { committed: true, image: { id, ...(sha256 ? { sha256 } : {}), ...(url ? { url } : {}) } };
}

server.registerTool("list_releases", {
  description: "List current non-obsolete releases and review lifecycle state for a Google Play track.",
  inputSchema: { packageName, track: track.default("production") },
}, async ({ packageName, track }) => output(await api.listReleases(packageName, track)));

server.registerTool("list_tracks", {
  description: "List tracks and their active releases using a temporary read-only edit that is deleted afterward.",
  inputSchema: { packageName },
}, async ({ packageName }) => output(await api.listTracks(packageName)));

server.registerTool("list_listings", {
  description: "List all localized Google Play store listings using a temporary read-only edit.",
  inputSchema: { packageName },
}, async ({ packageName }) => output(await api.listListings(packageName)));

server.registerTool("update_listing", {
  description: "Patch and publish a localized store listing. Requires explicit confirmation.",
  inputSchema: {
    packageName, language, title: z.string().min(1).max(30).optional(),
    shortDescription: z.string().min(1).max(80).optional(), fullDescription: z.string().min(1).max(4000).optional(),
    video: z.url().max(2048).optional(), confirmation: publishConfirmation,
  },
}, async ({ packageName, language, title, shortDescription, fullDescription, video }) => {
  const listing = { ...(title ? { title } : {}), ...(shortDescription ? { shortDescription } : {}),
    ...(fullDescription ? { fullDescription } : {}), ...(video ? { video } : {}) };
  if (Object.keys(listing).length === 0) throw new Error("At least one listing field is required");
  return output(await api.updateListing(packageName, language, listing));
});

server.registerTool("list_images", {
  description: "List screenshots and store listing graphics for a language and image type.",
  inputSchema: { packageName, language, imageType },
}, async ({ packageName, language, imageType }) => output(await api.listImages(packageName, language, imageType)));

server.registerTool("upload_image", {
  description: "Upload and publish a PNG or JPEG screenshot/store graphic from an absolute file path under ~/Projects. Requires explicit confirmation.",
  inputSchema: { packageName, language, imageType, filePath: z.string().min(1).max(4096),
    aiGeneratedState: z.enum(["aiGeneratedStateNotAiGenerated", "aiGeneratedStateAiGeneratedDeveloperAttested"]).optional(),
    confirmation: publishConfirmation },
}, async ({ packageName, language, imageType, filePath, aiGeneratedState }) => {
  const image = await readImageFile(filePath);
  const result = await api.uploadImage(packageName, language, imageType, image.contentType, image.bytes, aiGeneratedState);
  return output(boundedImageUploadMetadata(result));
});

server.registerTool("upload_bundle", {
  description: "Start an asynchronous Android App Bundle upload from an absolute .aab path under ~/Projects. Returns an operationId; poll get_bundle_upload_status until succeeded or failed. Requires explicit confirmation.",
  inputSchema: { packageName, filePath: z.string().min(1).max(4096),
    deviceTierConfigId: z.string().min(1).max(100).optional(), confirmation: publishConfirmation },
}, async ({ packageName, filePath, deviceTierConfigId }) => {
  const bundle = await projectFile(filePath, /^\.aab$/i, 53_687_091_200, "Android App Bundle");
  const operationId = randomUUID();
  const startedAt = new Date().toISOString();
  rememberBundleUpload(operationId, { status: "running", startedAt });
  void api.uploadBundle(packageName, bundle.path, deviceTierConfigId).then(
    (result) => rememberBundleUpload(operationId, { status: "succeeded", startedAt, finishedAt: new Date().toISOString(), result }),
    (error) => rememberBundleUpload(operationId, {
      status: "failed", startedAt, finishedAt: new Date().toISOString(),
      error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    }),
  );
  return output({ operationId, status: "running", next: "Call get_bundle_upload_status with this operationId until the status is succeeded or failed." });
});

server.registerTool("get_bundle_upload_status", {
  description: "Poll a bundle upload operation started by upload_bundle.",
  inputSchema: { operationId: z.uuid() },
}, async ({ operationId }) => {
  const operation = bundleUploads.get(operationId);
  if (!operation) throw new Error("Bundle upload operation is unknown or no longer retained");
  return output({ operationId, ...operation });
});

server.registerTool("delete_image", {
  description: "Delete and publish removal of a screenshot or store graphic. Requires explicit confirmation.",
  inputSchema: { packageName, language, imageType, imageId: z.string().min(1).max(255), confirmation: publishConfirmation },
}, async ({ packageName, language, imageType, imageId }) => output(await api.deleteImage(packageName, language, imageType, imageId)));

server.registerTool("update_data_safety", {
  description: "Submit and publish the complete Google Play Data Safety CSV declaration. Requires explicit confirmation.",
  inputSchema: { packageName, safetyLabelsCsv: z.string().min(1).max(2_000_000), confirmation: publishConfirmation },
}, async ({ packageName, safetyLabelsCsv }) => output(await api.updateDataSafety(packageName, safetyLabelsCsv)));

server.registerTool("convert_region_prices", {
  description: "Preview Google Play regional prices from a tax-exclusive base price; this does not change pricing.",
  inputSchema: { packageName, currencyCode: z.string().regex(/^[A-Z]{3}$/), units: z.string().regex(/^(0|[1-9][0-9]*)$/).max(18),
    nanos: z.number().int().min(0).max(999_999_999).optional(), productTaxCategoryCode: z.string().min(1).max(100).optional() },
}, async ({ packageName, currencyCode, units, nanos, productTaxCategoryCode }) => output(await api.convertRegionPrices(packageName,
  { currencyCode, units, ...(nanos !== undefined ? { nanos } : {}) }, productTaxCategoryCode)));

server.registerTool("promote_release", {
  description: "Promote existing version codes to another track and commit the change. This affects app distribution and requires explicit confirmation.",
  inputSchema: {
    packageName,
    targetTrack: track,
    versionCodes: z.array(versionCode).min(1).max(100),
    name: z.string().min(1).max(200).optional(),
    status: z.enum(["draft", "inProgress", "completed"]).default("draft"),
    userFraction: z.number().gt(0).lt(1).optional(),
    inAppUpdatePriority: z.number().int().min(0).max(5).optional(),
    releaseNotes: z.array(z.object({ language: z.string().min(2).max(35), text: z.string().min(1).max(500) })).max(100).optional(),
    confirmation,
  },
}, async ({ packageName, targetTrack, versionCodes, name, status, userFraction, inAppUpdatePriority, releaseNotes }) => {
  if (status === "inProgress" && userFraction === undefined) throw new Error("userFraction is required for an in-progress release");
  if (status !== "inProgress" && userFraction !== undefined) throw new Error("userFraction is only valid for an in-progress release");
  return output(await api.promoteRelease(packageName, targetTrack, {
    versionCodes, status, ...(name ? { name } : {}), ...(userFraction !== undefined ? { userFraction } : {}),
    ...(inAppUpdatePriority !== undefined ? { inAppUpdatePriority } : {}), ...(releaseNotes ? { releaseNotes } : {}),
  }));
});

server.registerTool("update_rollout", {
  description: "Start, adjust, halt, or complete an active release rollout and commit the change. This affects users and requires explicit confirmation.",
  inputSchema: {
    packageName, track, versionCode,
    status: z.enum(["inProgress", "halted", "completed"]),
    userFraction: z.number().gt(0).lt(1).optional(),
    confirmation,
  },
}, async ({ packageName, track, versionCode, status, userFraction }) => {
  if ((status === "inProgress" || status === "halted") && userFraction === undefined) {
    throw new Error("userFraction is required for an in-progress or halted rollout");
  }
  if (status === "completed" && userFraction !== undefined) throw new Error("userFraction is not valid for a completed rollout");
  return output(await api.updateRelease(packageName, track, versionCode, { status, userFraction }));
});

await server.connect(new StdioServerTransport());
