import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
  const image = await projectFile(filePath, /^\.(?:png|jpe?g)$/i, 15_728_640, "image");
  const contentType = /\.png$/i.test(image.path) ? "image/png" : "image/jpeg";
  const bytes = await fs.readFile(image.path);
  return output(await api.uploadImage(packageName, language, imageType, contentType, bytes, aiGeneratedState));
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
