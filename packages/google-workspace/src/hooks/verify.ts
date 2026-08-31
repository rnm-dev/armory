import { GoogleWorkspaceClient } from "../client.js"; import { readConfig } from "../config.js"; import { readInput, result } from "./protocol.js";
try { const input = await readInput(); if (input.operation !== "verify") throw new Error("invalid verify input");
  await new GoogleWorkspaceClient(await readConfig(input.package.home)).verifyCredentials();
  result({ ok: true, message: "Google Workspace connection verified" });
} catch { result({ ok: false, message: "Google Workspace connection could not be verified. Enable the Drive, Docs, Sheets, and Slides APIs in the service account's Google Cloud project, then retry.", errorCode: "VERIFICATION_FAILED" }); process.exitCode = 1; }
