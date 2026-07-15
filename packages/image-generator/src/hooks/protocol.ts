export type HookInput = {
  protocolVersion: 1;
  type: "input";
  operation: "configure" | "verify";
  package: { id: string; version: string; dir: string; home: string };
  platform: { os: "darwin" | "linux"; arch: "x64" | "arm64" };
  configuration?: Record<string, string>;
};

export async function readInput(): Promise<HookInput> {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 2 * 1024 * 1024) throw new Error("input too large");
  }
  const lines = input.trim().split("\n");
  if (lines.length !== 1) throw new Error("expected exactly one input message");
  return JSON.parse(lines[0]) as HookInput;
}

export function result(value: { ok: true; message: string; ownedPaths?: string[] } | { ok: false; message: string; errorCode: string }): void {
  process.stdout.write(`${JSON.stringify({ protocolVersion: 1, type: "result", ...value })}\n`);
}
