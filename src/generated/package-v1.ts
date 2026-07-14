/* Generated from the checked-in V1 JSON schema. Do not edit. */

export type Id = string;
export type Semver = string;
export type DependencyStrategy =
  | {
      type: "external";
      command: string;
      /**
       * @maxItems 64
       */
      args: string[];
      version: VersionParser;
    }
  | {
      type: "managed";
      /**
       * @minItems 1
       */
      platforms: [
        {
          os: "darwin" | "linux";
          arch: "x64" | "arm64";
          archive: Archive;
          format: "tar.gz" | "zip" | "binary";
          executablePath: RelativePath;
          version: Semver;
        },
        ...{
          os: "darwin" | "linux";
          arch: "x64" | "arm64";
          archive: Archive;
          format: "tar.gz" | "zip" | "binary";
          executablePath: RelativePath;
          version: Semver;
        }[]
      ];
    }
  | {
      type: "package";
      executablePath: RelativePath;
      version: Semver;
    }
  | {
      type: "manual";
      /**
       * @minItems 1
       */
      platforms: [
        {
          os: "darwin" | "linux";
          arch: "x64" | "arm64";
          instructions: string;
        },
        ...{
          os: "darwin" | "linux";
          arch: "x64" | "arm64";
          instructions: string;
        }[]
      ];
    };
export type RelativePath = string;
export type Field = {
  [k: string]: any;
} & {
  [k: string]: any;
} & {
  id: FieldId;
  label: string;
  help?: string;
  type: "text" | "secret" | "select" | "file";
  required: boolean;
  sensitive: boolean;
  /**
   * @minItems 1
   */
  options?: [
    {
      value: string;
      label: string;
    },
    ...{
      value: string;
      label: string;
    }[]
  ];
  validation?: {
    pattern?: string;
    maxLength?: number;
  };
} & {
  id: FieldId;
  label: string;
  help?: string;
  type: "text" | "secret" | "select" | "file";
  required: boolean;
  sensitive: boolean;
  /**
   * @minItems 1
   */
  options?: [
    {
      value: string;
      label: string;
    },
    ...{
      value: string;
      label: string;
    }[]
  ];
  validation?: {
    pattern?: string;
    maxLength?: number;
  };
};
export type FieldId = string;

export interface ArmoryManifestV1 {
  schemaVersion: 1;
  id: Id;
  version: Semver;
  minPeonVersion: Semver;
  /**
   * @minItems 1
   */
  platforms: [Platform, ...Platform[]];
  permissions: Permissions;
  dependencies: Dependency[];
  configuration?: Configuration;
  lifecycle?: Lifecycle;
  mcp: Mcp;
}
export interface Platform {
  os: "darwin" | "linux";
  arch: "x64" | "arm64";
}
export interface Permissions {
  networkHosts: string[];
  hostPaths: {
    path: string;
    mode: "read" | "write";
    purpose: string;
  }[];
}
export interface Dependency {
  id: Id;
  displayName: string;
  versionRange: string;
  /**
   * @minItems 1
   */
  strategies: [DependencyStrategy, ...DependencyStrategy[]];
  verify?: Command;
}
export interface VersionParser {
  source: "stdout" | "stderr";
  pattern: string;
}
export interface Archive {
  url: string;
  size: number;
  sha256: string;
}
export interface Command {
  executable: string;
  /**
   * @maxItems 128
   */
  args: string[];
}
export interface Configuration {
  /**
   * @minItems 1
   */
  fields: [Field, ...Field[]];
  handler: Command;
  verifyHandler?: Command;
  managedPaths: RelativePath[];
  environment?: {
    [k: string]: RelativePath;
  };
}
export interface Lifecycle {
  postInstall?: Command;
  preUninstall?: Command;
}
export interface Mcp {
  command: Command;
  toolPrefix: string;
  startupTimeoutMs?: number;
  callTimeoutMs?: number;
}
