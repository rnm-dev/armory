import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const accessToken = "google_play_test_access_token_that_must_not_leak";
const defaultPackage = "com.example.app";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const privateKeySecret = privateKeyPem.split("\n")[1];
const credentials = JSON.stringify({
  type: "service_account",
  client_email: "play-releases@example-project.iam.gserviceaccount.com",
  private_key: privateKeyPem,
  private_key_id: "test-key-id",
  project_id: "example-project",
});

async function runHook(name, input, env) {
  const child = spawn(process.execPath, [path.join(packageDir, "dist", "hooks", `${name}.js`)], {
    env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(`${JSON.stringify(input)}\n`);
  const code = await new Promise((resolve) => child.once("close", resolve));
  return { code, stdout, stderr };
}

async function startGoogleApi() {
  const requests = [];
  let nextEdit = 0;
  const tracks = {
    production: { track: "production", releases: [{ name: "1.0", versionCodes: ["100"], status: "inProgress", userFraction: 0.2 }] },
    beta: { track: "beta", releases: [] },
  };
  const listings = { "en-US": { language: "en-US", title: "Example", shortDescription: "Before" } };
  const images = { "en-US/phoneScreenshots": [{ id: "old-image", url: "https://example.test/old.png" }] };
  const bundles = [];
  let dataSafety;
  let convertedPrice;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, contentType: req.headers["content-type"], body });
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/token") {
      const params = new URLSearchParams(body);
      const assertion = params.get("assertion");
      assert(assertion);
      const claims = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString("utf8"));
      assert.equal(claims.iss, "play-releases@example-project.iam.gserviceaccount.com");
      assert.equal(claims.scope, "https://www.googleapis.com/auth/androidpublisher");
      res.end(JSON.stringify({ access_token: accessToken, expires_in: 3600 }));
      return;
    }
    if (req.headers.authorization !== `Bearer ${accessToken}`) {
      res.writeHead(401).end(JSON.stringify({ error: { message: "unauthorized" } }));
      return;
    }
    const base = `/androidpublisher/v3/applications/${defaultPackage}`;
    const uploadBase = `/upload/androidpublisher/v3/applications/${defaultPackage}`;
    const uploadMatch = req.url?.match(new RegExp(`^${uploadBase}/edits/([0-9]+)/listings/([^/]+)/([^?]+)\\?`));
    if (req.method === "POST" && uploadMatch) {
      const key = `${decodeURIComponent(uploadMatch[2])}/${decodeURIComponent(uploadMatch[3])}`;
      const image = { id: `new-image-${(images[key] ?? []).length}`, sha256: "test-sha", url: "https://example.test/new.png",
        imageBase64: "must-not-be-returned", localPath: "/private/operator/image.png", oversized: "x".repeat(100_000) };
      images[key] = [...(images[key] ?? []), image];
      res.end(JSON.stringify({ image })); return;
    }
    const bundleUploadMatch = req.url?.match(new RegExp(`^${uploadBase}/edits/([0-9]+)/bundles\\?`));
    if (req.method === "POST" && bundleUploadMatch) {
      const bundle = { versionCode: "200", sha256: "bundle-sha" };
      bundles.push({ ...bundle, bytes: Buffer.byteLength(body) });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      res.end(JSON.stringify(bundle)); return;
    }
    if (req.method === "POST" && req.url === `${base}/dataSafety`) {
      dataSafety = JSON.parse(body).safetyLabels;
      res.end("{}"); return;
    }
    if (req.method === "POST" && req.url === `${base}/pricing:convertRegionPrices`) {
      convertedPrice = JSON.parse(body);
      res.end(JSON.stringify({ convertedRegionPrices: { US: { regionCode: "US", price: convertedPrice.price } } })); return;
    }
    if (req.method === "POST" && req.url === `${base}/edits`) {
      res.end(JSON.stringify({ id: String(++nextEdit) })); return;
    }
    const editMatch = req.url?.match(new RegExp(`^${base}/edits/([0-9]+)(.*)$`));
    if (editMatch) {
      const suffix = editMatch[2];
      if (req.method === "DELETE" && suffix === "") { res.writeHead(204).end(); return; }
      if (req.method === "GET" && suffix === "/tracks") {
        res.end(JSON.stringify({ tracks: Object.values(tracks) })); return;
      }
      if (req.method === "GET" && suffix === "/listings") {
        res.end(JSON.stringify({ listings: Object.values(listings) })); return;
      }
      const listingMatch = suffix.match(/^\/listings\/([^/]+)$/);
      if (listingMatch && req.method === "PATCH") {
        const locale = decodeURIComponent(listingMatch[1]);
        listings[locale] = { ...(listings[locale] ?? { language: locale }), ...JSON.parse(body) };
        res.end(JSON.stringify(listings[locale])); return;
      }
      const imageMatch = suffix.match(/^\/listings\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/);
      if (imageMatch && req.method === "GET") {
        res.end(JSON.stringify({ images: images[`${decodeURIComponent(imageMatch[1])}/${decodeURIComponent(imageMatch[2])}`] ?? [] })); return;
      }
      if (imageMatch?.[3] && req.method === "DELETE") {
        const key = `${decodeURIComponent(imageMatch[1])}/${decodeURIComponent(imageMatch[2])}`;
        images[key] = (images[key] ?? []).filter((image) => image.id !== decodeURIComponent(imageMatch[3]));
        res.writeHead(204).end(); return;
      }
      const trackMatch = suffix.match(/^\/tracks\/(.+)$/);
      if (trackMatch && req.method === "GET") {
        res.end(JSON.stringify(tracks[decodeURIComponent(trackMatch[1])])); return;
      }
      if (trackMatch && req.method === "PUT") {
        tracks[decodeURIComponent(trackMatch[1])] = JSON.parse(body);
        res.end(body); return;
      }
      if (req.method === "POST" && suffix === ":validate") { res.end(JSON.stringify({ id: editMatch[1] })); return; }
      if (req.method === "POST" && suffix === ":commit") { res.end(JSON.stringify({ id: editMatch[1], expiryTimeSeconds: "0" })); return; }
    }
    res.writeHead(404).end(JSON.stringify({ error: { message: "not found" } }));
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  return { requests, tracks, listings, images, bundles, get dataSafety() { return dataSafety; }, get convertedPrice() { return convertedPrice; }, url: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

test("manifest declares bounded credentials, API hosts, and project-file reads", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, "armory.package.json"), "utf8"));
  assert.equal(manifest.id, "google-play");
  assert.deepEqual(manifest.permissions.networkHosts, ["androidpublisher.googleapis.com", "oauth2.googleapis.com"]);
  assert.deepEqual(manifest.permissions.hostPaths, [{
    path: "~/Projects", mode: "read",
    purpose: "Read operator-selected screenshots, store graphics, and Android App Bundles for Google Play upload.",
  }]);
  assert.deepEqual(manifest.configuration.managedPaths, ["config/google-play.json"]);
  assert.equal(manifest.configuration.fields[0].type, "file");
  assert.deepEqual(manifest.configuration.fields.map((field) => field.id), ["serviceAccountJson"]);
});

test("configures, verifies, inspects, and safely commits release changes without leaking secrets", async () => {
  const fake = await startGoogleApi();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "armory-google-play-"));
  const projectsRoot = path.join(home, "Projects");
  await fs.mkdir(projectsRoot);
  const imagePath = path.join(projectsRoot, "phone.png");
  const jpegPath = path.join(projectsRoot, "phone.jpg");
  const mismatchPath = path.join(projectsRoot, "mismatch.jpg");
  const unsupportedPath = path.join(projectsRoot, "phone.gif");
  const oversizedPath = path.join(projectsRoot, "oversized.png");
  const missingPath = path.join(projectsRoot, "missing.png");
  const directoryPath = path.join(projectsRoot, "directory.png");
  const racePath = path.join(projectsRoot, "race.png");
  const mutationRacePath = path.join(projectsRoot, "mutation-race.png");
  const bundlePath = path.join(projectsRoot, "app-release.aab");
  const outsideImagePath = path.join(home, "outside.png");
  const linkedImagePath = path.join(projectsRoot, "linked.png");
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("test-png")]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  await fs.writeFile(imagePath, png);
  await fs.writeFile(jpegPath, jpeg);
  await fs.writeFile(mismatchPath, png);
  await fs.writeFile(unsupportedPath, "GIF89a");
  await fs.writeFile(oversizedPath, png);
  await fs.truncate(oversizedPath, 15 * 1024 * 1024 + 1);
  await fs.mkdir(directoryPath);
  await fs.writeFile(racePath, png);
  await fs.writeFile(mutationRacePath, png);
  await fs.writeFile(bundlePath, "fake android app bundle");
  await fs.writeFile(outsideImagePath, "outside");
  await fs.symlink(outsideImagePath, linkedImagePath);
  const packageInfo = { id: "google-play", version: "0.4.1", dir: packageDir, home };
  const platform = { os: process.platform === "darwin" ? "darwin" : "linux", arch: process.arch === "arm64" ? "arm64" : "x64" };
  const env = {
    NODE_ENV: "test",
    HOME: path.join(home, "isolated-runtime-home"),
    PEON_ARMORY_HOST_HOME: home,
    GOOGLE_PLAY_TEST_TOKEN_URL: `${fake.url}/token`,
    GOOGLE_PLAY_TEST_API_URL: `${fake.url}/androidpublisher/v3`,
    GOOGLE_PLAY_TEST_IMAGE_READ_DELAY_MS: "150",
  };
  try {
    const configured = await runHook("configure", {
      protocolVersion: 1, type: "input", operation: "configure", package: packageInfo, platform,
      configuration: { serviceAccountJson: credentials },
    }, env);
    assert.equal(configured.code, 0, configured.stderr);
    assert.equal(configured.stdout.includes(privateKeySecret), false);
    assert.equal(JSON.parse(configured.stdout).ok, true);
    const stored = await fs.stat(path.join(home, "config", "google-play.json"));
    assert.equal(stored.mode & 0o777, 0o600);

    const verified = await runHook("verify", { protocolVersion: 1, type: "input", operation: "verify", package: packageInfo, platform }, env);
    assert.equal(verified.code, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).ok, true);

    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(packageDir, "dist", "mcp.js")], env: { ...process.env, ...env, PEON_ARMORY_HOME: home } });
    const client = new Client({ name: "google-play-package-test", version: "0.2.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), ["list_releases", "list_tracks", "list_listings", "update_listing", "list_images", "upload_image", "upload_bundle", "get_bundle_upload_status", "delete_image", "update_data_safety", "convert_region_prices", "promote_release", "update_rollout"]);
      await client.callTool({ name: "list_releases", arguments: { packageName: defaultPackage } });
      await client.callTool({ name: "list_tracks", arguments: { packageName: defaultPackage } });
      await client.callTool({ name: "list_listings", arguments: { packageName: defaultPackage } });
      await client.callTool({ name: "update_listing", arguments: { packageName: defaultPackage, language: "en-US", shortDescription: "After", confirmation: "CONFIRM_PLAY_CONSOLE_CHANGE" } });
      await client.callTool({ name: "list_images", arguments: { packageName: defaultPackage, language: "en-US", imageType: "phoneScreenshots" } });
      const expectImageError = async (filePath, code, confirmation = "CONFIRM_PLAY_CONSOLE_CHANGE") => {
        const result = await client.callTool({ name: "upload_image", arguments: {
          packageName: defaultPackage, language: "en-US", imageType: "phoneScreenshots", filePath, confirmation,
        } });
        assert.equal(result.isError, true, `expected ${code} for ${filePath}`);
        assert.match(result.content.map((item) => item.text ?? "").join("\n"), new RegExp(code));
      };
      const outsideUpload = await client.callTool({ name: "upload_image", arguments: { packageName: defaultPackage, language: "en-US", imageType: "phoneScreenshots", filePath: outsideImagePath, confirmation: "CONFIRM_PLAY_CONSOLE_CHANGE" } });
      assert.equal(outsideUpload.isError, true);
      assert.match(outsideUpload.content[0].text, /IMAGE_PATH_OUTSIDE_ROOT/);
      const symlinkUpload = await client.callTool({ name: "upload_image", arguments: { packageName: defaultPackage, language: "en-US", imageType: "phoneScreenshots", filePath: linkedImagePath, confirmation: "CONFIRM_PLAY_CONSOLE_CHANGE" } });
      assert.equal(symlinkUpload.isError, true);
      assert.match(symlinkUpload.content[0].text, /IMAGE_PATH_OUTSIDE_ROOT|IMAGE_SYMLINK_UNSUPPORTED/);
      await expectImageError(missingPath, "IMAGE_FILE_MISSING");
      await expectImageError(directoryPath, "IMAGE_NOT_REGULAR");
      await expectImageError(unsupportedPath, "IMAGE_MEDIA_UNSUPPORTED");
      await expectImageError(mismatchPath, "IMAGE_MEDIA_MISMATCH");
      await expectImageError(oversizedPath, "IMAGE_SIZE_INVALID");
      const badConfirmation = await client.callTool({ name: "upload_image", arguments: {
        packageName: defaultPackage, language: "en-US", imageType: "phoneScreenshots", filePath: imagePath,
        confirmation: "yes",
      } });
      assert.equal(badConfirmation.isError, true);

      const pngUpload = await client.callTool({ name: "upload_image", arguments: { packageName: defaultPackage, language: "en-US", imageType: "phoneScreenshots", filePath: imagePath, confirmation: "CONFIRM_PLAY_CONSOLE_CHANGE" } });
      const pngResult = JSON.parse(pngUpload.content[0].text);
      assert.deepEqual(Object.keys(pngResult).sort(), ["committed", "image"]);
      assert.deepEqual(Object.keys(pngResult.image).sort(), ["id", "sha256", "url"]);
      assert(JSON.stringify(pngResult).length < 4096);
      assert.equal(JSON.stringify(pngResult).includes("imageBase64"), false);
      assert.equal(JSON.stringify(pngResult).includes(imagePath), false);
      await client.callTool({ name: "upload_image", arguments: { packageName: defaultPackage, language: "en-US", imageType: "phoneScreenshots", filePath: jpegPath, confirmation: "CONFIRM_PLAY_CONSOLE_CHANGE" } });

      const raceUpload = client.callTool({ name: "upload_image", arguments: { packageName: defaultPackage, language: "en-US", imageType: "phoneScreenshots", filePath: racePath, confirmation: "CONFIRM_PLAY_CONSOLE_CHANGE" } });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const replacementPath = path.join(projectsRoot, "replacement.png");
      await fs.writeFile(replacementPath, png);
      await fs.rename(replacementPath, racePath);
      const raceResult = await raceUpload;
      assert.equal(raceResult.isError, true);
      assert.match(raceResult.content[0].text, /IMAGE_FILE_CHANGED/);

      const mutationRaceUpload = client.callTool({ name: "upload_image", arguments: { packageName: defaultPackage, language: "en-US", imageType: "phoneScreenshots", filePath: mutationRacePath, confirmation: "CONFIRM_PLAY_CONSOLE_CHANGE" } });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await fs.writeFile(mutationRacePath, Buffer.concat([png.subarray(0, 8), Buffer.from("changed!")]));
      const mutationRaceResult = await mutationRaceUpload;
      assert.equal(mutationRaceResult.isError, true);
      assert.match(mutationRaceResult.content[0].text, /IMAGE_FILE_CHANGED/);
      const uploadStartedAt = Date.now();
      const uploadStarted = await client.callTool({ name: "upload_bundle", arguments: { packageName: defaultPackage, filePath: bundlePath, confirmation: "CONFIRM_PLAY_CONSOLE_CHANGE" } });
      assert(Date.now() - uploadStartedAt < 750, "upload_bundle must return before the delayed Google upload finishes");
      const uploadOperation = JSON.parse(uploadStarted.content[0].text);
      assert.equal(uploadOperation.status, "running");
      let uploadStatus;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const polled = await client.callTool({ name: "get_bundle_upload_status", arguments: { operationId: uploadOperation.operationId } });
        uploadStatus = JSON.parse(polled.content[0].text);
        if (uploadStatus.status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(uploadStatus.status, "succeeded");
      await client.callTool({ name: "delete_image", arguments: { packageName: defaultPackage, language: "en-US", imageType: "phoneScreenshots", imageId: "old-image", confirmation: "CONFIRM_PLAY_CONSOLE_CHANGE" } });
      await client.callTool({ name: "update_data_safety", arguments: { packageName: defaultPackage, safetyLabelsCsv: "Question,Answer\nexample,true", confirmation: "CONFIRM_PLAY_CONSOLE_CHANGE" } });
      await client.callTool({ name: "convert_region_prices", arguments: { packageName: defaultPackage, currencyCode: "USD", units: "5", nanos: 990000000 } });
      await client.callTool({ name: "promote_release", arguments: { packageName: defaultPackage, targetTrack: "beta", versionCodes: ["100"], name: "1.0 beta", status: "draft", confirmation: "CONFIRM_RELEASE_CHANGE" } });
      await client.callTool({ name: "update_rollout", arguments: { packageName: defaultPackage, track: "production", versionCode: "100", status: "completed", confirmation: "CONFIRM_RELEASE_CHANGE" } });
    } finally { await client.close(); }

    assert.equal(fake.tracks.beta.releases[0].status, "draft");
    assert.equal(fake.tracks.production.releases[0].status, "completed");
    assert.equal(fake.listings["en-US"].shortDescription, "After");
    assert.deepEqual(fake.images["en-US/phoneScreenshots"].map((image) => image.id), ["new-image-1", "new-image-2"]);
    assert.deepEqual(fake.bundles, [{ versionCode: "200", sha256: "bundle-sha", bytes: 23 }]);
    assert.equal(fake.dataSafety, "Question,Answer\nexample,true");
    assert.equal(fake.convertedPrice.price.currencyCode, "USD");
    assert.equal("userFraction" in fake.tracks.production.releases[0], false);
    assert(fake.requests.some((request) => request.method === "DELETE"));
    assert.equal(fake.requests.filter((request) => request.url?.endsWith(":validate")).length, 7);
    assert.equal(fake.requests.filter((request) => request.url?.endsWith(":commit")).length, 7);
    const imageUploads = fake.requests.filter((request) => request.url?.includes("/listings/en-US/phoneScreenshots?"));
    assert.deepEqual(imageUploads.map((request) => request.contentType), ["image/png", "image/jpeg"]);
    assert.equal(fake.requests.some((request) => request.url?.includes("/tracks/production/releases")), false);
    const serialized = JSON.stringify(fake.requests);
    assert.equal(serialized.includes(privateKeySecret), false);
    assert.equal(serialized.includes(accessToken), true);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fake.close();
  }
});
