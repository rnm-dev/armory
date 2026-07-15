export type {
  ArmoryCatalogV1,
  Package as ArmoryCatalogPackageV1,
  Version as ArmoryCatalogVersionV1,
  Platform as ArmoryPlatformV1,
  Archive as ArmoryArchiveV1,
  PackageId,
} from "./generated/armory-v1.js";
export type {
  ArmoryManifestV1,
  Permissions as ArmoryPermissionsV1,
  Command as ArmoryCommandV1,
  Configuration as ArmoryConfigurationV1,
  Field as ArmoryConfigurationFieldV1,
} from "./generated/package-v1.js";
export type {
  ArmoryHookMessageV1,
  Progress as ArmoryHookProgressV1,
} from "./generated/hook-message-v1.js";

import type {
  ConfigureInput,
  FailureResult,
  PostInstallInput,
  PreUninstallInput,
  SuccessResult,
  VerifyInput,
} from "./generated/hook-message-v1.js";

export type ArmoryHookInputV1 =
  | PostInstallInput
  | ConfigureInput
  | VerifyInput
  | PreUninstallInput;

export type ArmoryHookResultV1 = SuccessResult | FailureResult;
