/* Generated from the checked-in V1 JSON schema. Do not edit. */

export type PackageId = string;
export type Semver = string;

export interface ArmoryCatalogV1 {
  schemaVersion: 1;
  name: "rnm-dev/armory";
  updatedAt: string;
  packages: Package[];
}
export interface Package {
  id: PackageId;
  displayName: string;
  summary: string;
  publisher: "rnm-dev";
  documentationUrl: string;
  latest: Semver;
  requirements: {
    credentials: boolean;
    localDependencies: boolean;
    hostWrites: boolean;
  };
  /**
   * @minItems 1
   */
  versions: [Version, ...Version[]];
}
export interface Version {
  version: Semver;
  minPeonVersion: Semver;
  /**
   * @minItems 1
   */
  platforms: [Platform, ...Platform[]];
  archive: Archive;
}
export interface Platform {
  os: "darwin" | "linux";
  arch: "x64" | "arm64";
}
export interface Archive {
  url: string;
  size: number;
  sha256: string;
}
