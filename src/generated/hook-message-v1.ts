/* Generated from the checked-in V1 JSON schema. Do not edit. */

export type ArmoryHookMessageV1 =
  PostInstallInput | ConfigureInput | VerifyInput | PreUninstallInput | Progress | SuccessResult | FailureResult;
export type Id = string;
export type Semver = string;

export interface PostInstallInput {
  protocolVersion: 1;
  type: "input";
  operation: "post_install";
  package: Package;
  platform: Platform;
}
export interface Package {
  id: Id;
  version: Semver;
  dir: string;
  home: string;
}
export interface Platform {
  os: "darwin" | "linux";
  arch: "x64" | "arm64";
}
export interface ConfigureInput {
  protocolVersion: 1;
  type: "input";
  operation: "configure";
  package: Package;
  platform: Platform;
  configuration: {
    [k: string]: string;
  };
}
export interface VerifyInput {
  protocolVersion: 1;
  type: "input";
  operation: "verify";
  package: Package;
  platform: Platform;
}
export interface PreUninstallInput {
  protocolVersion: 1;
  type: "input";
  operation: "pre_uninstall";
  package: Package;
  platform: Platform;
}
export interface Progress {
  protocolVersion: 1;
  type: "progress";
  phase: string;
  message: string;
  percent: number | null;
}
export interface SuccessResult {
  protocolVersion: 1;
  type: "result";
  ok: true;
  message: string;
  ownedPaths?: string[];
}
export interface FailureResult {
  protocolVersion: 1;
  type: "result";
  ok: false;
  message: string;
  errorCode: string;
}
