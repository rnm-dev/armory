let raw = "";
export async function readInput(): Promise<any> { for await (const chunk of process.stdin) raw += chunk; return JSON.parse(raw); }
export function result(value: object): void { process.stdout.write(`${JSON.stringify({ protocolVersion: 1, type: "result", ...value })}\n`); }
