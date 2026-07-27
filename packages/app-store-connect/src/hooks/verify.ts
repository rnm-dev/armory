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
  const authentication = error instanceof AppStoreConnectApiError && error.httpStatus === 401;
  result({
    ok: false,
    message: authentication
      ? "App Store Connect rejected the API key credentials; check the key type, Key ID, and matching .p8 file"
      : denied
      ? "App Store Connect accepted the API key but its role does not allow listing apps"
      : "App Store Connect connection could not be verified",
    errorCode: authentication
      ? "CREDENTIAL_INVALID"
      : denied ? "PERMISSION_DENIED" : "VERIFICATION_FAILED",
  });
  process.exitCode = 1;
}
