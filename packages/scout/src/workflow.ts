import { readConfig, SCOUT_URL } from "./config.js";
const home = process.env.PEON_ARMORY_HOME; if (!home) throw new Error("PEON_ARMORY_HOME is required");
let raw = ""; for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw) as { operation: string; requestId?: string; executionId?: string; leaseToken?: string; consumer?: string; sessionId?: string; runId?: string; state?: string; outcome?: string; summary?: string };
const { apiKey } = await readConfig(home);
let path = "/integrations/api/workflow/claims"; let method = "POST"; let body: unknown = { consumer: input.consumer };
const headers: Record<string,string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
if (input.requestId) headers["Idempotency-Key"] = input.requestId;
if (input.executionId) path = `/integrations/api/workflow/executions/${encodeURIComponent(input.executionId)}`;
if (input.leaseToken) headers["X-Workflow-Lease"] = input.leaseToken;
if (input.operation === "attach") { path += "/heartbeat"; body = { state: "starting", session_id: input.sessionId, run_id: input.runId }; }
else if (input.operation === "heartbeat") { path += "/heartbeat"; body = { state: input.state, session_id: input.sessionId, run_id: input.runId }; }
else if (input.operation === "read") { method = "GET"; body = undefined; }
else if (input.operation === "finish") { path += "/finish"; body = { outcome: input.outcome, summary: input.summary }; }
const response = await fetch(`${SCOUT_URL}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
const value = await response.json().catch(() => ({}));
let mcp: unknown;
if (input.operation === "claim" && response.ok && (value as any)?.execution) {
  const config = await fetch(`${SCOUT_URL}/mcp.json`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
  if (!config.ok) throw new Error(`Scout mcp.json returned ${config.status}`);
  mcp = await config.json();
}
process.stdout.write(`${JSON.stringify({ ok: response.ok, status: response.status, value, ...(mcp === undefined ? {} : { mcp }) })}\n`);
