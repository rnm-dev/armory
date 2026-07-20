import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GooglePlayClient } from "./client.js";
import { readConfig } from "./config.js";

const home = process.env.PEON_ARMORY_HOME;
if (!home) throw new Error("PEON_ARMORY_HOME is required");
const api = new GooglePlayClient(await readConfig(home));
const server = new McpServer({ name: "armory-google-play", version: "0.1.0" });
const packageName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/).max(255).optional();
const track = z.string().min(1).max(255);
const versionCode = z.string().regex(/^[1-9][0-9]*$/).max(20);
const confirmation = z.literal("CONFIRM_RELEASE_CHANGE").describe("Exact confirmation required because this change can affect users");
const output = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

server.registerTool("list_releases", {
  description: "List current non-obsolete releases and review lifecycle state for a Google Play track.",
  inputSchema: { packageName, track: track.default("production") },
}, async ({ packageName, track }) => output(await api.listReleases(api.packageName(packageName), track)));

server.registerTool("list_tracks", {
  description: "List tracks and their active releases using a temporary read-only edit that is deleted afterward.",
  inputSchema: { packageName },
}, async ({ packageName }) => output(await api.listTracks(api.packageName(packageName))));

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
  return output(await api.promoteRelease(api.packageName(packageName), targetTrack, {
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
  return output(await api.updateRelease(api.packageName(packageName), track, versionCode, { status, userFraction }));
});

await server.connect(new StdioServerTransport());
