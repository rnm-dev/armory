import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { repoRoot } from "../scripts/schema-utils.mjs";

test("release task requires explicit confirmation before doing any work", () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "release-package.mjs"), "cloudflare"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--confirm/);
  assert.match(result.stderr, /immutable GitHub Release/);
});
