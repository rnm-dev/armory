import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { blake3 } from "hash-wasm";
import path from "node:path";
import { promisify } from "node:util";
import mime from "mime";
import type { CloudflareClient } from "./client.js";

const execFileAsync = promisify(execFile);
const MAX_FILES = 20_000;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_BUCKET_FILES = 2_000;
const MAX_BUCKET_SIZE = 40 * 1024 * 1024;
const ignoredDirectories = new Set(["functions", "node_modules", ".git", ".wrangler"]);
const specialFiles = new Set(["_worker.js", "_headers", "_redirects", "_routes.json"]);

type Asset = {
  absolutePath: string;
  relativePath: string;
  hash: string;
  contentType: string;
  size: number;
};

type Deployment = {
  id?: string;
  project_name?: string;
  environment?: string;
  url?: string;
  aliases?: string[];
  created_on?: string;
  latest_stage?: unknown;
  deployment_trigger?: unknown;
};

type DirectUploadOptions = {
  api: CloudflareClient;
  home: string;
  accountId: string;
  projectName: string;
  projectPath: string;
  artifactPath: string;
  functionsPath: string;
  branch?: string;
  commitHash?: string;
  commitMessage?: string;
  commitDirty: boolean;
};

function resolveWithin(root: string, relativePath: string, label: string): string {
  if (path.isAbsolute(relativePath)) throw new Error(`${label} must be relative to projectPath`);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return resolved;
  throw new Error(`${label} must stay within projectPath`);
}

async function requireDirectory(candidate: string, label: string): Promise<string> {
  const candidateDetails = await fs.lstat(candidate).catch(() => undefined);
  if (!candidateDetails) throw new Error(`${label} does not exist`);
  if (candidateDetails.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`);
  const resolved = await fs.realpath(candidate).catch(() => undefined);
  if (!resolved) throw new Error(`${label} does not exist`);
  const details = await fs.lstat(resolved);
  if (!details.isDirectory()) throw new Error(`${label} must be a real directory`);
  return resolved;
}

async function hashAsset(contents: Buffer, filename: string): Promise<string> {
  const extension = path.extname(filename).slice(1);
  return (await blake3(contents.toString("base64") + extension)).slice(0, 32);
}

async function collectAssets(artifactRoot: string): Promise<Asset[]> {
  const assets: Asset[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(artifactRoot, absolutePath).split(path.sep).join("/");
      if (entry.isSymbolicLink()) throw new Error(`Pages artifact contains a forbidden symbolic link: ${relativePath}`);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || entry.name === ".DS_Store" || (!relativePath.includes("/") && specialFiles.has(entry.name))) continue;
      const details = await fs.stat(absolutePath);
      if (details.size > MAX_FILE_SIZE) throw new Error(`Pages asset exceeds 25 MiB: ${relativePath}`);
      const contents = await fs.readFile(absolutePath);
      assets.push({
        absolutePath,
        relativePath,
        hash: await hashAsset(contents, entry.name),
        contentType: mime.getType(entry.name) || "application/octet-stream",
        size: details.size,
      });
      if (assets.length > MAX_FILES) throw new Error(`Pages artifact exceeds ${MAX_FILES} files`);
    }
  };
  await walk(artifactRoot);
  return assets;
}

async function optionalFile(filename: string): Promise<Buffer | undefined> {
  return fs.readFile(filename).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

async function compileFunctions(
  projectRoot: string,
  artifactRoot: string,
  functionsRelativePath: string,
  temporaryDirectory: string,
): Promise<{ worker?: Buffer; routes?: Buffer; routingConfig?: Buffer }> {
  const artifactWorker = await optionalFile(path.join(artifactRoot, "_worker.js"));
  if (artifactWorker) {
    return { worker: artifactWorker, routes: await optionalFile(path.join(artifactRoot, "_routes.json")) };
  }

  const functionsCandidate = resolveWithin(projectRoot, functionsRelativePath, "functionsPath");
  const functionsCandidateDetails = await fs.lstat(functionsCandidate).catch(() => undefined);
  if (functionsCandidateDetails?.isSymbolicLink()) throw new Error("functionsPath must not be a symbolic link");
  const functionsRoot = await fs.realpath(functionsCandidate).catch(() => undefined);
  if (!functionsRoot) return { routes: await optionalFile(path.join(artifactRoot, "_routes.json")) };
  const functionsRelative = path.relative(projectRoot, functionsRoot);
  if (functionsRelative.startsWith("..") || path.isAbsolute(functionsRelative)) {
    throw new Error("functionsPath resolves outside projectPath");
  }
  if (!(await fs.lstat(functionsRoot)).isDirectory()) throw new Error("functionsPath must be a directory");

  const wranglerEntry = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
  const wranglerRealPath = await fs.realpath(wranglerEntry).catch(() => undefined);
  if (!wranglerRealPath || path.relative(projectRoot, wranglerRealPath).startsWith("..")) {
    throw new Error("Local Wrangler is required at projectPath/node_modules/wrangler to compile Pages Functions");
  }

  const workerPath = path.join(temporaryDirectory, "_worker.js");
  const routesPath = path.join(temporaryDirectory, "_routes.json");
  const routingConfigPath = path.join(temporaryDirectory, "functions-filepath-routing-config.json");
  try {
    await execFileAsync(process.execPath, [
      wranglerRealPath,
      "pages", "functions", "build", functionsRoot,
      "--outfile", workerPath,
      "--output-routes-path", routesPath,
      "--output-config-path", routingConfigPath,
      "--build-output-directory", artifactRoot,
      "--project-directory", projectRoot,
      "--install-skills=false",
    ], {
      cwd: projectRoot,
      env: {
        PATH: process.env.PATH || "",
        NO_COLOR: "1",
        WRANGLER_SEND_METRICS: "false",
      },
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new Error("Pages Functions compilation failed; run the local Wrangler build for diagnostic details");
  }

  return {
    worker: await fs.readFile(workerPath),
    routes: await optionalFile(path.join(artifactRoot, "_routes.json")) || await optionalFile(routesPath),
    routingConfig: await optionalFile(routingConfigPath),
  };
}

function createBuckets(assets: Asset[]): Asset[][] {
  const buckets: Asset[][] = [];
  for (const asset of [...assets].sort((left, right) => right.size - left.size)) {
    let bucket = buckets.find((candidate) => candidate.length < MAX_BUCKET_FILES
      && candidate.reduce((total, item) => total + item.size, 0) + asset.size <= MAX_BUCKET_SIZE);
    if (!bucket) {
      bucket = [];
      buckets.push(bucket);
    }
    bucket.push(asset);
  }
  return buckets;
}

async function uploadAssets(api: CloudflareClient, accountId: string, projectName: string, assets: Asset[]) {
  const { jwt } = await api.request<{ jwt: string }>(
    `/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/upload-token`,
  );
  const missingHashes = await api.requestWithBearer<string[]>("/pages/assets/check-missing", jwt, {
    method: "POST",
    body: JSON.stringify({ hashes: assets.map((asset) => asset.hash) }),
  });
  const missing = new Set(missingHashes);
  const pendingAssets = assets.filter((asset) => missing.has(asset.hash));
  for (const bucket of createBuckets(pendingAssets)) {
    const payload = await Promise.all(bucket.map(async (asset) => ({
      key: asset.hash,
      value: (await fs.readFile(asset.absolutePath)).toString("base64"),
      metadata: { contentType: asset.contentType },
      base64: true,
    })));
    await api.requestWithBearer("/pages/assets/upload", jwt, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
  await api.requestWithBearer("/pages/assets/upsert-hashes", jwt, {
    method: "POST",
    body: JSON.stringify({ hashes: assets.map((asset) => asset.hash) }),
  }).catch(() => undefined);
  return {
    manifest: Object.fromEntries(assets.map((asset) => [`/${asset.relativePath}`, asset.hash])),
    uploaded: pendingAssets.length,
    cached: assets.length - pendingAssets.length,
  };
}

function setFile(form: FormData, field: string, contents: Buffer | undefined, filename: string) {
  if (contents) form.set(field, new File([contents], filename));
}

export async function directUploadPagesProject(options: DirectUploadOptions) {
  if (!path.isAbsolute(options.projectPath)) throw new Error("projectPath must be absolute");
  const projectRoot = await requireDirectory(options.projectPath, "projectPath");
  const artifactRoot = await requireDirectory(
    resolveWithin(projectRoot, options.artifactPath, "artifactPath"),
    "artifactPath",
  );
  const artifactRelative = path.relative(projectRoot, artifactRoot);
  if (artifactRelative.startsWith("..") || path.isAbsolute(artifactRelative)) {
    throw new Error("artifactPath resolves outside projectPath");
  }

  const runtimeDirectory = path.join(options.home, "runtime");
  await fs.mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  const temporaryDirectory = await fs.mkdtemp(path.join(runtimeDirectory, "pages-direct-upload-"));
  try {
    const [assets, functions, headers, redirects] = await Promise.all([
      collectAssets(artifactRoot),
      compileFunctions(projectRoot, artifactRoot, options.functionsPath, temporaryDirectory),
      optionalFile(path.join(artifactRoot, "_headers")),
      optionalFile(path.join(artifactRoot, "_redirects")),
    ]);
    if (assets.length === 0) throw new Error("Pages artifact does not contain deployable assets");
    const { manifest, uploaded, cached } = await uploadAssets(
      options.api,
      options.accountId,
      options.projectName,
      assets,
    );

    const form = new FormData();
    form.set("manifest", JSON.stringify(manifest));
    if (options.branch !== undefined) form.set("branch", options.branch);
    if (options.commitHash !== undefined) form.set("commit_hash", options.commitHash);
    if (options.commitMessage !== undefined) form.set("commit_message", options.commitMessage);
    form.set("commit_dirty", String(options.commitDirty));
    setFile(form, "_headers", headers, "_headers");
    setFile(form, "_redirects", redirects, "_redirects");
    setFile(form, "_worker.js", functions.worker, "_worker.js");
    setFile(form, "_routes.json", functions.routes, "_routes.json");
    setFile(form, "functions-filepath-routing-config.json", functions.routingConfig, "functions-filepath-routing-config.json");

    const deployment = await options.api.request<Deployment>(
      `/accounts/${options.accountId}/pages/projects/${encodeURIComponent(options.projectName)}/deployments`,
      { method: "POST", body: form },
    );
    return {
      id: deployment.id,
      projectName: deployment.project_name ?? options.projectName,
      environment: deployment.environment,
      url: deployment.url,
      aliases: deployment.aliases,
      createdOn: deployment.created_on,
      latestStage: deployment.latest_stage,
      deploymentTrigger: deployment.deployment_trigger,
      files: assets.length,
      uploadedFiles: uploaded,
      cachedFiles: cached,
      functionsIncluded: functions.worker !== undefined,
    };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}
