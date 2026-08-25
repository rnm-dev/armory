import { randomBytes, randomUUID } from "node:crypto";
import { CloudflareClient } from "./client.js";
import type { CloudflareCapabilities, CloudflareConfig } from "./config.js";

export async function detectCapabilities(
  client: CloudflareClient,
  config: Pick<CloudflareConfig, "accountId">,
): Promise<CloudflareCapabilities> {
  const missingId = randomBytes(16).toString("hex");
  const zones = await client.request<Array<{ id?: string }>>(
    `/zones?account.id=${config.accountId}&page=1&per_page=5`,
  ).catch(() => []);
  const probeZoneId = zones.find(({ id }) => typeof id === "string")?.id ?? missingId;
  const missingProject = `armory-permission-probe-${randomBytes(8).toString("hex")}`;
  const accountPath = `/accounts/${config.accountId}`;
  const probe = (path: string, method: "PATCH" | "PUT", body = "{}") => client.hasPermission(path, {
    method,
    body,
  }).catch(() => false);

  const [zoneEdit, dns, tunnels, turnstile, pages, workers] = await Promise.all([
    probe(`/zones/${probeZoneId}`, "PATCH", JSON.stringify({ paused: "armory-permission-probe" })),
    probe(`/zones/${probeZoneId}/dns_records/${missingId}`, "PATCH"),
    probe(`${accountPath}/cfd_tunnel/${randomUUID()}`, "PATCH"),
    probe(`${accountPath}/challenges/widgets/${missingId}`, "PUT"),
    probe(`${accountPath}/pages/projects/${missingProject}`, "PATCH"),
    client.hasPermission(`${accountPath}/workers/scripts/${missingProject}`, { method: "GET" }).catch(() => false),
  ]);

  return { zones: zoneEdit, dns, tunnels, turnstile, pages, workers };
}
