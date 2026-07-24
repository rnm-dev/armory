import { AppStoreConnectApiError, AppStoreConnectClient } from "../client.js";
import { readConfig } from "../config.js";
import { readInput, result } from "./protocol.js";

try {
  const input = await readInput();
  if (input.operation !== "verify") throw new Error("invalid verify input");
  const config = await readConfig(input.package.home);
  await new AppStoreConnectClient(config).listApps(1);
  result({ ok: true, message: "App Store Connect connection verified" });
} catch (error) {
  const denied = error instanceof AppStoreConnectApiError && (error.httpStatus === 401 || error.httpStatus === 403);
  result({
    ok: false,
    message: denied
      ? "App Store Connect rejected the Team API key or its role permissions"
      : "App Store Connect connection could not be verified",
    errorCode: denied ? "CREDENTIAL_OR_PERMISSION_DENIED" : "VERIFICATION_FAILED",
  });
  process.exitCode = 1;
}
